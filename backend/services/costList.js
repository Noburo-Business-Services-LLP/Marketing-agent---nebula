'use strict';
/**
 * What the Settings > Billing price list needs beyond the per-unit cost map (GET /api/credits `pricing`):
 * the length of one video part and the most parts a video can have (so the page can show a 10, 20 or 30 second
 * video's price as parts x `studio_video`), and the Photoshoot packs with their photo counts (a pack costs
 * `photoshoot_image` x its photos). No price is set here: every number is read from the config it lives in.
 */
const { STUDIO_CLIP_SECONDS } = require('../config/apiCosts');
const { MAX_CLIPS } = require('./studioVideo');
const { PACKS } = require('../config/photoshootPacks');

const caps = require('../config/photoshoot');

/** Same reading of the Photoshoot switch as the photoshoot service: only the exact word "on" opens it. */
const photoshootOn = (env = process.env) => String((env && env[caps.SWITCH_ENV]) || '').trim().toLowerCase() === 'on';

/** While Photoshoot is off the packs are not sent, so the price list shows no Photoshoot rows. */
function pricingExtras(env = process.env) {
  const out = {
    videoPartSeconds: STUDIO_CLIP_SECONDS,
    videoMaxParts: MAX_CLIPS,
  };
  if (photoshootOn(env)) out.photoshootPacks = PACKS.map((p) => ({ key: p.key, title: p.title, photos: p.defaultCount, counts: p.counts.slice() }));
  return out;
}

/** The cost map for the price list: without the photo price while Photoshoot is off. The input is never changed. */
function visibleCosts(costs, env = process.env) {
  if (photoshootOn(env)) return costs;
  const { photoshoot_image: _hidden, ...rest } = costs || {};
  return rest;
}

module.exports = { pricingExtras, visibleCosts, photoshootOn };
