'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pricingExtras } = require('../services/costList');
const { STUDIO_CLIP_SECONDS, QUARK_COSTS } = require('../config/apiCosts');
const { MAX_CLIPS } = require('../services/studioVideo');
const { PACKS } = require('../config/photoshootPacks');

test('the price list extras come from the configs and carry no price of their own', () => {
  const x = pricingExtras();
  assert.equal(x.videoPartSeconds, STUDIO_CLIP_SECONDS);
  assert.equal(x.videoMaxParts, MAX_CLIPS);
  assert.equal(x.photoshootPacks.length, PACKS.length);
  for (const [i, p] of x.photoshootPacks.entries()) {
    assert.equal(p.key, PACKS[i].key);
    assert.equal(p.title, PACKS[i].title);
    assert.equal(p.photos, PACKS[i].defaultCount);
    assert.deepEqual(p.counts, PACKS[i].counts);
    assert.ok(!('quarks' in p) && !('price' in p), 'no price is typed into the extras');
  }
  // A 10, 20 and 30 second video: parts times the per-part price, as the Videos page shows it.
  for (const seconds of [10, 20, 30]) assert.ok(seconds / x.videoPartSeconds <= x.videoMaxParts, `${seconds} s is offered`);
  assert.ok(QUARK_COSTS.studio_video > 0 && QUARK_COSTS.photoshoot_image > 0);
});

test('GET /api/credits sends the extras next to the costs and units, in both answers', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'credits.js'), 'utf8');
  const hits = src.match(/pricing: pricingExtras\(\)/g) || [];
  assert.equal(hits.length, 2);
  assert.ok(src.includes("require('../services/costList')"));
});
