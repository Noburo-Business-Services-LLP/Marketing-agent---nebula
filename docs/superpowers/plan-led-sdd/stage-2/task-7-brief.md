### Task 7: Setup card, This week card, home screen

**Files:**
- Create: `frontend/utils/week.ts`, `frontend/utils/setup.ts`, `frontend/components/ThisWeekCard.tsx`, `frontend/components/SetupCard.tsx`, `frontend/tests/week.test.mjs`, `frontend/tests/setup.test.mjs`
- Modify: `frontend/services/api.ts` (`getWeek`, `approveWeek`, `changeWeekItem`, `skipWeek`, `getSetup`), `frontend/types.ts`, `frontend/pages/GravityHome.tsx` (replace the old "Finish setting up" notice with the cards; This week card above the hero review block for set-up accounts), `frontend/pages/MyPlan.tsx` is unchanged here, `frontend/index.html` (generated)

**Interfaces:**
- `utils/week.ts` (pure): `headline(counts): string` ("This week we will make 5 posts, 1 carousel and 2 videos, based on your plan."; singular and plural correct; zero parts omitted; all zero → 'Nothing is planned for this week yet.'); `itemLine(item): string`; `cardState(res): 'ready'|'approved'|'partly'|'skipped'|'top_up'|'no_plan'|'not_eligible'|'empty'` and `actionsFor(state)`; `scaledNote(proposal): string` ("Your pool covers most of the week, so we left out 1 video. Top up to add it back."); `canRaise(item, counts, ...)` not needed (changes are skip/swap only in this stage).
- `utils/setup.ts` (pure): `cardModel(setup): { show: boolean, title, nextStep, steps }`; the card is hidden when `allDone`; the next step carries `to` (route): profile → `/settings?tab=business`, socials → `/connect-socials`, plan → `/plan`, week → `/` (focus the This week card), choose → `/trial-expired`.
- `ThisWeekCard.tsx`: shows the headline, the list of items (kind icon, topic, channel) with Skip and Change on each, Approve and Skip this week buttons, the scaled-down note, states: approved (post items show "In Review and approve" or "Making…" or "Could not be made, try again"; carousel and video items show "Make this carousel" / "Make this video" buttons that call `setPrefill` and navigate to the screen), top-up prompt ("Top up to make this week's posts"), no plan ("Your plan is being built; it appears here when ready"), free account (no card; the Setup card's Choose a plan step covers it). Never shows Quarks.
- `SetupCard.tsx`: ordered steps with ticks, the one highlighted next step with its estimated minutes and a button, collapsible on mobile.

- [ ] **Step 1: Write the failing tests**

```js
// frontend/tests/week.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { headline, cardState, scaledNote } from '../utils/week.ts';

test('the headline counts plainly and never says zero of something', () => {
  assert.equal(headline({ posts: 5, carousels: 1, videos: 2 }), 'This week we will make 5 posts, 1 carousel and 2 videos, based on your plan.');
  assert.equal(headline({ posts: 1, carousels: 0, videos: 0 }), 'This week we will make 1 post, based on your plan.');
  assert.equal(headline({ posts: 0, carousels: 0, videos: 1 }), 'This week we will make 1 video, based on your plan.');
  assert.equal(headline({ posts: 0, carousels: 0, videos: 0 }), 'Nothing is planned for this week yet.');
});
test('the card state follows the server answer', () => {
  assert.equal(cardState({ eligible: false, reason: 'free' }), 'not_eligible');
  assert.equal(cardState({ eligible: true, proposal: null }), 'no_plan');
  assert.equal(cardState({ eligible: true, topUp: true, proposal: { empty: true, items: [] } }), 'top_up');
  assert.equal(cardState({ eligible: true, proposal: { status: 'proposed', items: [{ status: 'proposed' }] } }), 'ready');
  assert.equal(cardState({ eligible: true, proposal: { status: 'approved', items: [{ status: 'made' }, { status: 'made' }] } }), 'approved');
  assert.equal(cardState({ eligible: true, proposal: { status: 'approved', items: [{ status: 'made' }, { status: 'approved', kind: 'video' }] } }), 'partly');
  assert.equal(cardState({ eligible: true, proposal: { status: 'skipped', items: [] } }), 'skipped');
});
test('the scaled-down note is plain and mentions what was left out', () => {
  assert.match(scaledNote({ scaledDown: true, removed: { videos: 1, carousels: 0, posts: 0 } }), /left out 1 video/);
  assert.equal(scaledNote({ scaledDown: false }), '');
  assert.doesNotMatch(scaledNote({ scaledDown: true, removed: { videos: 2, carousels: 1, posts: 0 } }), /quark|credit|trial/i);
});
```

```js
// frontend/tests/setup.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { cardModel } from '../utils/setup.ts';
const steps = (done) => ['profile', 'socials', 'plan', 'week'].map((id, i) => ({ id, title: id, done: done[i], reason: '', minutes: 1 }));
test('the card shows the next step with its route, and hides when everything is done', () => {
  const m = cardModel({ steps: steps([false, false, false, false]), next: 'profile', allDone: false });
  assert.equal(m.show, true);
  assert.equal(m.nextStep.to, '/settings?tab=business');
  assert.equal(cardModel({ steps: steps([true, true, true, true]), next: null, allDone: true }).show, false);
});
test('every step has a route and a free account is sent to choose a plan', () => {
  const m = cardModel({ steps: [{ id: 'choose', title: 'Choose a plan', done: false, reason: '', minutes: 1 }], next: 'choose', allDone: false });
  assert.equal(m.nextStep.to, '/trial-expired');
  for (const [id, to] of [['socials', '/connect-socials'], ['plan', '/plan'], ['week', '/']]) assert.equal(cardModel({ steps: [{ id, title: id, done: false, reason: '', minutes: 1 }], next: id, allDone: false }).nextStep.to, to);
});
test('when nothing is asked of the customer yet the card says what is happening instead of a button', () => {
  const m = cardModel({ steps: steps([true, true, false, false]), next: null, allDone: false });
  assert.equal(m.show, true);
  assert.equal(m.nextStep, null);
  assert.match(m.waiting, /plan/i);
});
```

- [ ] **Step 2: Run to verify they fail.** **Step 3: Implement** helpers, components and the home integration (follow the card style of `AgencyUsage.tsx`/`AccountPrivacy.tsx`; use `--gv-*` tokens; mobile-first; the This week card keeps focus management: after Approve, focus moves to the status line; all buttons have visible focus; items list is a real list). In `GravityHome.tsx` remove the old "Finish setting up Nebulaa" block (keep its link target in the Setup card) and render `SetupCard` then `ThisWeekCard` above the hero. The Setup card must not show for a CSM pass or staff accounts. **Step 4:** run the frontend tests, `npx tsc --noEmit`, `node scripts/visual-audit/gen-layer-lists.mjs` then tests again, brand and voice audits (0). In the browser with throwaway users (new account, profile done with plan, set up and approved, free account, pool too small, agency client workspace) check the cards at desktop and 375 px, then delete the users. **Step 5: Commit** — `git add frontend && git commit -m "Home: setup path card and the This week proposal card"`

---

