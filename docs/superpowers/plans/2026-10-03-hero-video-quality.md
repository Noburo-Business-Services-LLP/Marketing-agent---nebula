# Hero Video Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the raw Seedance clip into a finished hero video: a story-first prompt with performance and sound direction (Part A), and a server-side finishing layer with realism grade, brand mark, fades, CTA end card, optional captions and loudness (Part B), plus three small fixes.

**Architecture:** Prompt v2 replaces the `hero_video.plan` template. A new self-contained `heroVideoFinish.js` (ffmpeg-static + node-canvas) runs inside the existing copy-lease section of `pollHeroJob`, with a hard fallback to the raw clip. The Hero page gains a Finish panel.

**Tech Stack:** Node 24 / Express / Mongoose, ffmpeg-static + ffprobe-static, node-canvas (already a dependency), `node --test`, React + TypeScript.

**Spec:** `docs/superpowers/specs/2026-10-03-hero-video-quality-design.md` (builds on `2026-10-03-hero-video-design.md`).

## Global Constraints

- Kling pipeline untouched: no edits to `videoService.js`, `routes/videoGeneration.js`, `videoGenerationQueue.js`, `models/VideoJob.js`, and no import of `videoGenerationPipeline.js` or `videoDraftStore.js` from hero code (they start timers).
- Hero jobs stay in `HeroVideoJob` (`hero_video_jobs`); quota (2/month), price (`CREDIT_COSTS.hero_video_clip`, derived) and the money path (deduct -> create -> recheck -> submit -> poll -> refund-once) are unchanged.
- A finishing failure or a finishing time over 120 s must never fail the job or lose the paid clip: deliver the raw clip as `videoUrl` and set `result.finishError` (plain language, no vendor/ffmpeg internals).
- Finishing happens at most once per job even under concurrent polls (inside the existing copy lease).
- Defaults: realism on, brand mark on when a logo exists, fades on, end card on (2.0 s), captions off, loudnorm on; `audioMode` default `native`.
- Output stays 720x1280 for 9:16 (and matching size for 16:9 / 1:1); the end card must match the clip's size, frame rate and audio format so concat is seamless.
- No user text may reach an ffmpeg filter string unescaped: end-card text is rendered by node-canvas to an image; captions go through an SRT file; only fixed, validated values enter filters.
- Remote fetches (logo) allow only `https:`, 10 s timeout, 5 MB cap.
- User-facing copy has no vendor/tool jargon. No prompt text in logs.
- Test command: `cd backend && node --test tests/*.test.js` (directory arg fails on Node 24; every file must exit by itself). Currently 95 tests pass.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. No live fal calls in any task.

## Review Focus

- Finishing throws, hangs or returns an empty file: the job still completes with the raw clip and a `finishError` (Task 4).
- Two polls race at completion: one finish, one upload (Task 4).
- CTA text containing quotes, colons, percent signs, emoji or very long strings does not break the render (Task 3).
- Audio stays continuous and in sync after the end card is appended; total duration equals clip + end card within 0.1 s (Task 3).
- Logo URL that is `http:`, huge, slow or not an image does not break finishing (Task 3).
- In native mode the template demands a real music line and never says "no music"; in sfx_only it says no music (Task 1).

---

### Task 1: Prompt v2 (`hero_video.plan`)

**Files:**
- Modify: `backend/services/promptRegistry.js` (the `hero_video.plan` entry)
- Modify: `backend/routes/heroVideo.js` (`/plan` passes the new variables; defaults)
- Modify/Test: `backend/tests/heroPrompt.test.js`, `backend/tests/heroVideoRoutes.test.js`

**Interfaces:**
- Produces: variables `brandContextBlock, conceptTitle, conceptStory, conceptEmotion, conceptVisualStyle, duration, aspectRatio, language, hasReferences, audioMode, ctaText, brandName`. `/plan` body adds optional `audioMode` (`'native'|'sfx_only'`, default `'native'`) and `ctaText` (string <= 60 chars). `normalizePlan(parsed)` additionally returns `story {hook,tension,turn,payoff,cta}` (strings, default `''`), `voice` (string), and `beatSheet[].emotion` (string, default `''`).

