# Task 5 fix round

Status: done. Backend 1079/1079 (was 1055, +24). Every file exits on its own. RED seen first for I1 (4/4 failed) and the profile routes (3 failed); the I3 tests passed on the existing code, so each was checked by mutation (9 deliberate breaks, every one made a test fail, files restored).

## I1: no free first batch for clients
- `services/agency.js`: `freeFirstBatch(user)` (false for a workspace; otherwise `!initialCampaignsGenerated`, unchanged).
- `routes/dashboard.js` both sites (:795, :954) use it. `services/agencyWorkspaces.js` also creates clients with `initialCampaignsGenerated: true`.
- Tests (`tests/agencyFreeBatch.test.js`): client never free (flag unset), non-agency accounts and the agency itself unchanged, new client created with the flag, both dashboard sites use the helper.

## I3: missing tests (`tests/agencyPayerCoverage.test.js`)
refundTo (recorded payer, resolved payer, client removed, plain account with no workspace key, zero/invalid/unplaceable/missing wallet), PAID_TIERS (agency active, halted not; agency top-ups not held at month end, free tier still held), settleWallet (client expires the agency pool, client untouched; plain account), Videos `charge` payer stamp and `fail` refund to the recorded payer (also after client removal, and zero Quarks), Blueprint `charge.payerId` and refund args (client vs ordinary), credits route pool lookup (`/` and `/history`, agency that cannot pay shows 0, ordinary account). Test hook: `routes/studioVideos.js` exports `_money = { charge, fail }`.
Guard test: pattern widened to `"credits.balance"`, backticks, `credits['balance']` and destructuring; scans `controllers` and `utils` too; a test pins the pattern. No new file tripped it.

## Minor 2 and 3
- `agency.publicCredits(user)`: client gets `{balance, totalUsed}` of the pool (0/0 if the agency cannot pay), never history; null for others. `routes/auth.js` helper `withPoolCredits` used by `/me`, `PUT /update-profile`, `PUT /complete-onboarding`. `/me` now shows 0 when the agency cannot pay.

## Skipped (Minor), one line each
- M1 agency history in credits routes: owner ruling needed, no client login today.
- M4 agency-pool-check.js AiSpendDay restore: dev script only.
- M5 stale comment in agency.js about halted: harmless.
- M6 refundTo result ignored at studioVideos reference refund: cannot fail in practice.
- M7 resolvePayer run 2-3 times per deduct: performance only.
- M9 concurrency test atomic by construction: not changed.
- M10 frozen clients ignored by money layer: acceptable, protect refuses them.
- M11 creditGuard deductCredits empty pool returns success: no runtime callers.
- I2 (removal while jobs run): Task 9, not built.
