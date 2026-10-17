# Plan-led Nebulaa, Stage 1: My plan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every customer (paying, managed, and staff looking at a client) can open "My plan": their ideal customer, their channels with the organic/paid split and who does what, and the next 90 days, built by the Blueprint engine and kept fresh automatically.

**Architecture:** A "plan run" is a Blueprint run with `kind: 'plan'`, started by the system from the business profile, never charged to the customer, kept as the account's newest completed plan. The planner gains two fact-checked blocks (`icp`, `effort`). Triggers: once when the profile becomes complete, monthly, a weekly manual refresh (staff bypass), and a throttled backfill script for existing managed clients. A new `/api/plan` and a `#/plan` page show it.

**Tech Stack:** Node/Express/Mongoose (`node --test tests/*.test.js`), React 19 + TypeScript + Vite (`node --test tests/*.test.mjs`), the existing Blueprint services under `backend/services/blueprint/`.

**Spec:** `docs/superpowers/specs/2026-10-17-plan-led-home-design.md` (Stage 1 and "Cost and limits"). Stages 2 and 3 have their own plans and depend on this one.

## Global Constraints

- Customers see posts and videos, never Quarks; wording guard bans "credit", "trial", "7 days" in customer-facing files (legal pages exempt); no agent names; `frontend/scripts/brand-audit.mjs` and `voice-audit.mjs` must report 0 violations; after UI changes run `node scripts/visual-audit/gen-layer-lists.mjs` in `frontend/` and commit `index.html`.
- A plan run is never charged to any customer pool and never uses the free-slot rules; it records its model spend like every model call (action `blueprint`, see `services/spendGuard.js`) and obeys the daily AI spend ceiling and provider switches.
- Every claim in a plan keeps the existing tags (verified / inference / proposed / unverified) and passes the existing QA scanner; the model can never mint Verified. `effort.nebulaaDoes` may only name actions from `PLAN_NEBULAA_CAN` (config), never anything else.
- Managed clients get plans like everyone (owner decision 2026-10-17); staff accounts never get plans. Existing managed and legacy accounts must never be blocked or changed in behaviour by this work except for the new page and the plan run.
- Weekly manual refresh limit: one per account per 7 days; staff refresh ignores it. Daily per-account Blueprint cap (`LIMITS.PAID_PER_ACCOUNT_PER_DAY`) still applies to customer-started runs and does NOT apply to system-started runs.
- Business profile input only: no new onboarding questions. Real runs only on `nebulaa_dev` through scripts that refuse any other database; throwaway users deleted afterwards; the one real plan run (a few rupees of model use) needs the owner's explicit OK first.
- Do not read or print `.env` or secrets. Commit after every task; messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never push; the controller pushes.

## Review Focus

1. A model answer missing `icp` or `effort`, or with percentages that do not sum to 100, or naming an action Nebulaa cannot do: the run still succeeds with the old plan blocks and the bad parts dropped (Task 1).
2. Two triggers at once (profile saved twice quickly, monthly scheduler plus a manual refresh): exactly one plan run in flight per account (Task 3, 4).
3. A failed run never replaces or hides the last good plan; a failed FIRST run retries then alerts the owner (Task 4).
4. Staff, free and agency-client accounts: staff never get plans; free accounts keep their free Blueprint untouched; agency client workspaces get a plan like any account and it is never paid from the agency pool (Tasks 3, 4, 7).
5. The backfill script cannot run unattended by accident, cannot exceed its cap, and a rerun skips accounts that already have a plan (Task 6).

## File Structure

Backend, create: `services/plan/profileInput.js` (profile to Blueprint input, `profileComplete`), `services/plan/planRules.js` (pure: refresh rules, selection for backfill/monthly), `services/plan/planService.js` (start plan runs, current plan, refresh), `services/plan/planScheduler.js`, `routes/plan.js`, `scripts/plan-backfill.js`. Tests: `tests/planNormalise.test.js`, `tests/planProfileInput.test.js`, `tests/planRules.test.js`, `tests/planService.test.js`, `tests/planScheduler.test.js`, `tests/planRoutes.test.js`, `tests/planBackfill.test.js`.
Backend, modify: `config/blueprint.js` (`PLAN_NEBULAA_CAN`, `PLAN_REFRESH_DAYS`), `services/promptRegistry.blueprint.js` (plan prompt gets `icp` and `effort`), `services/blueprint/planner.js` (`normalisePlan`), `models/Blueprint.js` (`kind`), `services/blueprint/service.js` (expose what the plan service needs), `models/User.js` (`planState`), `routes/auth.js` and the business-profile save route (call `maybeStartFirstPlan`), `routes/staff.js` (client plan summary and refresh), `routes/campaigns.js` (retire old ICP routes), `server-main.js` (mount, scheduler), `services/spendGuard.js` only if the `blueprint` action needs registering for system runs.
Frontend, create: `utils/plan.ts`, `pages/MyPlan.tsx`, `tests/plan.test.mjs`. Modify: `services/api.ts`, `types.ts`, `App.tsx` (route `/plan`), `components/Layout.tsx` (nav entry), `pages/Campaigns.tsx` (remove old ICP panel), staff client page (`frontend/pages/staff/*Client*.tsx`, locate with grep) and `index.html` (generated).

---

### Task 1: The planner returns `icp` and `effort`, fact-checked

**Files:**
- Modify: `backend/config/blueprint.js` (add `PLAN_NEBULAA_CAN`, `ORGANIC_PAID`), `backend/services/promptRegistry.blueprint.js` (the locked plan prompt: read it first), `backend/services/blueprint/planner.js` (`buildPlanVars`, `normalisePlan`)
- Test: `backend/tests/planNormalise.test.js`

