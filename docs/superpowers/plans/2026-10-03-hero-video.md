# Hero Video (Seedance) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a parallel "Hero video" path that makes one Seedance 2.0 clip (15 s, 720p, native audio) from a concept, limited to 2 per client per month, without changing the Kling reel pipeline.

**Architecture:** A small service layer (`heroVideoService.js` for fal + quota + input building, `heroVideoFlow.js` for start/poll logic with injected dependencies) behind thin Express routes at `/api/hero-video`. Generation uses fal's queue (submit, then poll by stored request id) so jobs survive restarts. Pricing derives from `apiCosts.js`. A new frontend page `/reels/hero` is reached from one button on the reel wizard.

**Tech Stack:** Node 24 / Express / Mongoose (`VideoJob`), `@fal-ai/serverless-client`, Cloudinary via `imageUploader.js`, React + TypeScript frontend, `node --test` for backend tests (the repo has no test framework yet; use the built-in runner, files in `backend/tests/`).

**Spec:** `docs/superpowers/specs/2026-10-03-hero-video-design.md`

## Global Constraints

- Kling reel pipeline untouched: no edits to `generateVideoClip`, `videoGeneration.js`, `videoGenerationQueue.js`, or the `VideoJob` schema.
- Resolution fixed at `720p`; duration max 15 s; audio on; default aspect `9:16` (also `16:9`, `1:1`).
- References: 0 to 4 public `https://` image URLs.
- Never hardcode a Quark number; price is `CREDIT_COSTS.hero_video_clip` derived via `PROVIDER_RATES → ACTION_USD → QUARK_COSTS`. Vendor rate `0.3034` USD/s, margin `3.2`.
- Quota: counts the user's `VideoJob` with `metadata.kind = 'hero'`, status in `queued|processing|completed`, `createdAt` >= start of current UTC month. Limit from `HERO_VIDEO_MONTHLY_LIMIT`, default `2`.
- A failed generation refunds Quarks exactly once and does not count against quota.
- Model ids from env `FAL_HERO_TEXT_MODEL` / `FAL_HERO_REF_MODEL`; real ids verified in Task 1.
- No live Seedance (fal) call anywhere in this plan's tasks. Tests use fakes.
- Commit trailer on every commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Double-click / two simultaneous Generate calls: must not create two paid jobs past the limit (Task 5 pins the post-create recheck).
- Reference URLs that are `http://`, `javascript:`, empty strings, or more than 4: rejected with 400, no charge (Task 1, Task 5).
- Polling a finished-failed job repeatedly: refund happens once only (Task 5).
- Polling another user's job id: 404, no data leak (Task 5).
- fal reports completed but returns no video URL: job fails and refunds rather than showing an empty player (Task 3, Task 5).
- Month boundary: quota window is UTC calendar month; a job created 23:30 UTC on the 31st does not count next month (Task 1).

---

### Task 1: Hero input builder, refs validation and quota math

**Files:**
- Create: `backend/services/heroVideoService.js`
- Test: `backend/tests/heroVideoService.test.js`

**Interfaces:**
- Consumes: `HERO_CLIP_SECONDS` from `backend/config/apiCosts.js` (added in Task 2; until then import with a local fallback of `15` and replace in Task 2).
- Produces (exports): `HERO_RESOLUTION = '720p'`, `HERO_MAX_REFS = 4`, `buildHeroInput({ prompt: string, refImageUrls?: string[], aspectRatio?: '9:16'|'16:9'|'1:1', duration?: number }) -> { model: string, input: object }`, `validateRefUrls(urls: unknown) -> string[]`, `heroMonthlyLimit() -> number`, `monthStartUTC(now?: Date) -> Date`, `nextMonthStartUTC(now?: Date) -> Date`, `getHeroQuota(userId, now?: Date, JobModel?) -> Promise<{ used: number, limit: number, resetsOn: string }>`.

- [ ] **Step 1: Verify fal's Seedance 2.0 endpoints (read-only research)**

Use WebFetch on fal's Seedance 2.0 text-to-video and reference-to-video model pages (find them via `https://fal.ai/models` search for "seedance 2.0"). Record in the header comment of `heroVideoService.js`: the exact endpoint ids, the input parameter names for prompt, duration (string or number), resolution, aspect ratio, audio toggle, and the reference image parameter (name and whether it is an array), plus the output shape (path to the video URL). If a fact cannot be confirmed from the page, say so in the comment and in the report; do not guess silently.

