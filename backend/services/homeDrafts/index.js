'use strict';
// The background sweep of the Home drafts: requests lost in a restart are closed and their Quarks returned even when the
// account never asks for another draft, and refunds that did not land are tried again (see service.js `sweep`).
// One server at a time (an OpsState lease), a bounded batch per run, never a second refund (each row is claimed first).
const caps = require('../../config/homeDrafts');

let instance = null;
function shared() {
  if (!instance) instance = require('./service').createHomeDrafts();
  return instance;
}

/** Once shortly after start, then every SWEEP_EVERY_MS. Off with ENABLE_HOME_DRAFTS_SWEEP=off. Never throws. */
function startHomeDraftsSweep({ env = process.env, service = shared } = {}) {
  if (String(env.ENABLE_HOME_DRAFTS_SWEEP || '').trim().toLowerCase() === 'off') return null;
  const run = () => Promise.resolve().then(() => service().sweep()).catch((e) => console.warn('[home drafts] sweep failed:', e && e.message));
  setTimeout(run, 45 * 1000).unref();
  return setInterval(run, caps.SWEEP_EVERY_MS).unref();
}

module.exports = { shared, startHomeDraftsSweep };
