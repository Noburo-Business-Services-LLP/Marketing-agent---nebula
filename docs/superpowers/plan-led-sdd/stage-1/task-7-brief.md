### Task 7: The My plan page, navigation, staff summary

**Files:**
- Create: `frontend/utils/plan.ts`, `frontend/pages/MyPlan.tsx`, `frontend/tests/plan.test.mjs`
- Modify: `frontend/services/api.ts` (`getPlan()`, `refreshPlan()`, staff `getClientPlan(id)`, `refreshClientPlan(id)`), `frontend/types.ts`, `frontend/App.tsx` (route `/plan`), `frontend/components/Layout.tsx` (nav item "My plan" for customers; also shown to a CSM inside a client), `frontend/pages/Campaigns.tsx` (remove the old ICP panel and its fetch), the staff client page (locate: `grep -rl "view_clients\|getStaffClient" frontend/pages/staff`), `frontend/index.html` (regenerated)

**Interfaces:**
- `utils/plan.ts` (pure, tested): `sectionsOf(plan): Array<{ id, title, kind }>` in the order Your business today, Your customer, Where to show up, The next 90 days, This month's content mix, What to do first (sections with no data are omitted); `tagLabel(tag): string` ('verified' -> 'Confirmed', 'inference' -> 'Our reading', 'proposed' -> 'Suggested', 'unverified' -> 'Not confirmed'); `effortRows(plan)`: channel rows with `organicPct`, `paidPct`, `nebulaaDoes` (joined into plain words), `youDo` texts; `refreshLabel(state, now)`: `'Refresh my plan'` or `'Next refresh on 24 October'`; `planBanner(state)`: `'building' | 'failed' | 'stale' | 'ready' | 'profile_incomplete' | 'free'` with plain text for each.
- `MyPlan.tsx` renders `GET /api/plan`: states: loading, building ("We are building your plan. This takes about a minute."), failed ("We could not build your plan just now. Try again."), profile incomplete (list what is missing with a button to Settings → Business profile), free (shows the free Blueprint link and "Choose a plan to turn this into weekly posts and videos"), ready (sections, with the date "Made on 12 October", the tag labels as small chips, and the "Nebulaa does / You do" split shown as two short lists per channel with the organic and paid percentages as a simple bar). A "Download as PDF" link reuses the existing Blueprint designed-PDF route when the run has one. Wording: posts and videos; never Quarks; no vendor names.
- Staff client page: a "Plan" card with the plan date, status, a short summary (the promise and the top three channels) and a "Refresh plan" button (staff bypass), with a link to open the full plan inside the client.

- [ ] **Step 1: Write the failing test**

```js
// frontend/tests/plan.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionsOf, tagLabel, effortRows, refreshLabel, planBanner } from '../utils/plan.ts';

const plan = { result: { plan: { promise: { text: 'More enquiries.' }, positioning: { audience: [{ text: 'Families' }] }, icp: { who: [{ text: 'Families who order for birthdays', tag: 'inference' }], pains: [], where: [], triggers: [] }, channels: [{ channel: 'Instagram', role: { text: 'Show the cakes.' } }], effort: [{ channel: 'Instagram', organicPct: 80, paidPct: 20, nebulaaDoes: ['posts', 'videos'], youDo: [{ text: 'Reply to DMs the same day.' }] }], roadmap: [{ phase: 'foundation', focus: { text: 'Set up.' }, actions: [], measure: [] }], calendar: [{ day: 1, format: 'image post' }, { day: 2, format: 'reel' }], firstSteps: [{ text: 'Post today.' }] } } };

test('sections come in the agreed order and empty ones are left out', () => {
  assert.deepEqual(sectionsOf(plan).map((s) => s.id), ['today', 'customer', 'channels', 'roadmap', 'mix', 'first']);
  const noIcp = { result: { plan: { ...plan.result.plan, icp: null, effort: [] } } };
  assert.ok(!sectionsOf(noIcp).some((s) => s.id === 'customer'));
});

test('tags are shown in plain words', () => {
  assert.equal(tagLabel('verified'), 'Confirmed');
  assert.equal(tagLabel('inference'), 'Our reading');
  assert.equal(tagLabel('proposed'), 'Suggested');
  assert.equal(tagLabel('unverified'), 'Not confirmed');
  assert.equal(tagLabel('whatever'), 'Suggested');
});

test('each channel row shows the split and who does what in plain words', () => {
  const rows = effortRows(plan);
  assert.equal(rows[0].channel, 'Instagram');
  assert.equal(rows[0].organicPct, 80);
  assert.equal(rows[0].nebulaaDoes, 'posts and videos');
  assert.deepEqual(rows[0].youDo, ['Reply to DMs the same day.']);
});

test('refresh label and banner states', () => {
  assert.equal(refreshLabel({ nextRefreshAt: null }, new Date('2026-10-17')), 'Refresh my plan');
  assert.equal(refreshLabel({ nextRefreshAt: '2026-10-24T00:00:00Z' }, new Date('2026-10-17')), 'Next refresh on 24 October');
  assert.equal(planBanner({ running: true }), 'building');
  assert.equal(planBanner({ failed: true, plan: null }), 'failed');
  assert.equal(planBanner({ plan: { stale: true } }), 'stale');
  assert.equal(planBanner({ eligible: false, reason: 'free' }), 'free');
  assert.equal(planBanner({ eligible: false, reason: 'profile_incomplete' }), 'profile_incomplete');
  assert.equal(planBanner({ plan: { id: 'x' } }), 'ready');
});
```

- [ ] **Step 2: Run to verify it fails.** **Step 3: Implement** the helpers, the page (follow the card and spacing style of `AccountPrivacy.tsx` and `AgencyClients.tsx`, use the `--gv-*` tokens, mobile-first, no fixed widths), the api methods, the route and the nav entry, remove the old ICP panel from `Campaigns.tsx`, add the staff card. **Step 4:** run `cd frontend && node --test tests/*.test.mjs`, `npx tsc --noEmit` (only the old `Influencers.tsx` error), `node scripts/visual-audit/gen-layer-lists.mjs` then the tests again, `node scripts/brand-audit.mjs`, `node scripts/voice-audit.mjs`; then in the browser (dev servers on 3000 and 5000) check My plan in each state with a throwaway user (ready, building, failed, incomplete, free) at desktop and 375 px, and delete the user. **Step 5: Commit** — `git add frontend && git commit -m "My plan page, navigation entry and staff client plan card"`

---

