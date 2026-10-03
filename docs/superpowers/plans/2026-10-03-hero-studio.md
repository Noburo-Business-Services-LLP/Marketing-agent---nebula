# Hero Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Hero video from the wizard's own story, cast, environment and the client's brand (as real Seedance references), with a story-first planner (director's brief), a server-side finishing layer (realism, brand mark, CTA end card, fades, loudness) and a Hero Studio page — replacing the earlier concept-only hero entry.

**Architecture:** A new `heroVideoBrief.js` validates a compact hero brief sent from the wizard, loads the client's brand server-side, selects and stages up to 9 references. The planner (`hero_video.plan` v2) turns story + cast + place + brand + references into a timed 11-block prompt, a hero cut and a shot list. Generation uses the existing reference-to-video path. A new `heroVideoFinish.js` finishes the clip inside the existing copy lease with a raw-clip fallback. The Hero page becomes Hero Studio.

**Tech Stack:** Node 24 / Express / Mongoose, `@fal-ai/serverless-client`, ffmpeg-static + ffprobe-static, node-canvas (already a dependency), Cloudinary (`imageUploader.js`), `node --test`, React + TypeScript.

**Spec:** `docs/superpowers/specs/2026-10-03-hero-studio-design.md` (amends `2026-10-03-hero-video-quality-design.md` and `2026-10-03-hero-video-design.md`). This plan supersedes `2026-10-03-hero-video-quality.md`.

## Global Constraints

- Kling reel pipeline untouched: no edits to `videoService.js`, `routes/videoGeneration.js`, `videoGenerationQueue.js`, `models/VideoJob.js`; no import of `videoGenerationPipeline.js` or `videoDraftStore.js` from hero code (they start timers and make tests hang).
- Hero jobs stay in `HeroVideoJob` (`hero_video_jobs`); quota (2/month), price (`CREDIT_COSTS.hero_video_clip`, derived) and the money path (deduct -> create -> recheck -> submit -> poll -> refund-once) are unchanged.
- Brand data (logo, colours, website, product, ideal-customer text) is loaded server-side for the authenticated user; never trusted from the request body.
- Every reference sent to the video model must be a public `https:` image URL: no `http:`, no `localhost`/loopback/private/link-local hosts, no `.local`/`.internal`, length <= 2048; at most **9** references. `dataUrl` images are uploaded to Cloudinary first (<= 6 MB, `image/png|jpeg|webp`).
- Request bounds: cast <= 4, scenes <= 12, environment images <= 5, every string capped (concept fields 600, scene script/visual 800, notes 500); the planner prompt stays under 14,000 characters.
- A finishing failure or a finishing time over 120 s never fails the job and never loses the paid clip: deliver the raw clip as `videoUrl`, set `result.finishError` (plain language, no vendor/tool names).
- Finishing and storage copy happen at most once per job under concurrent polls (inside the existing copy lease).
- Finish defaults: realism on, brand mark on when a logo exists, fades on, end card on (2.0 s), captions off, loudnorm on. `audioMode` default `native`.
- No user text reaches an ffmpeg filter string unescaped: end-card text is rendered to an image by node-canvas; captions go through an SRT file; only fixed, validated values enter filters. Remote fetches (logo): `https:` only, 10 s timeout, 5 MB cap.
- User-facing copy has no vendor/tool jargon. No prompt text in logs.
- Test command: `cd backend && node --test tests/*.test.js` (a directory arg fails on Node 24; every file must exit by itself). 95 tests pass at the start.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. No live fal calls in any task.

## Review Focus

- A reference URL that is `http:`, loopback/private, a data URL, or a 10 MB file is dropped or rejected, never forwarded (Task 1, Task 3).
- Brand fields in the request body are ignored; a different user's brand is never loaded (Task 1, Task 2).
- Brief with no cast, no scenes, zero references, 9+ candidate references, or a 60-scene story: clear message or deterministic caps, never a crash or an oversized prompt (Task 1, Task 2).
- Finishing throws, hangs or returns an empty file: the job completes with the raw clip and `finishError` (Task 6).
- Two polls race at completion: one finish, one upload (Task 6).
- End-card text with quotes, colons, percent signs, emoji or 300 characters does not break the render; audio stays continuous and in sync after the card (Task 5).
- Native mode demands a real music line and never says "no music"; `sfx_only` says no music (Task 2).

---

### Task 1: Hero brief, brand loading, reference selection and staging

