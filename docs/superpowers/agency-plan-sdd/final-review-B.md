# Final whole-branch review, part B: access control, isolation, deletion

Reviewer scope: `middleware/auth.js`, `services/agencyWorkspaces.js`, `routes/agency.js`, `services/agency.js`, `routes/auth.js` (/me), `services/accountDeletion.js`, `services/dataRegistry.js`, `services/accountExport.js`, `routes/account.js`, `services/cloudinaryCleanup.js`, staff client list/routes, schedulers, `server-main.js` mounts, `services/blueprint/service.js`, plus the frontend paths that decide "inside a client".
Read-only review. Ran `node --test tests/agency*.test.js tests/account*.test.js` (186 pass) and `tests/dataRegistry.test.js tests/protectDeletion.test.js tests/csmAccess.test.js` (11 pass). I also ran one in-memory Express check (no database, no network) to confirm how paths are matched.

## Verdict

The backend isolation holds up. A client pass is tied to one workspace and one agency, and the agency's ownership, active state, deletion state, plan and freeze are checked again on every request. Agency routes refuse a pass even without the path block, and payment create routes refuse workspaces on their own, so the path-block bypass below does not reach money for the agency. No route I found reads a sibling's or the agency's data by email, phone or owner.

I found no Critical defects. Five Important issues should be fixed before release:
- the frontend never learns it is inside a client (1),
- the slot counter can drift when the same client is removed twice at once, and that can orphan clients when the agency is deleted (2),
- staff working inside an account can undo the customer's deletion and accept the Terms for them (3),
- a purge that is interrupted stays stuck as "running" forever (4),
- the hard-coded personal email is a live data leak (5, already flagged).

The CSM path bypass is confirmed, and is wider than flagged (6).

## Important

### I1. The frontend never knows it is inside a client: `actingAgency` is dropped
- Backend: `backend/routes/auth.js:1170-1178` returns `actingAgency` next to `user`, not inside it.
- Frontend: `frontend/services/api.ts:437` (`getCurrentUser`) returns `{ user: response.user }` only. Nothing else sets `user.actingAgency` (grep: only the visual-audit mock `frontend/scripts/visual-audit/mock-session.js:132` puts it on the user, which hid the bug).
- Effect: `isInsideClient(user)` (`frontend/utils/agency.ts:11`) is always false. Inside a client, the workspace has `plan.tier: 'agency'`, so `isAgencyUser` is true and:
  - the agency's "Clients" nav and usage card show (`Layout.tsx:141`, `GravityHome.tsx:197`);
  - Settings shows billing and delete-account as if this were the agency (`Settings.tsx:39`);
  - the acting banner falls back to the CSM wording ("Payments ... stay with the client", `Layout.tsx:333-335`).
- Every one of those actions gets a 403 from the backend, so this is not a security hole. But the mitigation in handover flag 5 ("frontend suppresses the Terms prompt inside a client", `utils/accountDeletion.ts:24`) never fires. The Terms prompt shows inside every client, and accepting it writes a consent record onto the workspace through `POST /api/account/consent`, which the pass does not block.
- Scenario: the agency opens client "Sweet Co". It gets the Terms modal, sees "Clients" in the nav, and Settings offers "Delete account". Clicking that fails with a 403.
- Fix: merge `actingAgency` (and `actingCsm`) into the user in `getCurrentUser`, or return it inside `user` from `/me`. Add `/api/account/consent` to `BLOCKED_INSIDE_CLIENT`.
- Confidence: high.

