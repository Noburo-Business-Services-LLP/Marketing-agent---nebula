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

function pricingExtras() {
  return {
    videoPartSeconds: STUDIO_CLIP_SECONDS,
    videoMaxParts: MAX_CLIPS,
    photoshootPacks: PACKS.map((p) => ({ key: p.key, title: p.title, photos: p.defaultCount, counts: p.counts.slice() })),
  };
}

module.exports = { pricingExtras };
