'use strict';
const test = require('node:test');
const assert = require('node:assert');
const w = require('../config/quarkWording');
const { QUARK_COSTS, outputsFor } = require('../config/apiCosts');

test('a balance is written as Quarks with the posts and videos beside it, from the price list', () => {
  const o = outputsFor(4200);
  assert.strictEqual(w.equivalentText(4200), `about ${o.posts.toLocaleString('en-IN')} posts or ${o.videos.toLocaleString('en-IN')} videos`);
  assert.strictEqual(w.balanceText(4200), `4,200 Quarks (${w.equivalentText(4200)})`);
  assert.strictEqual(w.equivalentText(QUARK_COSTS.image_generated * 3), 'about 3 posts');
  assert.strictEqual(w.balanceText(1), '1 Quarks');
});

test('a price is written as Quarks with what it is worth in videos or posts', () => {
  assert.strictEqual(w.priceText(QUARK_COSTS.studio_video), `${QUARK_COSTS.studio_video.toLocaleString('en-IN')} Quarks (about 1 video's worth)`);
  assert.strictEqual(w.priceText(QUARK_COSTS.image_generated), `${QUARK_COSTS.image_generated} Quarks (about 1 post's worth)`);
  assert.match(w.priceText(QUARK_COSTS.studio_video * 2), /\(about 2 videos' worth\)/);
  assert.strictEqual(w.worthText(0), '');
});

test('server messages that name a figure carry the equivalent', () => {
  const fs = require('fs'); const path = require('path');
  for (const f of ['routes/studioVideos.js', 'routes/videoGeneration.js', 'routes/drafts.js', 'routes/carousels.js', 'middleware/trialGuard.js', 'routes/payment.js', 'services/billingPlans.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.match(src, /priceText|balanceText/, `${f} builds its figures with quarkWording`);
    assert.doesNotMatch(src, /\$\{[^}]+\} Quarks/, `${f} has no bare "N Quarks" figure`);
  }
});
