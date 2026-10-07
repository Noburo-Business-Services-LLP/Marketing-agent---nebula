# Hero video: its own quick flow

Date: 2026-10-07. Status: written from the owner's request, waiting for his OK before any build or paid test.

## Problem (found in the code)
Today a Hero video is not its own feature. `ReelGenerator.tsx` "Make this a Hero video" takes the output of the long wizard (Creative Director concept with a story up to 1500 characters, a cast, a script, many scenes) and `/reels/hero` squeezes all of it into ONE 15-second clip (`hero_video.plan` prompt). A 30 to 45 second story cannot fit in 15 seconds, so the clip gets cut mid-story, has no finish, no clear call to action, and the logo sits badly.

## Decision
Split into two clearly separate things on the Videos page:

1. **Hero video (new quick flow), 15 seconds.** One crisp idea, built to fit 15 seconds from the start.
2. **Step-by-step video (the existing wizard), 30, 45 or 60 seconds.** Unchanged: concept, cast, script, scenes. It no longer offers "Make this a Hero video".

## Hero quick flow
Screen 1, "Create a Hero video":
- What is it about? One or two sentences (prefilled from the business profile: hero product or main offer).
- Style, two choices only: **UGC** (a real-feeling person talking or reacting to camera, handheld, minimal dialogue) or **Brand film** (a short, simple cinematic film, almost no dialogue, strong visuals and transitions).
- Optional: a product photo, a location photo (people photos are not sent as references; the model refuses likenesses of real people), language, sound choice, call to action text, aspect ratio.

Screen 2, "Choose your idea": three **crisp** concepts, never long. Each is: a one-line hook for the first two seconds, three beats (about 5 seconds each, one sentence each), one line of dialogue at most (maximum two short lines), one closing call to action. Hard length caps are enforced in code (hook 120, each beat 160, total concept under 600 characters), so a concept can never again be a page long.

Screen 3: the existing Hero screen, already built: plan, price (729 Quarks today, from `apiCosts.js`), generate, finish. The cast step is skipped: characters are described in words in the plan (this already matches the no-people-photos default).

## Finish (fixes the "no proper ending" complaint)
- The final beat is always the call to action on a calm, held frame, then the end card (already built in `heroVideoFinish.js`): the closing card with call to action and website is ON by default.
- **Logo: off by default for now.** The logo is only added on the end card, where it sits on a clean background, not placed inside the moving video. Owner can switch it back on later.
- Captions stay optional; realism grade stays on.

## Backend
- New prompt `hero_quick.concepts` (registered, with caps and a validator like the other locked prompts) that returns three concepts in the shape above.
- New route `POST /api/hero-video/concepts` (no charge, light text AI cost only, same limiter as `/plan`). Accepts the idea, style, brand context from the server (never trusted from the client).
- `normaliseQuickConcept()` converts the chosen concept to the same brief the existing `/brief`, `/plan`, `/generate` flow already accepts (one cast-less brief, scenes = the three beats). No change to charging, refund, polling or the Kling files.
- Duration stays 15 seconds. Longer videos remain the wizard's job.

## Frontend
- Videos page: two clear buttons, "Create a Hero video (15 seconds)" and "Create a step-by-step video (30 to 60 seconds)".
- New `/reels/hero/new` quick screens as above; the existing `/reels/hero` screen is reused for plan, price and generate.
- The generation clock and typical range (already built) shows while it runs.

## Tests
- Concept validator: caps, three concepts, dialogue limit, no digits or claims not in the brand facts, brand name present.
- Route: refuses empty idea, no charge, fake LLM.
- Brief conversion: the converted brief passes the existing `normalizeHeroBrief`.
- Frontend: screen state helpers; voice and brand audits stay at 0.
- One real run only with the owner's explicit OK for that run (729 Quarks, about US$4.55 of fal spend if it succeeds).

## Not in scope
Kling files; changing the wizard's own long videos; server-side stitching of longer clips (see `2026-10-07-server-side-clips.md`).

## Open questions for the owner
1. Is 15 seconds the right Hero length, or also offer 10 seconds as a cheaper option later (price derived from `apiCosts.js`)?
2. Should "Make this a Hero video" stay inside the wizard as a shortcut, or be removed? (Recommendation: remove it, since it is the cause of the problem.)
3. Logo off by default for now: confirm.
