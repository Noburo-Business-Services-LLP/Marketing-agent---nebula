# Single extra client cancel: report

Built on `nebulaa-redesign`, not pushed.

## Backend
- `POST /api/payment/cancel-slot` in `backend/routes/payment.js` (protected, same payment rate limiter; 403 for client workspaces and for a client pass).
- Agency accounts only. Takes the newest active slot not already ending. None: 400 "You have no extra client to cancel."
- Refused with 400 when the clients would not fit under the lowered limit (an already-ending place is counted too, so nothing is ever frozen by this route).
- Cancels at Razorpay at cycle end, then records `cancelAtPeriodEnd`, `cancelRequestedAt`, `cancelEndsAt` on that subscription record (new schema fields). "Already cancelled" at Razorpay counts as success; any other failure is a 502 and nothing is recorded.
- `extraSlots` is not touched; the existing ended-event handler lowers it at month end.
- A repeat press when only ending places remain returns success without calling Razorpay.
- `toPublicJSON().agency` now has `extraSlots` and `slotsEnding`; `GET /api/agency/clients` also returns `extraSlots`, `slotsEnding`, `slotsEndAt` (used by the plans page). Helpers `slotsEndingOf`, `slotsEndAtOf` in `services/agency.js`.

## Frontend
- `CancelExtraClientDialog`, `apiService.cancelExtraClient()`, pure helpers in `utils/agencyPlan.ts`, link and "Ends on <date>" note on the plans page Extra clients card. Link hidden when `slotsEnding >= extraSlots`.

## Tests
backend/tests/slotCancel.test.js (13), frontend/tests/agencyPlan.test.mjs (5 added). Full suites: backend 1241, frontend 308, brand and voice audits 0, tsc only the old Influencers.tsx error.

## Not done
Not tried with real Razorpay (checklist updated). Not looked at in the running app. Clients page shows no ending note.

## Follow-up: adding a client respects places that are ending
- Counter `agency.slotsEnding` on the agency (schema, default 0). `cancel-slot` raises it in the same conditional update that flags the subscription; the ended-subscription handler lowers it (and clears the flag) only for a place that was flagged; it is clamped at 0 next to the existing `extraSlots` clamp. Flag and counter agree; `slotsEndingOf` (flags) feeds the public profile, the counter feeds the atomic checks.
- Effective limit for adding a client = client limit less places ending, never below the included clients (`EFFECTIVE_LIMIT_EXPR` in `services/agency.js`), used inside `claimSlot`'s atomic filter. Refusal: "One extra client place ends this month, so you can have up to X clients. Remove a client or keep the place." (plural form for several).
- `cancel-slot` now claims the place first with one conditional update (matches only while that place is unflagged AND the clients still fit, same expression), then calls Razorpay. A second press in flight matches nothing and returns success without a second cancel. A Razorpay failure (not "already cancelled") undoes the claim and counter and answers 502.
- Tests: 4 new backend cancel tests, 3 new add-client tests; backend 1248 pass, frontend 308 pass, audits 0, tsc only Influencers.tsx.
- Limits: the test fakes evaluate `$expr` with small hand-written evaluators, so the real Mongo expression is untested against a database. A place cancelled before this change has no counter (none exist, never released). A second press AFTER the first completes, with another open place, is a genuine second cancel.