**Interfaces:**
- Produces in `config/blueprint.js`: `PLAN_NEBULAA_CAN = ['posts', 'carousels', 'videos', 'captions and hashtags', 'scheduling and publishing', 'inbox replies', 'competitor tracking']` (the only things Nebulaa may be said to do).
- Produces in `normalisePlan(parsed, sheet).plan`: `icp: { who: Claim[], pains: Claim[], where: Claim[], triggers: Claim[] }` (each list at most 4 claims, through `toClaim`) and `effort: Array<{ channel, organicPct, paidPct, nebulaaDoes: string[], youDo: Claim[] }>` for channels in the channel plan only. `nebulaaDoes` entries come only from `PLAN_NEBULAA_CAN`. `organicPct + paidPct === 100`, integers, each 0..100; rows that cannot be repaired are dropped; missing blocks give `icp: null` / `effort: []` and never fail the plan.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/planNormalise.test.js
const test = require('node:test');
const assert = require('node:assert');
const planner = require('../services/blueprint/planner');
const { PLAN_NEBULAA_CAN } = require('../config/blueprint');

// A minimal evidence sheet and a valid base answer, built from the planner's own test helpers if they exist.
const sheet = { client: { name: 'Sweet Co' }, basis: 'limited', facts: [{ id: 'F1', kind: 'typed', field: 'Offer', text: 'Custom cakes baked to order' }, { id: 'F2', kind: 'page', field: 'About', text: 'Family bakery in Chennai' }], unverified: [] };
const base = () => ({
  promise: { text: 'More enquiries for custom cakes.', tag: 'proposed' },
  positioning: { audience: [{ text: 'Families in Chennai', tag: 'inference', factIds: ['F2'] }], territory: { name: 'Baked to order', rationale: { text: 'Fresh, made for you.', tag: 'proposed' } }, line: { text: 'Cakes made for your day.', tag: 'proposed' } },
  pillars: ['Behind the oven', 'Custom orders', 'Happy tables', 'Seasonal'].map((n) => ({ name: n, why: { text: 'It shows the work.', tag: 'proposed' }, example: { text: 'A cake being finished.', tag: 'proposed' } })),
  calendar: Array.from({ length: 24 }, (_, i) => ({ day: i + 1, pillar: ['Behind the oven', 'Custom orders', 'Happy tables', 'Seasonal'][i % 4], format: 'image post', hook: { text: 'A cake for your day.', tag: 'proposed' } })),
  channels: [{ channel: 'Instagram', priority: 1, role: { text: 'Show the cakes.', tag: 'proposed' } }, { channel: 'WhatsApp', priority: 2, role: { text: 'Take orders.', tag: 'proposed' } }],
  roadmap: [{ phase: 'foundation', focus: { text: 'Set up.', tag: 'proposed' }, actions: [{ text: 'Post three times a week.', tag: 'proposed' }], measure: [{ text: 'Enquiries.', tag: 'proposed' }] }, { phase: 'storytelling', focus: { text: 'Tell stories.', tag: 'proposed' }, actions: [], measure: [] }, { phase: 'growth', focus: { text: 'Grow.', tag: 'proposed' }, actions: [], measure: [] }],
  firstSteps: [{ text: 'Post today.', tag: 'proposed' }]
});

test('a good icp block is kept, tagged, and capped at four lines a list', () => {
  const p = base();
  p.icp = { who: [{ text: 'Families in Chennai who order for birthdays', tag: 'inference', factIds: ['F2'] }], pains: Array.from({ length: 7 }, (_, i) => ({ text: `Pain ${i}`, tag: 'proposed' })), where: [{ text: 'Instagram and WhatsApp groups', tag: 'proposed' }], triggers: [{ text: 'A birthday is coming', tag: 'proposed' }] };
  const out = planner.normalisePlan(p, sheet);
  assert.ok(out && out.plan.icp);
  assert.strictEqual(out.plan.icp.pains.length, 4);
  assert.ok(out.plan.icp.who[0].tag === 'inference' || out.plan.icp.who[0].tag === 'proposed');
});

test('effort rows keep only channels in the channel plan, percentages sum to 100, and Nebulaa only claims what it can do', () => {
  const p = base();
  p.effort = [
    { channel: 'Instagram', organicPct: 80, paidPct: 20, nebulaaDoes: ['posts', 'videos', 'telepathy'], youDo: [{ text: 'Reply to DMs the same day.', tag: 'proposed' }] },
    { channel: 'WhatsApp', organicPct: 70, paidPct: 20, nebulaaDoes: ['inbox replies'], youDo: [] },
    { channel: 'LinkedIn', organicPct: 100, paidPct: 0, nebulaaDoes: ['posts'], youDo: [] }
  ];
  const e = planner.normalisePlan(p, sheet).plan.effort;
  const insta = e.find((r) => r.channel === 'Instagram');
  assert.deepStrictEqual(insta.nebulaaDoes, ['posts', 'videos']);
  assert.strictEqual(insta.organicPct + insta.paidPct, 100);
  assert.ok(!e.some((r) => r.channel === 'LinkedIn'), 'LinkedIn is not in the channel plan');
  const wa = e.find((r) => r.channel === 'WhatsApp');
  assert.strictEqual(wa.organicPct + wa.paidPct, 100, 'a row that does not add up is repaired to 100');
  e.forEach((r) => r.nebulaaDoes.forEach((a) => assert.ok(PLAN_NEBULAA_CAN.includes(a), a)));
});

