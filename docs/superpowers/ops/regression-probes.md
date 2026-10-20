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

Run: `cd backend && npm run lint`, `cd frontend && npm run lint` (flat `eslint.config.js` in each; ESLint 9).

| | Errors before | Errors now | Warnings now |
|---|---|---|---|
| backend | 78 (34 empty catches, 44 other) | 0 | 1,934 (1,768 `no-console`, 145 `no-unused-vars`, 16 `no-useless-escape`) |
| frontend | 1,522 (1,473 `no-explicit-any`) | 0 | 1,744 (1,473 `no-explicit-any`, 228 unused vars, 45 hook dependency lists) |

Errors fail CI; warnings do not. The backend was under the 150 limit, so every error was fixed. The frontend was over it: the real problems were fixed (empty catches got a one-line reason, a function named `use...` that was not a hook was renamed, a non-exhaustive `case` got braces, ternary statements became `if`) and `no-explicit-any` (1,473, API payloads typed loosely) is a warning baseline to reduce over time; `tsc --noEmit` still checks everything else.

Rules switched off or softened on purpose (written in each config): `no-control-regex` off (the sanitisers strip control characters), `no-useless-escape` warn, `no-irregular-whitespace` ignores strings, templates, regexes and comments (prompt text and a BOM test contain the characters), `scripts/visual-audit/**` ignored in the frontend (scripts injected into a browser page).

Real bugs ESLint found and the fix:
- `services/geminiAI.js fetchWithTimeout`: any network error other than a timeout fell through to `throw lastError`, a variable that does not exist, so the caller got a ReferenceError instead of the real error. It now rethrows the real error.
- `routes/campaigns.js`: the generated-post builder used an undefined `hashtags` when the model returned no list (ReferenceError, now `[]`); the batch poster loop waited with an undefined `delay` (now a plain timer).
- `services/videoGenerationPipeline.js`: `plan?.globalVisualStyle` named an undefined `plan` (ReferenceError whenever a scene had no image prompt); it now reads the planner's own `globalVisualStyle`.
- `routes/videoGeneration.js`: `const prompt` was appended to (a TypeError at run time); now `let`.
- `services/geminiAI.js`: a duplicate `'education'` key in a picture map (the later one won; the dead earlier one is removed).
- `services/mediaComposer.js`: a second `return` that could never run, removed.
- `getFallbackSynopsis` (`geminiAI.js`) declared constants inside `case` without braces; braces added.
- 34 empty `catch` blocks in `routes`, `services`, `server-main.js`, `utils` now log at debug level with context through `utils/logger.js`.
- Frontend: `services/api.ts` `discoverInfluencers` result type lacked `breakdown`, which `pages/Influencers.tsx` reads (the one old `tsc` error, now fixed; `tsc --noEmit` is clean). The backend route does not currently send `breakdown`, so that screen line shows 0 Mega, 0 Macro, 0 Micro; flagged, not changed here.
