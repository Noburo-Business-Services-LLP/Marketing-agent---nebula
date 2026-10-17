# Plan-led Nebulaa: My plan, the weekly proposal, setup path and guided tour

Date: 2026-10-17. Status: for the owner's review. Nothing is built yet.

## Purpose

Today a customer finishes onboarding and lands in a tool that makes content. The product has lost the part that explains why: who the ideal customer is, which channels to use, how effort splits between organic and paid, what Nebulaa does and what the customer does themselves, and what the next 30, 60 and 90 days look like. The ICP and channel mix are still generated and stored for each account (`User.icpStrategy`, served by `GET /api/campaigns/icp-strategy`) but only the old Campaigns page shows them and that page is no longer in the main menu, so customers never see them. The Blueprint (nine pages, fact-checked claims, three-phase roadmap) exists as a separate document and is not connected to what Nebulaa creates.

Success looks like this:
- A paying customer can open one page, "My plan", and read their customer, their channels (organic and paid, who does what), and the next 90 days, top down.
- What Nebulaa creates (calendar, weekly proposals, pre-filled create screens) comes from that plan.
- A new customer always sees one clear next setup step, never a wall, and a short guided tour shows them the interface.
- On opening the app, a customer sees "this week we will make N posts, M videos, shall we go?", approves it in one tap, and the cheap parts happen while the costly parts stay one deliberate click.

Said by the owner: top-down strategy visible to the customer; setup order (connect socials, complete profile, plan, then proposals) shown clearly; a weekly "shall we go ahead" proposal; carousels and videos open a pre-filled screen; a step-by-step tour like other apps. Decided with the owner in this conversation: the plan is built from the Blueprint engine, not the old ICP generator (Option A); on approval, single posts are made at once and go to Review and approve, carousels and videos open pre-filled and wait for the customer to press Generate (Option B); setup is suggested, not enforced (Option B).
Assumed by me (to confirm): the first plan is free for paying customers and refreshes itself monthly (see "Cost and limits"); the weekly proposal is scaled down to what the Quark pool can afford.

## Out of scope

- Changing prices, plans or Quark costs; customers keep seeing posts and videos, never Quarks.
- Paid ads buying or ad campaign creation; the plan states the organic and paid split but Nebulaa does not run paid ads here.
- A new onboarding questionnaire; the existing business profile is the input.
- Team accounts, multi-language tours, video tutorials.
- Agency client workspaces get My plan and the weekly proposal automatically through the same code (a client is a normal account); no agency-specific screens.

## Stage 1: My plan

### What it is
A page per business at `#/plan`. The source is the latest completed plan run for that account, produced by the Blueprint engine (same fact collection, same claim tags verified / inference / proposed / unverified, same QA scanner), with two additions to the planner output:

- `icp`: who the ideal customer is, what bothers them, where they spend time online and offline, and what makes them act. Every line carries a tag like every other Blueprint claim; lines that no fact supports become proposals.
- `effort`: for each channel in the channel plan, an organic and paid percentage (sum 100), and a `who` split: actions Nebulaa does for the customer (posts, carousels, videos, inbox replies, scheduling) and actions the customer does themselves offline or on the platform (WhatsApp follow-up, Google Business Profile reviews, local events, calls). The set of things Nebulaa can do is fixed in config (`PLAN_NEBULAA_CAN`), so the model can never promise a capability the product does not have.

The existing pieces stay: audience and positioning, competitor read, content pillars, the channel plan, the 90-day roadmap with three phases, first steps. My plan shows them in this order: Your business today, Your customer (`icp`), Where to show up (channels with `effort`), The next 90 days, This month's content mix, What to do first. A "Download as PDF" button reuses the existing designed Blueprint PDF.

### How a plan run starts
A new system-started kind of Blueprint run (`kind: 'plan'`) built from the account's business profile (business name, website, what they sell, who it is for, goal, competitors, Instagram handle where present). It reuses `services/blueprint/*` unchanged where possible; the differences are: it is started by the system or by the "refresh" button, not by the Blueprint form; it is never charged to the customer's pool (the cost, a few rupees of model use, is ours); it does not use the free-slot rules; it still honours the per-account daily cap and the per-IP cap for manual refresh.

When it runs:
- Automatically, once, when a paying account's business profile becomes complete (a pure `profileComplete(user)` helper decides; the same helper drives the setup path).
- Automatically each month, on the first day the account's plan month starts (a small scheduler).
- By hand with "Refresh my plan", at most once a week per account; the button says when it will next be available.
- Never for staff accounts or managed clients unless staff trigger it from the client page (managed clients have their strategy done by their manager; the plan page appears for them only after a first run).