### I2. The slot counter can be released twice; drift can orphan clients when the agency is deleted
- `backend/services/agencyWorkspaces.js:124-136` (`removeWorkspace`), `:24` (`releaseSlot`, an unconditional `$inc: -1`), and `backend/services/accountDeletion.js:184-193` (`purgeWorkspace` returns `ok: true` with "already gone" when the record is missing).
- Scenario: a double-click, or two tabs, send `DELETE /api/agency/clients/X` twice. Both requests find X in `listWorkspaces`, both pause it, and both see no running work. The purge takes seconds (Cloudinary, Ayrshare, about 50 collections), so both run it. Each one either finishes `deleteOne` or hits "already gone", and each then calls `releaseSlot`. `agency.clientCount` drops by 2 for one removal. Repeating this pushes it to 0 or below.
- Consequences:
  - (a) `claimSlot` lets the agency create clients past its paid limit. They are frozen at the next `syncWorkspacePlans`, so this is confusing rather than free.
  - (b) More serious: `ownsClients` (`accountDeletion.js:34`) uses `clientCount > 0` once the plan has ended, and deletion cancels the plan immediately. With a drifted count, `requestDeletion` skips pausing the clients' scheduled posts (`:73-76`), and `stepsFor` leaves out the `clients` step (`:112`). The agency is erased, but its workspaces stay behind, hidden and with no owner. Their connected social profiles and scheduled posts carry on: `campaignScheduler` has no user check.
- The reverse drift also happens: if `releaseSlot` fails after a successful purge, the agency loses a slot it paid for.
- Fix:
  - Release only when this request's `deleteOne` removed the record (`deletedCount === 1`), or recompute `clientCount` as `countDocuments({ 'agency.ownerId': owner._id })` after every create and remove.
  - In deletion, decide "has clients" by querying `agency.ownerId`, never by the counter.
- Confidence: high on the double release; medium-high that it happens in practice.

### I3. Staff working inside an account can undo the customer's deletion and accept the Terms for them
- `backend/middleware/auth.js:82` lets a deletion-pending account through for any `/api/account/*` path. That check runs before the CSM check (`:87-97`). `BLOCKED_WHILE_ACTING` (`backend/services/csmAccess.js:12-18`) does not block `/api/account`.
- `POST /api/account/deletion/restore` (`routes/account.js:82`) asks for no password.
- `POST /api/staff/clients/:id/open` (`routes/staff.js:508-517`) only refuses accounts that are switched off. A deletion-pending account is still active.
- Scenario: a customer asks to be deleted. An Owner, Admin or assigned CSM opens the account, the frontend shows the DeletionPending screen with Restore, and one click cancels the customer's erasure request.
- Same gap: when a CSM opens a customer who has not yet agreed to the current Terms, `needsTermsPrompt` shows the modal to the CSM (the user is the client), and "Agree" records the client's consent (`routes/account.js:94-97`).
- Fix:
  - Add `/^\/api\/account(\/|$)/` to `BLOCKED_WHILE_ACTING`, keeping only `GET /status`.
  - Refuse `staff/clients/:id/open` while `deletion.status === 'pending'`.
  - Hide the Terms prompt while a CSM pass is held.
- Confidence: high.

### I4. An interrupted purge stays "running" forever and is never retried or alerted
- `backend/services/accountDeletion.js:198`: `purgeOne` sets `status: 'running'` before the steps start. `runPurgeOnce` (`:219`) only picks up `pending` or `failed`.
- Scenario: a deploy or crash happens while a purge runs. Purges are long: Cloudinary batches plus up to 25 client purges for an agency. The request stays `running` with no further attempts and no alert. The account stays pending forever, `purgeAfter` passes, and the customer is never erased.
- The same code has no atomic claim. Two instances, or an overlapping run, can purge the same request at once. This is mostly harmless because the steps can be repeated, but the "deleted" email can go out twice.
- Fix: claim with `findOneAndUpdate({ _id, status: { $in: ['pending', 'failed'] } }, { status: 'running', runningSince: now })`, and treat `running` older than N hours as failed.
- Confidence: high.

### I5. The notification scheduler emails every customer's (and every client's) scheduled posts to a personal Gmail
- `backend/services/notificationScheduler.js:252` and `:330`: `userEmail = 'navaneethakrishnan821@gmail.com'`. It starts unconditionally (`server-main.js:753-755`) and sends whenever SES is set up.
- What it sends: for every `scheduled` campaign across all accounts, the campaign name, platforms and time, about 30 and 15 minutes before it goes live. That now includes agency client brands. Data goes to a third party outside the privacy policy.
- It is existing code (flag 1), but it is a live leak, not just a test leftover.
- Fix: send to the campaign owner's email, skipping workspaces (send to the agency or no one), or turn the email off.
- Confidence: high.

