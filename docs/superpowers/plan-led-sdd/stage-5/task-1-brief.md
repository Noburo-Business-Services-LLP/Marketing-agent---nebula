### Task 1: Config, models, entitlement helper, ledger

**Files:** Create `backend/config/listening.js`, `backend/models/ListeningScore.js`, `backend/models/ListeningWeekly.js`, `backend/models/ListeningBatchLog.js`, `backend/services/listening/entitlement.js`, `backend/services/listening/ledger.js`, `backend/services/listening/store.js`; Modify `backend/config/apiCosts.js`, `backend/services/spendGuard.js`, `backend/models/User.js`; Tests `backend/tests/listeningConfig.test.js`, `backend/tests/listeningLedger.test.js`.

**Interfaces:**
- `config/listening.js` exports exactly the constants in Global Constraints.
- `ListeningScore` schema: `{ userId: ObjectId ref User required, inboxItemId: ObjectId required, platform: String, kind: { type: String, enum: ['public','private'] }, label: { type: String, enum: ['pos','neu','neg'] }, reason: String, itemAt: Date, scoredAt: Date, modelVersion: String }`, collection `listening_scores`, unique index `{ userId: 1, inboxItemId: 1 }`, index `{ userId: 1, itemAt: -1 }`. (The `kind: { type: String, ... }` form is the field definition; there is no schema key literally named `type`.)
- `ListeningWeekly`: `{ userId, weekStart: String, counts: { positive: Number, neutral: Number, negative: Number }, total: Number, reasons: Mixed (negative counts by reason), computedAt: Date }`, collection `listening_weekly`, unique `{ userId: 1, weekStart: 1 }`.
- `ListeningBatchLog`: `{ userId, day: String, at: Date (expires: 14*24*3600), itemIds: [ObjectId], source: enum tracker|staff }`, collection `listening_batch_log`, indexes `{ day: 1, userId: 1 }`, `{ userId: 1, at: -1 }`.
- `services/listening/entitlement.js`: `eligibleAccount(user, { blocked = new Set() }): boolean` = active (`isActive !== false`), `onboardingCompleted`, no `staffRole`, not `isCsm`, not in `blocked`, `canUse(user,'inbox').allowed`.
- `services/listening/ledger.js`: `createBatchLedger({ Model = undefined })` returning `{ record({ userId, itemIds, at, source }): Promise<void> (never throws, memory first), countBatchesToday(at), countItemsUserToday(userId, at), attempted(userId, itemIds, at): Promise<Set<string>> (ids attempted in the last 7 days, max of database and memory), lastRunAt(userId) }` and `sharedBatchLedger()`. Same memory-plus-database design as `services/competitors/readLedger.js`; pass `Model: null` for memory only in tests.
- `services/listening/store.js`: `listeningStore({ Score, Weekly } = {})` with `saveScores(userId, rows)` (bulk upsert by `{ userId, inboxItemId }`, never overwrites an existing label), `scoredIds(userId, ids)`, `scoresSince(userId, since)` (lean rows), `rebuildWeeks(userId, now)` (recompute `ListeningWeekly` for the last `KEEP_WEEKS` weeks from `ListeningScore` using `weekStartOf`, delete older weeks), `weeks(userId, n)`.
- `spendGuard.js`: `PROVIDER_OF.listening_score = 'listening_score'`, `LABELS.listening_score = 'Comment scoring'` (this adds it to `PROVIDERS`, the staff switch list).
- `apiCosts.js`: rates and `ACTION_USD.listening_score = gpt-style cost of TOKENS.listening_batch` using the new rate keys; `QUARK_COSTS.listening_score = 0`; add a unit label `'per batch of comments'` in the unit-label table next to `competitor_scrape: 'free'`.

- [ ] **Step 1: Write the failing tests.**

