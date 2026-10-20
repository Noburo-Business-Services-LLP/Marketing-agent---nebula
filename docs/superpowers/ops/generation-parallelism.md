# Parallel generation jobs (tester task E9), stage A: how it works and how to run it

Impact map: `docs/superpowers/impact-maps/generation-parallelism.md`. Decisions D68 to D72, review fixes D74 to D76 in `docs/superpowers/DECISIONS-LOG-2026-10-20.md`. Code on `nebulaa-redesign`, NOT released.

## What changed (in plain words)
Before: the step-by-step video queue ran at most 2 jobs at once for ALL customers together, whatever the number of servers, because it counted running jobs across the whole database. Now every worker server runs its own slots (by default 2 picture jobs and 2 video jobs at once), so two worker servers run twice as many. A job is "claimed" by one server with a time-limited lease that the server renews while it works; if the server dies, another one takes the job over after the lease runs out (or refunds it). One account cannot take every slot.

Stage A covers the persistent video queue (`VideoJob`: create video, clips, merge, missing scene pictures and clips, calendar reels) and gives the campaign image runner the same slot setting, metrics and shutdown. Videos (Omni), Photoshoot, Hero, Blueprint, plan runs and Drafts redo still run in the server that accepted the request (stage B, below).

## How it works
| Piece | Where | What it does |
|---|---|---|
| Slots | `backend/config/jobSlots.js` | Reads the variables below once, validates them (out of range is clamped, not a number falls back, one warning line each). |
| Claim | `services/videoGenerationQueue.js` `_drainQueue`, `_claimFair`, `_claim` | Per pool (image, video) the worker fills only ITS free slots. The claim is one atomic update `queued -> processing` that writes `workerId`, `leaseUntil` (now + 60 s) and `attempts + 1`. |
| Fair order | `_claimFair` | One aggregate counts running jobs per account; accounts already at `JOB_PER_USER_RUNNING` are left out of the query (so their waiting rows cannot fill the window), then among the 50 oldest waiting jobs of the others: fewest running first, oldest first on a tie. After each claim the account is re-counted; above the cap the job is handed back to the queue (attempt not counted) and not started (D76). |
| Heartbeat | `_runJob` | Every 20 s, and at every progress step, renews the lease, only while the job is still this worker's (same worker id and attempt). If that write matches nothing, the run is "lost": it stops at its next step and its result is thrown away. The pipeline (`services/runGate.js`) keeps every progress promise (no unhandled rejection) and checks, together with the queue's `isCancelled()`, before each paid step (scene plan, voice, each picture, each clip, thumbnail): a cancelled, lost or handed-back run pays for nothing more (D74). |
| Lost workers | `recoverStaleJobs` (+ `_expireLease`), every 30 s through the lease `scheduler:video-jobs:lease-sweep` and once at start | A `processing` job whose lease ran out one heartbeat ago (the margin covers clock differences between servers up to about a minute, D75): a retry-safe job goes back to `queued` (run 2 of 2, nothing charged again); anything else is failed and refunded once (the refund is claimed in the same write, `sweepRefunds` pays leftovers once with proof of the charge). Rows from older code (no worker id) keep the old 5-minute rule. |
| CPU | `services/cpuSlots.js` around `videoGenerationPipeline.runFfmpeg` | At most `CPU_SLOTS` ffmpeg processes at once per worker; a job waiting for ffmpeg keeps its claim and keeps renewing its lease. |
| Shutdown | `services/jobConsumersShutdown.js`, `server-main.js` SIGTERM | Claim nothing more, wait up to `JOB_SHUTDOWN_GRACE_MS` for running jobs, then hand back retry-safe ones to the queue (the attempt is not counted) and fail + refund the rest, before the database closes. |
| Metrics | `GET /api/metrics/queue` (staff with `run_jobs`) | Queue depth per job type and pool, running, oldest waiting age in seconds, running jobs per worker; this server's slots, slots in use, claims, completions, failures, lease re-queues, lease failures, hand-backs, lost runs. Same for campaign image jobs. Counts and server ids only. |
| CloudWatch | `services/queueMetricsEmitter.js` | OFF. With `QUEUE_METRICS_CLOUDWATCH=on` and the package `@aws-sdk/client-cloudwatch` installed, each consumer pushes `Nebulaa/Queue` `QueueDepth`, `OldestQueuedAge`, `Running`, `SlotsInUse`, `SlotsTotal` (dimension `Queue=video|image`) every 30 s. Use the Maximum statistic. Without the package: one warning, nothing sent. |

