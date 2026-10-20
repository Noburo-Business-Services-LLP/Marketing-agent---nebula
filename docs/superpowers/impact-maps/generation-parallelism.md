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
