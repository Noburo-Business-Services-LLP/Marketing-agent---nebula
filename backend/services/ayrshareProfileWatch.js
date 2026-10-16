'use strict';
/**
 * Ayrshare Business plan: a flat fee covers the first 30 social profiles, each one after that is billed extra
 * (USD 8.99 a month in October 2026). Every connected account and every agency client workspace that has a profile
 * is one profile. The numbers live in config/vendorPlans.js. We count from our own data and never call Ayrshare.
 */
const { AYRSHARE } = require('../config/vendorPlans');

const PROFILE_LIMIT = AYRSHARE.includedProfiles;
const ALERT_AT = AYRSHARE.alertAtProfiles;
const STATE_KEY = 'ayrshare_profile_alert';
const RANK = { ok: 0, near: 1, over: 2 };

// Same test everywhere: an account counts only when it really has a profile key.
const PROFILE_FILTER = { 'ayrshare.profileKey': { $exists: true, $nin: [null, ''] } };

function status(count) {
  const level = count > PROFILE_LIMIT ? 'over' : count >= ALERT_AT ? 'near' : 'ok';
  const message = level === 'over'
    ? `${count} connected social profiles: past the ${PROFILE_LIMIT} covered by the flat fee, so each extra profile now costs extra every month. Review the Agency and Publish prices.`
    : level === 'near'
      ? `${count} of ${PROFILE_LIMIT} connected social profiles used. Past ${PROFILE_LIMIT} each profile costs extra, so plan the price change for new Agency sign-ups.`
      : `${count} of ${PROFILE_LIMIT} connected social profiles used.`;
  return { count, limit: PROFILE_LIMIT, alertAt: ALERT_AT, level, message };
}

const countProfiles = ({ User }) => User.countDocuments(PROFILE_FILTER);

/** Durable store for the last alerted level (one record in the database). */
function modelStore(Model) {
  return {
    async load() { const d = await Model.findOne({ key: STATE_KEY }).lean(); return (d && RANK[d.value] !== undefined) ? d.value : 'ok'; },
    async save(level) { await Model.updateOne({ key: STATE_KEY }, { $set: { value: level } }, { upsert: true }); }
  };
}

/** Sends the message through the shared owner-alert path. The durable state does the de-duplication, so no cooldown here. */
const opsAlert = (alerter) => (message) => alerter.notify({
  key: STATE_KEY,
  subject: 'Nebulaa alert: social profiles are close to the plan limit',
  text: `${message}\n\nThis is counted from our own accounts. You will not get this again unless the count drops below ${ALERT_AT} and rises again, or passes ${PROFILE_LIMIT}.`,
  cooldownMs: 0
});

/**
 * Alerts the owner once per episode: when the count first reaches the alert level, and once more if it passes the limit.
 * It re-arms only after the count falls below the alert level. The level is recorded only after the alert was really sent.
 */
async function check({ User, alert, state = {}, store = null }) {
  const s = status(await countProfiles({ User }));
  const st = store || { load: async () => state.level || 'ok', save: async (l) => { state.level = l; } };
  const last = await st.load();
  if (s.level === 'ok') {
    if (last !== 'ok') await st.save('ok');
  } else if (RANK[s.level] > RANK[last]) {
    let sent = false;
    try { sent = (await alert(s.message)) !== false; } catch (_) { /* alerting never stops the check */ }
    if (sent) await st.save(s.level);
  }
  return s;
}

module.exports = { PROFILE_LIMIT, ALERT_AT, PROFILE_FILTER, status, countProfiles, modelStore, opsAlert, check };
