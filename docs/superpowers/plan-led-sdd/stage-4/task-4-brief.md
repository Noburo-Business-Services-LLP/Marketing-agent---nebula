### Task 4: API for customers and staff

**Files:** Create `backend/routes/competitorInsights.js`; Modify `backend/server-main.js` (mount `GET /api/competitors/insights` BEFORE the existing competitors router), `backend/routes/staff.js`; Test `backend/tests/competitorInsightsRoutes.test.js`.

**Interfaces:** `GET /api/competitors/insights` (protect, entitlement `canUse(user,'competitors')` else 403 with the standard add-on message used by `requireFeature('competitors')`; read the middleware and reuse it) -> `{ success, weekStart, highlights, competitors: [{ id, name, handle, status ('tracking'|'no_handle'|'failed'|'paused'|'waiting'), trend, lastCheckedAt }] }` built with `insights()`; never returns raw snapshots or handles of other accounts. Staff: `GET /api/staff/clients/:id/competitors` (same body for that client; permission `view_clients`/`open_client`, CSM scope via `clientFor`) and `POST /api/staff/clients/:id/competitors/check` (runs `runTrackerOnce` restricted to that account, bypassing the 12-hour cooldown but NOT the daily cap or the spend guard, logged like other staff actions; staff only). Inside CSM and agency passes the customer endpoint works (it is the client's data).

- [ ] Steps: write tests with the harness style of `tests/planRoutes.test.js` (full bodies: entitlement refused, 401, shape, statuses for each competitor state, no cross-account data, staff scope, staff check respects caps); implement; run the full backend suite; commit `git commit -m "Competitors: insights API for customers and staff"`.

---

