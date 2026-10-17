# Handover 8 — 2026-10-17 (plan-led Nebulaa: Stage 1 built; Stages 2 and 3 planned)

Read handovers 5, 6 and 7 first (owner, rules, environment, Agency plan). This file covers the plan-led work.

## What the owner asked for
Nebulaa had become a content generator. He wants a top-down, visible strategy (ideal customer, channels with organic/paid split and who does what, 30/60/90 days), everything flowing from it, a clear setup order, a weekly "shall we go ahead" proposal and a guided tour. Managed clients must get plans too (so the team has the strategy). Competitor tracking and social listening come later.

## Documents (all committed)
- Spec: `docs/superpowers/specs/2026-10-17-plan-led-home-design.md` (Stages 1 to 3, plus Stage 4 competitor tracking and Stage 5 social listening with the cost and API research).
- Plans: `docs/superpowers/plans/2026-10-17-plan-led-stage-1-my-plan.md`, `...-stage-2-week-and-setup.md`, `...-stage-3-guided-tour.md`.
- Build records for Stage 1 (ledger, briefs, reports, final review, final fix report): `docs/superpowers/plan-led-sdd/stage-1/`.
- Owner checklist for release: `docs/superpowers/ops/plan-launch-checklist.md`.

## Stage 1 (My plan): BUILT, reviewed, fixed, verified for real
Commits `a483aa5` to `def676a` plus the checklist. Backend 1335 tests, frontend 315, brand and voice audits 0.
- A plan run is a Blueprint run with `kind:'plan'`, started by the system from the business profile, never charged (nothing in the customer's pool or ledger), kept as the account's newest completed plan. The planner gained fact-checked `icp` and `effort` blocks (nebulaaDoes limited to a fixed list). Plan runs have their own queue lane so they cannot starve paid Blueprints.
- Triggers: a profile save that completes the profile, the customer's "Build my plan" button, a weekly manual refresh (staff bypass), the monthly pass (refreshes only accounts that already have a plan), a throttled owner-run backfill script (dry run by default) for existing managed clients.
- Safety: the daily AI spend ceiling, provider switches and a hard cap of 100 plan runs a day (`PLAN_RUNS_PER_DAY_MAX`); interrupted runs are reaped; no endless retries; stopped runs (unreadable business) are never retried automatically.
- UI: `#/plan` (`pages/MyPlan.tsx`), nav entry, staff Plan card on the staff client page; the old ICP endpoints and panel are retired (410).
- The final review caught three Critical defects the unit tests and a mock-data visual check could not (the stored result lacked the plan blocks the page reads; an interrupted run blocked an account forever; system runs bypassed the spend guard). Lesson: a mock fixture hid a real shape bug, so always verify with one real run.
- Real run on `nebulaa_dev` (2026-10-17, our own website as the test business, throwaway user, cleaned up): profile save started the run; completed in 51 s; icp, effort (sums to 100), roadmap, 30 calendar days all present; 95 claims tagged proposed or inference; nothing charged; second save and a refresh inside a week started no extra runs; `GET /api/plan` returns the plan. A first attempt failed because the OpenAI account had no credits and the Gemini fallback returned broken JSON: that is an operations issue, see the checklist.

### Open items for Stage 1
- Top up and monitor OpenAI credits in production (the failed run showed text silently falls back to Gemini).
- Not yet viewed in the browser with a REAL plan (visual checks used sample data before the shape fix; the real shape is now verified through `GET /api/plan`): do one look at `#/plan` with a real plan when convenient.
- No plan PDF; offers not shown; the staff Plan card was verified through tests only.
- The scheduler's Mongo queries (candidates, failed-first scan, atomic start claim) are covered by fakes, not a database run; the `--yes` backfill path was never run against a database.

## Stage 2 and Stage 3
Planned, not started. Stage 2 plan reuses `generateSingleCalendarItem` in `services/backgroundQueue.js` to make approved posts; its first task must check whether that path (and the monthly calendar auto-generation) charges the customer: it appears not to, which would be a cost leak for paying accounts. Stage 2 and 3 depend on Stage 1's `planService.currentPlan`.

## How to continue
Use the `superpowers:subagent-driven-development` skill (scripts in `~/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/subagent-driven-development/scripts/`): `task-brief PLAN N`, sonnet implementers, the controller verifies tests and does real dev runs and visual checks itself, ONE final review on the most capable model. Rules unchanged: plain replies, honest reporting, owner types the release, no paid generation without his OK per run, real runs only on `nebulaa_dev` through throwaway scripts with users deleted afterwards, never read or print secrets.