- [ ] **Step 1: Write failing tests** in `heroPrompt.test.js` (render the template with `audioMode:'native'` and `'sfx_only'`):
  - native output contains a music instruction and does NOT contain the phrases `no music`, `SFX only`, `overacting`, `Subtle expressions`;
  - sfx_only output contains `no music`;
  - both contain: a hook-in-first-2-seconds rule, `story` JSON key, `voice` JSON key, `emotion` per beat, a two-line / about-25-words dialogue limit, a rule against legible screens or text in frame, and the rule that no beat may add people beyond the declared HEADCOUNT;
  - no `{{` remains after rendering and every `{{var}}` is declared.
  In `heroVideoRoutes.test.js`: `/plan` passes `audioMode` (default native) and `ctaText` into `buildPrompt`; invalid `audioMode` -> 400; `normalizePlan` returns the new fields with safe defaults.
- [ ] **Step 2: Run** `cd backend && node --test tests/heroPrompt.test.js tests/heroVideoRoutes.test.js`. Expected: FAIL.
- [ ] **Step 3: Rewrite the template** per spec Part A rules 1-8 (read the existing entry and `/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/ai-video-studio/skills/seedance-hero-video/` + `ad-strategy-and-scripts/` + `remove-ai-look/references/prompt-realism-phrases.md` for wording; keep the 11-block numbering and integrity rules; JSON contract per Interfaces). Update `/plan` handler and `normalizePlan`. Keep the old test expectations that still apply (11 blocks, dialogue budget, integrity rules, no vendor words).
- [ ] **Step 4: Run** the two test files, then the full suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: hero prompt v2 - story arc, performance and sound direction`.

### Task 2: Finishing core (pure helpers + realism/fades/mark/loudnorm/captions)

**Files:**
- Create: `backend/services/heroVideoFinish.js`
- Test: `backend/tests/heroVideoFinish.test.js`

**Interfaces:**
- Produces: `normalizeFinishOptions(raw: unknown) -> { realism:boolean, brandMark:boolean, fades:boolean, endCard:{enabled:boolean, ctaText:string, website:string, tagline:string}, captions:boolean, loudnorm:boolean }` (defaults per Global Constraints; strings trimmed, `ctaText <= 60`, `tagline <= 80`, `website` must match a hostname or `https://` URL else `''`); `buildCaptionsSrt(beatSheet: {time:string, beat:string}[], dialogue: string) -> string` (SRT; cue time from each beat's `a-bs` range, text = the spoken line extracted from that beat's quoted text, beats without a quoted line produce no cue); `buildFinishFilterGraph(options, meta:{width,height,hasLogo,hasAudio,durationSeconds}) -> { videoFilter:string, audioFilter:string }`; `resolveFfmpegPath() -> string` (ffmpeg-static) and `runFfmpeg(args:string[], {timeoutMs?:number}) -> Promise<void>` (spawn, rejects on non-zero exit or timeout with a short plain error); `probeMedia(path) -> Promise<{width,height,fps,durationSeconds,hasAudio,sampleRate}>` using ffprobe-static.
- Does NOT yet render the end card or concat (Task 3); `finishHeroClip` is completed in Task 3.

- [ ] **Step 1: Write failing tests**: `normalizeFinishOptions` defaults and caps (`ctaText` of 200 chars -> 60, `website` `javascript:x` -> `''`, non-object input -> defaults, booleans coerced); `buildCaptionsSrt` on a 4-beat sheet with 2 quoted lines produces exactly 2 numbered cues with correct `HH:MM:SS,mmm` times and no cue for silent beats; `buildFinishFilterGraph` contains a `fade=t=in` when fades is true and not when false, a `loudnorm` in the audio filter only when loudnorm is true, the realism chain (`eq=`, `curves=`, `noise=`, `crop=`) only when realism is true, an `overlay` only when `hasLogo`, and never contains raw user strings; `runFfmpeg` rejects with a plain message on a bad argument list; `probeMedia` on a 2 s synthetic clip generated in the test with ffmpeg `lavfi` (`testsrc2=size=720x1280:rate=24` + `sine`) returns width 720, height 1280, hasAudio true.
- [ ] **Step 2: Run** `node --test tests/heroVideoFinish.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the exports in `heroVideoFinish.js`. Use the verified realism chain: `eq=contrast=0.90:saturation=0.92:gamma=1.03,curves=all='0/0.02 1/0.98',unsharp=5:5:-0.35:5:5:0,noise=alls=4:allf=t,scale=trunc(iw*1.05/2)*2:trunc(ih*1.05/2)*2,crop=W:H:x='(iw-W)/2+sin(2*PI*t*1.3)*7+sin(2*PI*t*3.1)*2.5':y='(ih-H)/2+cos(2*PI*t*1.1)*7+cos(2*PI*t*2.7)*2.5'` with W/H from meta. Module must import without side effects.
- [ ] **Step 4: Run** the file then the full suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: hero finishing core - options, captions, filter graph, ffmpeg runner`.

