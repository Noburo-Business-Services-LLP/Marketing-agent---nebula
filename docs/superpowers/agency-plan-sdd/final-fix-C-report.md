# Final fix C report

Status: all findings fixed except the items listed as skipped/concerns. Frontend 303/303, backend 1191/1191, tsc only the old Influencers.tsx error, brand and voice audits 0.

- C1 fixed: `mergeActing(response)` (utils/agency.ts) is used by `getCurrentUser` (both paths) so `actingAgency` and `actingCsm` sit on the user. Tested with the real response shape. Mock `/auth/me` now sends actingAgency next to user, owner name as the real server does.
- C2/I1 fixed: `needsTermsPrompt(user, holdsPass)`; App.tsx passes `csmReturnToken` presence. Tests added.
- I2 fixed: `actingClientName` (stored client name, else workspace name, else profile name); `toPublicJSON` now sends `agency.workspaceName`. Switcher compares by id (`csmActingClientId`, stored on open), falls back to name.
- I3 fixed: for agency, client workspace and lapsed agency only (`showsPostsNotQuarks`) the Quark pill/popover is hidden in Layout (no cheap source for pool numbers in the layout; pool numbers stay on the Clients/plans screens). TrialExpired: "Top up the shared pool" block for agencies, no Quark fallback. NeedPlanModal agency variant. api.ts credits-exhausted message has no Quarks. `agencyErrorMessage` falls back on Quark and vendor words. Other customers unchanged.
- I4 fixed: the switcher reloads each time it opens, old rows stay while loading.
- I5 fixed: `isLapsedAgency` (clientCount>0, tier not agency). AgencyClients shows "plan has ended, every client is paused" with Remove working and a See plans link; Clients nav item shown. Backend: `agency.clientCount` (and workspaceName) added to `toPublicJSON` only, test in backend/tests/userPublicJson.test.js. Checked DELETE /agency/clients/:id and GET /clients: no plan check, removal works.
- I6 fixed: AccountPrivacy and DeletionPending say how many client brands are erased (status `clients`); Terms 21.5 and Privacy 6 say it; Privacy 6 also lists the retained "Removed client" usage record.
- I7 fixed: Terms/Privacy show 16 October 2026, version 2026-10-16. Terms 17.4 lists Section 21. Checklist section 4 corrected to match reality: the pages have NO draft banner, so the line now says the text is a draft until the lawyer reviews it and must not be announced as final. Not fixed: `needsTermsPrompt` still checks only `acceptedAt`, not the version (a future Terms change will not re-ask); needs a client-known current version, left as a concern.
- I8 fixed: `openAgencyClient` refuses with a clear message while a staff or CSM pass is held (keeps that chain); all Back callers use `returnHashAfterActing`.
- I9 fixed: `clearPass()` on login, register, verifyOTP, getCurrentUser with no token or rejected session; `csmReturnTo` cleared after a pass-ended return.
- Minors fixed: AgencyDialog focuses the first field, mount-only focus effect, returns focus to the opener, Escape/backdrop/X ignored while busy; limit 0 treated as not active; "Choose a plan" flash removed (TrialExpired waits for the account); export text says client brands are not in the file.
- Skipped: menu roles/arrow keys in the switcher (not needed for launch), paging text counting "Removed client", `quarksSpent` in /agency/usage JSON (backend file, other agents).

Concerns: a lapsed agency cannot download the usage report (backend /agency/usage* requires an active agency plan), so the button is hidden for them; routes/agency.js not edited.