### I6. CSM path bypass confirmed and wider than flagged; the agency block shares the absolute-URL hole
- `backend/services/csmAccess.js:32-35`: no lower-casing and no decoding. Express routes are case-insensitive, so `POST /API/PAYMENT/cancel-subscription` reaches the payment routes with the CSM block reading false. Confirmed in an in-memory Express run.
- Both `isBlockedWhileActing` and `isBlockedInsideClient` (`agencyWorkspaces.js:153-161`) test `req.originalUrl`. With an absolute-form request line (`POST http://x/api/payment/create-order HTTP/1.1`), Express 4 still routes on the pathname `/api/payment/...`, but `originalUrl` starts with `http://`, so both checks return false. Also confirmed in the in-memory run.
- Whether this reaches production depends on whether the proxy in front (Render) rewrites absolute-form requests. Don't rely on that.
- Impact:
  - Agency pass: low. Payment create routes call `refuseWorkspace` (`routes/payment.js:73-77`), and agency routes check `req.actingAgency` themselves. The rest need the workspace's random password.
  - CSM pass on a real customer: a staff member can `cancel-subscription`, `PUT /billing-details` (GSTIN), or start a plan purchase for the client.
- Fix: one shared normaliser for both: `new URL(req.originalUrl, 'http://x').pathname` (or `parseurl(req).pathname`), then decode, lower-case, and collapse repeated `/`. Fail closed on any error.
- Confidence: high (both bypasses reproduced).

## Minor

- **M1. Staff routes can act on a workspace by id.** `routes/staff.js:277-283` (`clientFor`) uses `isCustomer`, which does not exclude `agency.ownerId`.
  - `open` issues a CSM pass into a workspace. That pass skips `_agencyPassProblem` and the agency block list, though spending is still gated by `CLIENT_PAYER_FILTER`.
  - `quarks` adds Quarks to the workspace record, where they are never shown or spent.
  - Single `assign-csm` (`:364-378`) lets a CSM be assigned a workspace. The bulk routes do exclude workspaces (`:479`, `:498`).
  - Fix: add `!isWorkspace` to `clientFor`.
- **M2. A pass can be issued from inside a CSM session.** `routes/agency.js:91-99` issues an 8-hour agency pass even when the request carries a CSM pass into the agency account. The new pass drops `actingCsm`, so removing the CSM's assignment no longer stops it, and no CsmSession or StaffAction row is written for the client. Refuse `/open` when `req.actingCsm` is set, or carry the CSM through.
- **M3. Pass check and pay check differ.** `_agencyPassProblem` (`middleware/auth.js:19-28`) does not check `subscription.status === 'halted'`, but `canPayForClients` (`services/agency.js:51-54`) does. With a halted agency, a client still opens and edits but every spend fails. The comment says the two are "the same test", and they are not.
- **M4. Some ways in skip the pass checks.**
  - The inbox SSE `streamAuth` (`routes/socialInboxRoutes.js:25-44`) and the Socket.IO hub (`services/socketHub.js:32-35`) verify the JWT but do not run the pass, CSM or deletion checks. A pass that has been revoked but has not expired (plan ended, client frozen, agency pending deletion) can still read that workspace's live inbox events for up to 8 hours.
  - `optionalAuth` (`middleware/auth.js:135-179`) also skips them. It is only used for `support/query`.
- **M5. In-flight work is not counted when removing a client.** `runningWork` (`agencyWorkspaces.js:94-116`) does not see:
  - the in-memory campaign image queue (`services/campaignImageQueue.js`, `POST /api/campaigns/regenerate-post-image?async=true`);
  - long synchronous requests such as campaign generation.

  A removal during one of these can leave Campaign or Draft rows and Cloudinary files written after the purge, owned by a deleted workspace.