- [ ] **Step 2: Write failing tests** in `backend/tests/heroVideoService.test.js` using `node:test` and `node:assert/strict`:
  - `buildHeroInput` with no refs returns the text model id and `input.resolution === '720p'`, duration 15, audio enabled, aspect `9:16`.
  - With 2 valid https refs returns the reference model id and both URLs in the reference parameter.
  - `duration: 99` clamps to 15; `duration: 2` clamps to 4.
  - Throws on empty/whitespace prompt; throws with 5 refs; throws for `http://x`, `javascript:alert(1)`, `''`, and non-array/non-string entries.
  - `monthStartUTC(new Date('2026-10-31T23:30:00Z'))` equals `2026-10-01T00:00:00.000Z`; `nextMonthStartUTC` of the same equals `2026-11-01T00:00:00.000Z`.
  - `heroMonthlyLimit()` returns 2 by default and 5 when `HERO_VIDEO_MONTHLY_LIMIT='5'`; returns 2 for `'abc'` or `'0'`... (0 is invalid: fall back to 2).
  - `getHeroQuota('u1', now, fakeModel)` where `fakeModel.countDocuments(filter)` records its filter: assert the filter has `userId: 'u1'`, `'metadata.kind': 'hero'`, `status: { $in: ['queued','processing','completed'] }`, `createdAt: { $gte: monthStartUTC(now) }`, and the returned `{ used, limit, resetsOn }` uses the fake's count and `nextMonthStartUTC(now).toISOString()`.

- [ ] **Step 3: Run** `cd backend && node --test tests/heroVideoService.test.js`. Expected: FAIL (module not found).

- [ ] **Step 4: Implement** the exports above in `backend/services/heroVideoService.js`. `JobModel` defaults to `require('../models/VideoJob')` loaded lazily inside `getHeroQuota` so the module imports without Mongo. Model id defaults come from the Task 1 research; read `process.env.FAL_HERO_TEXT_MODEL` / `FAL_HERO_REF_MODEL` at call time.

- [ ] **Step 5: Run** the same command. Expected: all PASS.

- [ ] **Step 6: Commit** `git add backend/services/heroVideoService.js backend/tests/heroVideoService.test.js && git commit -m "feat: hero video input builder, refs validation, monthly quota"`.

### Task 2: Seedance rate and hero price in apiCosts

**Files:**
- Modify: `backend/config/apiCosts.js` (add to `PROVIDER_RATES`, `ACTION_USD`, `MARGIN`, `ACTION_UNITS`, module exports)
- Modify: `backend/services/heroVideoService.js` (import `HERO_CLIP_SECONDS` instead of the local fallback)
- Test: `backend/tests/heroPricing.test.js`

**Interfaces:**
- Produces: `PROVIDER_RATES.seedance_720p_per_sec = 0.3034`, `HERO_CLIP_SECONDS = 15` (exported), `ACTION_USD.hero_video_clip`, `QUARK_COSTS.hero_video_clip`, `ACTION_UNITS.hero_video_clip = 'per clip'`.

- [ ] **Step 1: Write failing test** asserting: `ACTION_USD.hero_video_clip` equals `PROVIDER_RATES.seedance_720p_per_sec * HERO_CLIP_SECONDS + assetCost(INFRA.mb_per_scene_clip)` (compute `assetCost` in the test from `INFRA` the same way the file does: `(mb/1024)*cloudinary_per_gb*(1+deliveries_per_asset)`); `QUARK_COSTS.hero_video_clip === Math.max(1, Math.round(ACTION_USD.hero_video_clip * 3.2 / USD_PER_QUARK))`; the value is between 700 and 760; `require('../middleware/trialGuard').CREDIT_COSTS.hero_video_clip` equals it (guard requires Mongo models: if requiring trialGuard in a test needs a DB, skip this assertion and instead assert `CREDIT_COSTS` is built from `QUARK_COSTS` by reading how trialGuard defines it).
- [ ] **Step 2: Run** `cd backend && node --test tests/heroPricing.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the four additions in `apiCosts.js` with annotated comments in the file's existing style (list price, verify on first invoice; why the margin is 3.2). `assetCost` and `INFRA` already exist in the file.
- [ ] **Step 4: Run** the test plus `node --test tests/`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Seedance hero clip rate and derived Quark price`.

### Task 3: fal queue submit, status and storage copy

**Files:**
- Modify: `backend/services/heroVideoService.js`
- Test: `backend/tests/heroVideoFal.test.js`