## Switches
| Variable | Default | Meaning |
|---|---|---|
| `PROVIDER_SLOTS_IMAGE` | 2 (1 to 32) | picture jobs at once per worker (also the campaign image runner) |
| `PROVIDER_SLOTS_VIDEO` | 2 (1 to 32) | video jobs at once per worker |
| `PROVIDER_SLOTS` | not set | one value for both when the specific one is not set |
| `VIDEO_QUEUE_CONCURRENCY`, `IMAGE_JOB_CONCURRENCY` | not set | older names, still honoured as the defaults |
| `CPU_SLOTS` | min(2, vCPUs) (1 to 16) | ffmpeg at once per worker |
| `FFMPEG_THREADS` | 2 (1 to 8) | threads per ffmpeg of the queue pipeline |
| `JOB_GLOBAL_CEILING` | 200 (0 = off) | safety net: no worker claims while this many run in total |
| `JOB_PER_USER_RUNNING` | `JOB_CAP_ACTIVE` or 2 | running jobs per account at claim time |
| `JOB_LEASE_MS` | 60000 (20 s to 10 min) | a claim's lease |
| `JOB_HEARTBEAT_MS` | 20000 (at most a third of the lease) | renewal interval |
| `JOB_MAX_ATTEMPTS` | 2 (1 to 5) | runs per job when its worker is lost; `1` = never re-run (old rule) |
| `JOB_SHUTDOWN_GRACE_MS` | `SHUTDOWN_DRAIN_MS` - 5 s | how long SIGTERM waits for running jobs |
| `RUN_JOB_CONSUMERS` | follows `RUN_BACKGROUND` | this server claims and runs generation jobs |
| `RUN_SCHEDULERS` | follows `RUN_BACKGROUND` | this server runs the schedulers and sweeps |
| `QUEUE_METRICS_CLOUDWATCH` | off | the CloudWatch emitter (`QUEUE_METRICS_INTERVAL_MS` 30000, `QUEUE_METRICS_NAMESPACE` `Nebulaa/Queue`) |

Provider limit rule: (max worker tasks) x `PROVIDER_SLOTS_VIDEO` must stay under the fal.ai account's concurrent-request limit, and x `PROVIDER_SLOTS_IMAGE` under the image provider's. Confirm the limits before raising the defaults (D68).

### Role combinations
| `RUN_BACKGROUND` | `RUN_JOB_CONSUMERS` | `RUN_SCHEDULERS` | Server |
|---|---|---|---|
| not set | | | single task: everything (today) |
| `0` | | | web only (no jobs, no schedulers) |
| `1` | | | worker: consumers and schedulers; several worker tasks are safe (claims + leases) |
| `1` | | `0` | consumer-only worker (add for capacity) |
| `1` | `0` | | scheduler-only worker |
| `0` | `1` | | web task that also runs jobs (possible, not recommended: ffmpeg next to customer requests) |

The start-up log line says which: `[role] worker (RUN_BACKGROUND=1): ... (job consumers on, schedulers on)`.

## Run the real-database check
From the backend folder (nebulaa_dev only; it refuses any other database; fake providers and a fake wallet; at most 40 jobs on a throwaway collection that is dropped at the end):

```
cd backend && node scripts/queue-parallel-check.js
```

If a run was interrupted:

```
cd backend && node scripts/queue-parallel-check.js cleanup
```

