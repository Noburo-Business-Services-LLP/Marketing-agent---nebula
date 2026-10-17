# Plan-led Nebulaa, Stage 3: guided tour — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A short, skippable guided tour (about six steps) runs once for a new customer and can be replayed from a help button: it highlights the real parts of the interface and says what to click.

**Architecture:** Our own small component, no new libraries. Steps are data (`route`, `target` selector, title, body). A pure engine decides which steps are visible (a missing target is skipped), when the tour starts by itself, and where the card sits (spotlight beside the element on desktop, a bottom card on a phone). Progress is saved on the account (`User.tour`) through one small endpoint. Elements get `data-tour="…"` attributes.

**Tech Stack:** React 19 + TypeScript + Vite (`node --test tests/*.test.mjs`), Node/Express/Mongoose (`node --test tests/*.test.js`).

**Spec:** `docs/superpowers/specs/2026-10-17-plan-led-home-design.md` (Stage 3). **Depends on:** Stage 2 (the This week card and Setup card exist and carry `data-tour` targets), Stage 1 (the My plan page and nav entry).

## Global Constraints

- Wording is plain, friendly, no agent names, no "credit", "trial", "7 days", no Quarks, no vendor names; brand and voice audits 0; regenerate layer lists after UI changes; text readable in the light theme (contrast audit passes).
- The tour is never shown to: staff accounts, a CSM or staff working inside a customer's account (a held `csmReturnToken`), or an agency client workspace (`user.actingAgency`); the agency owner sees it on their own account. It never blocks the app: Skip and Escape are always available; a target that is missing on the current screen is skipped.
- It starts by itself only after onboarding is finished and the customer reaches the home screen (never on the landing page, auth, onboarding or payment pages), and at most once: completion or skip is saved; a replay never changes the saved completion time.
- Accessibility: focus moves into the card and is trapped there, Escape closes, arrow keys move between steps, focus returns to where it was on close, the card has `role="dialog"` with a label, motion respects `prefers-reduced-motion`, nothing relies on colour alone.
- A failure to save progress must never break the app (best effort, silent). No new dependency. Do not read or print `.env`/secrets. Commit after every task with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; never push.

## Review Focus

1. A step whose target is not on screen (smaller screen, collapsed sidebar, element not rendered for this account) is skipped without a flash or a stuck overlay (Tasks 1, 3).
2. Resizing, rotating or scrolling while the tour is open keeps the spotlight on the element and the card inside the screen (Tasks 1, 3).
3. Skip, Escape, browser back and logging out always leave a clean page: no stuck overlay, no scroll lock, no trapped focus (Task 3).
4. Never shown to staff, a CSM pass, or an agency client; never twice; replay works and does not reset completion (Tasks 1, 2).
5. Phone width (375 px): the card never covers the highlighted element's control without a way to reach it, and nothing overflows sideways (Task 3).

## File Structure

Frontend, create: `utils/tour.ts` (steps, engine, placement), `components/GuidedTour.tsx` (overlay and card), `components/HelpMenu.tsx` (help button menu: Replay the tour, Your setup path, Contact support), tests `tests/tour.test.mjs`, `tests/tourPlacement.test.mjs`. Modify: `components/Layout.tsx` (help button, `data-tour` on nav items and header), `components/ThisWeekCard.tsx` and `components/SetupCard.tsx` (add `data-tour`), `App.tsx` (mount and start rule), `services/api.ts` (`saveTour`), `types.ts` (`tour` on `User`), `index.html` (generated).
Backend, create: `routes/tour.js`, `tests/tourRoutes.test.js`. Modify: `models/User.js` (`tour: { completedAt, skippedAt, step, replays }`, and `tour` in `toPublicJSON`), `server-main.js` (mount `/api/tour`).

---

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

### Task 2: Saving progress on the account

**Files:**
- Create: `backend/routes/tour.js`, `backend/tests/tourRoutes.test.js`
- Modify: `backend/models/User.js` (`tour: { completedAt: Date, skippedAt: Date, step: String, replays: Number }` and include `tour: { completedAt, skippedAt }` in `toPublicJSON`), `backend/server-main.js` (mount `/api/tour`)

