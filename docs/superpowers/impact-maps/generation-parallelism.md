# Impact map and build plan: PARALLEL GENERATION JOBS (tester task E9), stage A

Written 2026-10-20 on branch `nebulaa-redesign`, before any E9 code. Inputs read: the tester task `/Users/dineshkannaa/Downloads/__E9 _N-10_ S-1.txt` (the spec), `HANDOVER-nebulaa-redesign-27.md` (DO NEXT 1), `HANDOVER-nebulaa-redesign-24.md` (money rules, claim-then-pay, D17 to D20), `ops/ecs-web-worker.md` (queue audit, web/worker split), `ops/hardening-sprint-mapping.md`, and the code cited below (line numbers are those of commit `398677f`).

Stage A is the safe core: the existing persistent video queue (`VideoJob`, images and videos) scales across worker tasks and stops being a global bottleneck. No flow that runs in-process today moves (that is stage B, one money flow per session). No charge or refund rule changes: the queue keeps using the existing claim-then-pay refund path.

## 0. The short version

1. Today the step-by-step video queue runs at most `VIDEO_QUEUE_CONCURRENCY` (2) jobs **for all customers together**, because `_drainQueue` counts `processing` rows in the whole collection (`services/videoGenerationQueue.js:661`). More worker tasks add nothing.
2. After stage A each worker claims jobs for **its own slots**: `PROVIDER_SLOTS` per pool (image 2, video 2 by default) plus `CPU_SLOTS` for ffmpeg (default 1 or 2 by vCPU), so total = workers x slots. A configurable global ceiling (default 200) stays as a safety net.
3. A claim is one atomic conditional update that writes `workerId` and `leaseUntil`; a heartbeat renews the lease every 20 s; every write of the running worker is conditional on its `workerId` and its attempt number, so a worker that lost its lease can never complete, fail or refund a job.
4. A lease that runs out (the worker died) is swept: a retry-safe job is re-queued (no new charge: the charge was taken by the route before the job existed), at most `JOB_MAX_ATTEMPTS` (2) runs; anything else is failed and refunded exactly once through the existing refund claim (`refundState`) and `sweepRefunds`/`settleRefund`.
5. Fair claims: per user at most `JOB_PER_USER_RUNNING` (2) running, and among waiting jobs the user with the fewest running jobs goes first (oldest first on a tie): one user cannot take all slots.
6. `RUN_JOB_CONSUMERS` and `RUN_SCHEDULERS` (both default to `RUN_BACKGROUND`) let the worker service run consumers on every task while schedulers stay leased; web tasks can consume or not.
7. Staff-only `GET /api/metrics/queue` (queue depth per type and pool, running, oldest waiting age, claims per worker, lease re-queues, failures) and an optional CloudWatch emitter that is OFF by default.
8. SIGTERM: stop claiming, let running jobs finish inside the grace time, then hand each still-running retry-safe job back to the queue (lease released) or fail and refund the rest.

## 1. Exact current behaviour (with file and line)

| What | Where | Behaviour today |
|---|---|---|
| Global cap | `services/videoGenerationQueue.js:658-691` `_drainQueue` | `activeCount = countDocuments({ status: 'processing' })` across the whole database; returns when `>= this.concurrency` (default 2, `VIDEO_QUEUE_CONCURRENCY`, line 7). Claim is `findOneAndUpdate({ status: 'queued' }, { status: 'processing', $inc: attempts }, sort createdAt)`: atomic, but no owner and no lease. Oldest first for everybody: one user with 7 jobs (2 running + 5 queued under the D41 cap) delays all others. |
| Drain triggers | lines 125-154 (`startWorker`), 369-374 (`enqueue`) | Every 15 s (5 s in a split, `VIDEO_QUEUE_DRAIN_INTERVAL_MS`) and at enqueue in a process that runs jobs. |
| Heartbeat | lines 506-510 | Every 30 s writes `metadata.heartbeatAt` and `updatedAt` while `status` is `processing` (any process could write it: no owner). |
| Restart | lines 156-174 `recoverInterruptedJobsOnStartup` | On every start, EVERY `processing` row in the database is failed and refunded (correct for one process, wrong for several workers: a starting worker would fail the jobs another worker is running). |
| Hung jobs | lines 284-324 `recoverStaleJobs` | Every minute: `processing` rows with `updatedAt` older than 5 min (`VIDEO_JOB_STALE_TIMEOUT_MS`) are failed and refunded, never re-queued ("fal.subscribe has no timeout ... re-queueing started a second paid generation"). |
| Refunds | lines 182-266 | `_failIfProcessing` ends the job AND claims the refund (`refundState: 'refunding'`) in one write; `_refundJob` pays each `metadata.quarkCharge` entry with its ref and payer; `sweepRefunds` pays leftovers once through `settleRefund` + `chargeProof` (D17 to D19). Cancel is one conditional update (line 421). |
| Writes while running | lines 447-450, 512-560 | `_updateIfProcessing` and completion are conditional on `status: 'processing'` only. |
| Who consumes | `server-main.js:698-705`, `912` | `startBackgroundJobs()` (all 24 starters, consumers and schedulers together) runs when `RUN_BACKGROUND` is not `0`. The queue's `runsJobsHere` is `runsBackground()` (line 94). |
| Shutdown | `server-main.js:976-983` | SIGTERM: health 503, HTTP close, Mongo close, exit after `SHUTDOWN_DRAIN_MS`. Running jobs are cut off; the next start fails and refunds them. |
| Job types | `routes/videoGeneration.js:96` `create_video_pipeline`, `:107` `generate_clips`, `:232` `render_missing_scene_images`, `:234` `render_missing_clips`, `:240` `generate_content`, `:297` `merge_video`; calendar reels `routes/contentCalendar.js:339` | Charges are taken in the route BEFORE `enqueue` (`routes/videoGeneration.js:1487`, `:3314`, merge similar) and recorded in `metadata.quarkCharge` only for `/createVideo`; `render_missing_*` charge each scene inside the handler (`perSceneCharging`). No handler of the other types charges. |
| ffmpeg | `services/videoGenerationPipeline.js:306` `runFfmpeg` (14 spawns go through it), `-threads 2` | No limit on how many ffmpeg processes run at once in a process. |
| Campaign image jobs | `services/imageJobQueue.js:142-205` | Already per runner: claim with `leaseOwner` + `leaseUntil`, `IMAGE_JOB_CONCURRENCY` (2) per runner, per account 2 running / 5 waiting, a lost job is failed and never re-run (no charge before delivery). Scales with workers already. |

## 2. Every flow that generates, and where it runs