test('a missing or broken icp/effort never fails the plan', () => {
  const out = planner.normalisePlan(base(), sheet);
  assert.ok(out && out.plan);
  assert.strictEqual(out.plan.icp, null);
  assert.deepStrictEqual(out.plan.effort, []);
  const p = base(); p.icp = 'nonsense'; p.effort = [{ channel: 5 }, null, 'x'];
  const again = planner.normalisePlan(p, sheet);
  assert.ok(again && again.plan);
  assert.deepStrictEqual(again.plan.effort, []);
});
```

- [ ] **Step 2: Run to verify it fails** — `cd backend && node --test tests/planNormalise.test.js` → FAIL (`planner.normalisePlan` is not exported, or `icp` undefined). If `normalisePlan` is not exported, export it (and `ctxOf`) from `planner.js` as part of Step 3.

- [ ] **Step 3: Implement**

`config/blueprint.js`: add and export `PLAN_NEBULAA_CAN` (list above) and `PLAN_REFRESH_DAYS = 7`.

`planner.js`, after the `channels` block in `normalisePlan`, add:

```js
  const icpRaw = isObj(parsed.icp) ? parsed.icp : null;
  const icp = icpRaw ? {
    who: claims(icpRaw.who, 4, ctx),
    pains: claims(icpRaw.pains, 4, ctx),
    where: claims(icpRaw.where, 4, ctx),
    triggers: claims(icpRaw.triggers, 4, ctx)
  } : null;
  const channelNames = new Set(channels.map((c) => c.channel));
  const effort = [];
  for (const e of arr(parsed.effort, RAW_CAP)) {
    if (!isObj(e) || !channelNames.has(e.channel) || effort.some((x) => x.channel === e.channel)) continue;
    let organic = Math.round(Number(e.organicPct));
    let paid = Math.round(Number(e.paidPct));
    if (!Number.isFinite(organic) || organic < 0 || organic > 100) continue;
    if (!Number.isFinite(paid) || paid < 0 || paid > 100 || organic + paid !== 100) paid = 100 - organic; // repaired: organic leads
    const does = arr(e.nebulaaDoes, RAW_CAP).map((a) => str(a, 40).toLowerCase()).filter((a) => PLAN_NEBULAA_CAN.includes(a));
    effort.push({ channel: e.channel, organicPct: organic, paidPct: paid, nebulaaDoes: [...new Set(does)], youDo: claims(e.youDo, 4, ctx, true) });
  }
```
add `icp: icp && (icp.who.length || icp.pains.length || icp.where.length || icp.triggers.length) ? icp : null, effort` to the returned `plan` object, `const { ..., PLAN_NEBULAA_CAN } = require('../../config/blueprint')` at the top, and export `normalisePlan`.
`buildPlanVars`: add `nebulaaCan: PLAN_NEBULAA_CAN.join(', ')` to the returned vars. In `promptRegistry.blueprint.js` read the locked plan prompt (`blueprint_plan`), add to its JSON schema description and instructions: `icp` (who, pains, where, triggers: short claims, each with tag and factIds like the other claims) and `effort` (one row per channel in `channels`: organicPct and paidPct integers summing to 100, `nebulaaDoes` chosen ONLY from {nebulaaCan}, `youDo` claims for what the owner does themselves offline or on the platform, for example follow up on WhatsApp, ask for Google reviews, local events); say the split is a recommendation, never a measurement, and every number must be tagged proposed. Keep the existing locked-prompt discipline (read how `getPrompt` and prompt tests pin the text; update those tests if they pin exact prompt text).

- [ ] **Step 4: Run to verify it passes** — `cd backend && node --test tests/planNormalise.test.js && node --test tests/blueprint*.test.js 2>&1 | grep -E "^ℹ (pass|fail)|^✖"` → pass; existing Blueprint tests still pass (adjust only tests that pin exact prompt text, and say so).

- [ ] **Step 5: Commit**

```bash
git add backend/config/blueprint.js backend/services/promptRegistry.blueprint.js backend/services/blueprint/planner.js backend/tests/planNormalise.test.js
git commit -m "Plan: the planner returns a fact-checked ideal customer and an organic/paid effort split"
```

---

### Task 2: From business profile to plan input

**Files:**
- Create: `backend/services/plan/profileInput.js`
- Test: `backend/tests/planProfileInput.test.js`

**Interfaces:**
- Produces: `profileComplete(user): { complete: boolean, missing: string[] }` and `inputFromProfile(user): object` shaped for `normaliseInput` (`businessName, website, instagram, whatYouSell, whoItsFor, goal, competitors:[{name}], offers:[]`).
- Mapping: `businessName` = `businessProfile.name || companyName`; `website` = `businessProfile.website`; `instagram` = handle of the connected Instagram account if the user object has one in `connectedSocials` (platform 'instagram', field `username`), else ''; `whatYouSell` = `description || heroProduct || problemSolved` (first with at least 10 characters); `whoItsFor` = `targetCustomerProfile || targetAudience` (first with at least 5 characters); `goal` from `marketingGoals` (first goal text containing: 'enquir' or 'lead' -> `enquiries`; 'sale' or 'sell' -> `sales`; 'follow' or 'awareness' or 'brand' -> `followers`; 'launch' -> `launch`; default `enquiries`); `competitors` = `businessProfile.competitors` names (strings, max 3) as `{ name }`.
- `profileComplete` requires: a name of at least 2 characters, at least one of website or instagram, whatYouSell and whoItsFor as above. `missing` lists plain-English labels: `'business name'`, `'website or Instagram page'`, `'what you sell'`, `'who it is for'`.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/planProfileInput.test.js
const test = require('node:test');
const assert = require('node:assert');
const { profileComplete, inputFromProfile } = require('../services/plan/profileInput');
const { normaliseInput } = require('../services/blueprint/input');

const full = () => ({ companyName: 'Sweet Co', businessProfile: { name: 'Sweet Co', website: 'sweetco.in', description: 'Custom cakes baked to order for birthdays', targetAudience: 'Families in Chennai', marketingGoals: ['Get more enquiries'], competitors: ['Cake House', 'Bake Lab', 'Third', 'Fourth'] }, connectedSocials: [] });

test('a full profile is complete and its input passes the Blueprint validator', () => {
  assert.deepStrictEqual(profileComplete(full()), { complete: true, missing: [] });
  const input = inputFromProfile(full());
  assert.strictEqual(input.goal, 'enquiries');
  assert.strictEqual(input.competitors.length, 3);
  const n = normaliseInput(input, { allowGuided: true });
  assert.strictEqual(n.ok, true, JSON.stringify(n.errors));
});

test('missing pieces are named in plain words', () => {
  const u = full(); u.businessProfile.website = ''; u.businessProfile.description = 'short'; u.businessProfile.heroProduct = '';
  const r = profileComplete(u);
  assert.strictEqual(r.complete, false);
  assert.deepStrictEqual(r.missing, ['website or Instagram page', 'what you sell']);
});

test('an Instagram account can stand in for the website', () => {
  const u = full(); u.businessProfile.website = ''; u.connectedSocials = [{ platform: 'instagram', username: 'sweetco.in' }];
  assert.strictEqual(profileComplete(u).complete, true);
  assert.strictEqual(inputFromProfile(u).instagram, 'sweetco.in');
});

test('goals map to the four Blueprint goals', () => {
  for (const [text, goal] of [['Increase sales', 'sales'], ['More followers', 'followers'], ['Launch our new range', 'launch'], ['Something else', 'enquiries']]) {
    const u = full(); u.businessProfile.marketingGoals = [text];
    assert.strictEqual(inputFromProfile(u).goal, goal, text);
  }
});

test('an empty or missing user is incomplete and never throws', () => {
  assert.strictEqual(profileComplete(null).complete, false);
  assert.strictEqual(profileComplete({}).complete, false);
  assert.ok(inputFromProfile({}));
});
```

