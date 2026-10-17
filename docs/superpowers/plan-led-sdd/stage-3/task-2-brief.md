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

