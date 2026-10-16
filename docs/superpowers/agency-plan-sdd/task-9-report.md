# Task 9 report: removing clients, deleting an agency, staff and scheduler exclusions

Status: done. Backend 1188/1188 (was 1161; +25 in `agencyDeletion.test.js`, +2 in `dataRegistry.test.js`). RED seen first (23 of 25 new tests failed), then GREEN. Frontend untouched, so frontend tests, tsc and audits were not re-run. Nothing pushed. No `.env` read or printed (the check script loads it through dotenv, as the existing scripts do).

## What was built

### Removing a client (`DELETE /api/agency/clients/:id`)
- Body `{ password, confirm: 'REMOVE' }`. Refused (403) inside a client pass or for a client login, 400 without REMOVE, 403 for a wrong password (shared `passwordOk` moved to `services/accountDeletion.js`, used by both routes), 404 for a client of another agency, 409 while work runs, 502 if the erase could not finish. Also blocked inside a client by `isBlockedInsideClient` (pinned by a test).
- `services/agencyWorkspaces.js`:
  - `removeWorkspace({ owner, workspaceId, models, purge, isBusy })`: finds the client among the owner's; pauses it (`agency.frozen = true`) FIRST, then checks for running work, so a job cannot start in between; if work runs it puts the client back exactly as it was and returns the plain refusal; otherwise runs `purge`, and only on success releases the slot. A client that could not be fully erased stays (still paused) and the agency is told to try again.
  - `runningWork(workspaceId, models, now)`: refusal text "Wait until this client's videos and jobs finish, then try again." (ruling 1).
- `services/accountDeletion.js`: `purgeWorkspace(id, { models, deps, now })` runs only the steps `files`, `social_profile`, `data`, `account` of the normal step list (no payments, staff log, tombstone, no email). It refuses an ordinary account or an agency. Already gone counts as done. A failed step returns `{ ok:false }` and the record stays.
- The agency's ledger rows tagged `workspace = <client>` are kept (ruling 2): the data registry finds ledger rows by `user` only, and `purgeWorkspace` therefore leaves the agency's rows alone. Pinned by two tests (registry filter shape; end-to-end removal keeps rows) and shown in the real run.
- The paid slot is not touched (`extraSlots` unchanged), only `clientCount` goes down by one (no single-slot cancel route, no billing change; ruling 5).

### Job collections checked for running work (ruling 1)
Every collection that holds a charged job from the Task 5 report, with the states counted as running:

| Label | Model | Running means |
|---|---|---|
| AI video jobs (Kling queue, Smart Calendar reels) | `VideoJob` (`userId`) | `queued`, `processing` |
| Hero videos | `HeroVideoJob` (`userId`) | `queued`, `processing` |
| Blueprints, including the designed deck | `Blueprint` (`userId`) | `status` `queued`/`processing`, or `designed.status` `queued`/`processing` |
| studio videos | `StudioVideo` (`user`) | `processing` |
| pictures and carousels (drafts, carousels, stale-draft reaper) | `Draft` (`userId`) | `processing` |
| posts going out | `Campaign` (`userId`) | `scheduled` with `scheduling.startDate` due now or within 2 minutes, not auto-cancelled, below the failure ceiling. The campaign scheduler has no "publishing" state; a due scheduled post stays `scheduled` until the scheduler marks it, so due means being published |
| posts being sent | `SocialPostAttempt` (`userId`) | `queued` and created in the last 30 minutes |

Not counted, with reason: Blueprint `awaiting_approval` (waiting for a person, no worker running; no one can approve once the client is gone); `ContentCalendar` items `generating` (the reel build it starts is a `VideoJob`, which is checked, and there is no reaper, so a crash would block removal for ever); `ScrapeJob` (no Quarks charged); the in-request routes in `videoGeneration.js`, `carousels.js`, `drafts.js` (they refund within the request and their stored work is the `Draft`/`VideoJob` rows above).

