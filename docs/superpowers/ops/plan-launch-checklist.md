# My plan: what the owner does before and after release

My plan (Stage 1 of the plan-led work) builds each customer's strategy automatically. Nothing starts a plan until the business profile is complete, and the scheduler only refreshes accounts that already have a plan. Read this before release.

## Before release
1. **Top up and check the OpenAI account.** On 2026-10-17 the OpenAI account used for local testing had no credits, so every text call silently fell back to Gemini, which produced broken output for the plan. Plans (and posts and captions) need the OpenAI text model. Confirm production has credit and set a billing alert. A plan run costs a few rupees of model use and is never charged to the customer.
2. **Dry-run the backfill for existing managed clients.** From `backend/`: `node scripts/plan-backfill.js --limit 20` (a dry run by default). It prints who would get a plan and an estimated cost (about Rs 5 each). It writes nothing without `--yes`.
3. **Run it in small batches.** `CONFIRM_PROD=yes node scripts/plan-backfill.js --limit 10 --yes` against production, one batch at a time. It waits for each run to finish and is safe to rerun (accounts that already have a plan are skipped). Look at the first 3 or 4 plans (My plan page, or the Plan card on the staff client page) before running more.
4. **Tell managed clients before the page appears.** They will see a new "My plan" menu item and, if they log in themselves, the plan page. Their team sees the plan on the client page in the staff area ("Plan" card, with a Refresh plan button).
5. **Daily cost safety.** Plan runs obey the daily AI spend ceiling and the provider switches (staff AI spend card). A hard cap of 100 plan runs a day applies (`PLAN_RUNS_PER_DAY_MAX` in `backend/config/blueprint.js`); the owner is alerted if it is hit.

## Switches
- **Competitor tracker: set `ENABLE_COMPETITOR_TRACKER=on` in the production secret to start weekly reads (about USD 0.46 a day at the 200 cap).** It is off by default in every environment, production included, and only the exact value `on` turns it on. Only the weekly tracker needs it. Customer-triggered competitor scrapes (add, discover, Competitors page) do not depend on it and keep working. Staff can stop every competitor read, weekly and customer-triggered, at any time with the "Competitor checks" switch on the staff AI spend card. Limits: 200 reads a day in total, 5 a day for one account (`backend/config/competitors.js`).
- `ENABLE_PLAN_SCHEDULER=off` stops the monthly refresh pass and the retry pass (the first plan from a profile save and the Build my plan button still work).
- Staff can refresh any client's plan from the staff client page; customers can refresh once a week.

## What customers see
- Complete profile -> plan appears in about a minute (the page says it is being built). Incomplete profile -> a plain list of what is missing. A business whose website cannot be read -> a message asking them to improve the profile (never retried automatically).
- Free accounts keep the free Growth Blueprint and are invited to choose a plan.

## Known limits
- No "Download as PDF" for the plan yet (the designed Blueprint PDF is per Blueprint and priced separately).
- The plan lists no offers (they are stored as fact ids; a later change can show them).
- The competitor tracking and social listening stages are specified (see the spec) but not built.

## Guided tour (Stage 3)
- A short six-step tour starts once for each customer after onboarding, on the home screen only. Skip, Escape or Done is saved on the account and it never restarts by itself; the "?" help button replays it any time (replaying never changes the saved completion).
- It is never shown to staff, to a CSM or staff working inside a customer's account, or to agency client workspaces.
- **Deploy order: ship the backend before (or together with) the frontend.** If the page ships first, the tour cannot save its progress and would start on every page load.
- The six steps and their wording live in `frontend/utils/tour.ts` (`TOUR_STEPS`). To switch the tour off for everyone, make `shouldAutoStart` return false and redeploy.
- Customers without a plan yet (or on a free account) see five steps, because the "This week" card is not shown to them yet.
- On a phone the sidebar menu opens by itself for the menu steps and the card sits at the bottom of the screen.
