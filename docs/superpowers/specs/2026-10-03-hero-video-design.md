# Hero Video (Seedance) — Design

Status: draft for user review. Branch: `dev-dk`.

## Purpose

Gravity's current reel flow (Kling, scene by scene, `/reels`) stays exactly as is. Add a parallel **Hero video** path: one Seedance 2.0 generation of up to 15 s at 720p with native audio (music, SFX, lip-synced dialogue), driven by a single multi-cut prompt. It is the premium, cinematic/UGC-style deliverable; the rest of a client's monthly videos remain Kling reels.

Success: a CSM picks a concept, reviews/edits a generated hero prompt, presses Generate, and receives a playable 15 s 9:16 clip. A client gets at most 2 hero clips per calendar month. A failed generation costs the client neither Quarks nor quota.

## Decisions already made (user)

- Branch point: after the concept is accepted in the existing Reel wizard (Step 1).
- Limit: 2 hero clips per client per month, 720p, up to 15 s. Everything else stays on the old workflow.
- "Client" = one user account (managed service: one account per client).
- Pricing derives from `backend/config/apiCosts.js`; no hardcoded Quark number. Charged via `deductCredits`, refunded via `refundCredits`.
- Quota is derived by counting jobs, not a new field on `User`.
- Allowance sizing (5,000 Quarks/month vs. 2 heroes) is a business setting outside this feature.

## Out of scope (v1)

1080p, durations over 15 s, multi-clip chaining, the ffmpeg realism pass (documented in the `ai-video-studio` plugin, not wired), Seedance 2.5 / Kling 3.0, merging a hero into the Kling timeline, scheduling/posting the result, per-workspace quotas.

## Architecture

All additive. No existing function in `videoService.js` or `videoGeneration.js` changes.

### Backend

1. **`backend/services/heroVideoService.js` (new)**
   - `buildHeroInput({ prompt, refImageUrls, aspectRatio })` → fal input for Seedance (pure; unit-testable). Fixed: 720p, `duration` 15 (clamped 4–15), audio on. 9:16 default; allows 16:9 and 1:1.
   - `submitHeroClip(input)` → `fal.queue.submit(model, { input })`, returns `requestId`.
   - `getHeroClipStatus(requestId)` → `{ state: 'queued'|'processing'|'completed'|'failed', videoUrl?, error? }`.
   - Model ids from env with defaults (`FAL_HERO_TEXT_MODEL`, `FAL_HERO_REF_MODEL`): text-to-video when no references, reference-to-video when 1–4 references. Exact endpoint ids and parameter names are verified against fal's live model pages in the first task and recorded in the file header; the existing `getFalClient()` pattern is reused (not the legacy Kling input builder).
   - Queue submit + status polling (not a blocking `subscribe`) so a job survives an ECS task restart.

2. **`backend/config/apiCosts.js` (modify)**
   - `PROVIDER_RATES.seedance_720p_per_sec = 0.3034` (annotated: list price, verify against first invoice).
   - `ACTION_USD.hero_video_clip` = rate × 15 + `assetCost` for one stored clip.
   - Margin: `MARGIN.hero_video_clip = 3.2` (same as other video actions). Result ≈ 728 Quarks; computed, not written.
   - Add `ACTION_UNITS.hero_video_clip = 'per clip'`; flows to `QUARK_COSTS` and `CREDIT_COSTS` automatically.

3. **`backend/services/promptRegistry.js` (modify)** — new entry `hero_video.plan` (stage `hero_video`), editable in Prompt Studio like `linkedin.content`. Variables: brand context, concept (title, story summary, emotion, visual style), duration, aspect, language, whether references exist. Template encodes the `seedance-hero-video` skill's 11-block anatomy (LOOK, CONTEXT, REFS, HEADCOUNT, CAMERA, STAGING, ACTION TIMED, ACTING, DIALOGUE LOCK, SFX, NEGATIVES), dialogue word budget (~35–40 words per 15 s), and the integrity rules (no invented proof or stats, generated people are not customers). Output strict JSON: `{ prompt, beatSheet[], dialogue, qaChecklist[], assumptions[] }`.