**Files:**
- Create: `backend/services/heroVideoBrief.js`
- Modify: `backend/services/heroVideoService.js` (`HERO_MAX_REFS` 4 -> 9; `validateRefUrls` also rejects non-public hosts)
- Test: `backend/tests/heroVideoBrief.test.js`, `backend/tests/heroVideoService.test.js` (update the cap tests)

**Interfaces:**
- Produces: `isPublicHttpsUrl(url: unknown) -> boolean`; `normalizeHeroBrief(raw: unknown) -> { ok:true, brief:HeroBrief } | { ok:false, message:string }` where `HeroBrief = { concept:{title,storySummary,coreEmotion,visualStyle}, aspectRatio:'9:16'|'16:9'|'1:1', language:string, cast:{id,name,age,gender,role,appearance,clothing,hairStyle,hairColor,personality,portraitUrl}[], castSheetUrl:string, environment:{enabled:boolean, notes:string, images:{url:string, dataUrl:string, alt:string}[]}, scenes:{sceneId:string, title:string, script:string, visual:string, durationSeconds:number, charactersRequired:string[], imageUrl:string}[] }` (missing cast or scenes -> `ok:false` with a plain message naming what to complete first); `loadBrand(userId, deps?) -> Promise<Brand>` with `Brand = { name, website, industry, audience, icp, tone:string[], heroProduct, logoUrl, colors:string[], productImages:{url,alt}[] }` (reads `User.businessProfile` and the `BrandAsset` collection; lazily required models; `deps` for tests); `selectReferences(brief, brand, opts?:{keptSceneIds?:string[]}) -> Ref[]` with `Ref = { tag:'@image1'.., kind:'cast'|'environment'|'brand'|'keyframe', label:string, url:string, source:string }` in the priority order cast (<=3; accepted/required first, else cast sheet) -> environment (<=2) -> brand product/logo (<=2) -> keyframes of kept scenes (<=3), total <= 9, tags numbered in order; `stageReferences(refs, deps?:{uploadBase64Image}) -> Promise<{ refs:Ref[], dropped:{label:string, reason:string}[] }>` (dataUrl images uploaded to Cloudinary via the existing `uploadBase64Image` in `imageUploader.js`; non-public URLs and oversize/bad-type data dropped with a plain reason; tags renumbered after dropping).

- [ ] **Step 1: Write failing tests** (`node:test`): `isPublicHttpsUrl` accepts `https://res.cloudinary.com/a.jpg`, rejects `http://x`, `https://localhost/a`, `https://127.0.0.1/a`, `https://10.0.0.5/a`, `https://192.168.1.2/a`, `https://169.254.169.254/a`, `https://[::1]/a`, `https://x.local/a`, `javascript:alert(1)`, `data:image/png;base64,AAA`, a 3000-char URL and non-strings. `normalizeHeroBrief`: valid sample passes with caps applied (a 2000-char script is cut to 800, 6 cast members -> 4, 20 scenes -> 12), bad aspect -> `9:16`, empty cast -> `ok:false` mentioning the cast step, empty scenes -> `ok:false` mentioning the script step, non-object -> `ok:false`. `loadBrand` with fake models returns the fields and ignores anything else; unknown user -> a brand with empty strings (never throws). `selectReferences`: priority/caps (4 cast, 3 env, 3 brand, 5 keyframes in -> 3/2/2/2 = 9 out when budget runs out, tags `@image1..@image9` in order), skips duplicates, uses the cast sheet when no portraits, respects `keptSceneIds` for keyframes, returns `[]` for an empty brief. `stageReferences`: uploads a `dataUrl` via the fake and swaps in the returned URL; drops a `dataUrl` over 6 MB or of type `image/gif`; drops `http://` with reason; renumbers tags. In `heroVideoService.test.js`: `HERO_MAX_REFS` is 9, `buildHeroInput` accepts 9 and rejects 10, `validateRefUrls` rejects a loopback URL.
- [ ] **Step 2: Run** `cd backend && node --test tests/heroVideoBrief.test.js tests/heroVideoService.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the new module and the `heroVideoService.js` changes (reuse `isPublicHttpsUrl` from the brief module or move it into `heroVideoService.js` and import it there; avoid circular requires). Module must import without Mongo or network.
- [ ] **Step 4: Run** the two files, then the full suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: hero brief, brand loading and reference selection/staging`.

### Task 2: Planner v2 and the brief/plan routes

