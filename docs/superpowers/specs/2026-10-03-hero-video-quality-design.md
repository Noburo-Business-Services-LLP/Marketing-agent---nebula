# Hero Video Quality — Story, Performance, Sound, Finish

Status: draft for review. Branch: `dev-dk`. Builds on `2026-10-03-hero-video-design.md` (the pipeline, already built and live-tested).

## Why

The first live run (Small Steps, Big Dreams, 15 s) proved the plumbing but the clip is not a hero video:
plastic/flat performance, no story arc, no music or sound design, and no brand finish (no CTA, no end card). Root causes found in our own template, not the model:

- Template says `SFX only, no music` and `No overacting`, `Subtle expressions` -> bland acting, silent score, and no later step adds music.
- Five scenes each with a spoken line in 15 s -> no hook, tension or payoff.
- Template has no voice/emotion direction per beat, and no rule against screens/text (the tablet screen rendered garbled text).
- Prompt contradicted itself (two people on screen vs client shots).
- The product returns the raw model clip; there is no finishing layer.

Success: a 15 s clip that has (1) a hook in the first 2 s, (2) one clear emotional arc with a payoff, (3) audible music + sound design that follow the arc, (4) performances with visible, specific emotion and natural speech, (5) a branded finish (CTA end card, brand mark, transitions), (6) fewer AI tells (grain, imperfection, no readable fake UI text). Judged by the user watching 3 test runs.

## Decisions (user / controller)

- Music and sound effects come from the model by default (`audioMode = native`); `sfx_only` stays available for when music is added elsewhere.
- Dialogue language defaults to English; the `language` value is passed through (the brand profile's content language may be offered later).
- The 2-hero-clips-per-month quota, the 729-Quark price and the pipeline are unchanged.
- Finishing runs server-side with ffmpeg-static on the completed clip and costs no Quarks (CPU only). A paid clip is never lost: any finishing failure falls back to delivering the raw clip.
- Test budget: up to 3 more real generations (about 11-14 USD at list price), each approved by the user in chat before it runs.
- Out of scope here: the "showpiece" Videos-page redesign (its own spec afterwards), 1080p, multi-clip stories, post-hoc voice-over/TTS.

## Part A — Prompt v2 (`hero_video.plan`)

Replace the template body (same registry key, same variables plus three new ones: `audioMode`, `ctaText`, `brandName`). Output JSON adds `story` and `voice`:

```
{ story: { hook, tension, turn, payoff, cta }, prompt, beatSheet:[{time, beat, emotion}], dialogue, voice, qaChecklist, assumptions }
```

**Director's brief (added from the user's "Master Cinematic Director" prompt).** The planner's template opens with a condensed director's brief (about 600-800 words, not the 20-section original) and then the compression rules. The long original is never sent to the video model: Seedance gets only the compact, timed 11-block prompt the planner produces. Adopted from the brief:
- Think in an arc: SETUP -> TENSION -> DISCOVERY -> TRANSFORMATION -> EMOTIONAL PAYOFF, with quiet moments (hesitation, reaction, relief), not constant energy.
- Every shot must answer one of: what must the audience know / feel / notice / anticipate; otherwise cut it. Shot grammar follows the emotion: wider and observational at setup, closer on the problem, curious on discovery, smoother on transformation, an intimate reaction for the payoff.
- Show, don't tell: the story must be understandable with the sound off (messy desk, buzzing phone, a breath) and dialogue only reinforces it.
- Performance: hesitation before speaking, eye movement toward objects, micro-smiles, breath, natural pauses; no constant smiling, no talking to camera unless required, no frozen listening poses.
- Layered sound: dialogue, location ambience, specific Foley for each meaningful action, and an understated score that begins quiet, lifts at the discovery, and releases at the payoff; dialogue always intelligible, music under it.
- Final shot gives emotional closure and is held long enough to register (this also becomes the clean frame before the end card).
- Priority order when instructions conflict: story clarity > human performance > continuity > natural physics > composition > camera movement > product visibility > effects.
- Continuity and failure-prevention lists (identity, wardrobe, props, hands, no morphing/floating, no warped teeth) feed the NEGATIVES block.