4. **`backend/routes/heroVideo.js` (new), mounted at `/api/hero-video` in `server-main.js`** — all routes `protect`, `checkTrial`, existing limiters.
   - `GET /quota` → `{ used, limit, resetsOn }`.
   - `POST /plan` `{ concept, aspectRatio, language, refImageUrls? }` → runs `hero_video.plan` through `callTextLLM`/`parseGeminiJSON`. No Quark charge (text call, cents); counts against nothing.
   - `POST /generate` `{ prompt, refImageUrls?, aspectRatio }`:
     1. validate prompt (non-empty, length cap) and that refs are public https URLs (≤ 4);
     2. quota check (below) → 403 `{ quotaExhausted: true, used, limit }`;
     3. `deductCredits(userId, 'hero_video_clip', 1, 'Hero video')` → 403 `{ creditsExhausted: true }`;
     4. create `VideoJob` with `metadata.kind = 'hero'`, store payload, `submitHeroClip`, save `metadata.falRequestId`, status `processing`; on submit error refund and mark failed;
     5. return `{ jobId }`.
   - `GET /jobs/:jobId` (owner only): while non-terminal, calls `getHeroClipStatus`; on completion copies the video to Cloudinary via the existing upload helper and stores `result.videoUrl`; on failure sets `failed` and refunds exactly once (guarded by `metadata.refunded`). Returns `{ status, progress?, videoUrl?, error? }`.
   - `GET /jobs` (owner, `metadata.kind='hero'`, newest first, limit 20) for history.

5. **Quota** — `heroQuotaForUser(userId, now)` in `heroVideoService.js`: count of the user's `VideoJob` with `metadata.kind='hero'`, `createdAt` ≥ start of the current UTC calendar month, status in `queued|processing|completed`. Failed/cancelled jobs do not count (they were refunded). Limit = `HERO_VIDEO_MONTHLY_LIMIT` env, default 2. Race note: two simultaneous generates could both pass the check; acceptable at this scale because each is separately paid, and the check re-runs after job creation (if over the limit, cancel and refund the newer job).

6. **`VideoJob` model** — no schema change (`metadata` and `payload` are Mixed). Hero jobs are distinguished by `metadata.kind`. Existing queue/worker ignores them because they never enter `videoGenerationQueue`.

### Frontend

- `frontend/pages/HeroVideo.tsx` (new), route `/reels/hero` in `App.tsx`. Receives the accepted concept via router state (falls back to the persisted workspace used by `ReelGenerator`). Layout: concept summary, optional reference images picker (existing brand-assets list), **Build prompt** → editable prompt + beat sheet + QA checklist, quota line ("1 of 2 hero videos used this month"), Quark price from `CREDIT_COSTS`, **Generate**, progress state, result player with download. Uses the Gravity primitives and respects the light/dark tokens.
- `frontend/pages/ReelGenerator.tsx` (modify, minimal): once `acceptedConcept` exists, show one extra button "Make a Hero video instead" that navigates to `/reels/hero` with the concept. No other wizard logic changes.
- `frontend/services/api.ts`: `heroVideoAPI.{quota, plan, generate, job, list}`.

## Data flow

Concept accepted → `/plan` (LLM builds 11-block prompt) → user edits → `/generate` (quota → deduct → fal queue submit → job) → UI polls `/jobs/:id` (poll → complete → Cloudinary copy → `videoUrl`) → player.

## Error handling

| Case | Behaviour |
|---|---|
| Quota used up | 403 `quotaExhausted`, UI shows "resets on 1 Nov", no charge |
| Insufficient Quarks | 403 `creditsExhausted` (existing pattern) |
| fal submit error / content-safety rejection | job `failed`, refund, message shown, no quota used |
| fal failure on poll | `failed`, refund once, no quota used |
| ECS restart mid-generation | no loss; next poll resumes via stored `falRequestId` |
| Cloudinary copy fails | keep fal URL as `videoUrl` temporarily, log; job still `completed` |
| Missing `FAL_KEY` | 500 with clear message before any charge |

## Testing

- Unit (no DB/network): `buildHeroInput` (720p fixed, duration clamp, audio on, endpoint choice by refs), cost derivation (`QUARK_COSTS.hero_video_clip` equals formula; rate change reprices), quota counting window and status filter, refund-once guard, refs validation.
- Route tests with mocked fal client and mocked `deductCredits` (success, quota, credits, submit failure refund, failed-poll refund once).
- Frontend: type-check and build; manual walkthrough once Atlas access is restored.
- **No live Seedance call until the user approves spending** (one 15 s clip is ≈ $4.55 vendor cost). Live verification is a single test generation on the user's `FAL_KEY`.
- End-to-end needs MongoDB Atlas reachable from this machine (currently blocked by the IP allowlist).

## Risks

- fal endpoint ids/params for Seedance 2.0 and reference-to-video must be checked against fal's live pages; the first task is a read-only verification and the model ids are env-overridable.
- Quark price (~728) exceeds a whole 5-scene reel (525); allowance sizing is the user's decision.
- 15 s multi-cut from one prompt is not confirmed by the provider docs; QA and retry guidance lives in the plugin's `qa-and-retry.md`.
