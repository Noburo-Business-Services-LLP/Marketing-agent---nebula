# Task 4 report: client pass, auth, clients API

## Built
- `services/agencyWorkspaces.js`: `issueAgencyPass({workspaceId, ownerId, secret})` (JWT `{id, actingAgency}`, 8 h), `PASS_HOURS`, `BLOCKED_INSIDE_CLIENT`, `isBlockedInsideClient(url, method)`.
- `middleware/auth.js`: `_agencyPassProblem(owner, workspace)` (exported) and the `decoded.actingAgency` block in `protect`. Every request re-reads the owner and checks: owner exists and active, not itself a client, not pending deletion, `workspace.agency.ownerId === owner._id`, owner on tier `agency`, workspace not frozen (all 401, message in body), then blocked routes (403). Sets `req.actingAgency` (lean owner: isActive, plan, agency.ownerId, deletion.status, names, email).
- `routes/agency.js` mounted at `/api/agency` in `server-main.js`; `routes/auth.js` `/me`.
- Tests `tests/agencyAuth.test.js` (6). Real check script `scripts/agency-isolation-check.js`.

## Request / response shapes
- `GET /api/agency/clients` -> `{ success, clients:[{id,name,createdAt,frozen}], limit, used, slotInr, slotQuarks }` (works with the agency token or a pass; owner always re-read).
- `POST /api/agency/clients {name, industry}` -> 201 `{ success, client:{id,name,createdAt,frozen:false} }`; 400 `{success:false,message}` for agency refusals (name, limit); 403 for non-agency or when called inside a client.
- `PATCH /api/agency/clients/:id {name}` -> `{success:true}`; 400 bad name; 404 not this agency's client; 403 inside a client.
- `POST /api/agency/clients/:id/open` -> `{ success, token, expiresInHours:8, client:{id,name} }`; 404 not found / not owned; 403 frozen or owner not on agency plan. Works from inside a client (switching). Runs `syncWorkspacePlans` first.
- `/me`: `actingAgency: { name } | null`; for a workspace `user.credits` is replaced by the agency's `{balance,totalUsed}` (response only, not saved).
- Blocked inside a client (403): payment, change-password, delete/deactivate, account deletion/export, everything under `/api/agency` except `GET /clients` and `POST /clients/:id/open`.

## Real run
Done on `nebulaa_dev` only (script refuses any other database), throwaway users, all removed (cleanup printed removed 4 users, 1 draft, 0 left over; an earlier aborted attempt removed its 5 users, 0 left). Showed: draft made in A is seen with A's pass, NOT with B's pass, NOT with the agency's own token; opening another agency's client 404; payment 403 inside a client and 200 on the agency; add-client from inside 403; forged pass for a client the agency does not own 401; plan ended 401; frozen 401 on use and 403 on open; removed client's old pass 401.
Note: `launch.json` has no `redesign-backend` entry and the brief gives no port instruction, so I did NOT start the backend. The script instead mounts the real `protect`, `routes/agency` and `routes/drafts` in a private in-process server on a random 127.0.0.1 port, connected to the dev database only. No other service was reached. No `.env` read or printed.

## Tests
RED seen (5 of 6 failing, missing functions/module), then GREEN. Backend 1034/1034 (was 1028). Frontend, tsc and audits not run (no frontend change).

## Deviations
- `isBlockedInsideClient` lower-cases and URL-decodes the path (Express routing ignores case; the brief's regexes would have been bypassed by `/API/PAYMENT`) and treats an undecodable path as blocked. CSM's `isBlockedWhileActing` has the same case gap; not touched.
- Extra guards in `_agencyPassProblem`: owner that is itself a client, or pending deletion, ends the pass.
- Added routes refuse create/rename for any workspace/pass even though `protect` already does (defence in depth).
- `/me` copies only `balance` and `totalUsed` from the agency (not history).
