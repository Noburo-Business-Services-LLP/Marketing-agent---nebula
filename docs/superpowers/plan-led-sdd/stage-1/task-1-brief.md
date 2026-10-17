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