```js
// backend/tests/listeningConfig.test.js
const test = require('node:test');
const assert = require('node:assert');
const cfg = require('../config/listening');
const { ACTION_USD, QUARK_COSTS } = require('../config/apiCosts');
const spend = require('../services/spendGuard');
test('caps and thresholds have the agreed values', () => {
  assert.strictEqual(cfg.BATCH_SIZE, 40); assert.strictEqual(cfg.MAX_ITEMS_PER_RUN, 400);
  assert.strictEqual(cfg.MIN_ITEMS, 20); assert.strictEqual(cfg.PERIOD_DAYS, 28);
  assert.deepStrictEqual(cfg.LABELS, ['pos', 'neu', 'neg']);
  assert.ok(cfg.REASONS.includes('delivery') && cfg.REASONS.includes('other'));
});
test('the scoring action is priced from rates, never charged in Quarks, and has its own staff switch', () => {
  assert.ok(ACTION_USD.listening_score > 0 && ACTION_USD.listening_score < 0.05);
  assert.strictEqual(QUARK_COSTS.listening_score, 0);
  assert.strictEqual(spend.providerOf('listening_score'), 'listening_score');
  assert.ok(spend.PROVIDERS.includes('listening_score'));
});
test('the schemas have the unique indexes and no schema key named type', () => {
  const S = require('../models/ListeningScore'); const W = require('../models/ListeningWeekly');
  const has = (M, keys) => M.schema.indexes().some(([k, o]) => o && o.unique && JSON.stringify(k) === JSON.stringify(keys));
  assert.ok(has(S, { userId: 1, inboxItemId: 1 })); assert.ok(has(W, { userId: 1, weekStart: 1 }));
  for (const M of [S, W, require('../models/ListeningBatchLog')]) assert.ok(!M.schema.path('type'));
});
```

```js
// backend/tests/listeningLedger.test.js
const test = require('node:test');
const assert = require('node:assert');
const { createBatchLedger } = require('../services/listening/ledger');
const NOW = new Date('2026-10-17T06:00:00Z');
test('batches and items are counted per day and per account', async () => {
  const l = createBatchLedger({ Model: null });
  await l.record({ userId: 'u1', itemIds: ['a', 'b'], at: NOW }); await l.record({ userId: 'u2', itemIds: ['c'], at: NOW });
  assert.strictEqual(await l.countBatchesToday(NOW), 2); assert.strictEqual(await l.countItemsUserToday('u1', NOW), 2);
  assert.strictEqual(await l.countItemsUserToday('u1', new Date('2026-10-18T06:00:00Z')), 0);
});
test('attempted items are remembered for 7 days even when nothing was saved', async () => {
  const l = createBatchLedger({ Model: null });
  await l.record({ userId: 'u1', itemIds: ['a'], at: NOW });
  assert.deepStrictEqual([...(await l.attempted('u1', ['a', 'b'], new Date(NOW.getTime() + 6 * 864e5)))], ['a']);
  assert.strictEqual((await l.attempted('u1', ['a'], new Date(NOW.getTime() + 8 * 864e5))).size, 0);
  assert.strictEqual((await l.attempted('u2', ['a'], NOW)).size, 0);
});
test('a database that throws never throws out of the ledger and memory still counts', async () => {
  const Model = { create: async () => { throw new Error('disk full'); }, countDocuments: async () => { throw new Error('down'); }, find: () => { throw new Error('down'); } };
  const l = createBatchLedger({ Model });
  await l.record({ userId: 'u1', itemIds: ['a'], at: NOW });
  assert.strictEqual(await l.countBatchesToday(NOW), 1); assert.ok((await l.attempted('u1', ['a'], NOW)).has('a'));
});
```

- [ ] **Step 2: Run to verify they fail** — `cd backend && node --test tests/listeningConfig.test.js tests/listeningLedger.test.js` → module not found.
- [ ] **Step 3: Implement** the files per the interfaces (read `services/competitors/readLedger.js` and `models/CompetitorReadLog.js` first and mirror them; read `config/apiCosts.js` around `TOKENS`, `PROVIDER_RATES` and the `competitor_scrape` lines (about 274, 372, 396) to place the new entries). Add `listeningRunAt: { type: Date }` next to `competitorsReadAt` in `models/User.js`. Add a `store` test using an in-memory fake only if `saveScores` has non-trivial logic; the real Mongo behaviour is covered in Task 8.
- [ ] **Step 4: Run the new tests, then the full backend suite** (`node --test tests/*.test.js`; the spend guard and apiCosts tests must still pass). **Step 5: Commit** — `git add backend/config/listening.js backend/models/ListeningScore.js backend/models/ListeningWeekly.js backend/models/ListeningBatchLog.js backend/services/listening backend/config/apiCosts.js backend/services/spendGuard.js backend/models/User.js backend/tests/listeningConfig.test.js backend/tests/listeningLedger.test.js && git commit -m "Listening: config, models, entitlement helper, durable batch ledger, cost action"`.

---