**Interfaces:**
- Consumes: `getFalClient()` pattern from `backend/services/videoService.js` (dynamic import of `@fal-ai/serverless-client`, `fal.config({ credentials: FAL_KEY })`). Do not import `generateVideoClip`; copy the small client-bootstrap (or export `getFalClient` from videoService if it is not exported yet, with no behaviour change).
- Produces: `submitHeroClip({ model, input }, fal?) -> Promise<string>` (request id), `getHeroClipStatus(model, requestId, fal?) -> Promise<{ state: 'queued'|'processing'|'completed'|'failed', videoUrl?: string, error?: string }>`, `copyClipToStorage(remoteUrl: string) -> Promise<string>` (Cloudinary URL; on any failure returns the original `remoteUrl` and logs).

- [ ] **Step 1: Write failing tests** with a fake `fal` object (`queue.submit`, `queue.status`, `queue.result`): submit returns `request_id`; status maps fal `IN_QUEUE`→`queued`, `IN_PROGRESS`→`processing`; `COMPLETED` + result containing a video URL (at the output path recorded in Task 1) → `completed` with `videoUrl`; `COMPLETED` with no URL → `failed` with an error message; a thrown error from `queue.result` → `failed` with the message; missing `FAL_KEY` (when no fake is injected) throws a clear error before any network call. `copyClipToStorage` is tested only for the failure fallback (inject a throwing downloader parameter or stub `downloadVideoFromUrl`).
- [ ] **Step 2: Run** `node --test tests/heroVideoFal.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** `copyClipToStorage` downloads with `downloadVideoFromUrl` (`backend/services/videoDownload.js`; read its signature first) to a temp file then `uploadVideoFile(path, 'nebula-hero-videos')` from `imageUploader.js`, and deletes the temp file in `finally`.
- [ ] **Step 4: Run** `node --test tests/`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: hero clip fal queue submit/status and storage copy`.

### Task 4: `hero_video.plan` prompt and Prompt Studio stage

**Files:**
- Modify: `backend/services/promptRegistry.js` (new entry after `linkedin.content`, stage `'hero-video'`)
- Modify: `frontend/components/PromptStudio.tsx` (`STAGE_ORDER`, `STAGE_LABELS`: `'hero-video': 'Hero videos'`)
- Test: `backend/tests/heroPrompt.test.js`

**Interfaces:**
- Produces: registry key `hero_video.plan` with variables `brandContextBlock, conceptTitle, conceptStory, conceptEmotion, conceptVisualStyle, duration, aspectRatio, language, hasReferences`; `buildPrompt(userId, 'hero_video.plan', vars)` output is a string containing all variable values; the model's JSON contract is `{ "prompt": string, "beatSheet": [{ "time": string, "beat": string }], "dialogue": string, "qaChecklist": string[], "assumptions": string[] }`.