A run that fails leaves the previous plan in place and shows "We could not refresh your plan just now, your last plan is still here." A first run that fails retries twice with backoff, then raises an owner alert and shows the customer a plain message with a Try again button.

### Free accounts
They keep the free Growth Blueprint exactly as today (read-only on the My plan page, with the plan's date). The page offers "Choose a plan to get this turned into weekly posts and videos." No weekly proposal for them.

### Old pages
The old ICP page and `GET/PUT /api/campaigns/icp-strategy` are retired once My plan ships. The stored `icpStrategy` data is left in place and ignored; nothing is deleted.

## Stage 2: everything flows from the plan, setup path, weekly proposal

### Content follows the plan
- The monthly calendar generator takes the current plan as an input: content pillars, the channel mix with each channel's role, and the phase the account is in (days 1 to 30 foundation, 31 to 60 storytelling and engagement, 61 to 90 growth, counted from the plan's start). When no plan exists yet it behaves exactly as today.
- A pure function `weekProposal({ plan, cadence, calendarItems, pool, now })` returns the week's proposal: counts of single posts, carousels and videos, with a topic and channel for each, taken from the calendar items due that week and the plan's format mix. If the pool cannot pay for the full week it removes the costliest formats first (videos, then carousels) and returns a `scaledDownBecause: 'pool'` note. The customer sees posts and videos, never Quarks.

### Setup path
A pure helper `setupSteps(user, state)` returns the ordered steps with `done`, `next` and a short reason:
1. Complete your business profile (required for a plan).
2. Connect your social accounts (required for publishing only; without it posts are made and saved, and the app points to Connect).
3. Read your plan (done once My plan has been opened after the first run).
4. Approve your first week.

Rules: nothing is blocked except what cannot work (publishing needs a connected account; the weekly proposal and My plan appear only after a plan exists). A setup card on the home screen shows the single next step with an estimated time and ticks finished steps. Once all four are done the card disappears.

### The home screen
For an account that is set up, the home screen opens on a "This week" card (before the review queue): "This week we will make 5 posts, 1 carousel and 2 videos, based on your plan. Shall we go ahead?" with Approve, Change, and Skip this week. Change lets the customer lower or raise each count (up to what the pool can pay), swap a topic, or skip an item. An account without a plan or without a pool sees the relevant next step instead (set up your profile, choose a plan, top up).

### What Approve does (Option B)
- Single posts: created straight away as drafts through the existing draft creation path and placed in Review and approve. Each post is a normal, cheap post charge as today, taken when it is made.
- Carousels and videos: each becomes an entry on the card ("Make this carousel", "Make this video"); opening one goes to the existing create screen pre-filled (topic, channel, format, language, anything the plan provides) and waits for the customer to press Generate.
- Nothing is made twice: each proposal item has a status (proposed, approved, made, skipped) stored per week, and "made" is set from the real created draft or job id.

### Data
- `PlanRun` is the existing Blueprint collection with `kind: 'plan'` (new optional field, default 'blueprint') and the `icp` and `effort` blocks inside `result`. The account's current plan is the newest completed run of that kind.
- `WeeklyProposal` (new collection `weekly_proposals`): `userId`, `weekStart` (Monday, account timezone, a date string), `status` (proposed, approved, skipped, expired), `items[] { id, kind: post|carousel|video, topic, channel, source: calendarItemId, status: proposed|approved|made|skipped, ref }`, `scaledDown`, `createdAt`. Unique on `userId + weekStart`. It references the user, so `dataRegistry` must list it as erasable (a test enforces this).
- `User.tour { completedAt, skippedAt, step }` and `User.setup { planOpenedAt, firstWeekApprovedAt }`.

### API
- `GET /api/plan` returns the current plan, its date, whether a run is in progress or failed, and when a refresh is next allowed.
- `POST /api/plan/refresh` (rate limited, weekly per account).
- `GET /api/week` returns this week's proposal (created on first read if none and the account qualifies); `POST /api/week/approve`, `POST /api/week/items/:id` (change or skip), `POST /api/week/skip`.
- `GET /api/setup` returns the ordered steps. All routes refuse a request inside an agency pass only where money or plans would change (none of these do), so they work inside a client workspace.

## Stage 3: guided tour