### Task 3: End card, brand mark fetch and `finishHeroClip`

**Files:**
- Modify: `backend/services/heroVideoFinish.js`
- Create: `backend/assets/fonts/` (one open-licence bold sans, e.g. Inter or Noto Sans; include its licence file); check `Dockerfile.backend` copies `backend/assets`
- Test: `backend/tests/heroVideoFinish.test.js` (extend)

**Interfaces:**
- Consumes: Task 2 exports.
- Produces: `renderEndCardPng({ width, height, ctaText, website, tagline, logoBuffer?, brandColor? }, outPath) -> Promise<void>` (node-canvas; registers the bundled font; text auto-wrapped and shrunk to fit; falls back to the default sans if the font file is missing); `fetchLogoBuffer(url) -> Promise<Buffer|null>` (https only, 10 s, 5 MB cap, content-type image/*, returns null on any failure); `finishHeroClip({ inputPath, outputPath, options, brand:{name, logoUrl, color, website}, story?, beatSheet?, dialogue?, timeoutMs? }) -> Promise<{ outputPath, durationSeconds, applied: string[] }>`. The result has the clip's original video+audio, then (if endCard.enabled) a 2.0 s card with a 0.4 s crossfade, audio continuous (silent/ducked bed on the card), total = input + 2.0 - 0.4 within 0.1 s. Rejects (never hangs) on failure or after `timeoutMs` (default 120000), cleaning temp files.

- [ ] **Step 1: Write failing tests**: `renderEndCardPng` makes a PNG of the requested size for a plain CTA, and for CTAs containing `"`, `:`, `%`, `'`, an emoji, a 300-char string and an empty string (no throw); `fetchLogoBuffer` returns null for `http://`, `javascript:`, an unreachable host and an oversized/non-image response (use a local `http.createServer` in the test, bound to 127.0.0.1) and a Buffer for a small https-like fixture served by injecting the fetch function (add an optional second parameter for dependency injection); real-ffmpeg integration on a 2 s synthetic clip with audio: `finishHeroClip` with defaults produces a file whose probe shows 720x1280, 24 fps, audio present, duration within 0.1 s of 2 + 2.0 - 0.4, and `applied` lists the steps; with `endCard.enabled=false` duration equals the input within 0.1 s; with an invalid `inputPath` it rejects with a plain message; with `timeoutMs: 1` it rejects and leaves no temp files in the output directory.
- [ ] **Step 2: Run** `node --test tests/heroVideoFinish.test.js`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** `renderEndCardPng`, `fetchLogoBuffer`, `finishHeroClip` (one or two ffmpeg passes; the end card still is turned into a video segment with matching size/fps/pixel format and an `anullsrc` or ducked audio bed with the clip's sample rate; use `xfade`/`acrossfade` for the join; apply captions via an SRT file with the `subtitles` filter using a path-escaping helper; apply the realism/mark/fade/loudnorm graph from Task 2). Add the font file and make sure the repository's Dockerfile image includes `backend/assets/fonts`.
- [ ] **Step 4: Run** the file then the full suite; confirm every test file exits by itself. Expected: PASS.
- [ ] **Step 5: Commit** `feat: hero end card, brand mark and finishHeroClip`.

### Task 4: Flow integration (options, finalize, fallback, raw clip)

**Files:**
- Modify: `backend/services/heroVideoFlow.js`, `backend/routes/heroVideo.js`
- Test: `backend/tests/heroVideoFlow.test.js`, `backend/tests/heroVideoRoutes.test.js`

**Interfaces:**
- Consumes: `normalizeFinishOptions`, `finishHeroClip` (Tasks 2-3); existing `deps.copyToStorage(remoteUrl) -> Promise<url>`.
- Produces: `startHeroGeneration` stores `payload.finish = normalizeFinishOptions(body.finish)` plus `payload.beatSheet`/`payload.dialogue` (strings/array, length-capped) when supplied; a new dep `deps.finalizeClip({ remoteUrl, job }) -> Promise<{ videoUrl:string, rawVideoUrl:string, finishError?:string }>` (default implementation in `defaultDeps()`: download the fal clip to a temp dir, `finishHeroClip`, upload the finished file and the raw clip to Cloudinary folder `nebula-hero-videos`, clean temp files; on any finishing error or timeout upload only the raw clip and return `finishError`); `pollHeroJob` calls `finalizeClip` once inside the existing copy lease in place of `copyToStorage` when it exists, and sets `result.videoUrl`, `result.rawVideoUrl`, `result.finishError`; `GET /jobs` whitelist adds `rawVideoUrl` and `finishError`; the poll response adds `rawVideoUrl?`, `finishError?`. Brand data for the end card comes from the user's business profile (name, logo, colour, website) loaded inside the default `finalizeClip` by `job.userId` via the `User` model (no Kling imports).

- [ ] **Step 1: Write failing tests** (fake deps): start stores normalized finish options (bad input -> defaults, never throws); completion with a working `finalizeClip` sets `videoUrl` (finished) and `rawVideoUrl`; `finalizeClip` rejecting -> job still `completed`, `videoUrl` = raw copy, `finishError` set, no refund; `finalizeClip` never resolving within the cap (inject a short cap) -> raw fallback; two concurrent polls at completion -> `finalizeClip` called exactly once; jobs created before this change (no `payload.finish`) complete through the old `copyToStorage` path unchanged; the list whitelist includes `rawVideoUrl`/`finishError` and still excludes `falRequestId`, `metadata`, `payload`, `error.stack`.
- [ ] **Step 2: Run** the two files. Expected: FAIL.
- [ ] **Step 3: Implement** the changes. The 120 s finishing cap is enforced in `defaultDeps().finalizeClip` (and respected by tests via an injected cap).
- [ ] **Step 4: Run** the two files then the full suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: hero jobs finish the clip with a raw-clip fallback`.

### Task 5: Hero page - Finish panel, audio mode, preflight, paywall and log fixes

**Files:**
- Modify: `frontend/pages/HeroVideo.tsx`, `frontend/services/api.ts`
- Modify: the module that handles the `trial-expired` event / paywall state (find it: search `trial-expired` in `frontend/`)
- Modify: `backend/services/heroVideoFlow.js` (log fal rejection reason on submit failure)
- Test: `backend/tests/heroVideoFlow.test.js` (log), frontend: type-check + build

**Interfaces:**
- Consumes: Task 4 response fields; `/plan` body `audioMode`, `ctaText`.
- Produces: Finish panel with toggles End card (CTA text input prefilled from `plan.story.cta` else brand name; website input prefilled from the business profile), Captions, Realism grade, and Sound select ("Music and effects from the video model" = `native` / "Effects only" = `sfx_only`); sends `finish` with `/generate` and `audioMode`, `ctaText` with `/plan`; shows the finished video plus a "Download raw clip" link and a gentle note when `finishError` is present; shows the story (hook, tension, turn, payoff, cta) read-only above the prompt; Quark preflight (`N` from the existing credits hook): when `N < price` the Generate button reads "Top up Quarks" and does not call `/generate`; the stuck paywall clears when the user navigates to another route or the balance becomes sufficient; on `/generate` submit failure the server logs `status` and fal's detail text only (never the prompt).

- [ ] **Step 1: Write the failing backend test** for the log line (submit throws an error with `status:403` and `body.detail`; capture `console.error`; assert it contains `403` and the detail text and does not contain the prompt text).
- [ ] **Step 2: Run** `node --test tests/heroVideoFlow.test.js`. Expected: FAIL; implement the log; PASS.
- [ ] **Step 3: Implement** the frontend changes. Reproduce the stuck paywall first (note how `trial-expired` sets state and why it persists) and fix the root cause, not by hiding the page.
- [ ] **Step 4: Verify**: `cd frontend && npx tsc --noEmit` (only the 4 pre-existing errors), `npm run build` (restore anything it changes under `backend/public`; commit nothing there), and a visual check in the Browser pane in light and dark at desktop and phone width (the local test app is running; do not click Generate).
- [ ] **Step 5: Commit** `feat: hero page finish panel, affordability preflight, paywall and log fixes`.