- [ ] **Step 2: Run to verify it fails** — module not found.

- [ ] **Step 3: Implement** — `services/plan/profileInput.js` exactly per the mapping above (pure, no requires except none). Keep each helper tiny and total (never throws on missing fields).

- [ ] **Step 4: Run to verify it passes** — `cd backend && node --test tests/planProfileInput.test.js`.

- [ ] **Step 5: Commit** — `git add backend/services/plan/profileInput.js backend/tests/planProfileInput.test.js && git commit -m "Plan: business profile to plan input, with a plain list of what is missing"`

---

### Task 3: Plan runs: rules and the service

**Files:**
- Create: `backend/services/plan/planRules.js`, `backend/services/plan/planService.js`
- Modify: `backend/models/Blueprint.js` (add `kind: { type: String, enum: ['blueprint', 'plan'], default: 'blueprint', index: true }`), `backend/models/User.js` (add `planState: { lastStartedAt: Date, lastRefreshAt: Date, firstPlanFailedAt: Date, attempts: Number }`), `backend/services/blueprint/service.js` (export what `planService` needs: `createBlueprintService` returns `{ start, run, get, list }` today: add `startSystem({ user, input, kind })` described below, reusing `Blueprint.create`, `deps.enqueue`, `run`)
- Test: `backend/tests/planRules.test.js`, `backend/tests/planService.test.js`

**Interfaces:**
- Produces in `planRules.js` (pure): `canRefresh({ user, now, staff }): { ok, nextAt?, message? }` (7-day rule via `planState.lastRefreshAt`, staff always ok); `shouldHavePlan(user): boolean` (not staff, not CSM, not a pending deletion, onboarding completed, profile complete, account active; free accounts: false — they keep the free Blueprint); `monthlyDue({ user, lastPlanAt, now }): boolean` (a plan older than 30 days, or none); `isStale(planDoc, now): boolean` (older than 45 days).
- Produces in `planService.js`: `createPlanService(deps)` returning `{ startPlan({ userId, reason }), currentPlan(userId), inFlight(userId), refresh({ user, staff }) }` where `startPlan` loads the user, checks `shouldHavePlan`, refuses if a plan run for the user is `queued` or `processing` (returns `{ ok:true, alreadyRunning:true }`), builds `inputFromProfile`, calls the Blueprint service `startSystem`, and records `planState.lastStartedAt`; `currentPlan(userId)` returns the newest `kind:'plan'`, `status:'completed'` Blueprint document trimmed to `{ id, completedAt, result }` or null; `refresh` applies `canRefresh` then `startPlan({ reason: 'refresh' })`.
- `startSystem` creates the Blueprint with `kind: 'plan'`, `tierAtStart: resolveTier(user)`, `freeSlot: false`, `charge: { state: 'none', quarks: 0 }`, no deduct, no per-account daily cap, and enqueues `run`. It must still respect `MAX_CONCURRENT_RUNS` (the runner queue does).

- [ ] **Step 1: Write the failing tests**

