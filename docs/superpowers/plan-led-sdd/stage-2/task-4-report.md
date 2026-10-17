# Task 4 report
Status: DONE. Added planContext.js (pure) plus planGuidanceFor (never throws); calendarPrompt/generateMonthlyCalendar accept planGuidance (calendarPrompt now exported); generate-next and regenerate load guidance.
Tests: planContext.test.js 6 pass; full backend 1388 pass, 0 fail.
Notes: processAutoGeneration only generates single items from existing calendars (no calendar generation), so it was left untouched. GET / and routes/auth.js also generate calendars but were out of the brief's scope, so they get no guidance. The plan block is joined to the MONTHLY_FOCUS slot, so with no plan the prompt is byte-identical. Brief test dates agree with the phase arithmetic.

## Follow-up
GET /api/content-calendar and the onboarding-complete call in routes/auth.js now use withPlanGuidance (planContext.js). Onboarding has no plan yet so it is effectively unchanged. Tests: 1390 pass.

## Calendar auto-generation leak (I3)
Fixed: skip generated/generating; atomic row claim + $inc count with cap in the claim; spendGuard check/record (image_generated); toggle keeps count; regenerate re-points open weekly items by day; 10-minute per-account cooldown (in memory, per process) on regenerate and auto-generate-week (429).
Remaining exposure at default cap 7: at most 7 posts/month/account from the toggle, about Rs 7 to 28 (Rs 1 to 4 each); at limit 31 about Rs 31 to 124. auto-generate-week: all open rows of a week per 10 minutes (about 7, Rs 7 to 28 per call, roughly 6 calls an hour, so bounded by cooldown plus the daily ceiling, not by a monthly cap). regenerate and auto-generate-week remain FREE (not charged). Stuck rows left in generating after a crash are not retried.
