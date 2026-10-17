# Handover 7 — 2026-10-16 (Agency plan finished, reviewed and fixed)

Read handovers 5 and 6 first (owner, rules, environment). This file only records what changed after handover 6.

## State
- All 12 Agency plan tasks are built. The final whole-branch review ran as three read-only reviews (money path, access/isolation/deletion, frontend and legal): **no Critical defects**, a handful of Important ones, all fixed in nine `fix(agency):` commits (`acb230a` .. `4737564`) and re-reviewed (backend: "safe to push"). Records: `docs/superpowers/agency-plan-sdd/final-review-A.md`, `-B.md`, `-C.md`, `final-fix-C-report.md`, `final-fix-AB-report.md`, `final-rereview-AB.md`.
- Tests at push: backend 1225, frontend 303, brand and voice audits 0, tsc only the old Influencers.tsx error.
- Real runs on `nebulaa_dev` (throwaway users, all cleaned): six agency scenarios (5 clients and sixth refused, spend charged to the agency and tagged, blocked routes 403 inside a client, plan end pauses and restore re-opens, client removal, agency purge keeping only the agency's payment record, staff list excludes clients) and the billing database updates (plan payment, slot first payment, replay, renewal, cancel, freeze).
- Not released, not deployed. The owner runs the release.

## What the reviews caught (fixed)
App did not know it was inside a client (the server's `actingAgency` was dropped), so clients looked like agency accounts; Terms prompt shown to clients and to staff passes; Quark wording shown to agencies; staff Usage page crashed once any Agency account existed; retry-invoices made GST invoices for refused payments; a verify/webhook race could wipe a month's Quarks right after the first payment; double slot release on concurrent removal; staff or CSM could undo a customer's deletion or accept Terms for them; interrupted purges stuck forever; CSM path check bypass (`/API/PAYMENT`) now one shared normaliser; a personal Gmail address received every customer's scheduled-post reminders (removed; reminders now go to the post owner only); schedulers ignored frozen/ended/deleting clients.

## Owner decisions still open (also in `docs/superpowers/ops/agency-launch-checklist.md`)
1. **Reminder emails: decided OFF.** The owner switched them off. They send only when the environment variable `CAMPAIGN_REMINDER_EMAILS` is `on` (case-insensitive); unset means no email and no error. In-app reminders are unchanged. To turn them on later: set `CAMPAIGN_REMINDER_EMAILS=on` and restart (they go to the post owner only).
2. **Slot Quarks (N1): decided and fixed.** Slot Quarks live in the monthly allowance. The first payment of a slot adds 500 to the monthly bucket at once (it ends with the current plan month; top-up Quarks and their end date are never touched). Slot renewals grant nothing; the Agency plan renewal grants 6,000 plus 500 per active extra slot (0 to 20).
3. Single-slot cancel button; Starter/Growth to Agency upgrade path; automatic switch of new Agency sign-ups to Rs 9,999 near 30 Ayrshare profiles (only the alert at 25 exists); whether content-calendar auto-generation and snapshots may spend the agency pool for client accounts (they are now skipped when the agency plan has ended or the client is frozen); whether the agency data export should include its clients.
4. Lawyer review of the new Terms section 21 and Privacy text (the pages carry no draft banner; do not send the "updated Terms" notice before review). Subashni: GST/SAC on agency invoices, retention.
5. Razorpay: create the two plan ids (or let the app create them), test slot and agency checkout with TEST keys (never run: the preview refuses payment). Ask Ayrshare whether a profile added and removed in one month is billed in full.

## Known small things left (deferred minors, see the review files)
Removal claim has no heartbeat for very long purges (N4/N5); a second removal click shows 502 instead of 409 (N3); verify answers success when a plan payment could not be applied after 5 retries (alert exists, N7); upcoming-renewals list does not show slot renewals; `needsTermsPrompt` ignores the Terms version; usage JSON still carries `quarksSpent` (UI never shows it); arrow-key navigation in the client switcher.

## Next
Push is done by the assistant to the existing branch `nebulaa-redesign`; release stays with the owner (`docs/superpowers/ops/release-prod.sh`, he types DEPLOY). Everything since production's last release `b6f374b` is in this branch.