| Flow | Entry | Runs where | Concurrency today | Money pattern | Stage |
|---|---|---|---|---|---|
| Step-by-step video queue (`VideoJob`): create, clips, merge, missing images/clips, calendar reels | `routes/videoGeneration.js`, `routes/contentCalendar.js:339` | Worker (or single task) via `_drainQueue` | 2 for the whole database | Route charges with ref, queue refunds through claim + sweep | **A (this change)** |
| Campaign image jobs (`ImageJob`) | `routes/campaigns.js:5669` | Worker runner | 2 per runner, 2 per account | Charge on delivery only | A: uses the shared image slot setting as its default; no money change |
| Videos (Omni studio chain) | `routes/studioVideos.js:404`, `:530` (`setImmediate`) | The web task that accepted the request (ffmpeg finishing included) | one create per account per task (`creating` Set, `:289`), 2 processing per account | `chargeProof` refunds, sweep `startStudioVideoSweep` (`:612`) | B1 |
| Photoshoot | `services/photoshoot/service.js:350` (`deps.schedule` = `setImmediate`, `:202`), `runJob` `:557` with `claimLease` (`repo.js:39`) | Web task; resume loop on the worker takes over a lost lease | 1 shoot per account (unique index), `CONCURRENCY` photos | Up-front charge, per-photo counting, refund once + `sweepUnsettled` (D17) | B2 |
| Hero clips | `services/heroVideoFlow.js:290` `startHeroGeneration` (fal queue submit in the request), finishing inside the poll `:507-515` | Web task (poll) | per account via jobCap `hero` | `refundOnce`, `sweepHeroRefunds` (`refundRecovery.js`) | B3 |
| Blueprint and plan runs | `services/blueprint/runner.js:7-24` lanes (`MAX_CONCURRENT_RUNS` 2, plan lane 1) | Web task, in memory | per process | Charge, refund claim, `sweepUnsettled` | B4 |
| Drafts picture redo, weekly calendar items | `services/backgroundQueue.js:199` `processQueue`, `routes/drafts.js:748`, `:837` | Web task, in memory, one at a time | 1 per process | Inline `deductCredits`/`refundCredits` (no claim, handover 24 "older inline callers"), stale-draft reaper | B5 (needs the inline money converted first) |
| Home drafts, weekly posts | `services/homeDrafts`, `services/week` | Web task, request-held | per request | Ledger row + refund once / week recovery | later (request-shaped, not queue-shaped) |

## 3. Target design

### 3.1 Slots (one config module, `backend/config/jobSlots.js`)
- `PROVIDER_SLOTS_IMAGE` (default 2), `PROVIDER_SLOTS_VIDEO` (default 2), `PROVIDER_SLOTS` (one value for both when the specific one is not set); the old `VIDEO_QUEUE_CONCURRENCY` still sets the video default and `IMAGE_JOB_CONCURRENCY` the image default. Each 1 to 32.
- `CPU_SLOTS`: default `min(2, os.availableParallelism())`, 1 to 16; `FFMPEG_THREADS` default 2 (1 to 8).
- `JOB_GLOBAL_CEILING` default 200 (0 = off), `JOB_PER_USER_RUNNING` default = `JOB_CAP_ACTIVE` (2), `JOB_LEASE_MS` 60 s (20 s to 10 min), `JOB_HEARTBEAT_MS` 20 s (at most a third of the lease), `JOB_MAX_ATTEMPTS` 2 (1 to 5), `JOB_SHUTDOWN_GRACE_MS` (default: drain time minus 5 s).
- Invalid values fall back to the default with one warning line; the module returns the warnings so the test can see them.
- Pools: a job's pool is set at enqueue from its type: `render_missing_scene_images`, `generate_content` -> `image`; the rest -> `video`. Rows without a pool (stored by older code) count as `video`.
- CPU pool: a process-wide semaphore around the pipeline's `runFfmpeg`: at most `CPU_SLOTS` ffmpeg processes at once in a worker; a job that has its provider result waits for a CPU slot while still holding its claim (its lease keeps being renewed), so another user's provider call is never blocked by ffmpeg.

### 3.2 Claims
- `VideoJob` gains `workerId`, `leaseUntil`, `pool`, `leaseRequeues`, `releases`; indexes `{status, pool, createdAt}` and `{status, leaseUntil}`.
- Worker id: `hostname:pid:start-time:random`.
- Claim: `findOneAndUpdate({ jobId, status: 'queued' }, { $set: { status: 'processing', workerId, leaseUntil: now + lease, startedAt }, $inc: { attempts: 1 } })`. Two workers racing for one row: the second update matches nothing.
- The drain counts only **this worker's** running jobs per pool (in memory; the worker knows what it runs) against its slots. The global ceiling is one `countDocuments({ status: 'processing' })`, skipped when `JOB_GLOBAL_CEILING=0`.
- Every write of the running handler (progress, heartbeat, completion, failure) is conditional on `{ jobId, status: 'processing', workerId: me, attempts: myAttempt }`. A heartbeat that matches nothing marks the run lost: the handler stops at its next step (`JobCancelledError`) and its result is discarded.

### 3.3 Expired leases
- A bounded sweep (25 rows, through `leaseLock` `scheduler:video-jobs:lease-sweep`, every minute and at start) takes `processing` rows whose `leaseUntil` is past (and rows of older code without a worker id whose `updatedAt` is older than 5 min: the old rule, failed, never retried).
- Retry-safe = type is one of `create_video_pipeline`, `generate_clips`, `merge_video`, `generate_content` (the handler does not charge), not `perSceneCharging`, not `metadata.noRetry`, `attempts < JOB_MAX_ATTEMPTS`, and the row was claimed by the new code. Re-queue is one conditional update on the same `workerId`, `attempts` and `leaseUntil` the sweep read, so two sweeps re-queue once.
- Otherwise: `_failIfProcessing` with the same conditions, which claims the refund in the same write, then `_refundJob`; leftovers are paid by `sweepRefunds` (unchanged). `JOB_MAX_ATTEMPTS=1` restores the old "never re-run" rule.

### 3.4 Fair scheduling
- Per pool the drain reads the 50 oldest waiting rows, counts running jobs per user among them (one aggregate on `{status: 'processing', userId: {$in}}`), skips users at the per-user cap and claims in order (fewest running, then oldest), adding each claim to the user's count: a simple round-robin by user.
- The per-user cap is enforced per drain; two workers draining at the same moment can each start one job for the same user (soft by at most workers - 1). The entry cap (D41: 2 running + 5 waiting per account) is unchanged.

### 3.5 Roles
| `RUN_BACKGROUND` | `RUN_JOB_CONSUMERS` | `RUN_SCHEDULERS` | Process |
|---|---|---|---|
| not set | default | default | single task: consumers + schedulers (today) |
| `0` | default (off) | default (off) | web only |
| `1` | default (on) | default (on) | worker: both; with several worker tasks each consumes, schedulers are leased |
| `1` | default | `0` | consumer-only worker (extra capacity) |
| `1` | `0` | default | scheduler-only worker |
| `0` | `1` | default (off) | web task that also consumes (allowed, not recommended: ffmpeg on web) |

Consumers = the video queue drain (with its lease sweep and refund sweep) and the campaign image runner. Everything else in `startBackgroundJobs()` is a scheduler.

### 3.6 Metrics
- `GET /api/metrics/queue` (staff `run_jobs`, same style as `/api/metrics/event-loop`): `{ videoJobs: { byType: {type: {queued, running}}, byPool, oldestQueuedAgeSeconds, runningByWorker }, imageJobs: { queued, running, oldestQueuedAgeSeconds }, thisWorker: { workerId, consumers, slots, running, claims, leaseRequeues, failures, releases, refundsClaimed } }`. Bounded: two aggregates over `status in (queued, processing)` and two small finds.
- CloudWatch emitter `services/queueMetricsEmitter.js`: OFF unless `QUEUE_METRICS_CLOUDWATCH=on`; uses `@aws-sdk/client-cloudwatch` only if installed (it is not today); namespace `Nebulaa/Queue`, metrics `QueueDepth`, `OldestQueuedAge`, `SlotsInUse`, every 30 s on consumer processes. Tests inject the sender; no AWS call.

