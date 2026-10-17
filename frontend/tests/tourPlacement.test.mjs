import test from 'node:test';
import assert from 'node:assert/strict';
import { placeCard, spotlightRect } from '../utils/tour.ts';

const vp = { w: 1280, h: 800 }; const card = { w: 320, h: 160 };
const inside = (p) => p.top >= 8 && p.left >= 8 && p.left + card.w <= vp.w - 8 && p.top + card.h <= vp.h - 8;

test('the card goes below the element when it fits', () => {
  const p = placeCard({ target: { top: 100, left: 40, width: 200, height: 40 }, viewport: vp, card });
  assert.equal(p.placement, 'below');
  assert.equal(p.top, 100 + 40 + 12);
  assert.ok(inside(p));
});
test('near the bottom it goes above, and it is always fully on screen', () => {
  const p = placeCard({ target: { top: 740, left: 1200, width: 60, height: 40 }, viewport: vp, card });
  assert.equal(p.placement, 'above');
  assert.ok(inside(p));
  for (const t of [{ top: 0, left: 0, width: 30, height: 30 }, { top: 790, left: 1270, width: 10, height: 10 }, { top: 400, left: 0, width: 1280, height: 20 }]) assert.ok(inside(placeCard({ target: t, viewport: vp, card })), JSON.stringify(t));
});
test('a tall element on a narrow side goes beside it, still on screen', () => {
  const t = { top: 20, left: 0, width: 200, height: 760 };
  const p = placeCard({ target: t, viewport: vp, card });
  assert.equal(p.placement, 'right');
  assert.ok(inside(p));
});
test('on a phone the card is a bottom sheet', () => {
  const p = placeCard({ target: { top: 100, left: 10, width: 50, height: 40 }, viewport: { w: 375, h: 812 }, card: { w: 359, h: 180 } });
  assert.equal(p.placement, 'bottom-sheet');
  assert.equal(p.top, 812 - 180 - 8);
  assert.equal(p.left, 8);
});
test('the spotlight is padded and stays on screen', () => {
  assert.deepEqual(spotlightRect({ top: 100, left: 50, width: 200, height: 40 }, { w: 1280, h: 800 }), { top: 94, left: 44, width: 212, height: 52 });
  const edge = spotlightRect({ top: 0, left: 0, width: 50, height: 40 }, { w: 1280, h: 800 });
  assert.ok(edge.top >= 0 && edge.left >= 0);
});

test('a measured card taller than the estimate still ends inside the viewport', () => {
  for (const vp of [{ w: 375, h: 812 }, { w: 1280, h: 720 }, { w: 800, h: 400 }]) {
    for (const h of [200, 223, 300, vp.h - 16]) {
      const r = placeCard({ target: { top: 300, left: 40, width: 200, height: 60 }, viewport: vp, card: { w: Math.min(360, vp.w - 16), h } });
      assert.ok(r.top >= 8, `top ${r.top}`);
      assert.ok(r.top + h <= vp.h - 8, `bottom ${r.top + h} in ${vp.h}`);
    }
  }
});
