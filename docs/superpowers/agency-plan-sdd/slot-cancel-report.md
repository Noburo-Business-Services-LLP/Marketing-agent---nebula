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
