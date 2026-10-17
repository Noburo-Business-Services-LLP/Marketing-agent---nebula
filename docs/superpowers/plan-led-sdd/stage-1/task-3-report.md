# Task 3 report: plan runs, rules and the service

Status: done. Tests: planRules/planService/blueprintService 53 pass; full backend suite 1269 pass, 0 fail.

## Changes
- New `backend/services/plan/planRules.js` (shouldHavePlan, canRefresh, monthlyDue, isStale; 7/30/45 day constants).
- New `backend/services/plan/planService.js` (createPlanService: startPlan, currentPlan, inFlight, refresh; lazy default deps).
- `models/Blueprint.js`: `kind` ('blueprint' default | 'plan', indexed). `models/User.js`: `planState`.
- `services/blueprint/service.js`: `startSystem({user,input,kind})` (no charge, freeSlot false, charge none, mode auto, tierAtStart resolveTier, enqueues run); `deps.recordSpend` (default spendGuard.record); `list()` filters `kind: {$ne:'plan'}`.
- `services/staff/usage.js`: the staff "Blueprints" usage count excludes plan runs.
- Tests: new planRules/planService tests (brief verbatim plus one: refresh with alreadyRunning does not stamp lastRefreshAt); 4 new startSystem tests in blueprintService.test.js.

## Findings
- `failAndRefund`/`refundOnce` only refund `charge.state === 'charged'` (atomic claim), so a 'none' charge refunds nothing; no guard needed (tested).
- `run` does not record spend; spend is recorded inside quarkBuckets.spend on a charge. Free and plan runs were therefore uncounted. startSystem now records `blueprint` spend (best effort) so the daily ceiling counts plan runs. Free-tier runs remain unrecorded (pre-existing, untouched).
- No existing tests edited.

## Concerns
- get() by id still returns plan runs to their owner (the route is ownership-scoped); fine for later tasks.
- Staff usage change was outside the brief's explicit list; small and tested by the full suite.
- `refresh` accepts `{userId}` (as the brief's tests do) or `{user}`.
