# Final review C: frontend and legal text

Scope: agency screens, switcher, hand-off, plans page, delete/export, Terms 21, Privacy 5.6 and 6, launch checklist. Read-only. Frontend unit tests pass (296/296), but they only test the pure helpers, which is why the first finding is not caught.

All paths are under `frontend/` unless stated.

## Critical

### C1. The app never learns it is inside a client, so the whole "inside a client" behaviour is dead in the real app
- `services/api.ts:437` `getCurrentUser` returns `{ user: response.user }`. The server (`backend/routes/auth.js:1177`) sends `actingAgency` as a sibling of `user`, not inside it. `toPublicJSON` does not include it. Nothing in the frontend reads `response.actingAgency`.
- Every check uses `user.actingAgency`: `utils/agency.ts:7,12`, `utils/accountDeletion.ts:24`, `Layout.tsx:334`, `ClientSwitcher.tsx:27`, `App.tsx:262,343` (`isInsideClient(user)`), `Settings.tsx:39`. So `isInsideClient(user)` is always false.
- A client workspace mirrors `plan.tier = 'agency'` (backend `agency.js:12`, `workspacePlanFields`), so `isAgencyUser(user)` is TRUE inside a client. Result when an agency opens a client:
  - Settings (`Settings.tsx:39,312,537,656`): the Security and Billing tabs, the "Delete my account" card and the export box are shown. The server refuses them (403), but the "handled in your agency account" note is missing.
  - Layout (`Layout.tsx:141,197,434-471`): the sidebar shows the "Clients" item, and the Quark popover shows "Need more Quarks? See plans", which leads to `/trial-expired`. `TrialExpired.tsx` gets `insideClient=false`, so it tries to load billing (403) and shows the checkout page to the agency inside a client. The spec says billing is hidden or blocked there.
  - Banner (`Layout.tsx:332-335`) shows the staff wording "Payments, plans and passwords stay with the client", which is the wrong party for an agency.
  - `GravityHome.tsx:197` shows the agency "Client usage" table on the client's own dashboard (the usage call is 403 inside a client, so it shows the error card "Usage reports are available while your Agency plan is active.").
  - `AgencyClients.tsx:66` never shows "Clients are managed from your agency account". It shows the full list with Add/Rename/Remove. The server refuses them.
  - `NeedPlanModal` (`App.tsx:340-343`) gets `insideClient=false`, so inside a client with an empty pool it says "You have used your Quarks ... Add Quarks / See plans" instead of pointing back to the agency.
  - The visual-audit mock (`scripts/visual-audit/mock-session.js:132`) puts `actingAgency` on `user`, which hides this in screenshots.
- Fix: in `getCurrentUser` return `{ user: { ...response.user, actingAgency: response.actingAgency ?? null } }`, and add a test that runs the real response shape through it.

### C2. The "updated Terms" prompt is shown to a client workspace
This follows from C1 and is also wrong in its own right. `createWorkspace` makes the client `onboardingCompleted: true` with no `consent`. With C1 unfixed, `needsTermsPrompt` (`utils/accountDeletion.ts:22-27`) returns true for every client the agency opens. It covers the screen (`TermsPrompt.tsx`, z-130, `App.tsx:204`). The agency owner would have to tick "I agree" and POST `/account/consent` for the client on every open. Fixing C1 removes the agency case.

## Important

### I1. Staff (CSM) working inside a client gets the Terms prompt and can "agree" for the customer
`needsTermsPrompt` skips only `staffRole`/`isCsm` of the signed-in user. A CSM or staff pass (`staffOpenClient`, `openCsmClient`) signs in AS the client, so `user.staffRole` is empty. For an existing customer with no consent record, the staff member sees "We have updated our Terms" over the client's account and a working "Agree and continue" (`/api/account/consent` is not blocked for passes). That records consent the customer never gave. `App.tsx:204` should also suppress the prompt when `localStorage.csmReturnToken` is held (the Layout already uses this as the "acting" test).

### I2. `actingAgency.name` is the agency owner's name, not the client's; the switcher label and tick are wrong
`backend/routes/auth.js:1177` fills `name` from the agency OWNER (`req.actingAgency` = owner). The frontend treats it as the client name:
- `Layout.tsx:334` banner reads "You are working in {owner name}'s brand".
- `ClientSwitcher.tsx:27` `currentName` is the owner name. The button label shows the owner name instead of the client. `isCurrent = c.name === currentName` (line 109) is never true, so no tick shows.
- Fix: prefer `localStorage.csmActingClient` (set from the open response, the real client name), or use the signed-in workspace's own name (`user.businessProfile.name` / `companyName`). Compare by id, not name (two clients can share a name).