**Files:**
- Modify: `backend/services/promptRegistry.js` (`hero_video.plan` entry)
- Modify: `backend/routes/heroVideo.js`
- Create: `docs/superpowers/specs/assets/master-cinematic-director-prompt.md` already exists (reference only)
- Test: `backend/tests/heroPrompt.test.js`, `backend/tests/heroVideoRoutes.test.js`

**Interfaces:**
- Consumes: Task 1 (`normalizeHeroBrief`, `loadBrand`, `selectReferences`, `stageReferences`).
- Produces: `POST /api/hero-video/brief` body `{ brief }` -> `{ success, brief, brand:{name,website,logoUrl,colors,heroProduct}, references:Ref[], dropped:[] }` or 400 with the plain `message` (no LLM call, no charge; `protect` + `checkTrial` + read limiter). `POST /api/hero-video/plan` body `{ brief, references?:string[] (urls the user kept), keptSceneIds?:string[], audioMode?:'native'|'sfx_only', ctaText?:string<=60 }`: the server recomputes brand and references itself (client `references` can only select from the staged set) and calls the planner; response `{ success, plan:{ story:{hook,tension,turn,payoff,cta}, heroCut:[{sceneId,keep,reason,time}], shotList:[{time,shot,lens,purpose}], prompt, beatSheet:[{time,beat,emotion}], dialogue, voice, qaChecklist, assumptions }, references:Ref[] }`. Template variables (all strings): `brandContextBlock, conceptTitle, conceptStory, conceptEmotion, conceptVisualStyle, castBlock, environmentBlock, brandBlock, scenesBlock, referencesBlock, duration, aspectRatio, language, audioMode, ctaText, brandName`. `normalizePlan` returns the new fields with safe defaults (`''`/`[]`, `shotList` capped at 7).