```js
// backend/tests/planRules.test.js
const test = require('node:test');
const assert = require('node:assert');
const r = require('../services/plan/planRules');
const DAY = 86400000;
const NOW = new Date('2026-10-17T06:00:00Z');
const ok = (extra = {}) => ({ isActive: true, onboardingCompleted: true, plan: { tier: 'starter' }, staffRole: null, isCsm: false, businessProfile: { name: 'Sweet Co', website: 'sweetco.in', description: 'Custom cakes baked to order', targetAudience: 'Families' }, ...extra });

test('who should have a plan: paying and managed accounts with a complete profile, never staff, free or deleting accounts', () => {
  assert.strictEqual(r.shouldHavePlan(ok()), true);
  assert.strictEqual(r.shouldHavePlan(ok({ plan: { tier: 'managed' } })), true);
  assert.strictEqual(r.shouldHavePlan(ok({ plan: {} })), true, 'legacy accounts without a tier are managed');
  assert.strictEqual(r.shouldHavePlan(ok({ plan: { tier: 'free' } })), false);
  assert.strictEqual(r.shouldHavePlan(ok({ staffRole: 'csm' })), false);
  assert.strictEqual(r.shouldHavePlan(ok({ isCsm: true })), false);
  assert.strictEqual(r.shouldHavePlan(ok({ deletion: { status: 'pending' } })), false);
  assert.strictEqual(r.shouldHavePlan(ok({ onboardingCompleted: false })), false);
  assert.strictEqual(r.shouldHavePlan(ok({ isActive: false })), false);
  assert.strictEqual(r.shouldHavePlan(ok({ businessProfile: { name: 'x' } })), false);
});

test('the weekly refresh rule, and staff are never limited', () => {
  assert.strictEqual(r.canRefresh({ user: ok(), now: NOW }).ok, true);
  const recent = ok({ planState: { lastRefreshAt: new Date(NOW - 2 * DAY) } });
  const c = r.canRefresh({ user: recent, now: NOW });
  assert.strictEqual(c.ok, false);
  assert.strictEqual(+c.nextAt, +new Date(NOW - 2 * DAY + 7 * DAY));
  assert.match(c.message, /once a week/);
  assert.strictEqual(r.canRefresh({ user: recent, now: NOW, staff: true }).ok, true);
  assert.strictEqual(r.canRefresh({ user: ok({ planState: { lastRefreshAt: new Date(NOW - 8 * DAY) } }), now: NOW }).ok, true);
});

test('monthly due and stale', () => {
  assert.strictEqual(r.monthlyDue({ user: ok(), lastPlanAt: null, now: NOW }), true);
  assert.strictEqual(r.monthlyDue({ user: ok(), lastPlanAt: new Date(NOW - 29 * DAY), now: NOW }), false);
  assert.strictEqual(r.monthlyDue({ user: ok(), lastPlanAt: new Date(NOW - 31 * DAY), now: NOW }), true);
  assert.strictEqual(r.isStale({ completedAt: new Date(NOW - 46 * DAY) }, NOW), true);
  assert.strictEqual(r.isStale({ completedAt: new Date(NOW - 10 * DAY) }, NOW), false);
  assert.strictEqual(r.isStale(null, NOW), false);
});
```

```js
// backend/tests/planService.test.js
const test = require('node:test');
const assert = require('node:assert');
const { createPlanService } = require('../services/plan/planService');

const goodUser = () => ({ _id: 'u1', isActive: true, onboardingCompleted: true, plan: { tier: 'starter' }, businessProfile: { name: 'Sweet Co', website: 'sweetco.in', description: 'Custom cakes baked to order', targetAudience: 'Families', marketingGoals: ['enquiries'] } });
function setup({ user = goodUser(), docs = [] } = {}) {
  const calls = [];
  const deps = {
    loadUser: async () => user,
    findRuns: async (q) => docs.filter((d) => d.userId === 'u1' && (!q.status || q.status.includes(d.status))),
    startSystem: async ({ user: u, input, kind }) => { calls.push({ id: u._id, kind, goal: input.goal }); return { id: 'bp1' }; },
    saveState: async (id, patch) => { user.planState = { ...(user.planState || {}), ...patch }; },
    now: () => new Date('2026-10-17T06:00:00Z')
  };
  return { svc: createPlanService(deps), calls, user, deps };
}

test('a qualifying account starts one plan run, never charged, and records when', async () => {
  const { svc, calls, user } = setup();
  const r = await svc.startPlan({ userId: 'u1', reason: 'first' });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(calls, [{ id: 'u1', kind: 'plan', goal: 'enquiries' }]);
  assert.ok(user.planState.lastStartedAt);
});

test('a run already queued or processing is not started twice', async () => {
  const { svc, calls } = setup({ docs: [{ userId: 'u1', status: 'processing', kind: 'plan' }] });
  const r = await svc.startPlan({ userId: 'u1', reason: 'monthly' });
  assert.strictEqual(r.alreadyRunning, true);
  assert.strictEqual(calls.length, 0);
});

test('a free account, a staff account or an incomplete profile starts nothing', async () => {
  for (const patch of [{ plan: { tier: 'free' } }, { staffRole: 'owner' }, { businessProfile: { name: 'x' } }]) {
    const { svc, calls } = setup({ user: { ...goodUser(), ...patch } });
    const r = await svc.startPlan({ userId: 'u1', reason: 'first' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(calls.length, 0);
  }
});

test('refresh: once a week for customers, any time for staff, and it stamps lastRefreshAt', async () => {
  const { svc, calls, user } = setup();
  assert.strictEqual((await svc.refresh({ userId: 'u1' })).ok, true);
  assert.ok(user.planState.lastRefreshAt);
  const again = await svc.refresh({ userId: 'u1' });
  assert.strictEqual(again.ok, false);
  assert.match(again.message, /once a week/);
  assert.strictEqual(calls.length, 1);
  const staff = await svc.refresh({ userId: 'u1', staff: true });
  assert.strictEqual(staff.ok, true);
});

test('the current plan is the newest completed plan run, and a failed run never hides it', async () => {
  const docs = [
    { userId: 'u1', kind: 'plan', status: 'completed', completedAt: new Date('2026-09-01'), blueprintId: 'old', result: { v: 1 } },
    { userId: 'u1', kind: 'plan', status: 'completed', completedAt: new Date('2026-10-01'), blueprintId: 'new', result: { v: 2 } },
    { userId: 'u1', kind: 'plan', status: 'failed', completedAt: new Date('2026-10-10'), blueprintId: 'bad' }
  ];
  const { svc } = setup({ docs });
  const cur = await svc.currentPlan('u1');
  assert.strictEqual(cur.id, 'new');
  assert.deepStrictEqual(cur.result, { v: 2 });
});
```

- [ ] **Step 2: Run to verify they fail** — modules not found.

- [ ] **Step 3: Implement**

