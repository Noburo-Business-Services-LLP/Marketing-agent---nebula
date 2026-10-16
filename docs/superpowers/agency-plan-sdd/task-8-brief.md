### Task 8: Ayrshare profile watch and the alert at 25

**Files:**
- Create: `backend/services/ayrshareProfileWatch.js`
- Modify: `backend/routes/staff.js` (read-only endpoint `GET /api/staff/ayrshare-profiles`, permission the same as the AI spend card), `backend/server-main.js` (hourly check), `frontend/pages/staff/StaffMoney.tsx` (show the count) if that page exists (the spec calls it the Money page; locate with `grep -rl "Reset Ayrshare" frontend/pages/staff`)
- Test: `backend/tests/agencyProfileWatch.test.js`

**Interfaces:**
- Produces: `PROFILE_LIMIT = 30` (flat-fee profiles), `ALERT_AT = 25` (named constants, with the comment that they come from the Ayrshare Business plan); `status(count): { count, limit, alertAt, level: 'ok'|'near'|'over', message }` (pure); `countProfiles({ User }): Promise<number>` counts users with a non-empty `ayrshare.profileKey` (workspaces included: each is a profile); `check({ User, alert, state }): Promise<status>` raising `alert(message)` once per level change.

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/agencyProfileWatch.test.js
const test = require('node:test');
const assert = require('node:assert');
const p = require('../services/ayrshareProfileWatch');

test('below 25 is fine, 25 to 30 is a warning, past 30 costs extra', () => {
  assert.strictEqual(p.status(7).level, 'ok');
  assert.strictEqual(p.status(24).level, 'ok');
  assert.strictEqual(p.status(25).level, 'near');
  assert.strictEqual(p.status(30).level, 'near');
  assert.strictEqual(p.status(31).level, 'over');
  assert.match(p.status(26).message, /26 of 30/);
  assert.match(p.status(31).message, /extra/);
});

test('the alert fires once per change of level, not every hour', async () => {
  const sent = [];
  const state = {};
  const User = (n) => ({ countDocuments: async () => n });
  await p.check({ User: User(10), alert: (m) => sent.push(m), state });
  await p.check({ User: User(25), alert: (m) => sent.push(m), state });
  await p.check({ User: User(26), alert: (m) => sent.push(m), state });
  await p.check({ User: User(31), alert: (m) => sent.push(m), state });
  await p.check({ User: User(31), alert: (m) => sent.push(m), state });
  assert.strictEqual(sent.length, 2, 'near once, over once');
});
```

- [ ] **Step 2: Run to verify it fails** — `cd backend && node --test tests/agencyProfileWatch.test.js` → FAIL.

- [ ] **Step 3: Implement**

```js
// backend/services/ayrshareProfileWatch.js
'use strict';
/**
 * Ayrshare Business plan: a flat fee covers the first 30 social profiles, each one after that is billed extra
 * (USD 8.99 a month in October 2026). Every connected account and every agency client is one profile.
 */
const PROFILE_LIMIT = 30;
const ALERT_AT = 25;

function status(count) {
  const level = count > PROFILE_LIMIT ? 'over' : count >= ALERT_AT ? 'near' : 'ok';
  const message = level === 'over'
    ? `${count} connected social profiles: past the ${PROFILE_LIMIT} covered by the flat fee, so each extra profile now costs extra every month. Review the Agency and Publish prices.`
    : level === 'near'
      ? `${count} of ${PROFILE_LIMIT} connected social profiles used. Past ${PROFILE_LIMIT} each profile costs extra, so plan the price change for new Agency sign-ups.`
      : `${count} of ${PROFILE_LIMIT} connected social profiles used.`;
  return { count, limit: PROFILE_LIMIT, alertAt: ALERT_AT, level, message };
}

const countProfiles = ({ User }) => User.countDocuments({ 'ayrshare.profileKey': { $exists: true, $nin: [null, ''] } });

async function check({ User, alert, state = {} }) {
  const s = status(await countProfiles({ User }));
  if (s.level !== 'ok' && state.level !== s.level) { try { alert(s.message); } catch (_) { /* alerting never stops the check */ } }
  state.level = s.level;
  return s;
}

module.exports = { PROFILE_LIMIT, ALERT_AT, status, countProfiles, check };
```

Wire it: in `routes/staff.js` add a read-only `GET /ayrshare-profiles` with the same permission as the AI spend card, returning `status(...)`; in `server-main.js` start an hourly `setInterval` (unref'd, guarded by `process.env.NODE_ENV !== 'test'`) calling `check({ User, alert: (m) => require('./services/opsAlerts').recordFailure('billing', m), state })`. Show the count on the staff Money page as one line using the returned `message`, with a warning style when `level !== 'ok'`.

- [ ] **Step 4: Run to verify it passes** — `cd backend && node --test tests/agencyProfileWatch.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend frontend/pages/staff
git commit -m "Staff: Ayrshare profile count with an alert at 25 of 30"
```

---

