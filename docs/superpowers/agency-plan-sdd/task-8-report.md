# Task 8 report: Ayrshare profile watch and the alert at 25

Status: done. No real run needed (brief requires none; all fakes, no external call).

## Built
- `backend/services/ayrshareProfileWatch.js`: `status(count)`, `countProfiles({User})`, `check(...)`, `modelStore`, `opsAlert`, `PROFILE_FILTER`. Counts users with a non-empty `ayrshare.profileKey` (workspaces count only when they have one; a removed workspace or cleared key drops out by itself, so Task 9 needs no extra call).
- `config/vendorPlans.js`: `alertAtProfiles: 25` (limit 30 is the existing `includedProfiles`).
- `models/OpsState.js` (collection `ops_state`): durable record of the last alerted level.
- `routes/staff.js`: `GET /api/staff/ayrshare-profiles` (same permission as the AI spend card, `manage_ai_switches`, Owner only).
- `services/staff/money.js`: uses the shared profile filter; the gauge payload gains `alertAt`, `level`, `message`. `StaffMoney.tsx` shows the message above the gauge when level is not ok.
- `server-main.js`: first check 1 minute after the database connects, then hourly, both unref'd, failures only logged.
- Tests: `tests/agencyProfileWatch.test.js` (9) and 2 added to `staffMoneyRoutes.test.js` (RED seen for both files).

## Deviations from the brief (deliberate)
1. Alert path: brief used `recordFailure('billing', ...)`, which needs 3 hits and would say "Automatic monthly invoices is failing". Used `opsAlerts.notify` with its own staff wording instead.
2. Dedupe is durable (database), not in-memory, and re-arms only when the count falls below 25. Level is stored only after the email was really sent (no recipients or mail failure means retry next hour). The level never steps down from over to near, so flapping at 30/31 does not repeat. Two emails at most per episode: reaching 25, and passing 30.
3. The Money page already had the Ayrshare gauge; I added the warning line rather than a new card.

## Notes
- Customers never see the alert or the vendor name: staff route and staff page only.
- Not hooked on profile creation (hourly only, per brief). Count query is unindexed `countDocuments`, fine hourly.
- Verification: backend 1161 pass / 0 fail; frontend 252 pass, tsc 1 old error, brand-audit 0, voice-audit 0.
