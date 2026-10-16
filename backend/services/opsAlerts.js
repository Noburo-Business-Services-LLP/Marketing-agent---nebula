/**
 * Owner alerts: email the team when a provider starts failing repeatedly, so outages are
 * noticed before customers report them. In memory per server process; one email per
 * category per cooldown. Never throws into the caller.
 *
 * Env: ALERT_EMAILS (comma-separated; no alerts if empty), RESEND_API_KEY, RESEND_FROM_EMAIL,
 * ALERT_THRESHOLD (default 3), ALERT_WINDOW_MINUTES (10), ALERT_COOLDOWN_MINUTES (60).
 */

const LABELS = {
  image: 'Image generation',
  publish: 'Publishing to social media',
  social_connect: 'Connecting social accounts',
  payment: 'Payments',
  ai_text: 'AI writing',
  video: 'Video generation',
  hero_video: 'Hero videos',
  billing: 'Automatic monthly invoices',
  provider_credits: 'A provider account has run out of credits'
};

function createAlerter({ env = process.env, now = () => Date.now(), send = null } = {}) {
  const threshold = Number(env.ALERT_THRESHOLD) || 3;
  const windowMs = (Number(env.ALERT_WINDOW_MINUTES) || 10) * 60000;
  const cooldownMs = (Number(env.ALERT_COOLDOWN_MINUTES) || 60) * 60000;
  const failures = new Map();
  const lastSent = new Map();
  const history = new Map(); // category -> [{ at, detail }], kept for a day, capped, for the staff Home screen
  const startedAt = now();

  const recipients = () => String(env.ALERT_EMAILS || '').split(',').map((s) => s.trim()).filter(Boolean);

  const sendEmail = send || (async ({ to, subject, text }) => {
    if (!env.RESEND_API_KEY) return;
    const { Resend } = require('resend');
    await new Resend(env.RESEND_API_KEY).emails.send({ from: env.RESEND_FROM_EMAIL || 'noreply@nebulaa.ai', to, subject, text });
  });

  async function recordFailure(category, detail = '') {
    try {
      const t = now();
      const past = (history.get(category) || []).filter((x) => t - x.at < 86400000);
      past.push({ at: t, detail: String(detail || '').slice(0, 300) });
      history.set(category, past.slice(-60));
      const list = (failures.get(category) || []).filter((x) => t - x.at < windowMs);
      list.push({ at: t, detail: String(detail || '').slice(0, 300) });
      failures.set(category, list);
      if (list.length < threshold) return false;
      if (t - (lastSent.get(category) ?? -Infinity) < cooldownMs) return false;
      const to = recipients();
      if (to.length === 0) return false;
      lastSent.set(category, t);
      const label = LABELS[category] || category;
      const lines = list.slice(-5).map((x) => `- ${new Date(x.at).toISOString()}  ${x.detail}`);
      await sendEmail({
        to,
        subject: `Nebulaa alert: ${label} is failing`,
        text: `${label} failed ${list.length} times in the last ${windowMs / 60000} minutes.\n\nLatest errors:\n${lines.join('\n')}\n\nCheck the backend logs. You will not get another alert for this for ${cooldownMs / 60000} minutes.`
      });
      return true;
    } catch (error) {
      console.error('[opsAlerts] could not send alert:', error.message);
      return false;
    }
  }

  /**
   * Something that needs a person at once, such as a provider account out of credits. One occurrence is enough,
   * and the same provider is not repeated for six hours.
   */
  async function recordCritical(provider, detail = '') {
    try {
      const t = now();
      const key = `provider_credits:${provider}`;
      const past = (history.get('provider_credits') || []).filter((x) => t - x.at < 86400000);
      past.push({ at: t, detail: `${provider}: ${String(detail || '').slice(0, 260)}` });
      history.set('provider_credits', past.slice(-60));
      if (t - (lastSent.get(key) ?? -Infinity) < 6 * 3600000) return false;
      const to = recipients();
      if (to.length === 0) return false;
      lastSent.set(key, t);
      await sendEmail({
        to,
        subject: `Nebulaa alert: ${provider} has run out of credits`,
        text: `${provider} refused a request because the account has no credits left. Images and other generation that depends on it will fail or fall back to a weaker option until credits are added.\n\nLatest message: ${String(detail || '').slice(0, 300)}\n\nAdd credits in the provider's billing page and switch on auto-recharge. You will not get another alert for ${provider} for 6 hours.`
      });
      return true;
    } catch (error) {
      console.error('[opsAlerts] could not send critical alert:', error.message);
      return false;
    }
  }

  /** Failures seen since this server started: counts for the last hour and day, and the latest few. */
  function snapshot() {
    const t = now();
    const out = {};
    for (const [category, items] of history.entries()) {
      const day = items.filter((x) => t - x.at < 86400000);
      out[category] = {
        lastHour: day.filter((x) => t - x.at < 3600000).length,
        lastDay: day.length,
        latest: day.slice(-3).reverse().map((x) => ({ at: new Date(x.at).toISOString(), detail: x.detail }))
      };
    }
    return { since: new Date(startedAt).toISOString(), categories: out };
  }

  // A plain alert with its own wording, sent at most once per `key` within `cooldownMs`. Never throws.
  async function notify({ key, subject, text, cooldownMs = 6 * 3600000 }) {
    try {
      const t = now();
      if (t - (lastSent.get(key) ?? -Infinity) < cooldownMs) return false;
      const to = recipients();
      if (to.length === 0) return false;
      lastSent.set(key, t);
      await sendEmail({ to, subject, text });
      return true;
    } catch (error) {
      console.error('[opsAlerts] could not send alert:', error.message);
      return false;
    }
  }

  return { recordFailure, recordCritical, notify, snapshot };
}

const shared = createAlerter();
module.exports = { createAlerter, recordFailure: (...args) => shared.recordFailure(...args), recordCritical: (...args) => shared.recordCritical(...args), notify: (...args) => shared.notify(...args), snapshot: () => shared.snapshot() };