- **M6. Schedulers ignore frozen, paused, ended or deleting accounts.**
  - `contentCalendarService.processAutoGeneration` (`:818-856`) generates a caption and image daily, up to 7 a month per calendar. Nothing is charged (no spend in `backgroundQueue.generateSingleCalendarItem`), and it runs for frozen clients, agencies whose plan ended, and deletion-pending accounts. This is an unbilled AI cost, multiplied by up to 25 brands.
  - `snapshotScheduler.collectSnapshots` (`:53`) calls Ayrshare for every profile, including frozen and pending accounts.
  - `campaignScheduler.processDueCampaigns` (`:193`) publishes already-scheduled posts for frozen clients and agencies whose plan ended. The spec says "nothing can be made", so publishing may be acceptable, but it should be decided.
  - `billingScheduler` and `renewalReminders` correctly exclude workspaces.
- **M7. The deletion tombstone hashes the raw lower-cased email** (`accountDeletion.js:20`), not the canonical `emailKey`. Deleting and signing up again as `j.ohn+x@gmail.com` gets a second free Blueprint. `deletedBefore` also fails open on error (`blueprint/service.js:157`). The HMAC key is `JWT_SECRET`, so rotating that secret silently voids every tombstone. Use a dedicated key.
- **M8. The client's Quark view shows the agency's full history.** `routes/credits.js:22-95`: inside a client, `/api/credits` and `/api/credits/history` return the agency's full Quark history (top-ups, slot grants, every client's spend). That contradicts the comment at `services/agency.js:76` ("the agency's history is never exposed"). It also ignores `frozen`, unlike `publicCredits`. The pass holder is the agency itself, so this is not a cross-tenant leak, but the stated intent is broken.
- **M9. Export password guessing has no lockout.** `routes/account.js:38-59` and `:61-80` check the password with a 20 per 15 minutes limit per user and IP, but failures never lock the account the way login does. Someone with a stolen session can guess the password from many IPs. Count failures toward `lockUntil`.
- **M10. The agency's export leaves out its clients' data**, while the spec says the agency can export until the plan ends. The usage report also 403s after the plan ends. Both are already flagged as owner decisions; listed only for completeness.
- **M11. The data-registry coverage test only finds `ref: 'User'` paths.** A model that stores a user id as a String, or without `ref`, would slip through. Today the only models outside the rules are AccountDeletion, DeletedAccount, OpsState and RetainedPayment, all deliberate, so there is no gap now.

## Checked and fine
- Pass validity:
  - a pass for client X cannot be used for client Y (the `id` is bound and ownership is re-checked);
  - a removed client gives "user no longer exists";
  - a deactivated, deletion-pending or ended agency is refused with a plain message;
  - a frozen client is refused;
  - a pass cannot name a workspace as the agency.
- `isBlockedInsideClient` path handling:
  - upper case, percent-encoding, query strings, `#` and trailing slashes are handled or fail closed;
  - `//api/payment` and `/api//payment` do not route at all;
  - HEAD and trailing-slash variants of `/api/agency/clients` are blocked (fail closed).
  - The only open hole is the absolute-form request (I6).
- Defense in depth: every mutating `/api/agency` route refuses `req.actingAgency || isWorkspace`, and payment create routes refuse workspaces.
- Workspaces cannot be logged into:
  - the placeholder email is on `.invalid`;
  - the password is 32 random bytes;
  - `update-profile` cannot change the email;
  - `change-password` needs the current password.
- Slot claim is atomic (`claimSlot` uses `$expr`), and a failed create releases its slot.
- Removal pauses the client first, refuses while work runs (409), and keeps ledger rows (QuarkLedger is found by `user`, which is the agency).
- Agency deletion:
  - pauses clients' scheduled posts;
  - purges every client before its own steps;
  - keeps only the agency's payment rows (RetainedPayment);
  - steps can be repeated.
- 423 allow-list: only `/api/account/*` and `/api/auth/me|logout`. Other casing fails closed. Restore works.
- Staff and managed accounts are excluded from self-deletion. Workspaces are refused ("Remove this client from your agency account").
- Staff lists, money, usage, bulk actions, the billing scheduler and renewal reminders all exclude workspaces (`NOT_A_WORKSPACE` matches a missing field, so existing accounts are unaffected).
- No change blocks or alters existing non-agency or managed accounts: `isWorkspace` needs `agency.ownerId` to be set, and the 423 only applies to pending accounts.
