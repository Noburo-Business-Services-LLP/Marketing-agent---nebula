### Task 7: Usage per client

**Files:**
- Create: `backend/services/agencyUsage.js`
- Modify: `backend/routes/agency.js` (add `GET /usage` and `GET /usage.csv`)
- Test: `backend/tests/agencyUsage.test.js`

**Interfaces:**
- Consumes: ledger rows with `workspace`, `action`, `quarks` (Task 5); `ACTION_UNITS` / `outputsFor` from config for post and video counts.
- Produces: `summarise(rows, workspaces): Array<{ id, name, posts, videos, quarksSpent }>` (pure); `toCsv(summary, monthLabel): string` (pure); `usageForMonth({ owner, month, models })` and routes `GET /api/agency/usage?month=YYYY-MM` → `{ success, month, poolLeft, clients: [...] }` and `/usage.csv`.

Counting rule: a ledger `spend` row with action in `POST_ACTIONS = ['image_generated','campaign_text','campaign_full','carousel_slide']` counts one post per `units` (use `ref`-less rows as one); actions in `VIDEO_ACTIONS = ['studio_video','video_generated','hero_video_clip']` count one video each. The implementer reads `config/apiCosts.js` `ACTION_USD`/`QUARK_COSTS` keys to complete these two lists with the real action names that `deductCredits` receives, and the test below pins the lists to those keys.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/agencyUsage.test.js
const test = require('node:test');
const assert = require('node:assert');
const u = require('../services/agencyUsage');
const { QUARK_COSTS } = require('../config/apiCosts');

test('every action named in the usage lists is a real Quark action', () => {
  for (const a of [...u.POST_ACTIONS, ...u.VIDEO_ACTIONS]) assert.ok(a in QUARK_COSTS, a);
});

test('usage is summed per client: posts, videos and Quarks, refunds taken off', () => {
  const rows = [
    { workspace: 'w1', type: 'spend', action: 'image_generated', quarks: -11 },
    { workspace: 'w1', type: 'spend', action: 'image_generated', quarks: -11 },
    { workspace: 'w1', type: 'spend', action: 'studio_video', quarks: -161 },
    { workspace: 'w2', type: 'spend', action: 'image_generated', quarks: -11 },
    { workspace: 'w1', type: 'refund', action: 'image_generated', quarks: 11 },
    { workspace: null, type: 'spend', action: 'image_generated', quarks: -11 }
  ];
  const s = u.summarise(rows, [{ id: 'w1', name: 'Sweet Co' }, { id: 'w2', name: 'Tea House' }, { id: 'w3', name: 'Quiet' }]);
  assert.deepStrictEqual(s.find((c) => c.id === 'w1'), { id: 'w1', name: 'Sweet Co', posts: 1, videos: 1, quarksSpent: 172 });
  assert.deepStrictEqual(s.find((c) => c.id === 'w2'), { id: 'w2', name: 'Tea House', posts: 1, videos: 0, quarksSpent: 11 });
  assert.deepStrictEqual(s.find((c) => c.id === 'w3'), { id: 'w3', name: 'Quiet', posts: 0, videos: 0, quarksSpent: 0 });
  assert.strictEqual(s.length, 3, 'the agency\'s own spending is not a client');
});

test('the CSV has a header, one line per client, and quotes names that contain commas', () => {
  const csv = u.toCsv([{ id: 'w1', name: 'Sweet, Co', posts: 2, videos: 1, quarksSpent: 183 }], 'October 2026');
  const lines = csv.trim().split('\n');
  assert.strictEqual(lines[0], 'Client,Posts,Videos');
  assert.strictEqual(lines[1], '"Sweet, Co",2,1');
  assert.ok(!/quark/i.test(csv), 'customers see posts and videos, not Quarks');
});

test('month parsing accepts YYYY-MM only and falls back to the current month', () => {
  assert.deepStrictEqual(u.monthRange('2026-10', new Date('2026-12-01')), { from: new Date('2026-10-01T00:00:00.000Z'), to: new Date('2026-11-01T00:00:00.000Z'), label: 'October 2026' });
  assert.strictEqual(u.monthRange('nonsense', new Date('2026-12-15T00:00:00Z')).label, 'December 2026');
});
```

(Client w1: 11 + 11 + 161 − 11 refunded = 172 Quarks; the agency's own spending row has no workspace and is ignored.)

- [ ] **Step 2: Run to verify it fails** — `cd backend && node --test tests/agencyUsage.test.js` → FAIL.

- [ ] **Step 3: Implement**

```js
// backend/services/agencyUsage.js
'use strict';
/** What each client of an agency used in a month, from the Quark ledger. Customers see posts and videos, not Quarks. */
const POST_ACTIONS = ['image_generated', 'campaign_text'];
const VIDEO_ACTIONS = ['studio_video'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthRange(input, now = new Date()) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(input || ''));
  const y = m ? Number(m[1]) : now.getUTCFullYear();
  const mo = m ? Number(m[2]) - 1 : now.getUTCMonth();
  return { from: new Date(Date.UTC(y, mo, 1)), to: new Date(Date.UTC(y, mo + 1, 1)), label: `${MONTHS[mo]} ${y}` };
}

function summarise(rows, workspaces) {
  const out = new Map(workspaces.map((w) => [String(w.id), { id: String(w.id), name: w.name, posts: 0, videos: 0, quarksSpent: 0 }]));
  for (const r of rows) {
    const c = r.workspace && out.get(String(r.workspace));
    if (!c || (r.type !== 'spend' && r.type !== 'refund')) continue;
    const sign = r.type === 'spend' ? 1 : -1;
    c.quarksSpent += sign * Math.abs(r.quarks);
    if (POST_ACTIONS.includes(r.action)) c.posts += sign;
    if (VIDEO_ACTIONS.includes(r.action)) c.videos += sign;
  }
  return [...out.values()].map((c) => ({ ...c, posts: Math.max(0, c.posts), videos: Math.max(0, c.videos), quarksSpent: Math.max(0, c.quarksSpent) }));
}

const q = (s) => (/[",\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
function toCsv(summary) {
  return ['Client,Posts,Videos', ...summary.map((c) => `${q(c.name)},${c.posts},${c.videos}`)].join('\n') + '\n';
}

async function usageForMonth({ owner, month, models, now = new Date() }) {
  const { from, to, label } = monthRange(month, now);
  const { listWorkspaces } = require('./agencyWorkspaces');
  const workspaces = await listWorkspaces({ owner, models });
  const rows = await models.QuarkLedger.find({ user: owner._id, workspace: { $in: workspaces.map((w) => w.id) }, type: { $in: ['spend', 'refund'] }, createdAt: { $gte: from, $lt: to } }).lean();
  return { month: label, clients: summarise(rows, workspaces) };
}

module.exports = { POST_ACTIONS, VIDEO_ACTIONS, monthRange, summarise, toCsv, usageForMonth };
```

Add `QuarkLedger` to `defaultModels()` in `services/accountDeletion.js` only if not already included by `erasable()` (it is a user-owned model; check `dataRegistry`). In `routes/agency.js` add `GET /usage` (JSON with `poolLeft: await walletBalance(owner._id)` shown to the frontend as a count of posts via `outputsFor`) and `GET /usage.csv` (`Content-Disposition: attachment; filename="client-usage-<month>.csv"`), both agency-only and, from inside a client, readable only through the agency token (blocked by `isBlockedInsideClient`, which already blocks everything but the list and open).

- [ ] **Step 4: Run to verify it passes** — `cd backend && node --test tests/agencyUsage.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "Agency: usage per client by month, JSON and CSV"
```

---

