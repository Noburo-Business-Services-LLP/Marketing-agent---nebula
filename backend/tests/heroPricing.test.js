const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PROVIDER_RATES, INFRA, ACTION_USD, QUARK_COSTS, ACTION_UNITS, USD_PER_QUARK, HERO_CLIP_SECONDS
} = require('../config/apiCosts');

// Same shape as the file's own helper: stored once, served N more times.
const assetCost = (mb) =>
  (mb / 1024) * INFRA.cloudinary_per_gb * (1 + INFRA.deliveries_per_asset);

test('Seedance vendor rate and clip length are exported', () => {
  assert.equal(PROVIDER_RATES.seedance_720p_per_sec, 0.3034);
  assert.equal(HERO_CLIP_SECONDS, 15);
});

test('hero_video_clip USD is vendor seconds plus asset cost', () => {
  const expected =
    PROVIDER_RATES.seedance_720p_per_sec * HERO_CLIP_SECONDS +
    assetCost(INFRA.mb_per_scene_clip);
  assert.ok(Math.abs(ACTION_USD.hero_video_clip - expected) < 1e-12);
});

test('hero_video_clip Quarks derive from USD at 3.2x margin', () => {
  const expected = Math.max(1, Math.round((ACTION_USD.hero_video_clip * 3.2) / USD_PER_QUARK));
  assert.equal(QUARK_COSTS.hero_video_clip, expected);
  assert.ok(QUARK_COSTS.hero_video_clip >= 700 && QUARK_COSTS.hero_video_clip <= 760);
});

test('hero_video_clip is priced per clip', () => {
  assert.equal(ACTION_UNITS.hero_video_clip, 'per clip');
});

test('trialGuard CREDIT_COSTS carries the hero price', () => {
  const guard = require('../middleware/trialGuard');
  assert.equal(guard.CREDIT_COSTS.hero_video_clip, QUARK_COSTS.hero_video_clip);
  assert.equal(guard.ACTION_UNITS.hero_video_clip, 'per clip');
});