`planRules.js` (pure) — `shouldHavePlan` uses `isStaff`-equivalent checks on `staffRole`/`isCsm`, `deletion.status !== 'pending'`, `isActive !== false`, `onboardingCompleted === true`, `resolveTier(user) !== 'free'`, and `profileComplete(user).complete`. `canRefresh`: if `staff` ok; if no `planState.lastRefreshAt` ok; else `nextAt = last + PLAN_REFRESH_DAYS days`; `ok` when `now >= nextAt`; message `'You can refresh your plan once a week. The next refresh is available on <date>.'` (date via `toLocaleDateString('en-IN', { day:'numeric', month:'long' })`). `monthlyDue`, `isStale` per the interface.
`planService.js`: `createPlanService(deps = defaultDeps())`; `defaultDeps` wires `loadUser` (`User.findById(...).lean()`), `findRuns` (`Blueprint.find({ userId, kind:'plan', status: {$in}})`), `startSystem` (the Blueprint service's `startSystem`), `saveState` (`User.updateOne({_id},{$set: {'planState.<k>': v}})`). `startPlan`: load user; if `!shouldHavePlan(user)` return `{ ok:false, reason:'not_eligible' }`; if any queued/processing plan run return `{ ok:true, alreadyRunning:true }`; `startSystem`; `saveState(lastStartedAt)`; return `{ ok:true, id }`. `refresh`: `canRefresh` then `startPlan`, stamping `lastRefreshAt` only when it started (not when `alreadyRunning`). `currentPlan`: query completed plan runs sorted by `completedAt` desc, return `{ id: blueprintId, completedAt, result }`.
`services/blueprint/service.js`: add `startSystem({ user, input, kind = 'plan' })`: `normaliseInput(input, { allowGuided: true })` (return `{ ok:false }` with errors if invalid), `Blueprint.create({ blueprintId: deps.uuid(), userId, emailKey, tierAtStart: resolveTier(user), mode: 'auto', status: 'queued', ..., input, businessKeys, freeSlot: false, ipHash: '', approvals: [], qaFlags: [], kind, charge: { state: 'none', quarks: 0 } })`, then `deps.enqueue(() => run(blueprintId))`, return `{ id }`. `run` must treat `charge.state === 'none'` as nothing to refund on failure (it already does for free runs; verify by reading `failAndRefund`). The model spend for the run must still be recorded by the existing path (`spendGuard.record('blueprint', 1)` or whatever `run` already calls): check and keep.

- [ ] **Step 4: Run to verify they pass** — `cd backend && node --test tests/planRules.test.js tests/planService.test.js && node --test tests/*.test.js 2>&1 | grep -E "^ℹ (pass|fail)|^✖"`.

- [ ] **Step 5: Commit** — `git add backend && git commit -m "Plan: plan runs from the business profile, never charged, one at a time, weekly refresh rule"`

---

### Task 4: Triggers and the monthly scheduler

**Files:**
- Create: `backend/services/plan/planScheduler.js`
- Modify: `backend/routes/auth.js` and the route that saves the business profile / completes onboarding (locate with `grep -n "onboardingCompleted: true" routes/auth.js` and the profile `PUT`; call `require('../services/plan/planService').maybeStartFirstPlan(userId)` after a successful save, fire-and-forget, errors logged), `backend/server-main.js` (start the scheduler beside the other schedulers; skip in tests), `backend/services/opsAlerts.js` use only (existing `recordFailure`)
- Test: `backend/tests/planScheduler.test.js`

**Interfaces:**
- Produces: `maybeStartFirstPlan(userId): Promise<void>` (in `planService.js`: starts a plan only when the account `shouldHavePlan` and has no completed or running plan); `runMonthlyOnce({ deps, now, limit = 20 }): Promise<{ started, skipped }>` (selects users that `shouldHavePlan` and `monthlyDue`, at most `limit` per tick, skipping accounts with a run in flight); `startPlanScheduler({ intervalMs = 6 * 3600 * 1000 })` (env `ENABLE_PLAN_SCHEDULER`, default on, off in tests); failure handling: a plan run that ends `failed` for an account with NO completed plan increments `planState.attempts`, retries on the next tick up to 2 times with at least 30 minutes between tries, then calls `opsAlerts.recordFailure('plan', 'first plan failed for <userId>')` once and sets `planState.firstPlanFailedAt`.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/planScheduler.test.js
const test = require('node:test');
const assert = require('node:assert');
const { runMonthlyOnce, retryFailedFirstPlans } = require('../services/plan/planScheduler');
const DAY = 86400000;
const NOW = new Date('2026-10-17T06:00:00Z');
const user = (id, extra = {}) => ({ _id: id, isActive: true, onboardingCompleted: true, plan: { tier: 'starter' }, businessProfile: { name: 'Sweet Co', website: 'a.in', description: 'Custom cakes baked to order', targetAudience: 'Families' }, ...extra });

test('the monthly run starts plans for due accounts only, at most the limit, one at a time per account', async () => {
  const started = [];
  const deps = {
    candidates: async () => [user('a'), user('b'), user('c', { plan: { tier: 'free' } }), user('d'), user('e')],
    lastPlanAt: async (id) => ({ a: null, b: new Date(NOW - 5 * DAY), d: new Date(NOW - 40 * DAY), e: null })[id] ?? null,
    inFlight: async (id) => id === 'e',
    startPlan: async ({ userId }) => { started.push(userId); return { ok: true }; }
  };
  const out = await runMonthlyOnce({ deps, now: NOW, limit: 1 });
  assert.deepStrictEqual(started, ['a'], 'b is fresh, c is free, d waits for the limit, e is running');
  assert.strictEqual(out.started, 1);
  const out2 = await runMonthlyOnce({ deps, now: NOW, limit: 10 });
  assert.deepStrictEqual(started.slice(1), ['a', 'd']);
  assert.ok(out2.skipped >= 3);
});

test('a failed first plan is retried twice with a pause, then the owner is told once', async () => {
  const alerts = []; const started = [];
  const states = { x: { attempts: 0, lastStartedAt: new Date(NOW - 60 * 60000) } };
  const deps = {
    failedFirst: async () => [{ user: user('x'), state: states.x }],
    startPlan: async ({ userId }) => { started.push(userId); states.x.attempts += 1; states.x.lastStartedAt = NOW; return { ok: true }; },
    saveState: async (id, patch) => Object.assign(states[id], patch),
    alert: (m) => alerts.push(m)
  };
  await retryFailedFirstPlans({ deps, now: NOW });                       // attempt 1
  await retryFailedFirstPlans({ deps, now: new Date(+NOW + 10 * 60000) }); // too soon: nothing
  await retryFailedFirstPlans({ deps, now: new Date(+NOW + 40 * 60000) }); // attempt 2
  await retryFailedFirstPlans({ deps, now: new Date(+NOW + 90 * 60000) }); // out of attempts: alert once
  await retryFailedFirstPlans({ deps, now: new Date(+NOW + 200 * 60000) }); // already alerted: silent
  assert.strictEqual(started.length, 2);
  assert.strictEqual(alerts.length, 1);
  assert.ok(states.x.firstPlanFailedAt);
});
```

- [ ] **Step 2: Run to verify it fails** — module not found.

- [ ] **Step 3: Implement** `planScheduler.js` with the two functions above (deps injected, defaults wired to Mongo: `candidates` = users with `onboardingCompleted:true, isActive:{$ne:false}, staffRole:null, isCsm:{$ne:true}` limited to 200 per tick sorted by `planState.lastStartedAt` ascending; `lastPlanAt` = newest completed plan run's `completedAt`; `inFlight` = a queued/processing plan run; `failedFirst` = users with a failed plan run, no completed plan run, `planState.firstPlanFailedAt` unset). `startPlanScheduler` uses `setInterval(...).unref()`, logs one line at start, and runs `retryFailedFirstPlans` then `runMonthlyOnce` each tick. Wire the hooks in the routes and `server-main.js`. Errors never crash the process.

- [ ] **Step 4: Run to verify it passes** — `cd backend && node --test tests/planScheduler.test.js` then the full backend suite.

- [ ] **Step 5: Commit** — `git add backend && git commit -m "Plan: first plan when the profile is complete, monthly refresh, retries and an owner alert"`

---

### Task 5: The API for customers and staff

**Files:**
- Create: `backend/routes/plan.js`
- Modify: `backend/server-main.js` (mount `/api/plan`), `backend/routes/staff.js` (client plan summary and refresh), `backend/routes/campaigns.js` (retire `GET/PUT /icp-strategy`: answer 410 with a plain message and remove their use)
- Test: `backend/tests/planRoutes.test.js`

**Interfaces:**
- `GET /api/plan` (protect): `{ success, plan: { id, completedAt, stale, result } | null, running: boolean, failed: boolean, nextRefreshAt: string|null, eligible: boolean, reason: '' | 'free' | 'profile_incomplete' | 'not_eligible', missing: string[], freeBlueprint: { id } | null }`. For a free account `eligible:false, reason:'free'` and `freeBlueprint` is the account's free Blueprint id when it has one (reuse `Blueprint.findOne({ userId, kind: 'blueprint', status: 'completed', freeSlot: true })`).
- `POST /api/plan/refresh` (protect, rate limited 5 per 15 minutes): `{ success, message, nextRefreshAt }`; 429 with the rule's message when too soon; 400 when not eligible.
- Staff: `GET /api/staff/clients/:id/plan` (permission `view_clients`): the same body for that client, plus `{ lastRunAt, lastStatus }`; `POST /api/staff/clients/:id/plan/refresh` (permission `manage_client` or the one used by other client actions; read `routes/staff.js` for the right one): bypasses the weekly limit, logs a `StaffAction` like the other actions.
- Both customer routes work for an account inside a CSM pass (the plan is the client's); inside an agency pass they are allowed (read and refresh) because they touch no money.

- [ ] **Step 1: Write the failing test** (use the same fake-service style as `tests/blueprintRoutes.test.js`: build the router with an injected `service` and a fake `protect`; copy its harness)

```js
// backend/tests/planRoutes.test.js — adapt the harness of tests/blueprintRoutes.test.js
const test = require('node:test');
const assert = require('node:assert');
// harness: const { call } = makeHarness(createPlanRouter({ service: fake, now: () => NOW }), { user })

test('GET /api/plan for a paying account with a plan returns it with the date and no staleness', async () => { /* expect plan.id, running false, eligible true */ });
test('GET /api/plan for a free account explains and points to the free Blueprint', async () => { /* eligible false, reason free, freeBlueprint.id */ });
test('GET /api/plan for an incomplete profile lists what is missing in plain words', async () => { /* reason profile_incomplete, missing array */ });
test('POST /api/plan/refresh: first time ok, second time 429 with the once-a-week message', async () => {});
test('a plan older than 45 days is returned with stale true', async () => {});
test('the old ICP endpoints answer 410 and never call the old generator', async () => {});
test('staff refresh ignores the weekly limit and is logged; a CSM without access to the client is refused', async () => {});
```
Write each test fully against the harness (assert status codes and bodies); the comments above state the exact expectations.

- [ ] **Step 2: Run to verify they fail** — module not found.

- [ ] **Step 3: Implement** `routes/plan.js` as `createPlanRouter(impl = {})` with lazy service creation like `routes/blueprint.js`; a `serialise(user, planService)` helper builds the GET body using `planRules`; reuse `isStale`; rate limiter as in the Blueprint routes. Staff endpoints in `routes/staff.js` use the existing `requireStaff(...)` and `clientFor` (which now excludes workspaces: confirm) and `logStaffAction`. In `routes/campaigns.js` replace the two ICP handlers' bodies with `res.status(410).json({ success:false, message:'Your customer profile now lives in My plan.' })` and remove the now-unused generator code only if nothing else imports it (grep first); leave `User.icpStrategy` in the model.

- [ ] **Step 4: Run to verify they pass**, plus the full backend suite.

- [ ] **Step 5: Commit** — `git add backend && git commit -m "Plan: /api/plan for customers, staff client plan and refresh, old ICP endpoints retired"`

---

### Task 6: Backfill for existing managed clients

**Files:**
- Create: `backend/scripts/plan-backfill.js`, `backend/services/plan/backfill.js` (pure selection and throttle plan)
- Test: `backend/tests/planBackfill.test.js`

**Interfaces:**
- `selectForBackfill({ users, hasPlanIds, limit }): { chosen: User[], skipped: Array<{ id, why }> }` (pure): chooses accounts that `shouldHavePlan`, are not in `hasPlanIds` (already have a completed or running plan), up to `limit`, oldest accounts first; skip reasons are plain codes (`not_eligible`, `has_plan`, `over_limit`).
- The script: `node scripts/plan-backfill.js [--limit 20] [--per-minute 3] [--yes]`. Without `--yes` it is a dry run: prints who would get a plan and an estimated cost (count times a configured `PLAN_RUN_INR_ESTIMATE = 5`) and exits without writing. With `--yes` it starts runs through `planService.startPlan({ reason: 'backfill' })` at the throttled rate, prints each result, and stops at `--limit` (default 20, hard maximum 200). It prints the database name first and, when the database is not `nebulaa_dev`, requires `--yes` AND `CONFIRM_PROD=yes` in the environment.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/planBackfill.test.js
const test = require('node:test');
const assert = require('node:assert');
const { selectForBackfill, throttleDelayMs } = require('../services/plan/backfill');
const u = (id, extra = {}) => ({ _id: id, createdAt: new Date(`2026-0${id}-01`), isActive: true, onboardingCompleted: true, plan: { tier: 'managed' }, businessProfile: { name: 'Biz', website: 'b.in', description: 'We sell good things here', targetAudience: 'Everyone nearby' }, ...extra });

test('picks eligible accounts without a plan, oldest first, up to the limit, and explains every skip', () => {
  const users = [u('3'), u('1'), u('2', { staffRole: 'csm' }), u('4'), u('5', { plan: { tier: 'free' } })];
  const out = selectForBackfill({ users, hasPlanIds: new Set(['4']), limit: 1 });
  assert.deepStrictEqual(out.chosen.map((x) => x._id), ['1']);
  const why = Object.fromEntries(out.skipped.map((s) => [s.id, s.why]));
  assert.strictEqual(why['2'], 'not_eligible');
  assert.strictEqual(why['4'], 'has_plan');
  assert.strictEqual(why['5'], 'not_eligible');
  assert.strictEqual(why['3'], 'over_limit');
});

test('the throttle spaces runs evenly and never divides by zero', () => {
  assert.strictEqual(throttleDelayMs(3), 20000);
  assert.strictEqual(throttleDelayMs(60), 1000);
  assert.strictEqual(throttleDelayMs(0), 60000);
});

test('a hard maximum caps the limit whatever is asked', () => {
  const users = Array.from({ length: 300 }, (_, i) => u(String(i + 1)));
  const out = selectForBackfill({ users, hasPlanIds: new Set(), limit: 5000 });
  assert.strictEqual(out.chosen.length, 200);
});
```

- [ ] **Step 2: Run to verify it fails.** **Step 3: Implement** the two pure functions (`HARD_MAX = 200`, `throttleDelayMs(perMinute) = perMinute > 0 ? Math.round(60000 / perMinute) : 60000`) and the script around them (connect with `MONGODB_URI`, print DB name, dry run by default, dev-vs-prod guard as above, sleep between starts, never run two starts at once). **Step 4:** run the test, then run the script in DRY RUN mode against `nebulaa_dev` and paste the output into the commit message body (no writes). **Step 5: Commit** — `git add backend && git commit -m "Plan: throttled backfill for existing managed clients, dry run by default"`

---

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

### Task 8: Real run, wording, handover

**Files:**
- Create: `docs/superpowers/ops/plan-launch-checklist.md`
- Modify: `docs/superpowers/HANDOVER-nebulaa-redesign-7.md` (or a new handover file: follow the latest numbering)

- [ ] **Step 1: Everything green.** `cd backend && node --test tests/*.test.js`, `cd ../frontend && node --test tests/*.test.mjs`, audits 0, layer lists committed.
- [ ] **Step 2: Ask the owner for the OK** for one real plan run on `nebulaa_dev` (a few rupees of model use). Only with the OK: throwaway paying user with a complete profile (use a real public website of a real small business only if the owner supplies one; otherwise a profile with typed facts only), call `planService.startPlan`, wait for completion, check: status completed, `result.plan.icp` and `effort` present and tagged, percentages sum to 100, nothing charged to the user's pool (`credits.balance` unchanged, no `QuarkLedger` row), `GET /api/plan` returns it, a second `refresh` inside a week is refused, staff refresh works, the free Blueprint path of a free throwaway user is untouched. Delete the users and any plan runs after.
- [ ] **Step 3: Checklist and handover.** `plan-launch-checklist.md` lists the owner steps: run the backfill dry run, review the list and the cost estimate, run the backfill with `--yes` in small batches, tell managed clients about the new My plan page before it appears, check the first plans for quality before telling customers, and how to switch the scheduler off (`ENABLE_PLAN_SCHEDULER=off`). Add a "Plan-led Stage 1" section to the handover with commits and test counts.
- [ ] **Step 4: Commit** — `git add docs && git commit -m "Plan Stage 1: verification, launch checklist, handover"`