### I3. Quark numbers and the word "Quarks" are shown to agency accounts, against the spec ("Customers see posts and videos, never Quarks")
- `Layout.tsx:357-367` (mobile pill) and `399-474` (desktop pill and popover): the balance, "Quarks", "used in total", "Need more Quarks?" are shown to the agency and inside a client. For a client the balance is the agency's shared pool (`withPoolCredits`).
- `Layout.tsx:449`: "See what each action costs" opens Settings (Quark costs).
- `TrialExpired.tsx:419-433`: the "Extra Quarks" section and "Extra Quarks stay valid for 60 days..." are shown to an agency (the page header already hides the balance for agencies via `!isAgencyPlan`, so the intent is clear). The top-up cards also fall back to "{n} Quarks" if `outputs` is missing.
- `NeedPlanModal.tsx:31-33`: an agency account (not inside a client) with an empty pool sees "You have used your Quarks ... Add Quarks".
- `services/api.ts:137` throws "You have used all of your Quarks." for the creditsExhausted 403; it can surface in toasts on any screen.
- `agencyErrorMessage` (`utils/agency.ts:127`) passes server sentences through unchanged and does not strip "Quark" or vendor names; today the agency routes' own messages are clean, so this is only a guard gap.
- Fix: hide the pill/popover (or show posts and videos) when `isAgencyUser(user) || isInsideClient(user)`; hide the "Extra Quarks" block for agencies; give NeedPlanModal an agency variant.

### I4. Switcher list goes stale, so a removed or new client is wrong until a full reload
`ClientSwitcher.tsx:47-50`: the list loads only when `state !== 'ready'` and is never refreshed. The switcher lives in `Layout`, which stays mounted while the Clients page adds, renames, removes or buys a slot. After removing a client it still appears (choosing it gives 404 "That client was not found."); a newly added or renamed client is missing or old; paused/active and "x of y clients" are stale. Reload the list every time the menu opens (keep the old rows visible while loading).

### I5. An agency whose plan has ended has no screen at all; the "all clients are paused / remove a client" promises in Terms 21.5 cannot be used
`AgencyClients.tsx:41,77`: `agency = isAgencyUser(user)` needs `tier === 'agency'`. When the plan ends the tier drops, so `<Navigate to="/dashboard">` fires, and the "Clients" nav item (`Layout.tsx:141`) disappears. The paused text for no plan (`utils/agency.ts:pausedReason(0)`, "Your Agency plan is not active, so every client is paused. Nothing was deleted.") is unreachable, the user cannot see or remove clients (the DELETE route has no plan check, so removal works server-side), and cannot download the usage report. Terms 21.5 says "Nothing is deleted until you remove a client or delete your account", but a lapsed agency has no way to do the first. Decide: allow `/agency/clients` for any account that owns clients (the status route already returns the client count), or add a plain "your plan has ended" page with Remove and Renew.

### I6. Deleting an agency account hides that all client brands are erased with it
The server counts clients on delete (`routes/account.js` status returns `clients`, "an agency's clients are deleted with it"). `AccountPrivacy.tsx:61,66` ignores it: the text says only "your posts, videos, brand details..." and `getAccountStatus`'s type (`services/api.ts:530`) omits `clients`. An agency with 12 client brands gets the same wording as a one-brand user, with no number and no "every client brand and its content, files and connected accounts". `DeletionPending.tsx:25` is also silent. Terms 21.5 and Privacy section 6 do not say it either. Show "This also erases your N client brands, with everything in them" in the open form (and consider a second typed confirmation), and add one sentence to Terms 21 and Privacy 6.

### I7. The Terms and Privacy pages still say "Version 1.0, 10 March 2025", and the launch checklist wrongly says they are "marked as drafts"
`TermsAndConditions.tsx:36,317`, `PrivacyPolicy.tsx:36,258,280`. New substantive sections (Terms 21, Privacy 5.6, retention) were added, the backend records agreement to `2026-10-16` (`backend/config/legalVersions.js`), and the prompt says "We have updated our Terms", but the pages show the old effective date and version. The consent record would name a version whose text is not labelled that way, and Privacy line 258 says the Effective Date shows when the policy last changed. Also `agency-launch-checklist.md` section 4 says "both pages stay marked as drafts"; they are not. Update dates and versions to match `legalVersions.js` (or mark them as drafts, as the checklist claims).
Related: `needsTermsPrompt` (`utils/accountDeletion.ts:26`) checks only `acceptedAt`, not the version, so a future Terms change would never re-ask anyone who already agreed.

### I8. Pass hand-off: a staff pass and an agency pass overwrite each other's return target
`api.ts:1496` (`openAgencyClient`) always sets `csmReturnTo = '#/agency/clients'` but keeps an existing `csmReturnToken`. Scenario: staff opens an agency owner's account (`staffOpenClient`: `csmReturnToken` = staff token, `csmReturnTo = '#/staff/clients'`), then opens one of its clients from the Clients page or the switcher. The return token is still the staff token, but `csmReturnTo` is now the agency page. "Back to my clients" (`Layout.tsx:338`, `ClientSwitcher.tsx:68`, `AgencyClients.tsx:72`, `TrialExpired.tsx:289`, `App.tsx:343`) restores the staff token and lands on `#/agency/clients`, which for staff redirects to `/dashboard`, with the wrong label "Back to my clients". The agency owner's account is gone from the stack. Either keep two separate slots (stack of passes) or refuse `openAgencyClient` while a staff pass is held. Several callers also hard-code `'#/agency/clients'` instead of `returnHashAfterActing(csmReturnTo)` (`AgencyClients.tsx:72`, `ClientSwitcher.tsx:68`, `TrialExpired.tsx:289`, `App.tsx:343`).

