'use strict';
// The one Photoshoot service of this server process (the routes and the resume loop share it, so the runner knows which
// jobs it is already running), and the loop that picks up jobs whose runner was lost in a restart.
const caps = require('../../config/photoshoot');

let instance = null;
function shared() {
  if (!instance) instance = require('./service').createPhotoshoot();
  return instance;
}

/** Once shortly after start, then every RESUME_EVERY_MS. Off with ENABLE_PHOTOSHOOT_RESUME=off. Never throws. */
function startPhotoshootResume({ env = process.env, service = shared } = {}) {
  if (String(env.ENABLE_PHOTOSHOOT_RESUME || '').trim().toLowerCase() === 'off') return null;
  const run = () => Promise.resolve().then(() => service().resumeLost()).catch((e) => console.warn('[photoshoot] resume check failed:', e && e.message));
  setTimeout(run, 30 * 1000).unref();
  return setInterval(run, caps.RESUME_EVERY_MS).unref();
}

module.exports = { shared, startPhotoshootResume };
