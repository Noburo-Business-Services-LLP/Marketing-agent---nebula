# Regression probe pack (tester's master prompt, section 1.2) as automated tests

Run: `cd backend && node --test tests/http/probes.test.js` (about 3 seconds). No network, no database, no provider.

How it works: `backend/tests/http/helpers/appHarness.js` loads the real `server-main.js` (`NEBULAA_SERVER_NO_START=1`, so no listener and no scheduler), listens on a random 127.0.0.1 port and sends real HTTP through the real middleware stack, in the real order (CORS gate, compression, limits, body limits, query guard, sanitiser, routes, error handler). The `User` model is the in-memory stand-in from `backend/tests/helpers/authHttp.js`; the few other models a probe touches (`Reminder`, `Draft`, `ContentCalendar`) are swapped inside that probe and put back. Any outgoing request to a non-local host throws and is counted; the file fails if the count is not zero. `AUTH_CACHE=off` because a stand-in `User` has no save hooks to clear the cache (the cache has its own tests: `authCache.test.js`).

`authHttp.js` `call()` now sends the query string too (it used to send only the path, which hid `?status[$ne]=x`).

## Table

Each probe asserts the FIXED behaviour. "Also covered by" lists existing unit or route tests that check the same rule at a lower level (kept, not duplicated).

| Probe | What it asserts | Test | Also covered by | Status |
|---|---|---|---|---|
| P1 | `Tom & Jerry <3`, `if (a<b) 5 > 3`, `<b>bold</b>` are stored unchanged (reminders) | `probes.test.js` P1 | `emailEscaping.test.js` (escape on output) | PASS |
| P2 | 25 signed-in `/api/auth/me` calls from one address, all 200 | `probes.test.js` P2 | `rateLimits.test.js` | PASS |
| P3 | prompt builder 401 without token; with a token a huge `sceneCount` is refused (400, our answer to "clamp") and the largest allowed request returns at most 20 scenes | `probes.test.js` P3 | `promptBuilderLimits.test.js` | PASS |
| P4 | rotating `X-Forwarded-For` spoofs to the left of the proxy-appended entry give one address (`/api/health/details` shows `req.ip`) | `probes.test.js` P4 | `rateLimits.test.js` (`trustProxySetting`) | PASS (see D64) |
| P5 | `GET /api/campaigns/123` and `?status[$ne]=x` are 400, no "Cast to" | `probes.test.js` P5 | `objectIdParams.test.js`, `errorHandler.test.js` | PASS |
| P6 | evil Origin is 403 JSON; an allowed origin is not refused | `probes.test.js` P6 | `corsPolicy.test.js` | PASS |
| P7 | `Bearerx <token>`, bare token, `Bearer <token> extra` are 401; `Bearer <token>` works | `probes.test.js` P7 | `strictBearer.test.js` | PASS |
| P8 | send-otp and forgot-password: identical status and body for unknown, unverified and verified email | `probes.test.js` P8 | `authEnumeration.test.js` | PASS |
| P9 | `GET /api/content-calendar` with no calendar: 200 `calendar:null`, status not_prepared, no generation call, no write, under 300 ms | `probes.test.js` P9 | `calendarReadOnly.test.js` | PASS |
| P10 | `/api/health` and `/api/ready` are 503 with the database down and 200 when it answers a ping | `probes.test.js` P10 | `healthCheck.test.js` | PASS (differs from the prompt, D63) |
| P11 | `/api/notifications/process`, `/check-now`, `/test` are 403 for a normal user | `probes.test.js` P11 | `notificationsStaffOnly.test.js` | PASS |
| P12 | `/api/social/inbox/dev/ingest` and `/dev/test` are 404 when `NODE_ENV=production` | `probes.test.js` P12 | `entitlementGates.test.js` (mentions the routes) | PASS |
| P13 | a 5 MB JSON body to a small-body route is 413 quickly, `/api/health` answers in under 500 ms meanwhile, the server keeps serving | `probes.test.js` P13 | `bodyLimits.test.js` | PASS (5 MB, not 30 MB: same code path, no flaky socket reset) |
| P14 | change password: old token 401, new token 200 | `probes.test.js` P14 | `tokenVersion.test.js` | PASS |
| P15 | XSS strings round trip as plain text; `javascript:` and `data:` links refused in the profile website | `probes.test.js` P15 | `safeUrl.test.js`, `uploadSafety.test.js` | PASS |
| P16 | sign-in 5/s for 20 s, health p99 | `backend/scripts/loadtest/` (sign-in flow) | | run by hand, see `loadtest.md` |
| P17 | drafts list 30 by default with `nextCursor` (the route asks the database for 31) | `probes.test.js` P17 | `listPage.test.js` | PASS |
| P18 | two processes, each scheduler starts in one | not an HTTP probe | `schedulerLeases.test.js`, `runBackground.test.js`; real two-process run in `loadtest.md` | cross-referenced |
| P19 | `server.js` without `JWT_SECRET` exits non-zero and names it | `probes.test.js` P19 (spawns the real entry point in an empty folder) | `bootEnv.test.js` | PASS |
| P20 | `Bearer demo:x@y.z` is 401 unless `ALLOW_DEMO_AUTH=1`, never in production | `probes.test.js` P20 | `bootEnv.test.js`, `inboxStreamDemoAuth.test.js` | PASS |

Counts: 18 probes run in `probes.test.js` (P1 to P15, P17, P19, P20: all PASS), P16 is a load run, P18 is cross-referenced to the lease tests plus the manual two-process run. No probe is "not applicable".

Note: "FAIL before the fix" cannot be shown from this repo state (the fixes are already in); what each test proves is the fixed behaviour, and the assertions are the ones from the tester's table.

## Lint baseline

See the section at the end of this file (filled in by the ESLint item).