### I9. Leftover pass after a lost session can swap the next person into the previous account
`logout()` (`api.ts:601-603`) clears all three keys, but `login`, `register`, `verifyOTP` (`api.ts:339-396`) do not, and neither do the other ways the token goes away (`App.tsx:106`, `Onboarding.tsx:506,525`, `getCurrentUser` with no token at line 427 keeps the keys). `csmReturnToken` is the agency owner's or staff member's full session token. If it is left behind and someone else signs in on that browser, the Layout bar shows (it only tests that the key exists, `Layout.tsx:329`) and "Back to my clients" calls `setToken(oldToken)`, putting them in the previous owner's account. Clear the three keys on every successful login/register/verify, and also when `getCurrentUser` finds no token. `getCurrentUser` (lines 443-455) also leaves `csmReturnTo` behind after a pass-ended return.

## Minor

- `AgencyDialog.tsx:8` first focus goes to the Close (X) button, not the first field: `querySelector('input, button')` returns the header X before the form inputs. In Add client and Remove client the user types into nothing, and Enter/Space closes the dialog. Focus the first input (or `[autofocus]`), keep the X out of the first position.
- `AgencyDialog.tsx:9-12`: no focus trap and no return of focus to the opener on close; the effect depends on `onClose`, which `AgencyClients.tsx:210,228` pass as new inline arrows, so any parent re-render (for example `getPlans` finishing) re-focuses the first control. Escape and backdrop clicks close the Add/Remove dialogs while a request is running (`busy`), so the list is not reloaded and the success notice never shows (the client was added or removed anyway). Ignore close while busy, as `ExtraClientDialog` already does.
- `ClientSwitcher.tsx:94`: `role="menu"` with menuitems but no arrow-key movement and no focus move on open; Tab works. Fine for launch, but the roles promise more than is built.
- `AgencyClients.tsx:148,152` / `slotOffer`: at `limit = 0` (tier says agency but no limit) the Add dialog shows the form "You are using 0 of 0" and only the server refuses. Treat `limit 0` as the "not active" state.
- `TrialExpired.tsx:315-320`: before billing loads, `tier` is `'free'`, so an agency whose pool is empty briefly sees "Choose a plan to start creating" and the free-Blueprint card.
- `AgencyUsage.tsx` and `AgencyClients.tsx` both call `getAgencyUsage`; the paging text counts the "Removed client" row as a client ("Showing 1 to 25 of 26 clients"). The `/agency/usage` JSON still carries `quarksSpent` and totals in the network tab (`backend/services/agencyUsage.js:40-105`); not on screen, but visible to anyone who opens developer tools.
- `RemoveDialog` explains that "your usage history is kept ... as Removed client" (`utils/agency.ts:119`), but Terms 21.4 and Privacy 5.6/6 do not mention that retained usage record. Add one line to Privacy 6 so the retention list is complete.
- Terms 17.4 survival list (Sections 8, 9, 13...20) does not include 21 (for example 21.2 responsibility for client content).
- `AccountPrivacy.tsx:45`: the export text does not say that an agency's client brands are not in the file (checklist section 8 lists this as an open decision).
- Mobile 375px: no fixed-width or overflow problems found in the new screens (cards stack with `flex-col`, dialogs are bottom sheets, long names use `break-words`/`truncate`, the usage table has 3 narrow columns). The header switcher is `w-[170px]` and hidden below `md`; the sidebar copy covers phones.

## Checked and fine
- Delete/removal confirmation cannot be bypassed from the UI: both buttons stay disabled until password and exact `DELETE`/`REMOVE` (`canConfirmDeletion`, `canConfirmRemoval`), forms submit through the same guard (`RemoveDialog.submit` re-checks), and server refusals (wrong password, running work, 409) are shown (`AccountPrivacy.tsx:36`, `AgencyClients.tsx:306`). The server re-checks both words independently.
- Wording: no "credit", "trial", "7 days", vendor names or Quark figures in the agency components or `agency*.ts`/`slotPurchase.ts`; amounts come from the server; Razorpay appears only on checkout.
- States covered: loading, error with retry, empty, at-cap (buy/max) and paused (frozen) clients in `AgencyClients`; loading, error, empty in the switcher and usage views.
- Terms/Privacy text matches behaviour: 21.4 immediate irreversible erase (matches `removeWorkspace` and the UI), 21.5 plan end pauses all clients, 21.6 over-limit paused not deleted (matches `pausedReason`, `syncWorkspacePlans`), 14-day wait (matches `GRACE_DAYS`), invoices 8 years (matches `RETENTION_YEARS = 8`). Section numbers are consistent: the old Contact section is now 22, nothing refers to "Section 21/22" by number, and the 4.3 and 6 cross-references still point to the right sections.
- `needsTermsPrompt` correctly skips staff and CSM accounts and pending deletions when the signed-in user is the staff member themself.