Adapted, because a 15 s Seedance clip differs from a film:
- "Don't stay in one angle" becomes **at most 6-7 shots in 15 s** (more cuts cause identity drift in this model), each with a stated reason; a `shotList` is returned with shot size, lens-feel, and purpose.
- The spoken language comes from `{{language}}`, not a fixed accent. Dialogue the planner writes is then locked verbatim in the DIALOGUE LOCK block (the original's "use only the provided dialogue" rule).
- "Product UI must remain stable and consistent" is satisfied by NOT showing legible screens (angled, glare or out of focus). If a readable product screen is required, the brand must supply a real screenshot as a reference image (reference-to-video), never generated UI.
- "Avoid transitions/dissolves" applies inside the generated clip; the fades and end-card crossfade are added in finishing, not requested from the model.
- Fixed lens guidance (24-35 mm environment, 50 mm human, 85 mm emotional close-ups) is kept as defaults; depth of field stays plausible with background detail visible.

Output JSON therefore also returns `shotList: [{ time, shot, lens, purpose }]` (it feeds the QA checklist and the UI).

Rules the template must enforce:
1. **Story first.** The model writes `story` before the prompt: a visual hook in 0-2 s, one problem, one turn, one payoff, and a clean CTA beat at 12-15 s with a calm, uncluttered frame (the end card follows). One desire, one emotion. No invented statistics or testimonials; generated people are characters, never customers.
2. **Four beats, not five.** Beats of about 2 / 5 / 5 / 3 s. Hard cuts only where the story turns. A cast declared once (HEADCOUNT) and respected in every beat — no shot may add people not declared.
3. **Dialogue discipline.** At most two short on-camera lines, about 25 words in total, natural everyday speech with contractions, hesitations and interruptions allowed; no ad-speak ("Impressive work!"). Language from `{{language}}`.
4. **Performance direction.** Each beat carries an `emotion` and a concrete physical action (breath, glance, hand movement, pause). `voice` gives age, pitch, pace, warmth and the emotion of each line. Remove "subtle/no overacting" language; ask for grounded but visibly felt emotion.
5. **Sound design on by default.** `audioMode = native`: an ACTUAL music line (genre, instruments, tempo, how it rises at the turn and resolves at the CTA, kept under dialogue) plus specific diegetic SFX; no "no music". `audioMode = sfx_only`: SFX and room tone, no music.
6. **Anti-plastic realism.** Imperfect practical light, visible skin texture, flyaway hair, lens flare/grain tolerated, handheld micro-jitter; no beauty look.
7. **Screens and text.** Never a legible screen close-up or text in frame; devices shown only at an angle, in glare, or out of focus. No captions/logos inside the generated clip (finishing adds them).
8. The QA checklist includes: hook visible in 2 s, headcount matches, no readable text, two lines max, music line present (native mode).

## Part B — Finishing layer (`backend/services/heroVideoFinish.js`)

New self-contained service (ffmpeg-static + node-canvas only; does not import the Kling pipeline). `finishHeroClip({ inputPath, outputPath, options, brand })` applies, in one or two ffmpeg passes:

- **Realism grade** (default on): the verified chain from the `remove-ai-look` skill — slight contrast/saturation reduction, fine temporal grain, mild unsharp negative, and a 5% zoom with sine handheld sway — sized to the clip (720x1280).
- **Brand mark** (default on if a logo exists): small logo, low opacity, top corner, entire clip (no sting before the hook; the hook must be first).
- **Fades and transition**: 0.3 s fade-in from black; a 0.4 s crossfade from the last frame into the end card; audio crossfades with it.
- **End card** (default on): 2.0 s card rendered with node-canvas (brand colour or dark gradient, logo, CTA text, website, optional tagline) using a bundled open-licence font under `backend/assets/fonts/`; appended with matching video format and a silent/ducked audio bed so audio stays continuous. Total length about 17 s.
- **Captions** (default off): burned in from the beat sheet's time ranges and dialogue lines; times are approximate, so they are opt-in.
- **Loudness**: `loudnorm` to about -16 LUFS integrated, applied to the final mix.

Options (validated, all optional; defaults above): `{ realism, brandMark, fades, endCard:{enabled, ctaText, website, tagline}, captions, loudnorm }`. `ctaText` falls back to the story's `cta`, then to the brand name.

Pure helpers (unit-testable without ffmpeg): `buildFinishFilterGraph(options, meta)`, `buildCaptionsSrt(beatSheet, dialogue)`, `normalizeFinishOptions(raw)`. One real-ffmpeg integration test runs the whole chain on a 2 s synthetic `lavfi` clip.

## Integration

- `POST /api/hero-video/generate` accepts `finish` options and stores them in the job payload; validated by `normalizeFinishOptions` (bad types -> defaults; text length caps; website must look like a hostname or https URL).
- On completion, `pollHeroJob` (inside the existing copy-lease section) downloads the fal clip once, runs `finishHeroClip`, uploads the finished file as the job's `result.videoUrl` and keeps the raw clip as `result.rawVideoUrl`. If finishing throws or exceeds a time cap (120 s), it uploads the raw clip as `videoUrl` and records `result.finishError` (plain-language) — never fails the job and never loses the paid clip.
- `GET /jobs` whitelist adds `rawVideoUrl`.
- Frontend `HeroVideo.tsx`: a "Finish" panel (End card with CTA text and website, Captions, Realism grade, Sound: "Music and effects from the video model" / "Effects only"), a "Download raw clip" link next to the finished video, and friendly copy when finishing was skipped.

## Small fixes shipped with this work

1. **Affordability preflight** on the Hero page: show "729 Quarks - you have N"; when N is short, the button reads "Top up Quarks" and does not call the API (avoids the surprise plans page).
2. **Stuck paywall**: after a credits failure the app kept showing the plans page on every route until reload. Find where the `trial-expired` event sets state and clear it when the user navigates or the balance is sufficient.
3. **Operator logging**: log fal's rejection reason (status + detail text, never the prompt) on submit failure.

## Testing and verification

- Unit tests for the prompt template (new keys, forbidden phrases absent: "no music", "overacting", "SFX only" in native mode; "music" line required), `normalizeFinishOptions`, filter-graph builder, SRT builder, end-card renderer (output PNG dimensions), flow integration with fake finish/copy deps (finish success, finish throw -> raw fallback, timeout -> raw fallback, no double finish under concurrent polls).
- Real-ffmpeg integration on a synthetic clip: output has video + audio, duration = input + end card, 720x1280.
- Live: up to 3 generations judged by the user against the success criteria; each explicitly approved before spend.

## Risks

- Seedance may still render flat performances at 720p; the Fast tier is cheaper for iteration but lower quality. The model id is env-overridable (`FAL_HERO_TEXT_MODEL`).
- Native music quality is unverified until the first v2 run.
- Burned captions are timed from beat ranges, not from audio; kept opt-in.
- Fargate Linux image has no system fonts: the end card must use the bundled font file, and the Dockerfile/CI image needs that file included (it lives in the repo, not a system path).
