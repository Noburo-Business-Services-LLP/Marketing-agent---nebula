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
  ai_text: 'AI writing'
};

function createAlerter({ env = process.env, now = () => Date.now(), send = null } = {}) {
  const threshold = Number(env.ALERT_THRESHOLD) || 3;
  const windowMs = (Number(env.ALERT_WINDOW_MINUTES) || 10) * 60000;
  const cooldownMs = (Number(env.ALERT_COOLDOWN_MINUTES) || 60) * 60000;
  const failures = new Map();
  const lastSent = new Map();

  const recipients = () => String(env.ALERT_EMAILS || '').split(',').map((s) => s.trim()).filter(Boolean);

  const sendEmail = send || (async ({ to, subject, text }) => {
    if (!env.RESEND_API_KEY) return;
    const { Resend } = require('resend');
    await new Resend(env.RESEND_API_KEY).emails.send({ from: env.RESEND_FROM_EMAIL || 'noreply@nebulaa.ai', to, subject, text });
  });

  async function recordFailure(category, detail = '') {
    try {
      const t = now();
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

  return { recordFailure };
}

const shared = createAlerter();
module.exports = { createAlerter, recordFailure: (...args) => shared.recordFailure(...args) };