- [ ] **Step 1: Write failing test** that loads the registry's default template for `hero_video.plan` (read how `promptRegistry.js` exposes defaults without a DB; if `buildPrompt` needs `PromptOverride` lookups, test the exported default-template map instead) and asserts: every `{{variable}}` in the template is declared in `variables`; the template names all 11 blocks (`LOOK`, `CONTEXT`, `REFS`, `HEADCOUNT`, `CAMERA`, `STAGING`, `ACTION`, `ACTING`, `DIALOGUE`, `SFX`, `NEGATIVES`); contains the dialogue budget rule (35-40 words per 15 s) and the instruction not to invent statistics or present generated people as real customers; and contains the JSON keys above.
- [ ] **Step 2: Run** `node --test tests/heroPrompt.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the entry. Source the block definitions and worked example from `/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/ai-video-studio/skills/seedance-hero-video/references/prompt-anatomy.md`, `dialogue-audio.md` and `SKILL.md` (read them; condense into the template; keep the integrity rules). Add the stage to `PromptStudio.tsx`.
- [ ] **Step 4: Run** `node --test tests/` and `cd frontend && npx tsc --noEmit` (if a tsc config exists; otherwise note it). Expected: PASS / no new type errors.
- [ ] **Step 5: Commit** `feat: hero_video.plan prompt (11-block Seedance anatomy)`.

### Task 5: Start/poll flow with credits, quota and refunds

**Files:**
- Create: `backend/services/heroVideoFlow.js`
- Test: `backend/tests/heroVideoFlow.test.js`

**Interfaces:**
- Consumes: from Task 1 `buildHeroInput`, `getHeroQuota`, `validateRefUrls`; from Task 3 `submitHeroClip`, `getHeroClipStatus`, `copyClipToStorage`; `deductCredits(userId, 'hero_video_clip', 1, desc) -> Promise<{ success: boolean, error?: string }>` and `refundCredits(...)` from `backend/middleware/trialGuard.js`; `VideoJob` model.
- Produces: `startHeroGeneration(deps, { userId, body }) -> Promise<{ status: number, json: object }>` and `pollHeroJob(deps, { userId, jobId }) -> Promise<{ status: number, json: object }>`, where `deps = { JobModel, quotaFn, deduct, refund, submit, getStatus, copyToStorage, now: () => Date }` so tests inject fakes.
- Response contracts: start → `200 { success: true, jobId }`; `400 { success:false, message }` (empty prompt, bad refs); `403 { success:false, quotaExhausted:true, used, limit }`; `403 { success:false, creditsExhausted:true, message }`; `500` on submit failure after refund. Poll → `200 { success:true, status, videoUrl? , error? }`; `404` for unknown or other-user job.

- [ ] **Step 1: Write failing tests** with in-memory fakes for every dep:
  - happy path: quota ok, deduct ok, job saved with `metadata.kind='hero'` and `metadata.falRequestId`, status `processing`, returns jobId.
  - quota exhausted: no deduct call, 403 `quotaExhausted`.
  - credits exhausted: no job created, 403 `creditsExhausted`.
  - submit throws: refund called once, no job left counting toward quota (job marked `failed`), 500.
  - post-create recheck: when two jobs exist after creation and used > limit, the newer job is cancelled and refunded (simulate by making `quotaFn` return `used: limit+1` on its second call).
  - bad refs (`http://`, 5 refs): 400, deduct not called.
  - poll completed: stores `result.videoUrl` (the `copyToStorage` return value), status `completed`, `completedAt` set; polling again does not call `getStatus` again.
  - poll failed: refund called once; polling twice still one refund (guard via `metadata.refunded`, set with an atomic `findOneAndUpdate` filtered on `'metadata.refunded': { $ne: true }`).
  - poll completed with no video URL (from `getStatus` returning `failed`): refund once.
  - other user's job id: 404 and no `getStatus` call.
- [ ] **Step 2: Run** `node --test tests/heroVideoFlow.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** both functions plus `defaultDeps()` that wires the real `VideoJob`, `getHeroQuota`, `deductCredits`, `refundCredits`, and Task 3 functions. Job id via `crypto.randomUUID()`. Job `payload` stores `{ prompt, refImageUrls, aspectRatio, model }`; never log the user's prompt at info level.
- [ ] **Step 4: Run** `node --test tests/`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: hero video start/poll flow with quota, credits and refund-once`.

### Task 6: Routes and server mount

**Files:**
- Create: `backend/routes/heroVideo.js`
- Modify: `backend/server-main.js` (require near line 99; `app.use('/api/hero-video', heroVideoRoutes)` next to line 447)
- Test: `backend/tests/heroVideoRoutes.test.js`

**Interfaces:**
- Consumes: Task 5 functions; `protect` from `../middleware/auth`; `checkTrial` from `../middleware/trialGuard`; `toUserId` from `../services/videoDraftStore`; `buildPrompt` from `../services/promptRegistry`; `callTextLLM` from `../services/openAI`; `parseGeminiJSON` from `../services/geminiAI`; `getHeroQuota`.
- Produces: `GET /quota`, `POST /plan`, `POST /generate`, `GET /jobs/:jobId`, `GET /jobs`. Own `express-rate-limit` limiters copied from the pattern in `videoGeneration.js` (write limiter 100/15min on `/plan` and `/generate`; read limiter 2000/15min on the others), keyed by user id.
- `POST /plan` body `{ concept: { title, storySummary, coreEmotion, visualStyle }, aspectRatio?, language?, refImageUrls? }`; calls `buildPrompt(req.user.id, 'hero_video.plan', ...)` with brand context from the user's `businessProfile` (same fields `generateConcepts` reads), runs `callTextLLM(prompt, { jsonMode: true, maxTokens: 3000 })`, parses, and returns `{ success: true, plan: { prompt, beatSheet, dialogue, qaChecklist, assumptions } }`; `502` when the model returns no `prompt`; `400` when the concept is missing.