- [ ] **Step 1: Write failing tests**: template (render with native and sfx_only): native has a music instruction and none of `no music`, `SFX only`, `overacting`, `Subtle expressions`; sfx_only has `no music`; both contain the arc words SETUP/TENSION/DISCOVERY/TRANSFORMATION/PAYOFF, hook-in-first-2-seconds, the "understandable with the sound off" rule, the 6-7 shot cap, the priority-order line, dialogue limited to two lines / about 25 words, the rule against legible screens or text, the rule that no beat may add people beyond the declared cast, a REFS instruction that every reference is tagged with a role ("appearance only"), instructions to use the cast, environment and brand blocks, the `heroCut`, `story`, `shotList`, `voice` keys in the JSON contract; no `{{` left and every `{{var}}` declared; with maximal blocks (12 scenes, 4 cast, 9 references) the rendered prompt is under 14,000 characters. Routes: `/brief` 400 on missing cast with the plain message; success returns staged references numbered `@image1..` and a brand summary containing only whitelisted fields; `/plan` ignores any `brand` in the body; `/plan` references selection can only choose from staged URLs; invalid `audioMode` -> 400; `normalizePlan` safe defaults; `/plan` passes the blocks into `buildPrompt` (assert the call's variable names/values via the injected deps).
- [ ] **Step 2: Run** `node --test tests/heroPrompt.test.js tests/heroVideoRoutes.test.js`. Expected: FAIL.
- [ ] **Step 3: Rewrite the template** with the condensed director's brief (read `docs/superpowers/specs/2026-10-03-hero-video-quality-design.md` "Director's brief" and Part A rules, `docs/superpowers/specs/assets/master-cinematic-director-prompt.md`, and `/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/ai-video-studio/skills/seedance-hero-video/` + `ad-strategy-and-scripts/` + `remove-ai-look/references/prompt-realism-phrases.md`); keep the 11-block numbering and integrity rules (no invented statistics/testimonials; generated people are characters not customers). Add a "compress the scene breakdown into a 15 s hero cut" section (pick 3-4 scenes including the opening hook and the resolution; honour `keptSceneIds` if provided). Add the `/brief` route and update `/plan` and `normalizePlan`. Keep the existing 11-block, dialogue-budget and integrity tests passing or update them with a stated reason.
- [ ] **Step 4: Run** the two files then the full suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: hero brief route and story-first planner with cast, place, brand and references`.

### Task 3: Generate with confirmed references

**Files:**
- Modify: `backend/services/heroVideoFlow.js`, `backend/routes/heroVideo.js`
- Test: `backend/tests/heroVideoFlow.test.js`, `backend/tests/heroVideoRoutes.test.js`

**Interfaces:**
- Consumes: Task 1 (`isPublicHttpsUrl`, cap 9).
- Produces: `POST /generate` accepts `refImageUrls: string[]` (<= 9, each public https; invalid -> 400 with a plain message and no charge) and optional `references: {tag,kind,label,url}[]` metadata (stored in `payload.references`, capped, strings capped) so the page can show them later; the job input uses the reference-to-video model when any reference exists (already implemented in `buildHeroInput`); the poll/list responses are unchanged. The saved prompt must still never be logged.

- [ ] **Step 1: Write failing tests** (fakes): 9 valid references -> job created, `buildHeroInput` called with 9 URLs and `payload.references` stored; 10 -> 400, no deduct; a loopback or `http:` URL -> 400, no deduct; duplicates collapse; no references -> text-to-video as before.
- [ ] **Step 2: Run** `node --test tests/heroVideoFlow.test.js tests/heroVideoRoutes.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the validation (use Task 1's `isPublicHttpsUrl`) and metadata storage.
- [ ] **Step 4: Run** the two files then the full suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: hero generation accepts up to 9 validated references`.

### Task 4: Finishing core (pure helpers + realism/fades/mark/loudnorm/captions)

**Files:**
- Create: `backend/services/heroVideoFinish.js`
- Test: `backend/tests/heroVideoFinish.test.js`

**Interfaces:**
- Produces: `normalizeFinishOptions(raw: unknown) -> { realism:boolean, brandMark:boolean, fades:boolean, endCard:{enabled:boolean, ctaText:string, website:string, tagline:string}, captions:boolean, loudnorm:boolean }` (defaults per Global Constraints; strings trimmed, `ctaText <= 60`, `tagline <= 80`, `website` must match a hostname or an `https://` URL else `''`); `buildCaptionsSrt(beatSheet: {time:string, beat:string}[], dialogue: string) -> string` (SRT; cue time from each beat's `a-bs` range, text = the quoted spoken line in that beat; beats without a quoted line produce no cue); `buildFinishFilterGraph(options, meta:{width,height,hasLogo,hasAudio,durationSeconds}) -> { videoFilter:string, audioFilter:string }`; `resolveFfmpegPath() -> string` (ffmpeg-static); `runFfmpeg(args:string[], {timeoutMs?:number}) -> Promise<void>` (spawn; rejects on non-zero exit or timeout with a short plain error, never hangs); `probeMedia(path) -> Promise<{width,height,fps,durationSeconds,hasAudio,sampleRate}>` via ffprobe-static. `finishHeroClip` is completed in Task 5.

- [ ] **Step 1: Write failing tests**: `normalizeFinishOptions` defaults and caps (`ctaText` of 200 chars -> 60; `website` `javascript:x` -> `''`; non-object -> defaults; booleans coerced); `buildCaptionsSrt` on a 4-beat sheet with 2 quoted lines gives exactly 2 numbered cues with correct `HH:MM:SS,mmm` times and no cue for silent beats; `buildFinishFilterGraph` contains `fade=t=in` only when fades is true, `loudnorm` in the audio filter only when loudnorm is true, the realism chain (`eq=`, `curves=`, `noise=`, `crop=`) only when realism is true, an `overlay` only when `hasLogo`, and never contains raw user strings; `runFfmpeg` rejects with a plain message on a bad argument list and on `timeoutMs: 1`; `probeMedia` on a 2 s synthetic clip generated in the test with the ffmpeg binary (`lavfi` `testsrc2=size=720x1280:rate=24` + `sine`) returns width 720, height 1280, hasAudio true.
- [ ] **Step 2: Run** `node --test tests/heroVideoFinish.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the exports. Use the verified realism chain: `eq=contrast=0.90:saturation=0.92:gamma=1.03,curves=all='0/0.02 1/0.98',unsharp=5:5:-0.35:5:5:0,noise=alls=4:allf=t,scale=trunc(iw*1.05/2)*2:trunc(ih*1.05/2)*2,crop=W:H:x='(iw-W)/2+sin(2*PI*t*1.3)*7+sin(2*PI*t*3.1)*2.5':y='(ih-H)/2+cos(2*PI*t*1.1)*7+cos(2*PI*t*2.7)*2.5'` with W/H from meta. The module must import without side effects.
- [ ] **Step 4: Run** the file then the full suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: hero finishing core - options, captions, filter graph, ffmpeg runner`.

### Task 5: End card, brand mark fetch and `finishHeroClip`

**Files:**
- Modify: `backend/services/heroVideoFinish.js`
- Create: `backend/assets/fonts/` (one open-licence bold sans, e.g. Inter or Noto Sans, plus its licence file); make sure `Dockerfile.backend` copies `backend/assets`
- Test: `backend/tests/heroVideoFinish.test.js` (extend)

**Interfaces:**
- Consumes: Task 4.
- Produces: `renderEndCardPng({ width, height, ctaText, website, tagline, logoBuffer?, brandColor? }, outPath) -> Promise<void>` (node-canvas; registers the bundled font; wraps and shrinks text to fit; falls back to the default sans if the font file is missing); `fetchLogoBuffer(url, fetchImpl?) -> Promise<Buffer|null>` (https only, 10 s, 5 MB cap, `image/*` content type, null on any failure); `finishHeroClip({ inputPath, outputPath, options, brand:{name, logoUrl, color, website}, beatSheet?, dialogue?, timeoutMs? }) -> Promise<{ outputPath, durationSeconds, applied:string[] }>`: original video+audio, then (if `endCard.enabled`) a 2.0 s card joined with a 0.4 s crossfade, audio continuous (silent or ducked bed on the card), total = input + 2.0 - 0.4 within 0.1 s, same size/fps/pixel format/audio format. Rejects (never hangs) on failure or after `timeoutMs` (default 120000), removing temp files.

- [ ] **Step 1: Write failing tests**: `renderEndCardPng` makes a PNG of the requested size for a plain CTA and for CTAs containing `"`, `:`, `%`, `'`, an emoji, a 300-char string and an empty string (no throw); `fetchLogoBuffer` returns null for `http://`, `javascript:`, an unreachable host, an oversized body and a non-image content type (inject `fetchImpl`; use a local `http.createServer` bound to 127.0.0.1 for the real-network cases) and a Buffer for a small valid PNG; real-ffmpeg integration on a 2 s synthetic clip with audio: `finishHeroClip` with defaults yields 720x1280, 24 fps, audio present, duration within 0.1 s of 2 + 2.0 - 0.4, and `applied` lists the steps; with `endCard.enabled=false` the duration equals the input within 0.1 s; an invalid `inputPath` rejects with a plain message; `timeoutMs: 1` rejects and leaves no temp files in the output directory.
- [ ] **Step 2: Run** `node --test tests/heroVideoFinish.test.js`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** the functions (one or two ffmpeg passes; the end-card still becomes a video segment with matching size/fps/pixel format and a matching audio bed; join with `xfade`/`acrossfade`; captions via an SRT file and the `subtitles` filter with a path-escaping helper; realism/mark/fade/loudnorm graph from Task 4). Add the font and licence files; verify the Dockerfile includes `backend/assets`.
- [ ] **Step 4: Run** the file then the full suite; confirm every test file exits by itself. Expected: PASS.
- [ ] **Step 5: Commit** `feat: hero end card, brand mark and finishHeroClip`.

### Task 6: Flow integration (finish options, finalize, raw fallback)

**Files:**
- Modify: `backend/services/heroVideoFlow.js`, `backend/routes/heroVideo.js`
- Test: `backend/tests/heroVideoFlow.test.js`, `backend/tests/heroVideoRoutes.test.js`

**Interfaces:**
- Consumes: `normalizeFinishOptions`, `finishHeroClip` (Tasks 4-5); existing `deps.copyToStorage(remoteUrl) -> Promise<url>`; Task 1 `loadBrand`.
- Produces: `startHeroGeneration` stores `payload.finish = normalizeFinishOptions(body.finish)` plus `payload.beatSheet`/`payload.dialogue` when supplied (capped); new dep `deps.finalizeClip({ remoteUrl, job }) -> Promise<{ videoUrl:string, rawVideoUrl:string, finishError?:string }>` whose default implementation (in `defaultDeps()`) downloads the fal clip once to a temp dir, loads the brand for `job.userId` (`loadBrand`), runs `finishHeroClip`, uploads the finished file and the raw clip to Cloudinary folder `nebula-hero-videos`, cleans temp files, and on any finishing error or a 120 s cap uploads only the raw clip and returns `finishError`; `pollHeroJob` calls `finalizeClip` once inside the existing copy lease in place of `copyToStorage` when `payload.finish` exists, and sets `result.videoUrl`, `result.rawVideoUrl`, `result.finishError`; `GET /jobs` whitelist adds `rawVideoUrl`, `finishError`; the poll response adds `rawVideoUrl?`, `finishError?`. Jobs created before this change (no `payload.finish`) complete through the old `copyToStorage` path unchanged.

- [ ] **Step 1: Write failing tests** (fake deps): start stores normalized finish options (bad input -> defaults, never throws); completion with a working `finalizeClip` sets `videoUrl` (finished) and `rawVideoUrl`; `finalizeClip` rejecting -> job `completed`, `videoUrl` = raw copy, `finishError` set, no refund; `finalizeClip` never resolving within an injected short cap -> raw fallback; two concurrent polls at completion -> `finalizeClip` called exactly once; a job without `payload.finish` completes via `copyToStorage`; the list whitelist includes `rawVideoUrl`/`finishError` and still excludes `falRequestId`, `metadata`, `payload`, `error.stack`.
- [ ] **Step 2: Run** the two files. Expected: FAIL.
- [ ] **Step 3: Implement** the changes. The 120 s cap is enforced in the default `finalizeClip` and via an injected cap in tests. Also log fal's rejection reason on submit failure: `status` and fal's detail text only, never the prompt (test: capture `console.error`, assert it contains the status and detail and not the prompt).
- [ ] **Step 4: Run** the two files then the full suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: hero jobs finish the clip with a raw-clip fallback; log fal rejection reasons`.

### Task 7: Hero Studio page, wizard entry and small fixes

**Files:**
- Modify: `frontend/pages/HeroVideo.tsx` (becomes Hero Studio), `frontend/services/api.ts` (`heroVideoAPI.brief`, extended `plan`/`generate`), `frontend/pages/ReelGenerator.tsx` (entry button + brief assembly only)
- Modify: the module that handles the `trial-expired` event / paywall state (search `trial-expired` in `frontend/`)

**Interfaces:**
- Consumes: Task 2 `/brief`, `/plan`; Task 3 `/generate` with `refImageUrls`/`references`; Task 6 response fields `rawVideoUrl`, `finishError`.
- Produces: in `ReelGenerator.tsx`, a **Make this a Hero video** button shown from Step 4 onward (replaces the concept-step button); a helper `buildHeroBrief()` that assembles `{ concept, aspectRatio, language, cast, castSheetUrl, environment, scenes }` from the existing wizard state (`acceptedConcept`, `generatedCharacters` with `portraitUrl` + `acceptedCharacterId`, `castImageUrl`, `environmentEnabled/Refs/Notes`, `scenes` with `imageUrl`, `aspectRatio`, language) and navigates to `/reels/hero` with `{ brief }`; when the cast or the script/scenes are missing the button explains what to finish first and goes to that step. Hero Studio page order: Story (concept + hero cut with scene toggles) -> Cast (portraits with names) -> Place (environment photos and notes) -> Brand (logo, product, colour, CTA text input prefilled from `plan.story.cta` else the brand name, website input prefilled from the brand) -> References (the staged set from `/brief`, each removable, with its role label and `@imageN` tag) -> Prompt (editable, plus story and shot list read-only) -> Finish (End card, Captions, Realism grade; Sound select "Music and effects from the video model" = `native` / "Effects only" = `sfx_only`) -> Generate. Quark preflight: show price and balance; when balance < price the button reads "Top up Quarks" and does not call `/generate`. Completed state shows the finished video plus a "Download raw clip" link and a gentle note when `finishError` is present. The stuck paywall (the app kept showing the plans page on every route after a credits failure until reload) is fixed at its root: find where `trial-expired` sets state and clear it on navigation or when the balance becomes sufficient. Copy has no vendor/tool jargon. No generation is triggered by tests or verification.

- [ ] **Step 1:** Implement `api.ts` additions and types; `cd frontend && npx tsc --noEmit` (only the 4 pre-existing errors).
- [ ] **Step 2:** Add the wizard entry and `buildHeroBrief()` in `ReelGenerator.tsx` (minimal insertion; no other wizard logic changes); type-check.
- [ ] **Step 3:** Build Hero Studio in `HeroVideo.tsx` with all sections, the preflight and the paywall fix (reproduce the stuck paywall first and note its root cause in the report); type-check.
- [ ] **Step 4: Verify** `cd frontend && npm run build` (restore anything it changes under `backend/public`; commit nothing there), then visual check in the Browser pane (the local test app is running at http://localhost:3000 with a signed-in test account; do NOT click Generate) in light and dark at desktop and phone width: the no-brief state, and a brief state reached by building a real cast + scenes in the wizard with the test account if feasible, else report what could not be seen.
- [ ] **Step 5: Commit** `feat: Hero Studio page, wizard entry, affordability preflight and paywall fix`.