**Interfaces:**
- `PUT /api/tour` (protect, rate limited 60 per 15 minutes) body `{ action: 'step'|'complete'|'skip'|'replay', step? }`: `step` records the current step id (only ids from the known list); `complete` sets `completedAt` once (never overwritten); `skip` sets `skippedAt` once; `replay` increments `replays` and changes nothing else. Returns `{ success: true, tour: { completedAt, skippedAt } }`. Refused with 403 for staff accounts, for a CSM pass (`req.actingCsm`) and inside an agency client pass (`req.actingAgency`), because those sessions must never write the customer's tour state. Unknown actions 400.

- [ ] **Step 1: Write the failing test** (same harness style as the other route tests: injected fake `User` model)

```js
// backend/tests/tourRoutes.test.js — adapt the harness of tests/planRoutes.test.js
const test = require('node:test');
const assert = require('node:assert');
test('complete stamps completedAt once and a second complete does not change it', async () => {});
test('skip stamps skippedAt once; replay only counts', async () => {});
test('step accepts known ids only and unknown actions are 400', async () => {});
test('staff accounts, a CSM pass and an agency client pass cannot write tour state (403)', async () => {});
test('toPublicJSON carries tour.completedAt and tour.skippedAt and nothing else', async () => {});
```
Write each body fully; the titles give the expected status codes and stored fields. For `toPublicJSON`, build a `User` document in memory (`new User({...}).toPublicJSON()`; no database) and assert the shape.

- [ ] **Step 2: Run to verify they fail.** **Step 3: Implement** with a conditional update for once-only stamps (`updateOne({ _id, 'tour.completedAt': { $exists: false } }, { $set: { 'tour.completedAt': now } })`), mount in `server-main.js`, extend `toPublicJSON`. **Step 4: Run the tests and the full backend suite.** **Step 5: Commit** — `git add backend && git commit -m "Tour: progress saved on the account, once-only completion, blocked in staff and client passes"`

---

### Task 3: The tour component

**Files:**
- Create: `frontend/components/GuidedTour.tsx`
- Modify: `frontend/services/api.ts` (`saveTour(action, step?)` best effort, returns void, swallows errors), `frontend/types.ts` (`tour?: { completedAt?: string; skippedAt?: string } | null` on `User`)

**Interfaces:**
- `<GuidedTour open onClose(reason: 'finished'|'skipped'|'closed') steps />` — uses `visibleSteps` with `document.querySelector`, `placeCard`, `spotlightRect`. Behaviour: renders a full-screen backdrop with a cut-out around the target (CSS box-shadow technique, no canvas), the card with title, body, step counter ("2 of 6"), Back, Next (Done on the last), Skip tour; scrolls the target into view (`scrollIntoView({ block: 'center' })`, instant when `prefers-reduced-motion`); recomputes on `resize`, `scroll` and when the route changes; if a step's `route` differs from the current route it navigates there first (HashRouter: `window.location.hash`), waits for the target up to 1.5 s, then skips the step if still missing; focus moves to the card heading on each step, Tab is trapped inside the card, Escape skips, ArrowRight/ArrowLeft move, focus returns to the previously focused element on close; body scroll is not locked (the page stays scrollable), the backdrop does not trap pointer events outside the card except to prevent accidental clicks on the highlighted control (clicks on the backdrop do nothing); `role="dialog"`, `aria-modal="true"`, `aria-labelledby` the heading; no animation when reduced motion is requested.
- All cleanup (listeners, overlay) runs on unmount so a route change, logout or back button leaves a clean page.

