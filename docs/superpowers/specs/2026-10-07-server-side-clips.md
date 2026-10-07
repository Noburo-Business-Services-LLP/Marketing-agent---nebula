# Scope: the server finishes all video clips, even if the page is closed

Written 2026-10-07. Status: scoped, not built.

## The problem (seen in production, TRM Santhi account, 7 Oct)
Clips are made by the browser page: `generateClips` in `frontend/pages/ReelGenerator.tsx` loops over the scenes and calls `POST /api/video-generation/generateSingleVideoClip` once per scene (each takes 75 to 150 seconds). Leaving the page, going back a step, or a reload stops the loop. In the log, clips 1 to 3 finished and clip 4 never started. Next stays locked until every scene has a clip, so the user is stuck until they find Resume.

## What already exists
- A persistent background queue (`services/videoGenerationQueue.js`, concurrency 2, restarts interrupted jobs, refunds on failure) with a `generate_clips` handler (`routes/videoGeneration.js:100`) and an opt-in route `POST /generateClips` with `async: true` (or env `VIDEO_STEP_ASYNC=true`) that enqueues it.
- That path is off by default and has gaps, which is why it was never switched on:
  1. It charges for ALL scenes up front (`deductCredits(..., sourceScenes.length)`) and re-renders every scene, including ones that already have a clip (the browser loop skips finished clips; this does not).
  2. The code comment says a later job failure does not refund ("a known, smaller gap").
  3. It runs one big `runGenerateVideoClips` call and writes all results at the end (`updateDraft` after the whole job), so a crash mid-way loses the clips already made.
  4. The browser never polls it for this step.

## Proposed design
1. **One shared function** `renderSceneClip({ userId, jobId, sceneIndex, tweak, aspectRatio })`: the body of the existing `/generateSingleVideoClip` route moved out unchanged (deduct 1 clip, render with Kling, upload, save to the draft, refund on error). The route calls it; the queue handler calls it. No behaviour change for the single-clip button.
2. **A new queue job type `render_missing_clips`**: for each scene without `clipUrl` and with `imageUrl`, call `renderSceneClip`, one scene at a time, saving each finished clip into the draft immediately. Charge per scene just before its render, refund that scene if it fails; a failed scene does not stop the others. Records progress (`done / total`, current scene).
3. **Route** `POST /api/video-generation/renderMissingClips { jobId }`: returns 202 with the queue job id; if a job for this draft is already queued or running, returns that one (no double charge). Checks the user has enough Quarks for all missing clips before starting (read-only), but only deducts per scene.
4. **Browser**: the "Generate all clips / Resume" button starts the job and polls the draft every 5 seconds (existing `getJobStatus` and draft fetch). Clips appear as they finish. Leaving and coming back resumes showing progress, because state is on the server. The "stay on this page" hint is removed. Per-scene Regenerate stays as it is.
5. **Restart safety**: reuse the queue's existing restart recovery; because each clip is saved as it finishes and scenes with a clip are skipped, a restarted job just continues.

## Risks and how to handle them
- **Money**: charge-per-scene and refund-per-scene must match what the single route does today. Test with fakes for: success, one scene failing, all failing, job restarted halfway, double-click on the button.
- **Cost of a runaway job**: cap the job at the draft's scene count; reject if the draft already has an active job.
- **Kling timeouts**: the existing 120 s request timeout and retry stay as they are (this change does not touch the render itself).
- **Server restarts during a deploy**: ECS replaces the task during a release; a clip in flight is lost and the scene is refunded and re-rendered on resume. Prefer not to release while a customer is mid-render (nothing new, but worth knowing).
- **Concurrency**: queue concurrency is 2 across ALL customers; a long video job can delay another customer's job. Fine at current volume; revisit with more clients.

## Effort and order
About one working session, in this order: (1) extract `renderSceneClip` with tests proving the single route is unchanged, (2) queue job and route with money tests, (3) browser polling and button, (4) a read-only production check in the logs plus one real render for a test account, with the owner's OK for that spend.

## Decisions for the owner
1. Go ahead? (recommended: this is the biggest remaining usability problem in the video flow.)
2. Should the same be done for scene IMAGES (they are also made one by one from the browser, 25 to 30 s each)? Same pattern, smaller cost; recommended as a second step.
3. Approval for one real test render on a test account when it is built (about 5 clips of Kling).