Last run (2026-10-20 evening, after the D74 fixes, from the Mac to the dev cluster): 4 PASS, 0 FAIL (twice in a row). 1 worker cleared 12 jobs in 8.3 s, 3 workers in 4.2 s (about 2x; from a laptop the network jitters, 1.5x to 2.7x seen on the same code, so the check's floor is 1.4x; earlier run: 8.9 s and 3.3 s, 2.7x, split 5/3/4); a killed worker's 3 jobs were taken over 3.0 s after the kill (lease 2 s in the check): 2 finished on another worker on their second run, the one that may not be re-run was failed and refunded once by two sweeps at the same moment; a provider failure refunded each of 4 charges once.

## Stage B step 1: Videos (Omni) on consumers (built 2026-10-20, NOT released, switch default OFF)
Impact map: `impact-maps/generation-parallelism.md` "Stage B step 1". Decisions D78 to D82.

In plain words: with `ENABLE_STUDIO_VIDEO_CONSUMER=on`, a Videos create (and a change) takes the Quarks, then leaves the video waiting in the database. Any worker claims it (same claim, lease and heartbeat as stage A), makes the clips in its own Omni slots and the finishing (join, subtitles, logo) in its CPU slots. Each clip is saved as soon as it is made, so if the worker stops, another one carries on after the last saved clip: nothing is made twice for the customer and nothing is charged twice. Refunds use the same proof-first, claim-then-pay machinery as before (paid at most once, never above the charge, to the wallet that paid).

| Piece | Where | What it does |
|---|---|---|
| Queue | `routes/studioVideos.js` `create`, `/:id/change`, `queueAfterCharge` | Row created as before (`processing`, no worker), charged, then flipped to `queued` (with `work`: prompts, finishing choices, or the change). A row is never claimable before its charge landed. |
| Consumer | `services/studioVideoConsumer.js` | Started with the other consumers (`RUN_JOB_CONSUMERS`) only when the switch is on. Claims `queued` rows (fair order and per-account cap as stage A), `PROVIDER_SLOTS_OMNI` making clips + finishing in `CPU_SLOTS`, heartbeat, lease sweep, SIGTERM hand-back, metrics. |
| Run | `routes/studioVideos.js` `runClaimed`, `run`/`runChain` with a control object | Every write carries the claim (worker id + attempt); a run that lost it stops and deletes its uploads. Clips stored in `clipUrls` (Cloudinary `nebula-studio-clips`, deleted once the video is closed). |
| Lost worker | `sweepLeases` | Lease ran out one heartbeat ago: run 1 -> queued again (resumes); run 2 (`JOB_MAX_ATTEMPTS`) -> failed + full refund once. |
| Unclaimed | `isStale`, studio `sweep`, `GET /`, `GET /:id` | Queued more than 30 minutes (`STUDIO_VIDEO_QUEUED_MAX_MS`) -> failed + refund once. |
| Screens | `shape()` | A queued video is answered as `processing` with `queued: true`; the web app also treats a raw `queued` as being made (older server during a deploy). |
| Metrics | `GET /api/metrics/queue` -> `studioVideos` | queueDepth, running, oldestQueuedAgeSeconds, runningByWorker, thisWorker (slots omni/cpu, slotsInUse omni/finishing, claims, finished, lostRuns, leaseRequeues, leaseFailures, released, shutdownFailed, capHandBacks). CloudWatch (when on): `Queue=omni`. |

Switches: `ENABLE_STUDIO_VIDEO_CONSUMER` (off), `PROVIDER_SLOTS_OMNI` (2, 1 to 32; `PROVIDER_SLOTS` when not set), `STUDIO_VIDEO_DRAIN_INTERVAL_MS` (5000), `STUDIO_VIDEO_QUEUED_MAX_MS` (1800000); lease, heartbeat, attempts, per-account cap, CPU slots and shutdown grace are the stage A variables. How to turn it on and off: `ecs-web-worker.md` "Videos on the worker".

Real-database check (nebulaa_dev only, a throwaway collection, fake Omni/ffmpeg/wallet, 10 videos, cleanup):

```
cd backend && node scripts/studio-video-consumer-check.js
```

If a run was interrupted:

```
cd backend && node scripts/studio-video-consumer-check.js cleanup
```

Last runs (2026-10-20 evening, from the Mac): 7 PASS, 0 FAIL, three runs in a row. 1 consumer made 3 videos in 9.1 to 9.5 s, 3 consumers in 3.4 to 4.4 s (2.1x to 2.7x; fake provider call 2.5 s); a killed consumer's 3-clip video was resumed 8 to 11 s after the kill (lease 6 s in the check) without making clip 1 again, one charge, no refund, the dead run's late result discarded; a failed video refunded its price once, a short video its missing clip once, a video lost twice refunded once by two sweepers at the same moment; every refund to the paying wallet and never above its charge.

Money review fixes (2026-10-20 night, D83 to D88): a lost reply after the queue flip answers 202 (no refund of a live claim); stale closes close only the claim they read; a claim resolving after SIGTERM is handed back; stored clips are deleted by every stale close and unresumable links by the resume; Omni calls made again after a lost lease, hand-back or unreadable clip are recorded as `studio_video` units, and consumers claim nothing at the daily ceiling or staff switch (`thisWorker.spendHolds`; the row waits and the 30-minute close refunds it); the CPU slot is only around ffmpeg; agency removal waits for open refunds; rollback needs queue depth and running at 0 first, and `scripts/studio-video-drain-queued.js` (dry run by default, `CONFIRM_DRAIN=yes`) closes and refunds leftover queued rows.

Known limits of stage B1 (not removed):
- A worker that is alive but lost its lease (database stalled longer than the lease) may finish the clip it was making while the re-run makes it again (our provider cost); at the cap the video is failed and refunded although the stalled worker could have finished (customer-favourable). Seen in the check with a 2 s lease and 2 to 4 s write spikes from a laptop; production lease is 60 s.
- A lost worker at run 2 means a FULL refund, even when some clips were made (no partial delivery from the sweep: it has no ffmpeg).
- A stored clip that cannot be downloaded again is made again (our cost). Stored clips are deleted when the video is closed; a run that crashed between upload and its database write leaves one orphan clip file (an account deletion still finds it only when its link was recorded).
- Whisper (subtitle timing) runs once per attempt: a run lost during finishing may have paid one transcription the re-run pays again (recorded in the spend guard).
- Old-code servers (before this release) would delete a `queued` row on `DELETE /api/videos/:id` without a refund: turn the switch on only after this code is live everywhere (the runbook does this).

## Stage B (one money flow per session, each with an independent read-only money review before and after)
1. Videos (Omni) create and finishing onto consumers (keep `chargeProof` and the studio sweep). BUILT (above), switch off.
2. Photoshoot: stop scheduling `runJob` in the request on web tasks; the consumer resume loop claims it (already lease based).
3. Hero: finishing moves out of the status poll into a consumer job.
4. Blueprint and plan runs: persisted claims instead of in-memory lanes.
5. Drafts redo and weekly items: first convert the inline `deductCredits`/`refundCredits` to `refundSettle` + `chargeProof`, then persist and claim.
6. Then put `CPU_SLOTS` around `mediaComposer`, `heroVideoFinish` and `studioVideoFinish` ffmpeg too.

## Known limits (not removed in stage A)
- A worker that is alive but lost its lease (database unreachable longer than the lease) keeps its provider call running until its next step while a second worker re-runs the job: at most one extra provider call (our cost); the late result is discarded.
- The per-account claim cap is re-counted after every claim and handed back when exceeded (D76): more than the cap never RUN. Two workers claiming at the same instant may both hand back, so that job waits one more drain. The entry cap (429) is still the first limit.
- A retried `create_video_pipeline` makes a new draft folder; the dead run may have left a partial one (not shown to the customer).
- Old-code servers during a rolling deploy still count all running jobs and may hold back; an old-code server STARTING (rollback) fails every running job once, as before.
- A job WITHOUT `metadata.quarkCharge` refunds nothing (D74; the old flat 11-Quark guess is gone). Every paid job type records its charge when it is enqueued:

| Enqueue site | Job type | Charge recorded in `metadata.quarkCharge` |
|---|---|---|
| `routes/videoGeneration.js` `/createVideo` | `create_video_pipeline` | `video_base` x1 (`video:<uuid>:base`) and `video_generated` x scenes (`video:<uuid>:scenes`), each with its payer |
| `routes/contentCalendar.js` `/items/:id/auto-generate` | `create_video_pipeline` | `campaign_full` x1 (`calreel:<uuid>`), payer recorded |
| `routes/videoGeneration.js` `/generateClips` (async) | `generate_clips` | `video_scene_clip` x scenes (`clips:<uuid>`), payer recorded; a running job for the draft is returned BEFORE any charge |
| `routes/videoGeneration.js` `/mergeVideo` (async) | `merge_video` | none: the merge is free, so a failure refunds nothing |
| `routes/videoGeneration.js` `/renderMissing` | `render_missing_scene_images`, `render_missing_clips` | none on the job: `perSceneCharging`, each scene is charged and refunded inside the handler |
| (no route enqueues it) | `generate_content` | handler registered only; no enqueue site today |

Known gap: two requests at the same instant can both pass the "running job" check before either has stored its job id, and both charge and enqueue (each job refunds its own charge). The route's job cap (`jobCap('video')`) limits it; a persisted per-draft claim belongs to the stage B money conversion.
- Jobs queued by older code have no recorded charge: if one of those fails after this release it is not refunded automatically (support refunds by hand). Jobs already failed with a refund claim are unaffected.
