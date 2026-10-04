# Brand Growth Blueprint — free lead magnet and in-app feature

Status: draft for the owner's approval. Branch: `nebulaa-redesign`. Nothing is built, pushed or deployed. Source of method: the owner's skill `Nebulaa_Brand_Growth_Blueprint_Skill.md` (discover, verify, diagnose, define, conceptualise, visualise, check, build, recommend; cover, nine pages and a closing page; modules A to H; QA gate; golden rule).

## What it is

A visually rich, printable growth plan for one business, made from a short form plus what can be verified on the public web. Used two ways:

1. **Lead magnet.** Ad says "Get your Brand Growth Blueprint, free". The visitor signs up free, receives 100 Quarks, fills the short form, and gets the blueprint. The blueprint is the only thing a free account can generate that costs us real money, so it is limited and verified (below).
2. **In-app content planning.** The same engine replaces the plain content plan inside Nebulaa for logged-in customers, in guided mode, and feeds the monthly calendar visuals.

## Decisions (owner, 2026-10-04, plus my calls where marked)

1. Free sign-up, then one blueprint per business. (owner)
2. The blueprint needs real input. It is not one click: a short form first. (owner's point, confirmed)
3. Lead-magnet mode runs fully automatic after the form; logged-in customers get guided mode with checkpoints. (my call)
4. Email verification before generation, one free blueprint per verified email and per business (website host or Instagram handle), plus rate limits per IP. (my call)
5. First version output: one styled page that prints to PDF, plus a view in the app. No separate PDF engine at first. (my call)
6. Build after the plans work, kept separate from it. (owner chose option A)

## The form (free mode)

Required: business name; website URL or Instagram link (at least one); what they sell, in one sentence; who it is for; main goal (more enquiries, more sales, more followers, launch). Optional: city, three competitors, logo upload, brand colours, three real offers with prices the owner types.

A thin form produces a thinner blueprint, and the blueprint says so on its cover ("Based on limited information").

## No invented facts (from the skill's golden rule)

- Discovery fetches only the pages the visitor pointed to (website pages, public Instagram profile text) with the existing safe-fetch rules (public https only, no private ranges, size and time limits).
- Every claim is tagged **[Verified]** (seen on a fetched page or typed by the visitor), **[Inference]** (our reasoning from verified facts) or **[Proposed]** (our recommendation). Nothing about pricing, results, follower counts, awards or testimonials is stated unless verified; otherwise it reads "[Unverified]" or is left out.
- The visitor's logo and photos are used unchanged; no logo is generated or redrawn.
- Automatic mode stops and returns a short "we could not read enough" page (with the form to fix it) when discovery finds almost nothing, instead of filling the gaps with guesses. The skill's stop conditions apply.

## Contents (cover, nine pages, closing)

Taken from the skill: cover and snapshot; where you are today (verified facts only); audience and positioning; competitor read (only if competitors were given or are findable, labelled with source); content pillars; 30-day calendar preview (the same plan the app uses, shown as designed post tiles); offers and hooks; channel plan; 90-day roadmap; what to do first. Closing page: "Turn this plan into posts in Nebulaa" with the sign-up or upgrade call to action. Modules A to H are the skill's building blocks and are reused, not rewritten.

## Cost and abuse control (Quark economics)

- The text analysis uses one planner call plus page fetches; images are not generated in free mode (tiles are typographic and use the visitor's own assets). The cost per blueprint is set in `backend/config/apiCosts.js` like every other action (a new `blueprint` action; never a hard-coded number), expected well under 10 Quarks, charged from the free 100 Quarks.
- One per verified email and per business; three attempts per IP per day; generation runs in the background with a status page, so the form returns fast.
- Free blueprints do not unlock publishing or any outside service.

## Where it fits in the code (to confirm in the plan)

- Backend: a new `blueprint` service (discover, verify, plan, assemble), a `Blueprint` model (owner, inputs, status, result JSON, sources), routes `POST /api/blueprint`, `GET /api/blueprint/:id`, entitlement `blueprint` allowed on every tier, cost entry in `apiCosts.js`, the planner prompt registered in the existing prompt registry.
- Frontend: a public landing section and sign-up deep link ("Get your Brand Growth Blueprint, free"), the form, a progress page, the blueprint page with a print stylesheet, and an entry in the app's content-planning area. Visual design uses the Nebulaa light design system already in the app.
- No change to the Kling pipeline or the Hero money path.

## Not in the first build

Automatic PDF files and email delivery of a PDF, image-generated tiles, paid deep-research modules, SEO modules, A/B copy testing, multi-language. Each is a later step.

## Testing

Unit tests only, with a fake fetcher and a fake planner: input validation; safe-fetch rules; the tagging rule (nothing untagged, nothing from outside the verified set labelled Verified); thin-input stop condition; one-per-email and per-business limits; rate limit; cost charged once and refunded on failure; the output contains no invented prices, numbers or testimonials (scanner over fixtures); tier rules (free account can generate a blueprint but cannot reach outside services). A manual look at the printed page at desktop and phone widths before any release.

## Questions for the owner

- The exact wording on the ad and landing section (I will draft options).
- Whether the free blueprint should include the competitor read automatically when no competitors are given (costs more fetches; I suggest only when the visitor names them).