- [ ] **Step 1: Write the failing test.** The component itself has no node-runnable test; the logic lives in Task 1. Add `frontend/tests/tourWording.test.mjs` that imports `TOUR_STEPS` and asserts every `target` string matches the `data-tour` names the sources use: read `components/Layout.tsx`, `components/ThisWeekCard.tsx`, `components/SetupCard.tsx` as text (`fs.readFileSync`) and assert each `data-tour="<name>"` from the steps appears in some source file (this fails until Task 4 adds them, which is the guard that a renamed element cannot silently break the tour). Mark the test as expected to fail only until Task 4 by writing it now and running it after Task 4 (state this in the commit message).
- [ ] **Step 2–3: Implement** the component (follow existing dialog patterns: `AgencyDialog.tsx` for focus handling; use the app's `--gv-*` tokens; card background solid cream like `TermsPrompt.tsx` (`#fffdf8`) so it is readable over any page, including the dark plans page).
- [ ] **Step 4:** `cd frontend && npx tsc --noEmit` (only the old Influencers error) and `node --test tests/*.test.mjs` (the wording test may still fail until Task 4: leave it for Task 4).
- [ ] **Step 5: Commit** — `git add frontend && git commit -m "Tour: the guided tour component with spotlight, focus handling and phone layout"`

---

### Task 4: Targets, help button, start rule

**Files:**
- Modify: `frontend/components/Layout.tsx` (add `data-tour="nav-create"`, `nav-review`, `nav-calendar`, `nav-plan`, `help` to the real elements; add the help button with `HelpMenu`), `frontend/components/ThisWeekCard.tsx` (`data-tour="this-week"` on the card root), `frontend/components/SetupCard.tsx` (`data-tour="setup"`), `frontend/App.tsx` (mount `<GuidedTour>` inside the router for the authenticated layout; start with `shouldAutoStart`; Skip/Done call `saveTour`; the replay event opens it without changing saved completion), `frontend/components/HelpMenu.tsx` (create)
- Test: the Task 3 wording test now passes.

**Interfaces:**
- `HelpMenu`: a "?" button (`aria-label="Help"`, `data-tour="help"`) opening a small menu: "Replay the tour" (dispatches `window.dispatchEvent(new CustomEvent('nebulaa-tour-replay'))` and calls `saveTour('replay')`), "Your setup steps" (navigates to the home screen and scrolls to the Setup card), "Contact support" (mailto from `constants/legal.ts` `SUPPORT_EMAIL`). Keyboard operable; closes on Escape and outside click.
- App start rule: when `shouldAutoStart({ user, path, hasCsmPass })` becomes true and the page has finished loading, wait 800 ms (so cards render), open the tour; never reopen after skip/complete in the same session even if the user object is stale (keep a `useRef` flag); on mobile the sidebar is collapsed, so nav targets are missing and those steps are skipped unless the menu is opened: the tour opens the mobile menu for nav steps through a small `onNeedsMenu` callback prop on `GuidedTour` (Layout provides it), or skips them if that is not possible; state which in the report.

- [ ] **Step 1: Run the wording/targets test** — it fails now (targets missing). **Step 2: Implement** the attributes, the help menu and the mount. **Step 3: Run** `cd frontend && node --test tests/*.test.mjs`, `npx tsc --noEmit`, `node scripts/visual-audit/gen-layer-lists.mjs`, tests again, `node scripts/brand-audit.mjs`, `node scripts/voice-audit.mjs` (0). **Step 4: Real check in the browser** with throwaway users (dev servers 3000/5000), desktop and 375 px: a new account sees the tour once after reaching the home screen; Skip, Escape, Back/Next, Done all behave; resizing during the tour keeps the spotlight; the target missing case (collapse the sidebar or a mobile width) skips steps cleanly; a second login does not show it again; the help button replays it; a staff account, a CSM pass and an agency client workspace never see it; logging out mid-tour leaves a clean login page; delete the throwaway users. **Step 5: Commit** — `git add frontend && git commit -m "Tour: targets on the real interface, help button, once-only start and replay"`

---

### Task 5: Handover

**Files:** `docs/superpowers/HANDOVER-nebulaa-redesign-7.md` (or the latest handover file), `docs/superpowers/ops/plan-launch-checklist.md` (add the tour line)

- [ ] **Step 1:** Run the whole backend and frontend suites, audits 0, layer lists committed.
- [ ] **Step 2:** Write a "Plan-led Stage 3" section: commits, test counts, how the start rule works, how to replay, what is not covered (no screen-reader pass beyond the basics; owner may want a short copy review of the six steps), how to switch the tour off for everyone if wording needs changes (`TOUR_STEPS` live in `frontend/utils/tour.ts`; to disable, return false from `shouldAutoStart`).
- [ ] **Step 3: Commit** — `git add docs && git commit -m "Plan-led Stage 3: guided tour, verification and handover"`