### Deleting an agency (ruling 3)
- `eligibility`: a workspace gets `Remove this client from your agency account.`; an agency (or any account that still owns clients) is `ok` with `clients: n`. `GET /api/account/status` adds `clients`.
- Request (14-day flow unchanged): billing cancelled at once through the existing `cancelBilling`, which already covers every active record in `plan.subscriptions`, so the agency plan AND every slot subscription are cancelled (test pins `sub_agency` and `sub_slot` both cancelled with `0`). New: the clients' scheduled posts are paused with the agency's, and put back on restore.
- Purge: new first-class step `clients` between `keep_payment_records` and `files`, present when the account is an agency or still has `agency.clientCount > 0` (so a lapsed agency whose plan tier already dropped still erases its clients; ordinary accounts keep the exact old step list, pinned by a test). Each client is erased by `purgeWorkspace` (Cloudinary files, social profile, data, record). A failed client stops the step, the agency stays, the alert names the step, and a retry skips finished steps and clients already gone.
- No email ever goes to a client workspace (`account` step also skips mail for workspaces). Only the agency's payments are retained; one tombstone, for the agency.
- A running-work check is deliberately NOT applied on agency deletion: the agency's own pool (the refund target) is being deleted in the same flow after a 14-day wait.

### Data registry guard (ruling 3)
- No new model refers to a user (`OpsState` does not). New user-reference FIELDS on registered models were `QuarkLedger.workspace` and `StudioVideo.payer`. A new test makes every extra user-reference field on a registered model acknowledged in an explicit map with the reason (7 entries, which also covers older ones such as `StaffAction.actor`), so a future field cannot be added silently. `QuarkLedger` rule gained a note about the workspace tag.

## Exclusions: every site (ruling 4)
Client workspaces are created `isHidden: true` (defence in depth for every `!u.isHidden` test) AND excluded by query with `NOT_A_WORKSPACE = { 'agency.ownerId': null }` (new, `services/agency.js`):

Changed:
1. `services/staff/clientList.js loadClientData`: base scope. This feeds the staff client list, counts, Home (`home.js`), Team (`team.js`) and the CSM views.
2. `services/staff/money.js loadMoneyData`: Money totals, payments page (via `routes/staff.js` payments), recurring.
3. `services/staff/usage.js loadUsageData`: usage and funnel numbers.
4. `routes/staff.js`: bulk change (`applyUpdate`) and bulk CSM assignment filters (a workspace id typed by hand cannot be changed).
5. `services/renewalReminders.js`: candidate query (it already needed an active subscription, which a workspace never has; now excluded by name too).
6. `services/billingScheduler.js`: managed invoice run (already `tier managed` plus `autoInvoice`; now excluded by name too).

Checked and left as they are, with reason:
- Welcome email: sent only after a payment (`routes/payment.js maybeSendWelcome`); a workspace never pays.
- Free first campaign batch: handled in Task 5 (`initialCampaignsGenerated: true`, `freeFirstBatch`). Free Blueprint: not offered inside a client (Tasks 1/5).
- `snapshotScheduler`: deliberately KEEPS client workspaces (analytics snapshots of the client's connected accounts are the client's own data, not customer treatment). `socialInboxService startInboxPolling`: a stub with an empty loop. `campaignScheduler`, `performanceTracker`, `notificationScheduler`, `contentCalendarService`: per-campaign/per-calendar work for the client's own posts, not customer-level.
- `ayrshareProfileWatch` and the Money Ayrshare count: deliberately INCLUDE workspaces (each profile is billed by Ayrshare).
- No daily digest, inactivity or re-engagement email exists in the codebase (grepped `digest|re-engage|win-back|inactiv|nudge|drip|lifecycle|abandon`; only staff "inactive" labels, which read the filtered list).
- `routes/staff.js` `GET /clients/:id` can still open a workspace by id for staff (read only, staff-only, not listed anywhere).
- `AYRSHARE_RESET` staff tool resets profile keys for every account on purpose.

