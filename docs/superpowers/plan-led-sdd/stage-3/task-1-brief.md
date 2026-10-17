### Task 1: The tour engine (pure)

**Files:**
- Create: `frontend/utils/tour.ts`
- Test: `frontend/tests/tour.test.mjs`, `frontend/tests/tourPlacement.test.mjs`

**Interfaces:**
- `TOUR_STEPS: Array<{ id, route, target, title, body, placement?: 'auto' }>` — six steps in this order: `welcome` (route `/dashboard`, target `[data-tour="this-week"]`, "This is your week", "Every week Nebulaa suggests what to make, based on your plan. Say yes and the posts are made for you."), `create` (target `[data-tour="nav-create"]`, "Make something yourself", "Posts, carousels and videos start here, when you want to make one now."), `review` (target `[data-tour="nav-review"]`, "Review and approve", "Everything Nebulaa makes waits here until you approve it."), `calendar` (target `[data-tour="nav-calendar"]`, "Your calendar", "See what is planned and what has gone out."), `plan` (target `[data-tour="nav-plan"]`, "My plan", "Who your customers are, where to show up, and what the next 90 days look like."), `help` (target `[data-tour="help"]`, "Help is always here", "Replay this tour or see your setup steps any time from this button."). Text must pass the wording rules.
- `visibleSteps(steps, hasTarget: (selector: string) => boolean): Step[]` (skips steps whose target is missing).
- `shouldAutoStart({ user, path, hasCsmPass }): boolean` — true only when: the user exists, `onboardingCompleted`, not staff (`staffRole` or `isCsm`), no `actingAgency`, no CSM/staff pass held, `user.tour` has neither `completedAt` nor `skippedAt`, and `path` is the home route (`/dashboard` or `/`).
- `reduce(state, action): state` where `state = { index, open }`, actions `next`, `back`, `skip`, `finish`, `start`; `next` past the last step finishes; `back` never goes below 0.
- `placeCard({ target, viewport, card, gap = 12 }): { top, left, placement }` where `target` and `viewport`/`card` are plain rectangles/sizes: on desktop prefers below the target, then above, then right, then left, clamping the card fully inside the viewport with an 8 px margin; when `viewport.w < 640` returns `{ placement: 'bottom-sheet', top: viewport.h - card.h - 8, left: 8 }` (card width is the caller's job: `viewport.w - 16`).
- `spotlightRect(target, pad = 6)` returns the highlighted rectangle with padding, clamped to the viewport.

- [ ] **Step 1: Write the failing tests**

```js
// frontend/tests/tour.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { TOUR_STEPS, visibleSteps, shouldAutoStart, reduce } from '../utils/tour.ts';

const user = (o = {}) => ({ onboardingCompleted: true, staffRole: null, isCsm: false, tour: null, ...o });

test('six steps, in order, with plain wording', () => {
  assert.deepEqual(TOUR_STEPS.map((s) => s.id), ['welcome', 'create', 'review', 'calendar', 'plan', 'help']);
  for (const s of TOUR_STEPS) assert.doesNotMatch(`${s.title} ${s.body}`, /credit|trial|7 days|quark|agent/i, s.id);
});
test('a step whose target is missing is skipped', () => {
  const has = (sel) => !sel.includes('nav-calendar');
  assert.deepEqual(visibleSteps(TOUR_STEPS, has).map((s) => s.id), ['welcome', 'create', 'review', 'plan', 'help']);
  assert.deepEqual(visibleSteps(TOUR_STEPS, () => false), []);
});
test('the tour starts by itself once, for ordinary customers on the home screen only', () => {
  assert.equal(shouldAutoStart({ user: user(), path: '/dashboard', hasCsmPass: false }), true);
  assert.equal(shouldAutoStart({ user: user({ tour: { completedAt: '2026-10-01' } }), path: '/dashboard', hasCsmPass: false }), false);
  assert.equal(shouldAutoStart({ user: user({ tour: { skippedAt: '2026-10-01' } }), path: '/dashboard', hasCsmPass: false }), false);
  assert.equal(shouldAutoStart({ user: user({ onboardingCompleted: false }), path: '/dashboard', hasCsmPass: false }), false);
  assert.equal(shouldAutoStart({ user: user({ staffRole: 'csm' }), path: '/dashboard', hasCsmPass: false }), false);
  assert.equal(shouldAutoStart({ user: user({ isCsm: true }), path: '/dashboard', hasCsmPass: false }), false);
  assert.equal(shouldAutoStart({ user: user({ actingAgency: { name: 'x' } }), path: '/dashboard', hasCsmPass: false }), false);
  assert.equal(shouldAutoStart({ user: user(), path: '/dashboard', hasCsmPass: true }), false);
  assert.equal(shouldAutoStart({ user: user(), path: '/campaigns', hasCsmPass: false }), false);
  assert.equal(shouldAutoStart({ user: null, path: '/dashboard', hasCsmPass: false }), false);
});
test('the state machine moves, never underflows, and finishes after the last step', () => {
  let s = reduce({ index: 0, open: false, total: 3 }, { type: 'start' });
  assert.deepEqual(s, { index: 0, open: true, total: 3 });
  s = reduce(s, { type: 'back' });
  assert.equal(s.index, 0);
  s = reduce(reduce(s, { type: 'next' }), { type: 'next' });
  assert.equal(s.index, 2);
  const done = reduce(s, { type: 'next' });
  assert.equal(done.open, false);
  assert.equal(done.finished, true);
  assert.equal(reduce({ index: 1, open: true, total: 3 }, { type: 'skip' }).skipped, true);
});
```

```js
// frontend/tests/tourPlacement.test.mjs
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
```

- [ ] **Step 2: Run to verify they fail** — `cd frontend && node --test tests/tour.test.mjs tests/tourPlacement.test.mjs` → module not found.
- [ ] **Step 3: Implement** `utils/tour.ts` exactly per the interfaces (pure, no DOM access; `spotlightRect(target, viewport, pad = 6)` signature as the test calls it). `reduce` keeps `total` in state and sets `finished`/`skipped` flags.
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit** — `git add frontend && git commit -m "Tour: steps, start rule, state machine and card placement"`

---

