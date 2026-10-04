# Nebulaa redesign — hand-over (resume here)

Written 2026-10-04 at the end of a long session. Read this file first, then the docs it points to. Branch: `nebulaa-redesign` (built on top of `dev-dk` @ `11e0954`, the finished Hero Studio work). Worktree path used so far: `~/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign`. **Nothing has been pushed anywhere.** Everything below is committed locally.

## What the owner asked for (Dinesh, 2026-10-03/04)

1. Finish Hero Studio first (done, see below).
2. Rebuild the Gravity app UI to match the Nebulaa website: warm, light, friendly. **Light only** (no dark theme, toggle removed).
3. Customers see **Nebulaa** (two a's) only. No Gravity / Pulsar / Orbit names anywhere customer-facing. Use the **new** logo from the website project (`logo-nebulaa.png`: navy wordmark with the warm sun), not the old black "Founder OS" one.
4. Inside the app, a switcher for the other areas: **Content** (active), **Outreach** and **Lead generation** shown but disabled, "Coming soon". Do not connect those apps yet. Later the whole app moves to `app.nebulaa.ai`.
5. The landing page, sign-in and onboarding form were **already built in a different session** (the website build). Do not redo them; they were brought in as-is.
6. Text unreadable on many pages: fix contrast properly.
7. Rewrite the app's own language like the website was rewritten: complete, plain, professional sentences. No Gen Z / social-media tone, no short bursts, no personified software. **Do not change the voice of AI-written content** (backend prompts for captions, replies, scripts): the owner said no. "Quarks" keeps its name. Navigation names were approved (see voice spec).
8. Check for deployment conflicts after the redesign.

## State of each part

| Part | State | Where |
|---|---|---|
| Hero Studio (8 tasks + final fixes) | **Done**, reviewed, 180 backend tests pass | branch `dev-dk` @ `11e0954`; read `docs/superpowers/HANDOFF-hero-studio.md` |
| Foundation: tokens, font, logo, light-only, shell, app switcher | Done, reviewed | commits `b1b375c`..`63933e8` |
| "Gravity" -> "Nebulaa" text, frontend + backend display strings | Done, reviewed (scanner test guards the frontend) | `192135c`..`88f49a9` |
| Legibility pass (contrast): auditor, layer remap, page fixes | **Done**; audit gate passes 52/52 routes at 1280 and 375 (was 553 and 462 failing text items) | `eeb3751`..`ca831a9`; reports in `docs/superpowers/specs/assets/nebulaa-contrast-*.md` |
| Landing page, sign-in, onboarding from the other session | **Brought in** as final-state files | `1d60c87` |
| Voice rewrite, pass 1 (12 of the most visible files, 293 strings) | **Done but NOT reviewed** by anyone | `ab96f03`..`9941d70`; before/after table `docs/superpowers/specs/assets/nebulaa-voice-pass-1.md` |
| Invented figures removed (+12%, +3%, "Bengaluru") | Done | `b7ea913` |
| **Final whole-branch review** | **NOT done** (started, then stopped to save credits) | see "Do next" |
| Voice rewrite, later passes (the other ~25 pages) | Not started | see "Do next" |
| Deploy / push decision | Not decided; nothing pushed | see "Deploy notes" |

Test commands (all must stay green): `cd frontend && node --test tests/*.test.mjs` (47 pass, includes the brand-name scanner, voice scanner, contrast maths, audit gate, layer-lists determinism); `cd frontend && npx tsc --noEmit` (exactly **3** pre-existing errors: AdminDashboard, AdminLogin, Influencers); `cd backend && node --test tests/*.test.js` (180 pass; every file must exit by itself); `cd frontend && npm run build` (it writes into `backend/public`: afterwards run `git checkout -- backend/public && git clean -fdq backend/public` and commit nothing there).

## Do next (in this order)

1. **Final whole-branch review of `nebulaa-redesign`** (base `11e0954`, head = current). It was dispatched and stopped before reporting. Highest-value checks, none of which any reviewer has done yet:
   - **Voice pass safety** (done by one implementer, never reviewed): any changed string that is data or logic rather than display (object `value`/`id`/`key`/`path`, tab keys, option values sent to the backend, `htmlFor`/`id`, strings compared with `===`); facts and numbers preserved; no new product claims the code cannot back up (the BrandAssets "fallback mode" notice and the Performance "previous 7 days" label were the implementer's interpretation: verify); layout overflow from longer strings (nav labels, tab pills, buttons); other hard-coded fake figures in customer-visible text.
   - **Sign-up flow**: does `Auth.tsx` honour `/login?mode=signup` (the landing page's "Start free" navigates there, inside a HashRouter)? Does the shortened onboarding (26 -> 15 fields in the other session) still send what the backend profile route requires? A mismatch would break sign-up.
   - Light-only leftovers (`LogoSelector.tsx` reads `classList.contains('dark')`), the dev-only `/__onboarding-preview` route (must not ship), showcase asset sizes, build copies of `public/assets/*`.
   - Hygiene: no `.env` or keys, no `backend/public` build output, Kling files untouched, backend diff is display strings only.
2. **Voice rewrite, later passes**: the spec is `docs/superpowers/specs/2026-10-03-nebulaa-app-voice-design.md`; the authority is the website's `nebulaa-ai-website/.claude/brand-voice-guidelines.md`. Pass 1 skipped: `ReelGenerator.tsx` (5k lines), `Campaigns.tsx` (10k), classic `Dashboard.tsx`, `Analytics.tsx`, `Inventory.tsx`, `Competitors.tsx`, `AdCampaigns.tsx`, `TrialExpired.tsx`, admin pages, and the Terms/Privacy pages (legal register stays). Grow `frontend/tests/voice-scope.json` as each file is done; the scanner then guards it.
3. **Decisions only the owner can make**: see "Open questions".
4. **Push / PR**: nothing is pushed. `dev-dk` (Hero Studio) and `nebulaa-redesign` are local only. Do not push or open PRs without the owner's OK (shared branches).

## Hard rules (carried from the owner)

- **Never run a real video generation or any fal call without the owner's explicit OK for that specific run** (about US$4.55 plus 729 Quarks each). Tests use fakes. The first live Hero run with reference images is still unverified and needs his approval.
- Never run the app against a database other environments use. A real backend and the owner's own frontend were found listening on `localhost:5000` and `localhost:3000` during this work: never reuse those ports, never let a test page reach `:5000`. The audit tooling (`frontend/scripts/visual-audit`, README inside) runs on `127.0.0.1:3100` with a stub in the page and enforces this. Do not copy or create `.env` files.
- Do not touch the Kling pipeline files (`backend/services/videoService.js`, `routes/videoGeneration.js`, `videoGenerationQueue.js`, `models/VideoJob.js`).
- Do not edit `LandingPage.tsx`, `Auth.tsx`, `Onboarding.tsx`, `components/onboarding/*` except to fix real defects the review finds: they were designed in the website session and are already in the website voice.
- Do not change the AI-written content voice (backend prompts). Do not rename routes, files, API fields or DB fields (display text only).
- Integrity: no invented results, statistics, testimonials or cities; generated people are never presented as real customers.
- Never commit `.env`, keys, `backend/public` build output, or the `node_modules` symlinks. Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- The machine has no Homebrew/system Node: use nvm (`export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"`). In the worktrees `frontend/node_modules` and `backend/node_modules` are **symlinks** to the `hero-studio` worktree's installs (do not commit them; recreate with `ln -s` or run `npm ci`).

## Open questions for Dinesh

1. **Deploy path.** `nebulaa-redesign` is 82+ commits ahead of `origin/prod`: deploying it ships everything on `dev-dk` (Hero Studio and more), not just the redesign. The other session's `origin/rebrand-on-prod` (based on prod) carries the landing/sign-in/onboarding only and could go to production alone. Which route? (Memory note: `main` is not the latest; `test`/`dev-dk` is.)
2. **Terms page**: Terms 8.5 (trademark list) and the "Platform" definition no longer name Gravity/Pulsar. This is legal text: needs his sign-off.
3. **AI prompt text** still names the product "Gravity" in a few backend prompts (`socialInboxService.js:344`, `brandMemory.js:82/161`, `promptRegistry.js`). The model could echo it. He decided not to touch the AI voice; wording-only change of the product name is his call.
4. "Quarks" naming (kept for now). `constants/quarks.ts` ACTION_LABELS use emoji that show in Settings > Billing.
5. By-eye sign-offs recorded in `frontend/scripts/visual-audit/unknown-signoff.json` (trial-expired price text over a gradient, three Home photo tags, Campaigns placeholders over a glow): he may want to look.

## Deploy notes (analysis, nothing deployed)

- Website "Start free" points at `https://gravity.nebulaa.ai` (`nebulaa-ai-website/lib/contact.ts` `APP_URL`); changing to `app.nebulaa.ai` later is one line there.
- The app uses `HashRouter`; nginx `server_name _` accepts any host. Landing links look like `/#/terms`.
- Backend CORS: `BASE_ALLOWED_ORIGINS` in `backend/server-main.js` lacks `app.nebulaa.ai`; extend with the `CORS_ALLOWED_ORIGINS` env var (no code change).
- OAuth/social/calendar redirect URIs (Google, Meta, Twitter, LinkedIn, Pinterest, Google Calendar) come from env vars; a domain move means updating each provider console, the env, and probably Razorpay and Ayrshare.
- Hero Studio adds native deps to the backend image (node-canvas libs, ffmpeg-static): reviewed by reading only; the image build was never run. Stale Prompt Studio overrides of `hero_video.plan` are guarded in code.
- Website session branches: `origin/rebrand-on-prod` (prod base; includes the sign-up-focused landing `6ebb0b7`) and `origin/rebrand-nebulaa-landing` (dev-dk base; lacks `6ebb0b7`). The final-state files from both are already on this branch.

## Deferred minor findings (none blocking; triage in the final review)

Full per-task list is in `docs/superpowers/sdd-ledger-nebulaa-foundation.md` (the live copy is gitignored under `.superpowers/`). Highlights: brand scanner has contrived blind spots (single-quoted strings with ` /* `, trailing `// ... /*`); AppSwitcher polish (Tab-close focus, aria-current on a menuitem); audit tool limits (first screen only, no modals/hover, 5 sample points, tspan with own text -> unknown); the generated layer block in `index.html` is about 66 KB and new dark-era Tailwind classes must go through `frontend/scripts/visual-audit/gen-layer-lists.mjs` (a unit test fails when they are not classified); Facebook and Instagram brand tiles in `ConnectSocials.tsx` are icon-only and pass at 3:1; Hero Studio minors are in `HANDOFF-hero-studio.md`.

## What remains unverified

- Everything about Hero Studio's live behaviour (reference tags, face fidelity, logo/product rendering): needs a paid run with the owner's approval.
- The Docker image build; Safari/Firefox; real data states (everything was checked against a stubbed API in a browser at 1280 and 375 wide); modals other than the fixtures; the wizard "Make this a Hero video" bar in a browser; the other session's pages for contrast (they were excluded from the gate as designed in light; a one-off audit of `/`, `/login`, signup and onboarding is cheap to run with the audit tooling).
- The voice pass: nobody has read all 293 changed strings in context; the owner should skim `docs/superpowers/specs/assets/nebulaa-voice-pass-1.md`.

## Where things are

- Specs: `docs/superpowers/specs/2026-10-03-nebulaa-foundation-design.md`, `...-nebulaa-app-voice-design.md`, `...-hero-studio-design.md`.
- Plans: `docs/superpowers/plans/2026-10-03-nebulaa-foundation.md` (Tasks 1-5 foundation, addendum Tasks 6-8 legibility), `...-hero-studio.md`.
- Reports and evidence: `docs/superpowers/specs/assets/nebulaa-foundation-check.md`, `nebulaa-contrast-baseline.md`, `nebulaa-contrast-after-layer.md`, `nebulaa-voice-pass-1.md` (+ screenshot folders).
- Audit tooling: `frontend/scripts/visual-audit/README.md`.
- Workflow used: superpowers subagent-driven development (one implementer per task, a separate reviewer, fix rounds, one final whole-branch review). It worked, but it is expensive: per-task reviews on the largest model drove the cost. For the remaining work prefer a mid-tier model, one review at the end, and run the audit only per route.

## Prompt to paste into Claude Code for the next developer

```
You are taking over the Nebulaa app redesign (the product formerly called Gravity) in the repo Noburo-Business-Services-LLP/Marketing-agent---nebula. Work in the git worktree for branch `nebulaa-redesign` (it sits on top of `dev-dk`; if the worktree is missing, create one from that branch). Read docs/superpowers/HANDOVER-nebulaa-redesign.md first, then the voice spec (docs/superpowers/specs/2026-10-03-nebulaa-app-voice-design.md) and the progress ledger (docs/superpowers/sdd-ledger-nebulaa-foundation.md). Nothing has been pushed; do not push or open PRs without the owner's explicit OK.

State: Hero Studio is finished on dev-dk. On nebulaa-redesign the foundation (Nebulaa name and new logo, cream light-only theme, app switcher with Content active and Outreach/Lead generation "Coming soon"), the contrast pass (audit gate passes), the landing/sign-in/onboarding brought in from another session, and voice pass 1 (12 pages) are committed. NOT done: the final whole-branch review (it was stopped), later voice passes for the remaining pages, and the owner's decisions listed under "Open questions".

Do next, in order: (1) run the final whole-branch review of nebulaa-redesign against base 11e0954 using the checklist in the handover doc (especially: the voice pass was never reviewed; sign-up flow via /login?mode=signup and the 15-field onboarding payload vs the backend; light-only leftovers; hygiene); fix real findings in small commits. (2) Continue the voice rewrite page by page using the spec and the website's .claude/brand-voice-guidelines.md, adding each file to frontend/tests/voice-scope.json; do NOT change the AI-written content voice (backend prompts), do not rename routes/files/API fields, keep "Quarks". (3) Ask the owner the open questions (deploy path, Terms wording, AI prompt product name) before any deploy work.

Hard rules: never run a real video generation or any fal call without the owner's explicit OK for that run (about US$4.55 plus 729 Quarks); never run the app against a database other environments use; a real backend and the owner's frontend may be listening on localhost:5000 and :3000 — never use or reach them (use the audit tooling in frontend/scripts/visual-audit on 127.0.0.1:3100 with its stub); no .env, keys, backend/public build output or node_modules symlinks in commits; do not touch the Kling pipeline files; do not edit LandingPage/Auth/Onboarding/components/onboarding except to fix real defects; no invented results, figures or testimonials. Use nvm for Node. Keep these green: `cd frontend && node --test tests/*.test.mjs` (47), `npx tsc --noEmit` (exactly 3 pre-existing errors), `cd backend && node --test tests/*.test.js` (180). Be cost-conscious: use a mid-tier model for implementation, review once at the end, and audit single routes instead of the full audit unless you changed shared styles.
```
