/**
 * Cost safety. Three things, all cheap enough to run on every request:
 *   1. A daily ceiling on estimated AI spend. A warning email at 70 percent, another when it is reached, and from
 *      then on new things are refused until the next UTC day (or the ceiling is raised).
 *   2. A switch per provider that the owner can flip to stop it being used.
 *   3. The record of what was spent today, for the staff screen.
 * Spend is estimated from config/apiCosts.js (what the provider charges us per unit), not read from the providers.
 *
 * Env: AI_DAILY_SPEND_CAP_USD (default 150; 0 turns the ceiling off), AI_KILLED (comma list of providers that are always off).
 */
const { ACTION_USD } = require('../config/apiCosts');

const PROVIDER_OF = {
  image_generated: 'openai_image', image_edit: 'openai_image', refine_image: 'openai_image', campaign_full: 'openai_image',
  carousel_generated: 'openai_image', rival_post: 'openai_image', strategic_post: 'openai_image', event_post: 'openai_image',
  studio_reference: 'openai_image', blueprint_pdf: 'openai_image',
  campaign_text: 'openai_text', chat_message: 'openai_text', blueprint: 'openai_text',
  studio_video: 'google_video',
  hero_video_clip: 'fal_video', video_base: 'fal_video', video_generated: 'fal_video', video_scene_image: 'fal_video',
  video_scene_clip: 'fal_video', video_character_portrait: 'fal_video',
  competitor_scrape: 'apify_scrape'
};
const LABELS = { openai_image: 'Pictures', openai_text: 'Writing', google_video: 'Videos', fal_video: 'Older video maker', apify_scrape: 'Competitor checks' };
const PROVIDERS = Object.keys(LABELS);
const BUSY = 'Making things is very busy right now. Please try again in a little while. Nothing was charged.';

const providerOf = (action) => PROVIDER_OF[String(action || '')] || null;
const dayOf = (now = new Date()) => now.toISOString().slice(0, 10);

function createSpendGuard({
  Spend = () => require('../models/AiSpendDay'),
  Switch = () => require('../models/AiSwitch'),
  alert = (a) => require('./opsAlerts').notify(a),
  env = process.env,
  now = () => new Date(),
  cacheMs = 15000
} = {}) {
  let cache = { at: 0, switches: new Map(), total: 0, day: '' };

  const cap = () => {
    const raw = env.AI_DAILY_SPEND_CAP_USD;
    const n = raw === undefined || raw === '' ? 150 : Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 150;
  };
  const killedByEnv = () => new Set(String(env.AI_KILLED || '').split(',').map((s) => s.trim()).filter(Boolean));

  async function refresh() {
    const t = now().getTime();
    if (t - cache.at < cacheMs && cache.day === dayOf(now())) return cache;
    const [rows, today] = await Promise.all([
      Switch().find({ disabled: true }).lean().catch(() => []),
      Spend().findOne({ day: dayOf(now()) }).lean().catch(() => null)
    ]);
    cache = { at: t, day: dayOf(now()), switches: new Map(rows.map((r) => [r.provider, r])), total: Number(today && today.totalUsd) || 0 };
    return cache;
  }

  /** Can this kind of work start? Never throws: if the checks themselves fail, the work is allowed. */
  async function check(action) {
    try {
      const provider = providerOf(action);
      if (!provider) return { ok: true };
      if (killedByEnv().has(provider)) return { ok: false, reason: 'switched_off', provider, message: BUSY };
      const c = await refresh();
      if (c.switches.has(provider)) return { ok: false, reason: 'switched_off', provider, message: BUSY };
      const limit = cap();
      if (limit > 0 && c.total >= limit) return { ok: false, reason: 'daily_cap', provider, message: BUSY };
      return { ok: true };
    } catch (_) {
      return { ok: true };
    }
  }

  /** Adds what one finished charge cost us. Warns at 70 percent and at the ceiling, once each per day. */
  async function record(action, units = 1) {
    try {
      const provider = providerOf(action);
      const unit = Number(ACTION_USD[action]);
      if (!provider || !Number.isFinite(unit)) return null;
      const usd = unit * (Number(units) > 0 ? Number(units) : 1);
      const day = dayOf(now());
      const doc = await Spend().findOneAndUpdate({ day }, { $inc: { totalUsd: usd, [`byProvider.${provider}`]: usd } }, { upsert: true, new: true });
      cache.total = doc.totalUsd; cache.day = day;
      const limit = cap();
      if (limit > 0) {
        if (doc.totalUsd >= limit && !doc.alerted100) {
          const first = await Spend().findOneAndUpdate({ day, alerted100: { $ne: true } }, { $set: { alerted100: true } });
          if (first) await alert({ key: 'ai_cap_100', cooldownMs: 6 * 3600000, subject: 'Nebulaa alert: the daily AI spend ceiling has been reached', text: `Estimated AI spend today is about $${doc.totalUsd.toFixed(2)}, which reaches the ceiling of $${limit}. New posts, pictures and videos are being refused until tomorrow (UTC). To carry on today, raise AI_DAILY_SPEND_CAP_USD and restart, or check that nothing is looping.` });
        } else if (doc.totalUsd >= limit * 0.7 && !doc.alerted70) {
          const first = await Spend().findOneAndUpdate({ day, alerted70: { $ne: true } }, { $set: { alerted70: true } });
          if (first) await alert({ key: 'ai_cap_70', cooldownMs: 6 * 3600000, subject: 'Nebulaa alert: AI spend is at 70% of today’s ceiling', text: `Estimated AI spend today is about $${doc.totalUsd.toFixed(2)} of the $${limit} ceiling. If this is expected, no action is needed. If not, look for a runaway job.` });
        }
      }
      return doc;
    } catch (e) {
      console.error('[spendGuard] could not record spend:', e.message);
      return null;
    }
  }

  async function status() {
    const [rows, today] = await Promise.all([Switch().find({}).lean().catch(() => []), Spend().findOne({ day: dayOf(now()) }).lean().catch(() => null)]);
    const off = killedByEnv();
    return {
      day: dayOf(now()), capUsd: cap(), totalUsd: Number(today && today.totalUsd) || 0, byProvider: (today && today.byProvider) || {},
      providers: PROVIDERS.map((p) => {
        const row = rows.find((r) => r.provider === p);
        return { provider: p, label: LABELS[p], disabled: off.has(p) || !!(row && row.disabled), lockedByEnv: off.has(p), note: (row && row.note) || '' };
      })
    };
  }

  async function setSwitch(provider, disabled, { note = '', by = '' } = {}) {
    if (!PROVIDERS.includes(provider)) return { ok: false, message: 'Unknown provider.' };
    await Switch().findOneAndUpdate({ provider }, { $set: { disabled: !!disabled, note: String(note).slice(0, 200), updatedBy: String(by).slice(0, 80) } }, { upsert: true, new: true });
    cache.at = 0;
    return { ok: true };
  }

  return { check, record, status, setSwitch, providerOf, PROVIDERS, LABELS, BUSY };
}

const shared = createSpendGuard();
module.exports = { createSpendGuard, providerOf, dayOf, PROVIDERS, LABELS, BUSY, check: (...a) => shared.check(...a), record: (...a) => shared.record(...a), status: (...a) => shared.status(...a), setSwitch: (...a) => shared.setSwitch(...a) };