### 3.7 Shutdown
SIGTERM on a consumer: stop claiming at once, wait for running jobs up to the grace time, then for each still running: retry-safe and `releases < 3` -> back to `queued` (attempt not counted, lease cleared, one conditional update on my worker id and attempt); otherwise failed + refund (the old restart behaviour, now immediate). The handler of a released job stops at its next step and cannot complete.

## 4. What each change affects

| Area | Effect | Why it stays correct |
|---|---|---|
| Charges | None: routes still charge before `enqueue`; no handler of a retry-safe type charges. A re-queued job runs the handler again with no new charge. | Retry-safe list excludes `perSceneCharging` (`render_missing_*`) |
| Refunds | Same claim-then-pay path; the only callers that refund are the winners of a conditional update (`_failIfProcessing` with my worker id and attempt, or the sweep's update on the row it read). | `refundState` is claimed in the same write that ends the job; `sweepRefunds` + `chargeProof` unchanged |
| Provider cost (ours) | A retried job can call the provider twice (the dead run and the retry); bounded by `JOB_MAX_ATTEMPTS` 2. A worker that is alive but lost its lease (database stall) keeps running until its next step. | Risk accepted and logged (D68); `JOB_MAX_ATTEMPTS=1` turns retry off |
| Leases | New per-job lease on `VideoJob`; scheduler leases (`job_leases`) unchanged; the sweep uses one new lease name. | `schedulerLeases.test.js` allowlist reason updated |
| Restarts | A restart no longer fails every `processing` job at once; jobs of the dead process are swept when their lease runs out (60 s), and retried or refunded. Rows from older code keep the old rule. | |
| Deploys | Rolling deploy with old and new code: old code still counts global `processing` (it may hold back while new workers run more: harmless); old stale rule needs `updatedAt` fresh: the new heartbeat writes it every 20 s. | |
| Agency payer | Unchanged: refunds go to `quarkCharge[].payerId`. | |
| Staff views | Usage page reads `video_jobs` as before; new fields are extra. | |
| Metrics | New staff route; nothing about any customer returned (counts and worker ids only). | |
| Per-user caps | Entry cap (D41) unchanged; new claim-time cap per user. | |

## 5. Failure modes

| Case | What happens |
|---|---|
| Worker dies mid-job (Spot reclaim, crash) | Lease runs out after at most `JOB_LEASE_MS`; the next sweep (any consumer) re-queues a retry-safe job (attempt 2) or fails and refunds it once. |
| Two workers claim the same job | Impossible: the claim matches `status: 'queued'` and the first update changes it. |
| Lease expires while the provider call is still running (database stall, event loop blocked) | The sweep re-queues (or fails) it; the old run's next write matches nothing (worker id or attempt changed): it stops and never completes, fails or refunds. Our provider cost may double for that job (bounded). |
| Provider slow | The job holds its slot; heartbeat keeps the lease; other pools and other workers are not affected. |
| Provider down | Jobs fail in the handler and are refunded once (unchanged); no retry loop: a handler failure is never retried automatically. |
| Queue flood by one user | Entry cap 2 + 5 (429), claim cap 2 running, and fair order: other users start first. |
| Restart during a refund | The refund claim is in the row (`refundState: 'refunding'`): `sweepRefunds` pays it once after 2 minutes, only with proof of the charge. |
| Sweep and a late completion race | The completion is conditional on worker id + attempt + `processing`; the sweep's update is conditional on the same values it read: exactly one wins. |
| Retried job fails again | Attempt 2 = cap: the handler failure refunds once; a second lease loss fails and refunds once. |
| Database unreachable for the sweep | It skips (lease lock or query error); nothing is ended without a successful conditional write. |

## 6. Stage B order (one money flow per session, each with an independent read-only money review)
1. **B1 Videos (Omni)**: persist the create as a `VideoJob`-style claim (or a `StudioVideo` lease) and run the chain + ffmpeg finishing on consumers; keep `chargeProof` and the studio sweep.
2. **B2 Photoshoot**: already has `claimLease`; only stop scheduling `runJob` in the request on web tasks and let consumer resume loops claim it (smallest money risk).
3. **B3 Hero**: move the finishing step out of the poll into a consumer job; the poll only reads.
4. **B4 Blueprint and plan runs**: replace the in-memory lanes with a persisted claim.
5. **B5 Drafts redo / weekly items**: first convert the inline `deductCredits`/`refundCredits` to `refundSettle` + `chargeProof`, then persist and claim.
6. Then the same `CPU_SLOTS` semaphore around `mediaComposer.runFfmpeg`, `heroVideoFinish` and `studioVideoFinish` once they run on consumers.

## 7. Tests
Unit (fake model, fake clock, fake providers; no network, no database): two workers never run the same job; concurrency = workers x slots; the old global count is gone (a busy database does not stop a free worker) and the ceiling still applies; lease expiry re-queues exactly once (two sweeps); a retried job charges once and refunds once; non-retry-safe and capped jobs fail and refund once; a lost-lease run cannot complete; per-user cap and fairness (A 5 jobs, B and C start before A's third); shutdown releases leases; slot config validation; metrics shape; role switches; CPU semaphore.
Real database: `backend/scripts/queue-parallel-check.js` (nebulaa_dev only, `zz.` users, fake providers, at most 40 jobs, cleanup, PASS/FAIL counts): 3 in-process workers, no job runs twice, throughput scales with workers, a killed worker's jobs are re-claimed, refunds exact.

---

# Stage B step 1: Videos (Omni)

Written 2026-10-20 (evening) before any stage B code, at commit `9aad851`. Decision D77 started it; decisions D78 onwards record the calls made here. Line numbers are those of `9aad851`.

## B1.0 The short version
1. Today a Videos create charges the whole price, writes the `StudioVideo`, answers 202 and runs the clips with `setImmediate` **in the web task that took the request**. A restart, a deploy or a crash loses the work; the only recovery is the stale sweep, which **refunds** (never resumes), 15 minutes per clip after the start.
2. Behind `ENABLE_STUDIO_VIDEO_CONSUMER` (default **off** = today, unchanged), the `StudioVideo` row becomes the job: after the charge it is `queued`; any consumer (a worker task, or any task with `RUN_JOB_CONSUMERS` on) claims it with the stage A protocol (one atomic conditional update writing `workerId`, `leaseUntil`, `attempts + 1`), renews the lease, runs the chain in its own `omni` provider slots (`PROVIDER_SLOTS_OMNI`, default 2) with ffmpeg inside the shared `CPU_SLOTS`, and writes progress and completion **only while the row is still its claim** (same worker id and attempt).
3. Each clip is **stored as soon as it is made** (uploaded, its link written into `clipUrls` in the same conditional write as `clipsDone`). A job whose worker died is re-queued once (`JOB_MAX_ATTEMPTS`, 2) and **resumes after the last stored clip**: clips already made are downloaded, not made again, and nothing is charged again.
4. Every refund still goes through the D19-B machinery (charge proof, the `refundState: 'refunding'` claim in the same write that closes the video, the studio sweep for leftovers), so it is paid at most once, never above the proven charge, to the recorded payer.

## B1.1 Exact current behaviour (file:line, commit `9aad851`)

| What | Where | Behaviour today |
|---|---|---|
| Create | `routes/studioVideos.js:358-418` | Per-process limiter (30 an hour, `allowed`), spend guard (`busy`, `:28`), a per-process `creating` Set (`:289`, `:367`) plus `countDocuments({ user, status:'processing', startedAt > now - 15 min x 6 })` (`:369`): at most 2 processing per account. Builds the prompts (`:386`), `StudioVideo.create` with the default `status:'processing'` (`:388`, model default `models/StudioVideo.js:9`), then `charge` (`:395`, `:271`: `settleWallet`, `quarkBuckets.spend(total, { ref: <video id>, units: clips })`, writes `payer`). Not enough Quarks: the row is deleted, 403. Then 202 with `shape(doc)` (`:401`) and `setImmediate` (`:404`): `run` for one clip (`:408`), `runChain` for 2 to 6 (`:410`). A throw before launch: `settleUnstarted` (`:279`: no proof = delete the row; proof = `fail` with a proven refund). |
| One clip | `run` `:150-164` | `omni.generate` once (no retry), `applyFinish` (`:171`, never throws, never refunds), `store` (`:140`, upload to Cloudinary `nebula-studio-videos`), `completeIfOpen` (`:252`, conditional on `OPEN` `:186`: `processing`, `refunded:false`, not `refunding`; a loser deletes its upload). Any failure: `fail` (`:243`). |
| Several clips | `runChain` `:299-327`, `services/studioVideoChain.js:103-145` `makeChain` | Clips one after another, each from the last frame of the one before (`lastFrame`, ffmpeg), each tried at most twice (`:122`), a refused idea not retried; `onClip` writes `clipsDone` (UNCONDITIONAL, `:306`, best effort `:129`). **Clips live only in memory** until the joined video is uploaded: nothing is stored between steps. Join (`concat`, ffmpeg, `:63`), finishing, upload, then `completeIfOpen` (all clips) or `finishShort` (`:330`: fewer clips = a shorter video, `quarks` lowered and the refund for the missing clips claimed in ONE update; clip 1 failing = `fail`, full refund). |
| Change | `POST /:id/change` `:507-544` | Only for a completed 10-second video; new row (`parent`), charge one clip, 202, `setImmediate(run(...))` with `omni.change` on the downloaded earlier video. |
| Refund | `closeWithRefund` `:223-241`, `payClaimed` `:199`, `fail` `:243` | Reads `chargeProof(<video id>)`; amount = min(wanted, proven spend), 0 when already refunded or no proof. Claim (status, amount, `refundPayer`, `refundState:'refunding'`) is ONE `findOneAndUpdate(OPEN)`; then `refundTo(..., { ref, payerId })`; then `refunded:true, refundState:'done'`. |
| Lost work | `isStale` `:547`, `GET /` `:550` (closes up to 5 of the caller's own), `GET /:id` `:562`, `sweep` `:584` + `startStudioVideoSweep` `:612` (every 10 min, lease `scheduler:studio-video-sweep`, started with the SCHEDULERS in `server-main.js:776`) | `processing` older than 15 min x clips since `startedAt` = `fail` (refund with proof). Rows stuck in `refunding` for 2 minutes are paid by the sweep (at most 5 tries, then an alert for a person). Never resumed. |
| Delete | `DELETE /:id` `:574` | Refused (silently, nothing deleted) while `processing` or `refunding`. |
| Readers of the status | `frontend/pages/CreateVideo.tsx:197`, `:208`, `:218`, `:372`, `:718`, `:723`; `frontend/utils/library.ts:128`; `services/agencyWorkspaces.js:109` (client removal refused while a studio video is `processing`) | Only `processing` means "being made". |
| Finishing and Whisper | `services/studioVideoFinish.js:287-327` | Subtitle timing: spend guard check, the spend row is written BEFORE the one Whisper call, one attempt, no retry (`studioTranscribe.js`). A finishing problem never fails or refunds the video. |
| Metrics | none for Videos | `GET /api/metrics/queue` covers the step-by-step queue and campaign image jobs only. |

## B1.2 New state machine (switch on)

```
create:  [row 'processing', no worker] --charge ok--> 'queued' --claim--> 'processing' (workerId, leaseUntil, attempts)
                       \--charge refused--> row deleted (403)          |  heartbeat renews leaseUntil (only while mine)
                                                                       |--all clips--> 'completed'
                                                                       |--fewer clips--> 'completed' (short) + refund claim
                                                                       |--clip 1 fails / error--> 'failed' + refund claim
                                                                       |--lease ran out, attempts < 2--> 'queued' (resume)
                                                                       |--lease ran out, attempts = 2--> 'failed' + refund claim
                                                                       |--SIGTERM--> 'queued' (hand back, attempt not counted)
'queued' longer than 30 min (no consumer anywhere) --> 'failed' + refund claim
refund claim = refundState 'refunding' in the SAME write --> paid --> 'done'  (the studio sweep pays a crashed one)
```
- `refunding` is NOT a new status: it stays the `refundState` field of D19-B (the video's `status` is already `failed` or `completed`).
- The row is created as `processing` with no worker id (exactly as today) and flipped to `queued` only AFTER the charge landed (`{ _id, status:'processing', workerId:null }` -> `queued`): a consumer can never claim a video that was not paid for. If the flip fails, the existing `settleUnstarted` path refunds the proven charge.

## B1.3 Who claims
- `services/studioVideoConsumer.js` (new), started in `startBackgroundJobs()` next to the video queue consumers, only when `RUN_JOB_CONSUMERS` is on for the process AND `ENABLE_STUDIO_VIDEO_CONSUMER` is on.
- Slots per worker: `PROVIDER_SLOTS_OMNI` (default 2, 1 to 32, `PROVIDER_SLOTS` when not set) for jobs making clips; a job in its finishing step (join, subtitles, logo, upload) frees its provider slot and waits for a `CPU_SLOTS` slot (the shared `services/cpuSlots.js` semaphore: `lastFrame`, `concat` and the finishing pass run inside it). At most `omni + cpu` jobs are held in memory per worker. Total = workers x slots.
- Fair order (same as stage A): accounts at `JOB_PER_USER_RUNNING` are left out of the candidate query, among the 50 oldest waiting rows the account with the fewest running goes first (oldest on a tie), and after a claim the account is re-counted; above the cap the job is handed back (`queued`, attempt not counted). `JOB_GLOBAL_CEILING` counts running Videos rows.
- A web task with the switch on and consumers off only stores `queued`; a worker drains every 5 s (`STUDIO_VIDEO_DRAIN_INTERVAL_MS`). A task that runs consumers drains at once after its own create.

## B1.4 Retry rules (resume, never re-charge)
- Clips are NOT durably stored today (B1.1). DECISION (D78): on the consumer path each clip is uploaded as soon as it is made (Cloudinary folder `nebula-studio-clips`, the same uploader as the finished video) and its link is written with `clipsDone` in ONE write conditional on `{ status:'processing', workerId, attempts }`. If that write matches nothing, the run has lost its claim: the clip upload is deleted and the run stops.
- A re-run (attempt 2) downloads the stored clips in order (`safeFetch`, the same caps as `/change`), takes the last frame of the last one, and continues with the next clip. Clips already stored are never generated again and nothing is charged again (the only charge is the one `create` took). A stored clip that cannot be downloaded ends the stored prefix there: from that clip on, the clips are made again (our provider cost, never the customer's).
- An upload that fails does not stop the video (the clip stays in memory and the video can still be delivered); later clips are then not stored either (a resume needs an unbroken prefix), so a retry after that point re-makes them (our cost).
- `JOB_MAX_ATTEMPTS` (default 2) caps the runs; a lost lease at the cap = failed with a FULL refund (customer-favourable; the clips made are discarded). A provider failure is never retried by the consumer (the chain's own one retry per clip is unchanged), so partial delivery stays exactly as today: clip k fails twice -> a shorter video with the missing clips refunded; clip 1 fails -> full refund.
- One clip and `/change`: the same resume rule (the one clip, once made, is stored before finishing), so a death during finishing or upload does not call Omni again.
- SIGTERM hand-back: at most 3 per job (`releases`), the attempt is not counted, resumable like a lease loss. A fourth = failed + refund.

## B1.5 Refund rules
- Unchanged machinery: `closeWithRefund` (proof first, amount = min(wanted, proven spend), 0 when a refund exists, claim in the same write, pay, mark done), `payClaimed`, the studio `sweep` for `refunding` rows older than 2 minutes. On the consumer path every close carries the claim's owner conditions (`workerId`, `attempts`, and for the lease sweep the `leaseUntil` it read), so of a late completion, a lease sweep, a SIGTERM hand-back and the old stale ceiling exactly ONE write wins, and only the winner pays.
- Payer: the refund goes to `proof.spend.payer` (the wallet the charge came from, the agency for a client workspace), recorded in `refundPayer` as today.
- A row that is `queued` and older than 30 minutes (`STUDIO_VIDEO_QUEUED_MAX_MS`; nothing claimed it: consumers switched off or down everywhere) is failed and refunded by the studio sweep and by `GET /`, `GET /:id`, like a stale `processing` row.

## B1.6 API and screens
- `POST /create` and `/:id/change` still answer 202 with the video; `GET /:id` and `GET /` answer the same shape. DECISION (D79): `shape()` shows a `queued` row as `status: 'processing'` with an extra `queued: true`, so every reader (Videos page, Library, staff) keeps working unchanged. The frontend additionally treats a raw `queued` like `processing` (`CreateVideo.tsx`, `library.ts`), because during a rolling deploy an OLD-code web task (which has no such mapping) can answer a poll for a row a new task queued.
- `DELETE /:id` is also refused while `queued` (it is charged and about to run).
- The create cap counts `queued` and `processing` (2 per account).
- Agency client removal (`services/agencyWorkspaces.js:109`) counts `queued` and `processing` studio videos as running work.
- Staff views: the usage page reads the Quark ledger (`studio_video` action), unchanged. Metrics: `GET /api/metrics/queue` gains `studioVideos` (queued, running, oldest waiting age, running per worker, this worker's slots and counters), and the CloudWatch emitter (when on) a `Queue=omni` dimension.

## B1.7 Finishing and Whisper
- Unchanged: the finishing pass runs once per attempt, inside a CPU slot; the Whisper spend row is written before its one call. A run that loses its claim during finishing may have paid one transcription the retry pays again (our cost, recorded in the spend guard; bounded by 2 attempts).

## B1.8 Restart, deploy, SIGTERM, rolling deploy
- SIGTERM: the consumer stops claiming, waits `JOB_SHUTDOWN_GRACE_MS` for running videos, then hands each one back to `queued` (resumable) before the database closes. A kill without SIGTERM: the lease runs out (60 s + one heartbeat margin) and the lease sweep of any consumer re-queues it.
- Rolling deploy, the switch decides who runs what:
  - switch off everywhere (default): nothing changes. The consumer is not started, no row is ever `queued`.
  - new tasks with the switch on, old tasks still running: new creates write `queued`; OLD code never writes, claims or sweeps `queued` rows (its sweep and stale checks read `processing` only). A `processing` row claimed by a new consumer can be closed by an OLD server's stale ceiling (15 min x clips since the claim's `startedAt`), exactly as a new server would; the consumer's later writes are conditional and lose, the result is discarded, and the refund is paid once (OPEN + `refundState` claim). Old code's own in-process creates stay `processing` with no worker id and are never claimed by a consumer (the consumer only claims `queued`, the lease sweep only reads rows with a worker id).
  - Turn the switch on in the web AND the worker service in the same release (`ecs-web-worker.md`); a web task with the switch on and no consumer anywhere leaves rows `queued`, which are refunded after 30 minutes (the safety net, not the plan).
- Rollback: switch off (instant); rows already `queued` are still claimed by any new-code consumer only while its switch is on, so switch off AFTER the queue is empty, or let the 30-minute rule refund them. Rolling back the code with rows `queued`: old code ignores them, a new-code server (any) refunds them after 30 minutes.

## B1.9 Failure modes

| Case | What happens |
|---|---|
| Consumer dies mid-chain | Lease runs out; a sweep re-queues (attempt 2); a consumer claims, downloads the stored clips, makes the rest. No new charge. |
| Dies again | Attempt 2 = cap: failed, full refund once. |
| Alive but lost its lease (database stall) | Its next clip write, heartbeat or close matches nothing: it stops, deletes its upload; the late result is discarded. The other run may repeat one clip (our cost). |
| Two consumers, one row | Impossible: the claim matches `status:'queued'`. |
| Lease sweep and late completion race | Both conditional on worker id + attempt (+ lease end for the sweep): one wins. |
| Provider down | Clip 1 fails twice -> failed + full refund; later clip -> short video + partial refund (today's rule). |
| Upload of a clip fails | The video goes on from memory; only resumability is lost from that clip. |
| Database down for the flip after the charge | `settleUnstarted` refunds the proven charge (or the stale rule does). |
| Account deleted while queued or processing | Rows deleted: the claim finds nothing, a running claim's next write matches nothing and stops. |
| No consumer anywhere (misconfiguration) | `queued` > 30 min = failed + refund. |
| Refund crash | `refundState: 'refunding'` stays; the studio sweep pays once with proof. |

## B1.10 Tests
Unit (fake model with a fake clock, fake Omni, fake ffmpeg and finishing, fake wallet): two consumers never run the same video; concurrency = consumers x slots; a consumer that dies mid-chain is resumed (clips made once, one charge, at most one refund, partial delivery rules kept); lease-expiry races (two sweeps, sweep vs late completion); a late result after lease loss is discarded; delete while queued and processing; per-user cap and fairness; switch off keeps the in-process path; rolling-deploy coexistence (old-style rows are not claimed; old stale ceiling vs consumer); SIGTERM hand-back; metrics shape; the existing studio tests pass unchanged. Real database: `backend/scripts/studio-video-consumer-check.js` (nebulaa_dev only, a throwaway collection, `zz.` accounts, fake Omni and ffmpeg, at most 12 videos, cleanup, PASS/FAIL counts).

---

# Stage B step 2: Photoshoot

Written 2026-10-20 (night) before any stage B2 code, at commit `7867b59`. Decisions D90 onwards record the calls made here. Line numbers are those of `7867b59`. Template: stage B1 (Videos), its money review (D83 to D88) and the earlier Photoshoot money review (`ops/review-money-paths-2026-10-19.md`: S1 charge that throws, S2 history proof, S4 refund retries, M1 refund claim first).

## B2.0 The short version
1. Today a Photoshoot is already a durable job (`photoshoot_jobs`): the row is written before the charge, the charge is taken up front with the job id as `ref`, every photo has its own status and attempt count on the row, and a runner holds a 10-minute lease. But the runner is started with `setImmediate` **in the web task that took the request** (`service.js:350`), and a lost runner is taken over by the in-process resume loop (`resumeLost`, a scheduler) in whichever process runs it, outside any slot accounting.
2. Behind `ENABLE_PHOTOSHOOT_CONSUMER` (default **off** = today, unchanged), the charged row waits in the database and a worker consumer claims it with the stage A protocol (one atomic conditional update writing the worker id into `leaseOwner`, a 60 s `leaseUntil` and `runs + 1`), renews the lease with a heartbeat, makes the photos in `PROVIDER_SLOTS_PHOTOSHOOT` job slots per worker (default 2), and writes every photo start, photo result and the close **only while the row is still its claim**.
3. Photos are already stored per index as they are made (`photos[i].url`, `status: 'done'`). A job whose worker died is re-queued (at most `JOB_MAX_ATTEMPTS`, 2 runs) and the next run makes only the photos that are not finished. Nothing is charged again: the one charge is the one `startJob` took.
4. Money rules are the existing ones (10 Quarks a photo, up front, idempotency key, one job in flight per account, the caps, failed photos refunded, everything refunded when none was made) but every consumer close reads the charge proof first (`quarkBuckets.chargeProof`, amount = min(wanted, proven), 0 when a refund exists), claims the refund in the SAME conditional write that closes the job, then pays with the job id as `ref`; a crash after the claim is settled by the existing settle sweep (one claim, `refundSettlingAt`), which for consumer rows decides through `refundSettle.settleRefund` (pays only with proof, never above it).

## B2.1 Exact current behaviour (file:line, commit `7867b59`)

| What | Where | Behaviour today |
|---|---|---|
| Create / redo | `service.js:398` `create`, `:437` `redo` | Precheck (switch, staff, entitlement, key), per-process lock (`locks`), idempotency (`findByKey`), `resumeLost`, one in flight (`anyInFlight` + the unique partial index `one_in_flight_per_account`), input, caps (`capsProblem` `:230`: 3 starts a minute, 60 photos per India day, `MAX_RUNNING_ALL_ACCOUNTS` 30 counted as `inFlight` + `running`), spend guard, then `startJob`. |
| Charge | `startJob` `:309-352` | `repo.insert` (status `queued`, `inFlight: true`, every photo `pending`) BEFORE the charge; `settle`; `spend(user, cost, { action: 'photoshoot_image', ref: <job id>, units: photos })`. A throw: `settleUnsureCharge` (`:359`, proof decides, else the stale sweep). Refused: `closeRefused`. Then `markCharged` (`repo.js:25`: `queued` -> `running`, `quarks`, `payerId`, `chargedAt`); if that fails, `closeLedger` claims the refund first (M1) and pays it. Then `deps.schedule(runJob)` (`setImmediate`) and 202. |
| Runner | `runJob` `:557-589` | `claimLease` (`repo.js:39`: `running` and lease free or mine, 10 min), `releaseCalling` (a photo left `calling`: back to `pending` if it has a call left, else failed `lost`), rounds: re-read, `MAX_AGE_MS` (60 min from `chargedAt`) closes open photos `stale`, staff switch closes them `switched_off`, `CONCURRENCY` (2) photos at once (`makePhoto` `:506`: `startPhoto` counts the attempt BEFORE the call, a second call is recorded in the spend guard, `finishPhoto` writes the result while the photo is `calling`), `renewLease` after each batch. Then `finalize`. |
| Close and refund | `finalize` `:531-554`, `repo.finalize` `repo.js:63` | ONE conditional write closes the job (`done`/`partial`/`failed`) and claims the refund (`refunded: true`, `refundedQuarks` = failed x 10, everything when none was made), unsets `inFlight` and the lease; then `refundTo(..., { ref: <job id>, payerId })`; paid -> `refundSettledAt`; failed -> `refundFailed` + alert. The amount is NOT checked against the charge proof here. |
| Settle sweep | `sweepUnsettled` `:628` (D17) | Closed jobs with `refundedQuarks > 0`, no `refundSettledAt`, finished over 2 minutes ago: claimed (`refundSettlingAt` hold), proof read, refund paid once (min(recorded, proven); recorded when no proof), settled. |
| Refund retries | `retryRefunds` `:659` (S4) | `refundFailed` rows: claimed, proof read, paid, back-off, give up after 5 with an alert. |
| Stale queued | `sweepStale` `:597` | `queued` rows older than 3 minutes (the charge may or may not have landed): the proof decides, closed `failed` with the proven refund claimed in the same write (`closeStale`). |
| Lost runner | `resumeLost` `:688`, `get` `:708`, `startPhotoshootResume` (`index.js`, scheduler, lease `scheduler:photoshoot-resume`, every 2 min) | `running` rows with no lease or an expired one: `runJob` scheduled in THIS process. |
| Readers | `jobView` `:122` (`queued` shown as `running`), `frontend/utils/photoshoot.ts:26` | The page knows `running`, `done`, `partial`, `failed`, `refused`. |
| Agency client removal | `services/agencyWorkspaces.js:103` `runningWork` | Does NOT look at `photoshoot_jobs` at all (a client with a running or refund-pending photoshoot can be removed today; its refund would then have no wallet to land in). |
| Metrics | `routes/metrics.js` | No photoshoot entry. |
| SIGTERM | `services/jobConsumersShutdown.js` | Not involved: an in-process runner is cut off and taken over after its 10-minute lease. |

## B2.2 New state machine (switch on)

```
create:  row 'queued', via:'consumer', chargedAt:null   (written BEFORE the charge, exactly as today; not claimable)
         --charge refused--> 'refused'                    --charge threw--> settleUnsureCharge / stale sweep (today's rules)
         --charge ok--> SAME row: 'queued' + chargedAt + quarks + payerId + quarkCharge + queuedAt   (claimable)
                         |--claim--> 'running' (leaseOwner = workerId, leaseUntil = now + 60 s, runs + 1)
                         |              |--heartbeat renews leaseUntil (only while leaseOwner and runs are mine)
                         |              |--every photo finished--> 'done' | 'partial' | 'failed'  + refund claim (proof first)
                         |              |--lease ran out, runs < JOB_MAX_ATTEMPTS--> 'queued' (resume: only unfinished photos)
                         |              |--lease ran out at the cap--> open photos failed 'lost', closed + refund claim
                         |              |--older than MAX_AGE_MS since the charge (alive but stuck)--> open photos 'stale', closed + refund claim
                         |              |--SIGTERM--> 'queued' (hand back, runs not counted, at most 3 times, then closed + refund)
                         |--queued longer than 30 min (no consumer anywhere)--> every photo failed, closed + full refund claim
refund claim = refunded:true + refundedQuarks + refundPayer in the SAME write that closes the job --> paid --> refundSettledAt
               (a crash in between: the settle sweep pays it once, with proof)
```
- DECISION (D90): the waiting state is the existing status `queued` plus a recorded charge (`chargedAt` set, `via: 'consumer'`), not a new status. Why: (a) `jobView` already shows `queued` as `running`, so the page (and an OLDER server answering a poll during a rolling deploy) needs no change; (b) every place that treats `queued` as "written, not yet charged" (`sweepStale`, `closeStale`, `closeLedger`, `closeRefused`) gains the condition `chargedAt: null`, which every in-process `queued` row already meets (in-process rows go `queued` -> `running` and get `chargedAt` in the same write), so the switch-off path is unchanged; (c) an older image (the production release `3a281f2` has this Photoshoot code) closes a waiting row through its own stale sweep 3 minutes after it was created, with the proven refund (customer-favourable), instead of leaving it charged and never delivered. The drain-before-rollback rule stays MANDATORY anyway (B2.8).
- The claim reuses the existing lease fields: `leaseOwner` holds the worker id. So the in-process `claimLease` of either code version can never take a consumer row while its 60 s lease is fresh, and every consumer write is conditional on `{ status: 'running', leaseOwner: me, runs: myRun }`.
- `via: 'consumer'` is written at insert on the consumer path only. It is the claim marker the in-process paths respect: the resume loop (`lostJobs`) and `get` never schedule `runJob` for a consumer row; the consumer claims only consumer rows.

## B2.3 Who claims
- `services/photoshootConsumer.js` (new), started in `startBackgroundJobs()` with the other consumers, only when `RUN_JOB_CONSUMERS` is on for the process AND `ENABLE_PHOTOSHOOT_CONSUMER` is on.
- Slots per worker: `PROVIDER_SLOTS_PHOTOSHOOT` (default 2 jobs, 1 to 32, `PROVIDER_SLOTS` when not set). Each job still makes `CONCURRENCY` (2) photos at once, so a worker has at most 2 x 2 = 4 image calls in flight. DECISION (D91): 2 is a GUESS like D68 and D81 (the image provider's concurrency limit for our account is not known): (max workers) x `PROVIDER_SLOTS_PHOTOSHOOT` x 2 must stay under it. Confirm the limit before raising it.
- CPU slot: a Photoshoot does no local image work (the references are downloaded and passed on as base64, the result is stored by the provider wrapper, `services/openaiImage.js`; no sharp, canvas or ffmpeg in `services/photoshoot/*`), so it takes NO `CPU_SLOTS` slot. If local image processing is ever added, it goes inside `cpuSlots().run` (the consumer passes `ctl.cpu` for that).
- Fair order (stage A): accounts at `JOB_PER_USER_RUNNING` (counted over ALL running photoshoot rows of all workers and the in-process path, one aggregate) are left out of the candidate query; among the 50 oldest waiting rows the account with the fewest running goes first, oldest on a tie; after the claim the account is re-counted and the job handed back (runs not counted) when above the cap (D76; not D74's multiplied cap). In practice one account has at most one photoshoot in flight (the unique index), so the cap is a second line.
- `JOB_GLOBAL_CEILING` counts running photoshoot rows. The existing all-accounts cap (`MAX_RUNNING_ALL_ACCOUNTS` 30) counts waiting consumer rows too when the switch is on (otherwise a queue could grow without limit).
- Daily spend guard: the consumer claims nothing while `spendGuard.check('photoshoot_image')` or `check('image_generated')` says `daily_cap` (the row waits; the 30-minute close refunds it); counted in `thisWorker.spendHolds`. A staff switch (`switched_off`) does NOT hold claims: the claimed run closes the job at once as `switched_off` with the refund (today's rule in `runJob`), so a paused feature returns Quarks within seconds instead of 30 minutes.
- Re-run provider calls: a photo called again after a lost worker already has `attempts >= 1` on the row, so `makePhoto`'s existing rule records that call in the spend guard (the first call of every photo is covered by the charge). No over-recording.
- A web task with the switch on and consumers off only stores the waiting row; a worker drains every 5 s (`PHOTOSHOOT_DRAIN_INTERVAL_MS`). A task that runs the consumer is kicked at once by its own create.

## B2.4 Retry rules (resume, never re-charge, never re-make a finished photo)
- A finished photo (`done` with its link, or `failed`) is never called again by any run. A photo left `calling` by a dead run goes back to `pending` only if it has a call left (`MAX_CALLS_PER_PHOTO` 2; its second call is recorded in the spend guard), else it fails `lost` and is refunded. Same rule as today's `releaseCalling`, now conditional on the new claim.
- `JOB_MAX_ATTEMPTS` (default 2) caps the runs; a lost lease at the cap closes the job with the per-photo rule (finished photos kept and charged, open photos failed and refunded; everything refunded when none was made). Unlike Videos there is no need for a full refund: each photo is delivered on its own.
- A provider failure is never retried by the consumer beyond the existing one extra call per photo.
- SIGTERM: the consumer claims nothing more, tells every run to stop before its next batch (calls already in flight finish and are recorded while the claim is still valid), waits `JOB_SHUTDOWN_GRACE_MS`, then hands each job back (`queued`, runs not counted, `releases + 1`, at most 3, then closed with the per-photo refund). A claim that resolves after SIGTERM began is handed back too (D85).
- Hard ceiling: a running consumer row older than `MAX_AGE_MS` (60 min) after its charge plus one heartbeat (a worker that is alive but stuck on a provider call, so its heartbeat keeps the lease fresh) is closed by the lease sweep on the claim it read (open photos `stale`, refunded).

## B2.5 Money rules (unchanged numbers, proven helpers)
- Charge: unchanged `quarkBuckets.spend(user, 10 x photos, { action: 'photoshoot_image', ref: <job id>, units: photos })`. On the consumer path the SAME write that makes the row claimable records `quarkCharge: { action, ref, quarks, payerId }` (like `metadata.quarkCharge` of the video queue) and the payer.
- Close (consumer path, every close: run end, lease sweep at the cap, hard ceiling, SIGTERM over the hand-back limit, queued timeout): (1) open photos failed with the reason, conditional on the claim read; (2) proof first (`chargeProof(<job id>)`; unreadable = left open, the lease sweep or the next run tries again); amount = min(wanted, proven spend), 0 when a refund already exists or there is no proof; (3) ONE conditional write closes the job and claims the refund (`refunded: true`, `refundedQuarks`, `refundPayer` = the proven payer, `inFlight`/lease unset), filtered on `refunded: false`, every photo finished AND the claim's conditions (`leaseOwner` + `runs`, plus the `leaseUntil` read for a sweep; `status: 'queued'` + `queuedAt` for the queued timeout); (4) `refundTo(user, amount, { ref: <job id>, payerId })`; (5) `refundSettledAt`. A refund that does not land: `refundFailed` + alert; the existing retry loop pays it (for consumer rows through `settleRefund`).
- Crash after the claim: the existing settle sweep (`sweepUnsettled`) is the ONE settle path for both kinds of rows, so there is no second handler that could pay twice; it claims each row with `refundSettlingAt`, the same field an older image uses, so old and new code never pay the same row at once. For consumer rows (`via: 'consumer'`) it decides through `settleRefund` (pays only with proof, never above the proven charge, to the recorded payer); in-process rows keep today's rule.
- Payer: the refund goes to the wallet the charge came from (the agency pool for a client workspace).

## B2.6 API and screens
- `POST /jobs` and `/jobs/:id/photos/:index/redo` still answer 202 with the job (`status: 'running'`). Replay of the key, `GET /jobs`, `GET /jobs/:id`, Library: unchanged shapes. No frontend change.
- Lost reply after the queue write (D83): the charge landed and the write that makes the row claimable threw: the row is re-read; a recorded charge (`chargedAt` set) means the job was accepted: 202 with it, nothing refunded. `closeLedger` now only matches rows with no recorded charge, so it can never refund an accepted job. If the re-read also fails the answer is the existing 503 "If any Quarks were taken, they come back by themselves" while the job is made (double failure; money-safe: nothing is refunded twice and nothing is charged again).
- `GET /jobs/:id` of a consumer row never schedules an in-process run; a waiting row past the 30-minute limit is closed and refunded when it is looked at (like Videos).
- Agency client removal: `runningWork` gains `photoshoots` (`PhotoshootJob`: in flight, or a refund recorded and not yet settled, or `refundFailed` not given up). This also closes today's gap for the in-process path.
- Metrics: `GET /api/metrics/queue` gains `photoshoot` (`queueDepth`, `running`, `oldestQueuedAgeSeconds`, `runningByWorker`, `thisWorker`: slots, slots in use, claims, finished, lost runs, lease re-queues, lease failures, released, shutdown failed, cap hand-backs, spend holds, ceiling closes, orphans deleted).

## B2.7 Failure scenarios per step

| Step | Case | What happens |
|---|---|---|
| Before the charge | Crash after the insert | Row `queued`, no charge: the stale sweep (3 min) finds no proof, closes it with 0 refund (today). Not claimable (no `chargedAt`). |
| Charge | `spend` throws | `settleUnsureCharge` (today, S1): proof shows a charge = closed and refunded once; else left for the stale sweep. Never claimable. |
| After the charge, before the queue write | Crash | Row `queued`, `chargedAt: null`, charge landed: the stale sweep refunds it once from the proof (today's rule). Never claimable, so it is never made AND refunded. |
| Queue write | Lost reply | Re-read: accepted -> 202, no refund (B2.6). Not accepted -> `closeLedger` claims and refunds once (M1 rule). |
| Double click | Same key | `findByKey` replay (same job, no second charge); a second press while the first is inside `startJob` gets the per-process lock (409) or the unique in-flight index (409 or replay). |
| Claim | Three workers race | One atomic update on `status: 'queued'`, `via`, `chargedAt != null`: exactly one wins. |
| Worker dies mid-photo | Lease runs out | Sweep (one heartbeat margin, D75): runs < 2 -> `queued`; the next claim resets `calling` photos (one more call or failed), makes only open photos. Same charge, nothing re-made that was finished. |
| Worker alive but lost the lease (database stall) | Its next photo start, photo result, heartbeat or close matches nothing | It stops; a photo result it could not record is deleted from the image host (orphan rule); the other run may call that photo again (our cost, recorded). |
| Dies again at run 2 | Cap | Closed with the per-photo refund once (two sweeps at once: one wins on `leaseUntil` + `refunded: false`). |
| Cancel | None for customers | The staff switch closes the rest `switched_off` and refunds (claimed rows at the next batch, waiting rows at once on claim). |
| Restart / deploy | SIGTERM | Hand back (resumable). Kill without SIGTERM: lease sweep. |
| Agency client removal | While waiting/running/refund pending | Refused (`runningWork`), the client stays. |
| Refund claim races | Run close vs lease sweep vs settle sweep vs old-code settle sweep | Close and sweep closes: one conditional write wins (`refunded: false` + the claim). Payment after a crash: one settle claim (`refundSettlingAt`) at a time, proof read after the claim (already refunded = only marked). |
| Daily spend guard | Ceiling reached | Consumers claim nothing; waiting rows are refunded after 30 min if the ceiling does not lift. A row already claimed carries on (its spend was counted at the charge). |
| No consumer anywhere | Misconfiguration | Waiting rows are closed and refunded after 30 min (`PHOTOSHOOT_QUEUED_MAX_MS`) by the resume loop (a scheduler, independent of the switch) and by `GET /jobs/:id`. |
| Switch turned off with rows waiting or running | Consumer not started on the next deploy | Running rows: their worker's SIGTERM hands them back; the resume loop's consumer sweeps (lease, queued timeout) still run on schedulers and close/refund them within 30 min. They are never run in-process (the marker). |
| Account deleted | Rows deleted | Claim finds nothing; a running claim's next write matches nothing and stops. |

## B2.8 Old code, rolling deploy and rollback hazard
- Switch off everywhere (default): no `via: 'consumer'` row exists; every new condition (`chargedAt: null` on the queued paths, `via != consumer` on the resume loop) matches every in-process row: behaviour unchanged, existing tests unchanged.
- Old code and consumer rows: an older image never claims a waiting row; its stale sweep closes a waiting row 3 minutes after it was created (customer refunded with proof); its resume loop takes over a consumer `running` row only after the 60 s lease ran out (a dead worker) and finishes it in-process with today's rules. Both are money-safe (conditional writes, refund claimed once) but not intended for normal running.
- MANDATORY rule (as handover 28 for Videos): before ANY image rollback while `ENABLE_PHOTOSHOOT_CONSUMER` is on: switch it off on the web service, wait until `GET /api/metrics/queue` shows `photoshoot.queueDepth` = 0 and `photoshoot.running` = 0, then the worker, then the image. An image from before the Photoshoot code (or before this release) would leave waiting rows charged, never made and blocking the account (`inFlight`). Leftovers: `backend/scripts/photoshoot-drain-queued.js` (dry run by default, `CONFIRM_DRAIN=yes`, refuses a URI without a database name; lists counts of waiting and running consumer rows; closes waiting rows through the same proof-first close). Never run against a real database without the owner.
- Turn-on order: release first and check it; worker service with `RUN_JOB_CONSUMERS=1` and the switch first, then the web service.

## B2.9 Tests (fakes only)
Unit (fake repo with the same conditional rules, fake clock, fake generator, fake wallet with a fake charge proof): claim exactly once across 3 simulated workers; a lost worker's job resumes without re-making finished photos and without a second charge; lost reply after the queue write answers 202 and refunds nothing; double click (same key) is one job and one charge; partial failure refunds only the failed photos, once; all-fail refunds everything, once; a stale close (sweep) cannot be overwritten by the late run and the late photo file is deleted; SIGTERM hand-back (and a claim that resolves after SIGTERM); per-account cap counted across workers (re-count after the claim); queued timeout refunds once; spend-guard hold; staff switch closes on claim; the settle sweep pays a crashed consumer close once with proof and never twice with an older-style sweep; switch OFF keeps the old path (the existing photoshoot test files pass unchanged); the drain script (pure part) lists and closes waiting rows; metrics shape; start gating (`RUN_JOB_CONSUMERS` and the switch). Real database: `backend/scripts/photoshoot-consumer-check.js` (nebulaa_dev only, a throwaway collection `zz_photoshoot_consumer_check`, fake generator and wallet, throwaway account ids, 3 simulated workers in one process: claims, resume, refunds, caps, metrics; bounded; PASS/FAIL; cleanup; non-zero on a leftover).
