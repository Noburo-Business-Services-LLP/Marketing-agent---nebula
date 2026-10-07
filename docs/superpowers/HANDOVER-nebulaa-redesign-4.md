# Nebulaa hand-over 4 (read this first, then hand-over 3)

Written 2026-10-07 (late) by the Claude Sonnet 5.5 session that built the staff area, the Hero fix, the Gemini fix and the brand-colour picker. It adds to `HANDOVER-nebulaa-redesign-3.md` (still correct for architecture, hosting, release procedure, rules). Read hand-over 3 section 2 (where things are), 3 (release) and 9 (owner's rules) before touching anything.

## 1. State right now

- Branch `nebulaa-redesign`, worktree `~/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign`. **Production runs `prod-3926888`.** Two commits are pushed to GitHub but NOT released: `a8ddecb` (brand colours from the logo) and `b88df6c` (Gemini text models). The next release carries them.
- Tests: backend 728, frontend 189, `npx tsc --noEmit` exactly 1 old error (Influencers.tsx). Commands: `cd backend && node --test tests/*.test.js`; `cd frontend && node --test tests/*.test.*`; `node scripts/voice-audit.mjs` and `node scripts/brand-audit.mjs` (0 violations); after changing CSS classes run `node scripts/visual-audit/gen-layer-lists.mjs`. Use nvm for Node.
- Done since hand-over 3 (all released unless noted):
  - **Staff area complete:** Home, Clients, client page, Team, Money, Usage. Old `/admin` is gone (`#/admin` redirects to sign-in). Owner tools moved: Reset Ayrshare IDs (Money page), Reset account (Team rows), hide a client (client page), coupons (Money page). First-Owner bootstrap routes (`POST /api/admin/login`, `/api/admin/make-owner`) are kept on the server only, no screen.
  - Staff screens were verified against a **throwaway database with made-up clients** (`backend/scripts/seed-staff-demo.js`; it refuses any DB not named `nebulaa_seed_*` or any non-local host; a mongod 7.0.x binary is cached under `nebulaa-accounts/node_modules/.cache/mongodb-memory-server/`). Use the same method for any staff-area change. Never use real customer data.
  - Fixes found that way: login no longer deleted on an API outage, staff error messages, CSV formula injection, chart counts, wording.
  - "Back to staff area" bar stays on screen while acting inside a client's account (`a2fa681`).
  - Hero video: **root cause of the 422 failures found**: Seedance 2.0 reference-to-video refuses reference images that show people ("The images or videos provided may contain likenesses of real people or other private information that cannot be processed", seen in fal's request history). Fix (`3926888`, released): by default no cast portraits or scene stills are sent as references; characters are described in words; an unchecked opt-in lets people photos through; a plain customer message for the refusal. **Still unproven by a real run** (see section 4).
  - Brand colours: auto-read from the logo on upload, palette picker, round swatches (`a8ddecb`, unreleased, not tested with a real upload).
  - Gemini: Google retired `gemini-2.5-flash-lite` (and likely the other 2.5 text models) for the new Google project, so Gemini text failed (log: "no longer available to new users... use gemini-3.5-flash-lite"). Fix (`b88df6c`, unreleased): shared model chain in `backend/services/geminiTextModels.js`, default `gemini-3.5-flash-lite` first, override with `GEMINI_TEXT_MODELS` (comma list); retired models are skipped; `/api/dashboard/content-strategy` falls back to OpenAI. **Unproven on the live key.**

## 2. Do next, in order

1. **Release** the two unreleased commits (owner runs `bash docs/superpowers/ops/release-prod.sh`; see hand-over 3 section 3). First set in the production secret `nebulaa-gravity/prod/backend`: `OPENAI_API_KEY` (needed by the new content-strategy fallback), optionally `GEMINI_TEXT_MODELS` and `OPENAI_TEXT_MODEL` (default `gpt-4.1-mini`, a guess), plus the older to-dos in hand-over 3 section 5 (`ALERT_EMAILS`, `FRONTEND_URL=https://gravity.nebulaa.ai`, `RAZORPAY_WEBHOOK_SECRET`). Restart the backend after changing the secret. After release: open Settings, click "Content Strategy PDF", and check CloudWatch for "Content strategy generation error".
2. **Prove the Hero fix with ONE owner-approved real run** (729 Quarks refunded on failure; about US$4.55 real fal spend if it succeeds). Default settings, people-photos box unticked. Then read fal's request history for `bytedance/seedance-2.0/reference-to-video` and the log line `Hero job <id> failed at the video provider: <reason>` (the error text now keeps the provider's `type` and unknown body shapes). If location photos with people are refused, drop environment images from the default reference set too. Never run a fal call without the owner's OK for that run.
3. **Build the image-based Blueprint PDF** (section 3). This is the owner's priority: the Blueprint is the hook to get people to sign up.
4. **Redo the business-profile questionnaire** (section 5).
5. Smaller owner decisions (section 6).

## 3. Blueprint as a designed, image-based PDF (decided, not built)

Owner's references: `~/Downloads/Amalga/Amalga Proposal.pdf` (11 pages) and `~/Downloads/Aval Aran_ Brighter Communities Blueprint.pdf` (9 pages). Ask the owner for these files; they are client proposals and are NOT in the repo. Facts verified by opening them: every page is a single A4 portrait image (595x842 pt) with no live text, merged into one PDF. Each has a cover with a bold headline and photo-real people, one idea per page with infographics, icon cards and step flows, one brand colour set, a page marker "01 / 08", a "Prepared by Nebulaa" footer and a closing contact page.

Today's Blueprint (built, released) is an HTML page with an A4 print stylesheet, planned by OpenAI text (`services/openAI.js` `callTextLLM`), with tagged facts and a QA gate (`backend/services/blueprint/*`, `backend/config/blueprint.js`, prompts in `backend/services/promptRegistry.blueprint.js`; specs `specs/2026-10-04-brand-growth-blueprint-design.md`, plan `plans/2026-10-04-brand-growth-blueprint.md`). Keep it: it is the instant, exact, cheap preview and the fallback.

Owner decisions (2026-10-07): follow the suggestion below; **do not waste image credits**, but make it as impressive as possible; it is a sign-up hook; giving away the 100 free Quarks is acceptable ("we'll see how"). The final free-versus-paid line is the owner's call once the real cost is known.

Design to implement (write a spec and plan first, using the superpowers workflow, one review at the end):
1. Page copy: the existing plan produces an exact, short copy deck per page (cover, 8 content pages, closing page). Facts stay tagged `[Verified]`/`[Inference]`/`[Proposed]`/`[Unverified]`; nothing invented (prices, results, follower counts, testimonials); the QA gate still runs on the copy before any image is made.
2. Image per page: OpenAI image model through the existing `backend/services/openaiImage.js` (gpt-image-1, edits endpoint accepts reference photos; sizes are 1024x1024, 1024x1536, 1536x1024, so generate 1024x1536 and crop to A4 with safe margins). Prompt = shared style spec (brand colours from the logo extraction, industry look, type feel), the exact copy, a reserved blank area for the logo, and the cover passed as a reference so pages match. The AI never draws the logo.
3. Check each page: a vision model reads the text in the image and compares it to the planned copy; regenerate a page up to 2 times; if it still fails, use the HTML page for that page. Keep the check ON.
4. Code overlays the real logo unchanged, the page number and "Prepared by Nebulaa" (use `sharp`/`canvas`), adds a small "Illustrative imagery" note where AI-made people appear, and never presents generated people as real customers.
5. Merge pages into one PDF (needs a new dependency such as `pdf-lib`; none exists in `backend/package.json` today) and store it; the app shows page previews and a download button.
6. Quarks: add the OpenAI image rate to `backend/config/apiCosts.js` PROVIDER_RATES (verify the current price; do not guess), derive an action cost for a full image Blueprint like every other cost (never hard-code a Quark price), charge once and refund once on failure like the existing Blueprint runner (`backend/services/blueprint/runner.js`, `service.js`). Suggested free offer: free accounts get the HTML Blueprint plus an image cover and two sample pages; the full image PDF costs Quarks. Per-page retry for a failed page without redoing the rest. The cost is real money: model it per sign-up before deciding to make the full PDF free; keep one free Blueprint per verified email and per business and the IP limits already built.
7. Tests with a fake image provider and a fake vision checker (no real calls). One owner-approved real run at the end, with the image spend stated first.

## 4. Unproven things (do not claim they work)

- Hero video with the new default reference set; `gemini-3.5-flash-lite` and the OpenAI fallback on the live keys; the brand-colour auto-capture with a real upload and the screen picker; video publishing and Google Business through Ayrshare; Razorpay live flows and add-on cancellation; staff screens with real data volumes (everything was checked on made-up data); real emails.

## 5. Questionnaire / business profile audit (not yet redone)

Findings (code: `backend/models/User.js` businessProfile, `frontend/types.ts`, `frontend/pages/Settings.tsx` around the business profile form, `frontend/components/onboarding/onboardingStrings.ts`):
- Geographic reach offers only `hyperlocal`, `local_city`, `regional`: no State, All India or International. Replace with Neighbourhood, City, State, All India, International (allow several) and keep old values loading.
- Target gender (`mostly_men`, `mostly_women`, `both_equally`, `families`) does not fit B2B and invites stereotypes: make it optional, off by default, hidden for B2B; ask "who buys from you" instead.
- No B2B branch (company size, decision maker, sales cycle).
- `ContentLanguage` in `types.ts` still allows only tamil/english/tamil_english_mix while onboarding offers 12 languages.
- Brand voice and goals are choices in onboarding but comma-separated text in Settings; some fields are labelled "CSM-filled" but shown to customers; industry list is retail-heavy.
Do a short design pass with the owner, then data change with backward compatibility, then check the monthly planner reads the new fields. The owner filled his own Nebulaa test-account profile by hand from answers drafted in chat; those fields are his wording, not defaults.

## 6. Owner decisions waiting

- Old "Content Strategy PDF" button in Settings: replace it with the Growth Blueprint (recommended) or keep it.
- Staff-area definitions (client-status definitions are in hand-over 3 section 6): trial-to-paid counts every sign-up in the window; accounts with no plan show "Managed · trial" forever; Admin sees "Added Quarks" in client history; removing a CSM only unassigns their clients; "Last active" is last login only.
- Coupons only record metadata; keep or remove.
- Owner panel on the Money page for the Ayrshare suspension-risk numbers (the old admin panel was dropped).
- Whether the full image Blueprint PDF is free or costs Quarks (section 3).
- Terms of Service and Privacy Policy were rewritten by Claude; the owner said that is acceptable (they were AI-written before too). Have them read once by a person before relying on them.

## 7. Rules (unchanged, full list in hand-over 3 section 9)

Never run a real video, image or provider spend without the owner's OK for that run. Never run the app against a database other environments use; use throwaway data. Never read or print `.env` or secrets. No keys, build output or `node_modules` symlinks in commits. Do not touch the Kling files. Customers never see vendor names, raw errors or the words Gravity, Pulsar or Orbit; "Quarks" stays. The owner runs releases (`release-prod.sh` asks him to type DEPLOY); batch fixes into one release. Say plainly what is untested; read test output before committing and never commit over a failing test. Be cost-conscious: mid-tier models for routine work, one review at the end.
