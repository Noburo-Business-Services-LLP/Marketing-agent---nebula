# Task 4 report
Status: done. Tests: planScheduler 3/3, full backend 1272 pass / 0 fail.
Added services/plan/planScheduler.js (runMonthlyOnce, retryFailedFirstPlans, startPlanScheduler), maybeStartFirstPlan + maybeStartFirstPlanSafe in planService.js, hooks in routes/auth.js (PUT complete-onboarding after save; profile PUT before response, fire-and-forget), scheduler start in server-main.js (off in test, ENABLE_PLAN_SCHEDULER=off). Uses backgroundGate.blockedAccountIdsSafe and opsAlerts.recordFailure('plan', ...).
Concerns: retry attempts counted by a wrapper in the real tick ($inc planState.attempts); the monthly run can also pick up an account with no plan whose retries ended (no completed plan); hook runs on every profile PUT (cheap no-op once a plan exists or is running); no DB-backed test of default deps.

## Fix: monthly run cannot retry endlessly
runMonthlyOnce now skips accounts with planState.firstPlanFailedAt, applies a 12h cooldown (24h when the newest run failed), leaves failed first plans to the retry logic, counts monthly starts in planState.attempts (reset when the newest run is not failed), and after 3 failed monthly attempts alerts once and sets firstPlanFailedAt. A successful refresh clears firstPlanFailedAt and resets attempts. Tests added; full suite passes.
