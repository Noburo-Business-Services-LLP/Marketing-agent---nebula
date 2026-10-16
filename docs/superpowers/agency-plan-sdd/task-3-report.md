# Task 3 report: client workspaces

Built `backend/services/agencyWorkspaces.js` and `backend/tests/agencyWorkspaces.test.js`, using the brief's code and tests verbatim apart from one fix.

## Exports (all take `{ models: { User } }` except claimSlot/releaseSlot which take `User`)
- `claimSlot(User, ownerId)` -> updated owner doc or null. One `findOneAndUpdate` with `plan.tier:'agency'` and an `$expr` limit check; `$inc agency.clientCount`.
- `releaseSlot(User, ownerId)` -> `$inc agency.clientCount -1`.
- `createWorkspace({ owner, name, industry, website, models, randomId })` -> `{ ok:true, workspace }` or `{ ok:false, message }`. Refusal messages: "Client brands are part of the Agency plan." / "Please enter the client's business name." / "Your plan includes N clients and all of them are in use. Add a client slot to add more." If User.create throws, the slot is released and the error rethrown.
- `listWorkspaces({ owner, models })` -> `[{ id (string), name, createdAt, frozen }]`, oldest first.
- `renameWorkspace({ owner, workspaceId, name, models })` -> `{ ok }` or `{ ok:false, message }`; only workspaces owned by `owner` can be renamed ("That client was not found.").
- `syncWorkspacePlans({ owner, models })` -> number of workspaces; writes `workspacePlanFields(owner)` to all, sets `agency.frozen` true beyond `clientLimitOf(owner)` (oldest kept), clears it when back within limit. Nothing is deleted.
- `cleanName` (trim, collapse spaces, 80 chars).

Workspace document: email `ws-<id>@workspace.invalid`, random 64-char hex password, isVerified and onboardingCompleted true, firstName/companyName/businessProfile.name = name, businessProfile.industry/website (both exist in schema), `agency: { ownerId, workspaceName }`, `plan: { tier, addons }`.

## Deviation
The brief spread `workspacePlanFields(owner)` (dotted keys) into `User.create`, which fails (no nested `plan`); create now builds `plan: { tier, addons }` from those fields. Dotted keys are still used for `$set` in sync, as intended.

## Tests
RED: module not found. GREEN: 5/5 new; backend full suite 1028/1028 (was 1023). Frontend untouched, so frontend, tsc and audits not re-run. No real database run (brief does not require one). Nothing pushed.
