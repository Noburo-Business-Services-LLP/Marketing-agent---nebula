# This week, setup path and calendar-follows-plan: what the owner does before and after release

Stage 2 of the plan-led work. Needs Stage 1 (My plan) in the same release.

## Decisions for the owner (open)
1. **Calendar auto-generation is free for paying accounts, and has been since before this work.** The monthly "auto-generate" toggle, "Generate this week" and "Regenerate" make posts (caption and image) without charging the customer's balance. After the fixes in this release it can no longer make the same day over and over or overshoot its monthly cap, it obeys the daily AI spend ceiling and the kill switches (the toggle path), and "regenerate" and "generate this week" are limited to one call per account per 10 minutes. What remains is a bounded free allowance per account (about 7 posts a month at the default cap, roughly Rs 7 to 28 of model use) plus "generate this week", which is bounded only by the cooldown and is NOT counted by the daily ceiling (it goes through the background queue). Decide: (a) keep these free as a feature, (b) charge them like weekly posts (one post price each), (c) cap "generate this week" by the daily ceiling. Recommendation: (b) or (c) before many customers use it; no one is blocked by waiting.
2. **Videos in the weekly proposal.** A video costs `studio_video` (161 Quarks, about 12 on Growth, 3 on Starter), so a Starter customer's weekly proposal will usually leave videos out ("we left out 1 video, top up to add it back"). That is intended, not a bug.

## Before release
1. Release Stage 1 and Stage 2 together; read `plan-launch-checklist.md` first (plans are built when a profile is complete and by the backfill).
2. Check the unique index on the `weekly_proposals` collection exists after deploy (it is created by the app on first use; the cluster is near its disk ceiling, so confirm it rather than assume).
3. Tell managed clients and your team before the new Setup card and "This week" card appear on the home screen. Managed accounts get the proposal like everyone (their balance is topped up by hand, so the proposal scales to what they have).
4. Switches: `ENABLE_WEEKLY_PROPOSAL=off` hides the card and refuses writes; `ENABLE_WEEK_RECOVERY=off` stops the background recovery sweep (every 15 minutes) that finishes posts left half-made after a restart.

## What customers see
- A Setup card with the one next step (profile, socials, read the plan, approve the first week), never blocking anything, hidden once everything is done and for staff, a CSM pass and agency clients.
- A "This week" card with the posts, carousels and videos suggested from their plan and calendar, scaled to their balance. Approve makes the posts in the background (they appear in Review and approve in about two to three minutes each); carousels and videos open the create screen filled in, and the customer presses Generate.
- Free accounts see the setup card and a prompt to choose a plan, never the weekly card.

## Known limits
- The weekly flow was proven end to end with one real post (charged exactly one post price, one ledger row, draft with image). Plan-sourced posts (no calendar yet) were covered by tests and the cards but not by a real generation.
- After a post fails three times it shows "try again later or contact support"; a refund that fails is recorded and alerts the owner.
- A server crash mid-post is recovered within about 15 minutes by the recovery sweep.
