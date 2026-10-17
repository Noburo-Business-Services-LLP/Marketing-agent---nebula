# Final fix report: N1 and N2

**N2 (commit "reminder emails off by default").** Environment variable `CAMPAIGN_REMINDER_EMAILS`; emails send only when it is `on` (case-insensitive). The switch sits in `notificationScheduler.recipientFor` and `sendEmailNotification`, so the scheduler, the test email and both sends in `routes/notifications.js` all go quiet. In-app notifications are unchanged. Start-up logs ON or OFF. Checklist and HANDOVER-7 item 1 updated.

**N1 (commit "slot Quarks live in the monthly allowance").**
- Agency renewal: `buildChargeUpdate` option `extraSlots` (default 0, clamped 0..20); grant = 6,000 + 500 x slots. `applyCharge` passes the account's `agency.extraSlots` and adds it to the plan guard, so a slot change between read and write forces a re-read.
- Slot first payment: `credits.balance` and `credits.planBalance` +500, `extraSlots` +1; `planExpiresAt` is not touched; no top-up field is in the update.
- Slot renewal: no Quarks (payment and invoice still recorded, payment credits 0).
- Replay, amount checks, slot gate and cap unchanged. No invoice text claimed slot Quarks on renewal, so none changed.

**Real check on `nebulaa_dev`** (throwaway users, script and users deleted): renewal with 0, 2, 20 slots gave 6000, 7000, 16000 in the monthly bucket; slot first payment on an account with a 2-day top-up pack added 500 to planBalance only, with the month end and the pack end date unchanged; renewal 0; every replay matched nothing.

**Concerns.** If an agency has no `planExpiresAt`, slot Quarks have no end until the next plan renewal (left as is; agency plan payments always set it). A slot bought after the plan month has ended (past `planExpiresAt`) would expire at the next settle; slots are only sold to active agency accounts. Existing slots already bought keep their old top-up Quarks.