- [ ] **Step 1: Write failing test** that requires the router module with fake auth/limiters unavailable: assert `require('../routes/heroVideo')` exports an Express router with the five route paths and methods (inspect `router.stack`), and that every route has `protect` before its handler. Plan-parsing logic lives in an exported pure helper `normalizePlan(parsed) -> plan | null` tested for: missing prompt → null; non-array beatSheet → `[]`; trims strings.
- [ ] **Step 2: Run** `node --test tests/heroVideoRoutes.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the router and mount it. Handlers delegate to `startHeroGeneration` / `pollHeroJob` and send `{status, json}` verbatim; errors use a small local `try/catch` returning `500 { success:false, message }`.
- [ ] **Step 4: Run** `node --test tests/` and `cd backend && node -e "require('./routes/heroVideo')"` (loads without throwing; Mongo not required for require). Expected: PASS, no error.
- [ ] **Step 5: Commit** `feat: /api/hero-video routes`.

### Task 7: Frontend API, Hero video page, entry button

**Files:**
- Modify: `frontend/services/api.ts` (add `heroVideoAPI` after `videoGenerationAPI`)
- Create: `frontend/pages/HeroVideo.tsx`
- Modify: `frontend/App.tsx` (import + `<Route path="/reels/hero" element={<HeroVideo />} />` beside `/reels`)
- Modify: `frontend/pages/ReelGenerator.tsx` (one button; locate where the concept is accepted in Step 1 by searching `setAcceptedConcept`; render "Make a Hero video instead" when `acceptedConcept` exists, `navigate('/reels/hero', { state: { concept: acceptedConcept, aspectRatio } })`; touch nothing else)

**Interfaces:**
- Produces: `heroVideoAPI.quota() -> Promise<{ success, used, limit, resetsOn }>`, `.plan(payload) -> Promise<{ success, plan? }>`, `.generate({ prompt, refImageUrls, aspectRatio }) -> Promise<{ success, jobId?, quotaExhausted?, creditsExhausted?, message? }>`, `.job(jobId) -> Promise<{ success, status, videoUrl?, error? }>`, `.list()`. Use the same `apiCall` helper the neighbours use, against `/api/hero-video` (check how `videoGenerationAPI` builds its base path).
- Page behaviour (all states reachable without a backend change): reads the concept from router state, else shows a "pick a concept in Reels first" message with a link; loads quota and brand images (`videoGenerationAPI` brand-assets list, existing endpoint `/brand-assets/images`) for up to 4 selectable references; **Build prompt** calls `plan` and shows the editable prompt, beat sheet, dialogue and QA checklist; shows "X of Y hero videos used this month" and the price `CREDIT_COSTS`-equivalent Quarks (fetch from the existing credits/costs API if the frontend already exposes it, otherwise omit the number rather than hardcode one); **Generate** is disabled when quota is used up or prompt is empty; polls `job` every 5 s until `completed`/`failed` and cleans its interval on unmount; shows a `<video controls playsInline>` with a download link on completion and the error text on failure. Uses the Gravity primitives from `components/gravity` and theme tokens from the light-mode work; no hardcoded dark-only colors.

- [ ] **Step 1:** Implement `heroVideoAPI` and types in `api.ts`; run `cd frontend && npx tsc --noEmit` (or the project's type-check script; check `frontend/package.json`). Expected: no new errors.
- [ ] **Step 2:** Build `HeroVideo.tsx` and the route; type-check again.
- [ ] **Step 3:** Add the button to `ReelGenerator.tsx`; type-check; run `cd frontend && npm run build`. Expected: build succeeds.
- [ ] **Step 4:** Visual check via `preview_start` (see `nebulaa-gravity-local-setup` memory; if the backend cannot connect to Atlas the page's empty/error states are still checkable) in light and dark mode at desktop and mobile widths; report anything that could not be verified.
- [ ] **Step 5: Commit** `feat: Hero video page and entry from reel wizard`.

### Task 8: Env docs and wrap-up

**Files:**
- Modify: `backend/.env.example` (create the lines in the existing style if the file exists; otherwise append a short section to `docs/superpowers/specs/2026-10-03-hero-video-design.md` under "Configuration")

- [ ] **Step 1:** Document `HERO_VIDEO_MONTHLY_LIMIT` (default 2), `FAL_HERO_TEXT_MODEL`, `FAL_HERO_REF_MODEL`, and that `FAL_KEY` is required.
- [ ] **Step 2:** Run `cd backend && node --test tests/` and the frontend build once more. Expected: all pass.
- [ ] **Step 3: Commit** `docs: hero video configuration`.