- A client-side component driven by data: a list of steps `{ id, route, target, title, body }`, where `target` is a `data-tour="…"` attribute added to the real elements (home This week card, Create, Review and approve, Calendar, My plan, the help button). Steps: Welcome and the This week card; Create content; Review and approve; Calendar; My plan; Help button. About six steps.
- First run: starts once after the customer's first login after they begin setup (not before onboarding finishes), can be skipped at any step, and its progress and completion are saved on the account (`PUT /api/tour`). A help button in the header replays it and shows the setup path.
- Behaviour: a spotlight with a short card on desktop; a bottom card without spotlight on a phone. Keyboard operable (Escape closes, arrow keys move), focus trapped inside the card and restored on close, respects reduced motion, text readable in the light theme.
- A step whose target is missing on the current screen is skipped, never blocks.
- Not shown to staff or to a CSM working inside a client, nor inside an agency client workspace (the agency owner sees it on their own account).

## Cost and limits

- The plan run costs us a few rupees of model use per run, never charged to a customer. With the monthly refresh and one manual refresh a week the worst case is five runs a month per account. A global cap and the existing daily AI spend ceiling apply (the plan run records its spend like every other model call, as the action `blueprint_plan`).
- Weekly proposals are free to produce (no model call for the counts; topics come from the existing calendar). Costs arise only when posts, carousels or videos are made, at the existing prices.
- Posts made automatically after Approve are charged at the normal price when made. The customer sees the number of posts and videos, and the app never lets the proposal exceed what the pool pays for.

## Error handling

- Plan run fails: keep the last plan, show a plain message, retry rules above, owner alert on a failed first run.
- No calendar yet: the weekly proposal is built from the plan's format mix and first steps instead, with generic topics from the pillars; the next calendar generation replaces it.
- A week with nothing left to do (everything made or skipped): the card shows "Nothing left to make this week" and the next proposal date.
- Pool too small for even one post: the card explains and points to top-up.
- Approve pressed twice: second press changes nothing (items already approved are skipped).
- Plan stale (older than 45 days because refresh failed): shown with its date and a gentle "this may be out of date" note.

## Testing

- Pure helpers with unit tests: `profileComplete`, `setupSteps` (every combination of done/not done, free and paid, with and without socials), `weekProposal` (scales down by removing videos then carousels, never exceeds the pool, no double items, week boundaries in the account timezone, month ends), phase from plan start date.
- Planner: tests that `icp` and `effort` pass the QA scanner and tag rules, that `effort` percentages sum to 100, that any "Nebulaa does" action outside `PLAN_NEBULAA_CAN` is dropped, and that a model response missing the new blocks degrades to the old plan without failing the run.
- Plan run scheduling: not charged, weekly limit, monthly auto-run once per month, failed run keeps the old plan, staff and managed accounts excluded.
- `WeeklyProposal`: unique per week, approve idempotent, item status moves only forward, "made" set from a real id, data registry coverage test.
- Frontend: helper tests for the setup card and the proposal card state, tour step logic (missing target skipped, saved progress, replay), wording guard ("credit", "trial", "7 days", Quark and vendor words absent in these screens), brand and voice audits, layer lists.
- Real runs on `nebulaa_dev` with throwaway users: one real plan run for an account with a complete profile (one low-cost model call, with the owner's OK for that spend), then the week proposal, approve (posts appear in Review and approve; a video entry opens the pre-filled screen without charging), refresh limit, and the tour on desktop and at 375 px in the browser.

## Staging

One spec, three plans, each shipped and checked before the next: Stage 1 My plan (planner additions, plan runs, `/plan` page, retire old ICP page); Stage 2 content follows the plan, setup path, home screen This week card, weekly proposal and Approve; Stage 3 guided tour. Stage 1 is useful on its own.

## Open items and risks

1. Whether the first plan should wait until the business profile has a website or Instagram link (the Blueprint relies on public facts and falls back to proposals with little evidence). The proposal here: run anyway with the profile alone, mark thin evidence honestly, and invite the customer to add a website to improve it.
2. The effort split (organic vs paid percentages) is a recommendation, not a measurement; the page says so in plain words and tags it as a proposal.
3. Managed clients: a plan page appears for them only after staff run the first plan, so existing customers see no change until the owner decides.
4. The weekly proposal depends on a calendar existing; accounts that never generated one get the plan-based fallback until they do.
5. Owner to decide later whether a weekly proposal should repeat automatically when the customer does nothing (the first version only proposes and waits).