## Real run (`backend/scripts/agency-removal-check.js`, `nebulaa_dev` only, refuses other databases)
Throwaway agency + 2 clients, a rival agency with a client, an ordinary customer; real routes on an in-process server on a random 127.0.0.1 port; fake Cloudinary, Ayrshare, Razorpay and email injected through `del.defaultDeps` and a fake razorpay object. Results (all assertions passed, "ALL CHECKS PASSED"):
- Refused: no REMOVE (400), wrong password (403), inside a client pass (403), a client login (403), another agency's client (404); nothing erased.
- Refused with the exact plain message (409) while each kind of work ran, one at a time: VideoJob, HeroVideoJob, Blueprint (queued), Blueprint (designed deck processing), StudioVideo, Draft, due scheduled Campaign, queued SocialPostAttempt; every time the client stayed, the slot stayed used, the client was not left paused. Finished jobs (completed/failed) do not block.
- Removed when idle: client record, all registry data and files erased; Ayrshare profile released (fake got the key); Cloudinary file deleted (fake got the id); no email; the other client and the other agency untouched; pool unchanged by the removal.
- Ledger kept: rows tagged with the removed client still there, and `/api/agency/usage` shows a "Removed client" line with its 22 Quarks and does not expose the id.
- The removed client's old pass is refused (401) on the next request.
- Count and slots: 1 of 5 after removal; added 4 fillers to 5 of 5; the sixth refused ("all of them are in use"); removing the fillers freed the slots; `extraSlots` stayed 0.
- Exclusions: staff client list, money and usage loaders (scoped to the throwaway ids) returned exactly the 3 real customers and no client workspace; a new client is `isHidden`. A workspace made to look like a payer (active subscription, later tier managed with auto invoicing) was not picked up by the renewal reminder run (reminder went only to the ordinary customer through a fake transport) nor by the billing run (zero calls).
- Deleting the agency: eligible with `clients: 1`; plan and slot both cancelled at once; the remaining client's scheduled post paused; the client pass refused while pending (401); then `purgeOne` on its request (not `runPurgeOnce`, so no other dev request could be touched) completed with steps keep_payment_records, clients, files, social_profile (skipped, the agency has none), data, staff_log, tombstone, account. Agency and client gone, the client's profile released, one deleted email to the agency only, the agency's payment record retained, ledger removed with the agency, the rival agency, its client and the customer untouched.
- Cleanup: 3 users removed, left over 0 (users, workspaces, registry data, ledger, deletion requests, retained payment, tombstones all checked). The shared daily AI spend counter is restored to what it was.
- Operational note: the dev database is remote and the script takes about 4 minutes. My FIRST attempt was killed by me while it was still running (output was buffered, I thought it hung), which left 3 users, 2 workspaces and their data. I deleted exactly those by the tag and subtracted exactly that run's 3 image units from today's `AiSpendDay` (0.2548 USD from `openai_image` and total); the counter is back at its Task 5 baseline (`openai_image` 0.0955, total 1.1010). Nothing else in `nebulaa_dev` was touched.

## Deviations from the brief
- The brief's tests call `stepsFor` with two arguments and give `removeWorkspace` a `purge` only; the real `stepsFor` takes one object, so the tests were adapted. `removeWorkspace` gained an optional `isBusy` (default: real `runningWork`).
- `clients` step condition is "agency or owns clients" instead of "isAgency" alone (lapsed agencies).
- Workspaces are created `isHidden: true` (not in the brief).
- `eligibility` returns `clients: n` only for accounts that own clients.
- `requestDeletion` / `restoreDeletion` also pause and restore the clients' scheduled posts (not in the brief).
- Frozen flag is used as the removal fence (not in the brief).
- Registry: an acknowledgement map test rather than only a note.

## Concerns
1. Race window: a request that passed `protect` before the client was paused can still spend or start a job in the instant between pause and check. The check runs after the pause, so a job created after the pause is refused only if it needs a pass; a job already past `protect` could slip in. Tiny, as with Task 6 I4.
2. If the erase succeeds but `releaseSlot` fails (crash between), `clientCount` stays one too high. A recount on open would heal it; not built.
3. `notificationScheduler.sendEmailNotification` sends every campaign reminder email to a hard-coded personal address (existing code, not changed). Client posts feed it too.
4. `snapshotScheduler` and the content-calendar auto-generation keep running for client workspaces (spend is charged to the agency pool and refused when it cannot pay). Left on purpose.
5. The account export (`accountExport.js`) exports only the agency's own data, not its clients'. The spec says the agency has until the plan ends to export; whether the export should include clients is an owner decision.
6. Agency deletion does not wait for or check running client jobs (refund target is deleted anyway).
7. Staff can still open a workspace record by id.
8. The single-slot cancel route was not built (ruling 5); billing untouched.
9. No Kling file was edited; only read for the job states.

## Files
Changed: `backend/services/accountDeletion.js`, `backend/services/agencyWorkspaces.js`, `backend/services/agency.js`, `backend/services/dataRegistry.js`, `backend/routes/agency.js`, `backend/routes/account.js`, `backend/routes/staff.js`, `backend/services/staff/clientList.js`, `backend/services/staff/money.js`, `backend/services/staff/usage.js`, `backend/services/renewalReminders.js`, `backend/services/billingScheduler.js`, `backend/tests/dataRegistry.test.js`.
New: `backend/tests/agencyDeletion.test.js`, `backend/scripts/agency-removal-check.js`, this report.
