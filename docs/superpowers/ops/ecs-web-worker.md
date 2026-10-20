# Scaling: web tasks and one worker task (Phase 1 code, Phase 2 AWS steps, Phase 3 checks)

Why: the tester's load test (`/Users/dineshkannaa/Downloads/Generation flow.txt`) showed one Node process tops out around 130 to 145 requests a second and that the 10+ background schedulers, queues and ffmpeg share that process with customer requests. The plan: run the same backend image as two ECS services, `web` (customer requests, 2 to 6 tasks behind the load balancer) and `worker` (every background job, exactly 1 task, not behind the load balancer). Decisions D31 to D38 in `docs/superpowers/DECISIONS-LOG-2026-10-20.md`.

**Update E9 stage A (2026-10-20, `generation-parallelism.md`):** generation jobs are now claimed per worker with leases, so the worker service may run MORE than one task: each task runs its own slots (`PROVIDER_SLOTS_IMAGE`/`_VIDEO`, `CPU_SLOTS`) and the scheduler ticks stay leased (one runs each tick). New switches `RUN_JOB_CONSUMERS` and `RUN_SCHEDULERS` (both default to `RUN_BACKGROUND`): the worker service sets `RUN_JOB_CONSUMERS=1`; extra worker tasks may set `RUN_SCHEDULERS=0`. Keep the worker at exactly 1 task until this code is released and the first deploy is checked; then raise it.

Nothing here changes how today's single backend task behaves until the owner sets the new variables. Phase 1 is code (done on `nebulaa-redesign`, not released). Phase 2 is AWS console/CLI work for the owner. Phase 3 is the re-test.

## Phase 1: what the code does now

| # | Item | What changed | Where |
|---|------|--------------|-------|
| 1 | `RUN_BACKGROUND` | Every scheduler, sweep, queue consumer and loop of `server-main.js` (24 starters) is inside one function, `startBackgroundJobs()`, called only where background jobs run. `RUN_BACKGROUND` not set = single task (today, unchanged); `1` = the worker of a split; `0` = a web task (starts none of them). One log line at start says which. A web task stores old-style video jobs and leaves them to the worker. The plan clean-up at start ends only stale runs in a split (in a single task it still ends all). Guard test: `tests/runBackground.test.js` (every starter inside the gate, none outside, no module starts a timer at load time except one local cache). | `backend/server-main.js`, `services/backgroundRole.js`, `services/videoGenerationQueue.js`, `services/plan/planService.js` |
| 2 | Health | `/api/health` and `/api/ready` both answer 200 only when MongoDB is connected (readyState 1) and answers a ping (kept 5 s), 503 otherwise and while shutting down (commit `3b2dbf0`, verified, `tests/healthCheck.test.js`). Point the target group at **`/api/ready`**. SIGTERM: 503 at once, stop accepting, exit when open requests finish, at most `SHUTDOWN_DRAIN_MS` (default 20 s, now a setting, at most 115 s). | `services/healthCheck.js`, `server-main.js` |
| 3 | Proxy and limits | `trust proxy` = `TRUST_PROXY_HOPS`, default **1** (the ALB); verified (`tests/rateLimits.test.js`). The sign-in bucket covers only the credential routes (verified). NEW: every one of the app's **38 limiters** is made through `services/rateLimitStore.js`, which picks the store from `RATE_LIMIT_STORE`: `memory` (default), `mongo` (shared, recommended with 2+ web tasks), `redis` (only with `REDIS_URL` and the optional packages `rate-limit-redis` + `redis` installed; otherwise a warning and Mongo). The general per-address limiter (every request) stays per task even with the shared store unless `RATE_LIMIT_GENERAL_SHARED=on` (D32). | `services/rateLimitStore.js`, `middleware/rateLimits.js`, 21 route files |
| 4a | OAuth state | Google Calendar, YouTube and the four direct social callbacks: state is 32 random bytes, stored only as its SHA-256 in `oauth_states` with the account, the purpose and a 10 minute TTL, used once. A callback may land on any task. | `services/oauthState.js`, `models/OAuthState.js` |
| 4b | Campaign image jobs | Stored in `image_jobs` (TTL), claimed with a lease by the runner on the worker (or the single task): `IMAGE_JOB_CONCURRENCY` at once (default 2), per account 2 running and 5 waiting, the 6th gets 429; a job whose runner died is failed ("This did not finish. Please try again.") and never re-run (the charge is only taken when a picture is delivered, so nothing to refund). The status poll works from any task and shows the queue position. The in-process `campaignImageQueue` is gone. | `services/imageJobQueue.js`, `models/ImageJob.js`, `routes/campaigns.js` |
| 4c | Live updates | Socket.IO gets the Redis adapter only when `REDIS_URL` is set and `@socket.io/redis-adapter` + `redis` are installed (lazy; otherwise one log line "live updates are single-process"). The Inbox live stream (SSE, which is what the web app really uses) is forwarded to the other tasks through it. No frontend change: the web app creates no Socket.IO client (it uses `EventSource` in `frontend/services/api.ts` `openSocket`), so there is no transport to switch. | `services/socketAdapter.js`, `services/socketHub.js` |
| 4d | Local disk | Audited (table below). No migration built. | this file |
| 5 | MongoDB pool | `MONGO_MAX_POOL_SIZE` (default 20 per task), `MONGO_MIN_POOL_SIZE` (2), `MONGO_SERVER_SELECTION_TIMEOUT_MS` (30000, unchanged). | `config/mongoOptions.js` |

Release scripts: `deploy-ecs-release.sh` now also switches the worker service to the new image **if it exists** (after the web service, before the frontend; it copies the worker's own task definition and changes only the image, so its `RUN_BACKGROUND=1` stays). Until the worker exists it prints "not found ... skipped". `release-prod.sh`'s smoke test loads the new modules. No other release change.

### Queue and background-work audit (how a web-only task behaves now)

| Work | How it is consumed today | Web task with `RUN_BACKGROUND=0` |
|------|--------------------------|----------------------------------|
| Old step-by-step video queue (`videoGenerationQueue`, Mongo `VideoJob`) | Persistent; drained at enqueue and every 15 s; atomic claim queued -> processing with this worker's id and a lease (E9: per-worker slots, fair order, a lost worker's job re-queued or refunded) | Stores the job and does NOT drain (unless `RUN_JOB_CONSUMERS=1`); a consumer claims it (its drain runs every 5 s in a split). Nothing dropped. See the disk caveat below. |
| Campaign image jobs (async regenerate) | Was in-process memory (lost on restart, 404 from another task) | Stored in Mongo; worker claims; status from any task. (The web app calls this route in its direct, non-queued form today, which runs in the request as before.) |
| Drafts picture redo, weekly calendar items (`backgroundQueue`, in-process list; state in `Draft` documents) | Runs in the process that received the request, one at a time | Unchanged: runs in that web task; nothing dropped. Lost on a task stop; the worker's stale-draft reaper closes it after 20 minutes and returns the Quarks. Next step if needed: persist-and-claim like image jobs. |
| Videos (Omni studio chain) with `ENABLE_STUDIO_VIDEO_CONSUMER=on` (E9 stage B1, default off) | Persistent: the StudioVideo row is `queued` after the charge; a consumer claims it with a lease, resumes after the last stored clip if its worker was lost | Stores the video and does NOT run it (unless `RUN_JOB_CONSUMERS=1`); a worker claims it within about 5 s. See "Videos on the worker" below. |
| Videos (Omni studio chain) with the switch off, Photoshoot runner, Hero, Blueprint and plan runs (`blueprint/runner` lanes), Home drafts, weekly posts | Started by the request in that process (setImmediate / in-process lanes); state and leases in Mongo | Unchanged: run in the web task that accepted them (they still use that task's CPU, including ffmpeg for Videos finishing). Each has a lease or heartbeat, and the worker's sweeps (`startStudioVideoSweep`, `startPhotoshootResume`, `startHomeDraftsSweep`, `startWeekRecovery` + refund recovery, plan scheduler) close or take over only stale work, so a running job on a web task is never ended by the worker. Concurrency caps (Blueprint 2, plan 1, one Video create per account) are per task. Moving these to the worker is the next step (persist-and-claim). |
| Schedulers (campaign posting, status sync, calendar, snapshots, notifications, performance, billing, renewals, account purge, Bin purge, competitor tracker, listening, plan refresh, brand memory, memory distillation, profile watch, image runner) | Interval loops in the one task | Not started on web tasks; exactly once on the worker. |
| Calendar "being prepared" mark (`routes/contentCalendar.js` `preparation` Map) | In-process | Known limit (performance-week1.md): another task answers "not prepared" until the month is saved; the page keeps polling for 2 minutes. |
| Auth cache (15 s), Home summary cache (60 s), small per-process caps (`createAssist` hits, Videos `hits` and `creating`, campaign `generationLocks`) | In-process | Per task: a cache can be up to its lifetime stale on another task (D26); the small caps become "per task" (at most N times as loose). |

### Local disk audit

| Path | Written by | Fetched by the user? | Size and lifetime | With web + worker |
|------|-----------|----------------------|-------------------|-------------------|
| `backend/storage/ai-videos/<job>/{images,clips,audio,final,temp}` served at `/generated-media/...` | Old step-by-step video maker (`videoGenerationPipeline.js`, `videoDraftStore.js` also writes `draft.json` there as a backup of the `VideoDraft` document) | Yes: preview images, audio and (when the cloud upload failed) clips use `/generated-media` links. Final and merged videos and clips are uploaded (`uploadVideoFile`) and use cloud links. | Tens of MB per job; never cleaned up by the app; already lost on every deploy today (Fargate disk is per task) | Files are written on the worker, links are served by web tasks: those previews 404. **Owner/infra task** (this maker is hidden from customers): either mount one EFS volume at `/app/backend/storage` on both services (no code change), or accept it until that maker is retired. A code migration (upload every intermediate) was not built. |
| `os.tmpdir()` work folders (`studioVideoFinish`, `studioVideoChain`, `heroVideoFinish`, `heroVideoFlow`, `mediaComposer`, `routes/studioVideos.js` temp mp4, `routes/drafts.js` upload temp, `videoDownload.js`) | The task running the job | No: removed when the step ends; results are uploaded and stored as links | Up to a few hundred MB during a finish | Fine: each job runs start to finish in one task. Size `ephemeralStorage` to 30 GB+ on the task that runs ffmpeg (web today, see audit above). |
| `backend/temp` | Created at start (write test) | No | Empty | Nothing to do. |
| `backend/tone-audio` (`/audio/*.mp3`) | Shipped in the image | Yes | Fixed | Same in every task. |

## Phase 2: AWS steps (the owner)

Names used below are today's: cluster `stratschool-prod-cluster`, web service `prod-nebulaa-gravity-backend-service` (it stays the web service, so the load balancer, the release scripts and DNS are unchanged), new worker service `prod-nebulaa-gravity-worker-svc` (the name the deploy script looks for), region `ap-south-1`. For the test environment use `stratschool-test-cluster`, `test-nebulaa-gravity-backend-svc`, `test-nebulaa-gravity-worker-svc`. Do the whole thing on the test environment first.

Every AWS command below runs through Docker like the release scripts (no AWS CLI install needed). Paste this once in the terminal:

```
aws() { docker run --rm -v "$HOME/.aws:/root/.aws:ro" -v "$PWD:/work" -w /work amazon/aws-cli --region ap-south-1 --output json "$@"; }
```

### Step 0: release this code as usual (still one task)
Run the normal release. With no new variable set the backend behaves exactly as before; the log shows `[role] single process (RUN_BACKGROUND not set): background jobs run in this process`.

### Step 1: environment variables (both services unless noted)

| Variable | web | worker | Why |
|----------|-----|--------|-----|
| `RUN_BACKGROUND` | `0` | `1` | the split (D31) |
| `RATE_LIMIT_STORE` | `mongo` | `mongo` | limits shared by all web tasks (D32) |
| `RATE_LIMIT_STORE_WAIT_MS` | `300` (default) | same | a slow store never adds more than this to a request |
| `RATE_LIMIT_GENERAL_SHARED` | not set | not set | keeps the per-request flood guard per task |
| `TRUST_PROXY_HOPS` | `1` | `1` | one ALB in front (default already 1) |
| `MONGO_MAX_POOL_SIZE` | `20` | `20` | connections per task |
| `MONGO_MIN_POOL_SIZE` | `2` | `2` | |
| `AUTH_CACHE` | `on` (default) | `on` | 15 s staleness across tasks accepted (D26) |
| `SHUTDOWN_DRAIN_MS` | `110000` | `20000` | web: let long requests (campaign generation holds a request 1 to 6 minutes) finish within stopTimeout |
| `RUN_JOB_CONSUMERS` | not set (off with `RUN_BACKGROUND=0`) | `1` | the generation queues run here (E9, `generation-parallelism.md`) |
| `RUN_SCHEDULERS` | not set | not set (on); `0` on extra consumer-only workers | the schedulers and sweeps |
| `PROVIDER_SLOTS_IMAGE` / `PROVIDER_SLOTS_VIDEO` | (unused) | `2` / `2` | per worker task; raise only to what the provider account limits allow (workers x slots) |
| `CPU_SLOTS` | (unused) | `2` on 2 vCPU | ffmpeg at once per worker |
| `IMAGE_JOB_CONCURRENCY` | (unused) | not set | older name of `PROVIDER_SLOTS_IMAGE`, still honoured |
| `VIDEO_QUEUE_DRAIN_INTERVAL_MS` | (unused) | not set (5 s in a split) | |
| `ENABLE_STUDIO_VIDEO_CONSUMER` | not set (off), later `on` | not set (off), later `on` | Videos (Omni) made on the worker instead of the web task (E9 B1). Turn on in BOTH services, in a release AFTER this code is live: see "Videos on the worker" |
| `PROVIDER_SLOTS_OMNI` | (unused) | `2` | Videos making clips at once per worker task; (worker tasks) x this must stay under the Gemini Omni concurrency limit |
| `STUDIO_VIDEO_DRAIN_INTERVAL_MS` | (unused) | not set (5 s) | how often a worker looks for queued Videos |
| `STUDIO_VIDEO_QUEUED_MAX_MS` | not set (30 min) | same | a queued video nobody claims for this long is failed and refunded (safety net) |
| `REDIS_URL` | not set | not set | only if you later add ElastiCache AND install the optional packages |

Keep every existing variable and secret (`AWS_SECRET_IDS` etc.) as they are on both. Task-definition variables win over values from Secrets Manager (`bootstrap.js` never overwrites a set variable), so do not put `RUN_BACKGROUND` in the shared secret.

### Step 2: the worker task definition (ready to edit)
Get today's backend task definition and keep its roles, image, secrets and log settings:

```
aws ecs describe-task-definition --task-definition "$(aws ecs describe-services --cluster stratschool-prod-cluster --services prod-nebulaa-gravity-backend-service --query 'services[0].taskDefinition' | tr -d '"')" --query taskDefinition > backend-td.json
```

Make `worker-td.json` from it: change `family` to `prod-nebulaa-gravity-worker`, `cpu` to `"2048"`, `memory` to `"4096"`, remove `portMappings`'s load balancer use (keep the port, nothing points at it), add the variables, a container health check and `stopTimeout`. The shape (fill the `<...>` from `backend-td.json`, keep its `secrets`, `logConfiguration`, roles):

```json
{
  "family": "prod-nebulaa-gravity-worker",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "cpu": "2048",
  "memory": "4096",
  "ephemeralStorage": { "sizeInGiB": 40 },
  "runtimePlatform": { "cpuArchitecture": "X86_64", "operatingSystemFamily": "LINUX" },
  "executionRoleArn": "<same as backend-td.json>",
  "taskRoleArn": "<same as backend-td.json>",
  "containerDefinitions": [
    {
      "name": "<same container name as backend-td.json>",
      "image": "<same image as backend-td.json>",
      "essential": true,
      "portMappings": [{ "containerPort": 5000, "protocol": "tcp" }],
      "stopTimeout": 30,
      "environment": [
        { "name": "RUN_BACKGROUND", "value": "1" },
        { "name": "RUN_JOB_CONSUMERS", "value": "1" },
        { "name": "PROVIDER_SLOTS_IMAGE", "value": "2" },
        { "name": "PROVIDER_SLOTS_VIDEO", "value": "2" },
        { "name": "CPU_SLOTS", "value": "2" },
        { "name": "RATE_LIMIT_STORE", "value": "mongo" },
        { "name": "TRUST_PROXY_HOPS", "value": "1" },
        { "name": "MONGO_MAX_POOL_SIZE", "value": "20" },
        { "name": "MONGO_MIN_POOL_SIZE", "value": "2" },
        { "name": "SHUTDOWN_DRAIN_MS", "value": "20000" }
      ],
      "secrets": "<same as backend-td.json>",
      "logConfiguration": "<same as backend-td.json, stream prefix worker>",
      "healthCheck": {
        "command": ["CMD", "node", "-e", "fetch('http://127.0.0.1:5000/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],
        "interval": 30, "timeout": 5, "retries": 3, "startPeriod": 60
      }
    }
  ]
}
```

Register it:

```
aws ecs register-task-definition --cli-input-json file:///work/worker-td.json --query 'taskDefinition.taskDefinitionArn'
```

### Step 3: the web task definition
Make a new revision of the backend family from `backend-td.json`: `cpu` `"1024"`, `memory` `"2048"`, `stopTimeout` `120` on the container, add `RUN_BACKGROUND=0`, `RATE_LIMIT_STORE=mongo`, `MONGO_MAX_POOL_SIZE=20`, `MONGO_MIN_POOL_SIZE=2`, `SHUTDOWN_DRAIN_MS=110000` to `environment`. Register it the same way (do not switch the service yet). Note: until Videos finishing moves to the worker, ffmpeg runs on web tasks; if web CPU spikes during finishes, use 2 vCPU / 4 GB for web.

### Step 4: create the worker service with 0 tasks (no load balancer)

```
aws ecs create-service --cluster stratschool-prod-cluster --service-name prod-nebulaa-gravity-worker-svc \
  --task-definition prod-nebulaa-gravity-worker --desired-count 0 --launch-type FARGATE \
  --deployment-configuration "minimumHealthyPercent=0,maximumPercent=100,deploymentCircuitBreaker={enable=true,rollback=true}" \
  --network-configuration "awsvpcConfiguration={subnets=[<same private subnets as the backend service>],securityGroups=[<backend security group>],assignPublicIp=<same as backend>}"
```

(`minimumHealthyPercent=0` and `maximumPercent=100`: the old worker stops before the new one starts. No autoscaling on this service yet. After the E9 code is released two workers at once are safe (claims and leases); a later step can scale the worker on the `Nebulaa/Queue` metrics, see `generation-parallelism.md`. On SIGTERM a worker hands its running jobs back within `SHUTDOWN_DRAIN_MS` - 5 s; for long videos raise the worker's `stopTimeout` to 120 and `SHUTDOWN_DRAIN_MS` to 110000.)

### Step 5: the target group (web)
In EC2 > Target groups > the backend target group: Health checks > path **`/api/ready`**, healthy threshold 2, unhealthy 2, interval 15 s, timeout 5 s. Attributes > **Deregistration delay 120 s** (matches `stopTimeout` 120 and `SHUTDOWN_DRAIN_MS` 110000: the ALB stops new requests, open ones finish). Keep stickiness off (nothing needs it now: limits, OAuth state and image jobs are shared).

### Step 6: the switch (order matters: never two workers, at most a short gap)
1. Switch the web service to the new web revision (rolling, as a release does) and wait until the rollout says COMPLETED:

```
aws ecs update-service --cluster stratschool-prod-cluster --service prod-nebulaa-gravity-backend-service --task-definition <web revision arn>
```

   From now on no background job runs anywhere (scheduled posts wait, videos wait queued) until step 2. Do step 2 at once.
2. Start the worker:

```
aws ecs update-service --cluster stratschool-prod-cluster --service prod-nebulaa-gravity-worker-svc --desired-count 1
```

3. Check the logs (below). Then raise web to 2 tasks in two zones (the service's subnets must be in two AZs):

```
aws ecs update-service --cluster stratschool-prod-cluster --service prod-nebulaa-gravity-backend-service --desired-count 2
```

### Step 7: web autoscaling (min 2, max 6)

```
aws application-autoscaling register-scalable-target --service-namespace ecs --scalable-dimension ecs:service:DesiredCount \
  --resource-id service/stratschool-prod-cluster/prod-nebulaa-gravity-backend-service --min-capacity 2 --max-capacity 6
```

Requests per task (the metric counts requests per target **per minute**: 50 to 60 a second = 3000 to 3600; start at 3000 and replace it with the value measured in Phase 3). `ResourceLabel` is `app/<alb name>/<alb id>/targetgroup/<tg name>/<tg id>` (the end of the two ARNs):

```
aws application-autoscaling put-scaling-policy --service-namespace ecs --scalable-dimension ecs:service:DesiredCount \
  --resource-id service/stratschool-prod-cluster/prod-nebulaa-gravity-backend-service --policy-name web-requests --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration '{"TargetValue":3000,"PredefinedMetricSpecification":{"PredefinedMetricType":"ALBRequestCountPerTarget","ResourceLabel":"app/<alb>/<id>/targetgroup/<tg>/<id>"},"ScaleOutCooldown":60,"ScaleInCooldown":300}'
```

```
aws application-autoscaling put-scaling-policy --service-namespace ecs --scalable-dimension ecs:service:DesiredCount \
  --resource-id service/stratschool-prod-cluster/prod-nebulaa-gravity-backend-service --policy-name web-cpu --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration '{"TargetValue":55,"PredefinedMetricSpecification":{"PredefinedMetricType":"ECSServiceAverageCPUUtilization"},"ScaleOutCooldown":60,"ScaleInCooldown":300}'
```

### Step 8: MongoDB connections (Atlas)
At peak the cluster sees about (web tasks + 1 worker) x `MONGO_MAX_POOL_SIZE` + scripts: 7 x 20 = 140. Atlas limits per tier (check the cluster's page): M10 about 1,500, M20 and M30 about 3,000; shared tiers 500. If you raise the max web count, keep tasks x pool well under the limit. Three new small collections appear (`rate_limits`, `oauth_states`, `image_jobs`), each with a TTL index, so they stay small (the cluster has a disk ceiling; each row lives minutes to a day).

### What to watch in the logs
- Worker, once at start: `[role] worker (RUN_BACKGROUND=1): background jobs run in this process`, then each scheduler's start line once (for example `Persistent Queue: Background worker successfully started`, `[image jobs] runner started (concurrency 2, ...)`, the campaign scheduler, calendar, snapshot lines).
- Each web task: `[role] web only (RUN_BACKGROUND=0): background jobs do NOT run in this process` and **no** scheduler start lines.
- `[live] REDIS_URL not set: live updates are single-process` on every task (expected without Redis; see concern 3).
- Warnings to act on: `[rate limit] shared store error ... let through` (more than now and then: the database is slow; consider Redis), `[image jobs] ... runner was lost`.

### Videos on the worker (E9 stage B1, switch `ENABLE_STUDIO_VIDEO_CONSUMER`)
Today (switch off) a Videos create runs in the web task that took the request: a deploy or a crash of that task stops it and the video is refunded about 15 minutes per clip later. With the switch on, the video waits in the database (`queued`) and a worker makes it; if that worker stops, another one carries on after the last clip already made (nothing is charged twice). Details: `generation-parallelism.md` (stage B1).

How to turn it on (after the release that contains this code is live and checked, with the switch still off):
1. Worker service: new task-definition revision with `ENABLE_STUDIO_VIDEO_CONSUMER=on` (it already has `RUN_JOB_CONSUMERS=1`; leave `PROVIDER_SLOTS_OMNI` at 2 unless the Omni limit is known). Deploy it and wait until it is running. Its log shows `[videos consumer] started (worker ...; omni slots 2, ...)`.
2. Web service: new revision with `ENABLE_STUDIO_VIDEO_CONSUMER=on`. Deploy. From now on new Videos are made on the worker.
3. Check: make one short video in the app (one clip, owner's OK for the provider cost), then `GET /api/metrics/queue` as staff: `studioVideos.queueDepth` goes back to 0, `runningByWorker` names the worker.

On a single task (no split, `RUN_BACKGROUND` not set) the switch also works: that task queues and claims its own videos (a restart then resumes them instead of refunding).

How to turn it off (rollback). **The wait in step 2 is MANDATORY before any rollback of the image** (also a rollback to an older release): an older image never claims or refunds a `queued` video and deletes it on DELETE without a refund.
1. Web service first: revision without the variable (new Videos run in the web task again).
2. MANDATORY: wait until `studioVideos.queueDepth` and `studioVideos.running` in `GET /api/metrics/queue` are both 0 (the worker finishes what was queued). Only then the worker revision without the variable, and only then any older image.
3. Leftovers (the switch went off, or an older image was already released, with videos still `queued`): they are failed and refunded after 30 minutes by the sweep of a current image. To close and refund them at once, from a machine with the current code: `cd backend && MONGODB_URI='<uri that names its database>' node scripts/studio-video-drain-queued.js` is a dry run (counts only); add `CONFIRM_DRAIN=yes` to act. It refuses when the URI has no database name and prints counts only.

Never turn it on in the web service while NO task runs the consumer (worker at 0 tasks): videos would wait 30 minutes and then be refunded.

### Rolling back
- Worker trouble: `aws ecs update-service ... --service prod-nebulaa-gravity-worker-svc --desired-count 0`, then switch the web service back to the revision WITHOUT `RUN_BACKGROUND` (the deploy script printed it, or pick the previous revision) with desired count 1: one task does everything again, as today. Do the worker first, so two task sets never both run the schedulers.
- Limits trouble: set `RATE_LIMIT_STORE=memory` (new revision): per-task counters, as today.
- Code trouble: release the previous commit as usual (the new collections are harmless to older code).

### Cost note
- Worker: 2 vCPU / 4 GB around the clock. Fargate Spot is about 70% cheaper, but Spot can stop the task with two minutes' warning (a video in progress fails and is refunded; schedulers resume when the replacement starts) and a Spot shortage would leave background jobs stopped until capacity returns. Try Spot on the test environment first (capacity provider strategy `FARGATE_SPOT` weight 1) and keep on-demand in production until you are comfortable.
- Web: the 2-task baseline (2 x 1 vCPU / 2 GB) runs all month: a 1-year Compute Savings Plan for that baseline is the cheap part; autoscaled tasks above it are on-demand. Exact prices: AWS Fargate pricing page for ap-south-1 (vCPU-hour and GB-hour), times 730 hours.

## Leases, log format and compression (hardening E2, A7, A8; D56 to D58)
- **An accidental second worker is safe.** Every scheduler tick that sends, publishes, charges or refunds takes a MongoDB lease first (`job_leases`, names `scheduler:<job>`; `backend/services/leaseLock.js`). While one server holds a name, the other skips that tick and logs nothing worse than a skipped run. Hourly and slower jobs also stay blocked for half their interval after a good run, so two workers do not repeat the same hourly invoice run or weekly distillation. A crashed worker's lease runs out by itself (10 minutes for the campaign publish tick). Check 3 of the verification list below ("scheduled jobs run exactly once") now holds even if a web task is started without `RUN_BACKGROUND=0`; keep that variable anyway, it also keeps the web tasks light.
- **Log format.** stdout is one JSON object per line (`level` 30/40/50, `time`, `msg`, and for requests `req.method`, `req.url` without any token, `res.statusCode`, `responseTime`). `/api/health` and `/api/ready` probes are not logged at the default level. `LOG_LEVEL` (default `info`) can be raised to `debug` on one task to see the probes. Set a CloudWatch metric filter on `{ $.level = 50 }` for errors.
- **Compression.** The API gzips JSON and text over 1 KB (not the Inbox event stream). The ALB passes it through; nginx for the web app has its own gzip.

## Phase 3: verification checklist (staging copy)
1. Staging = the test environment with this split: 2 web tasks + 1 worker, Atlas dev/staging cluster, the tester's 10k-user seed, stubbed providers with realistic delays.
2. Re-run the tester's suite: each flow holds 10 to 15 requests a second for 10 minutes with p90 under 300 ms and no errors (generation flows: accepted at once with a job id, honest progress).
3. Scheduled jobs run exactly once: one scheduled test post is posted once; the worker log shows each scheduler once; web logs show none.
4. Limits across tasks: 21 sign-in attempts for one account through the ALB get the 429 on the 21st whichever task answers (`backend/scripts/scaling-check.js` shows the same on the database).
5. OAuth across tasks: connect Google Calendar and YouTube several times; the callback works whichever task it lands on.
6. Live updates: without Redis, an Inbox message shows live only when the browser's stream is on the task that received the webhook (otherwise on the next refresh); with Redis, always.
7. Image jobs: start async picture redos from two accounts; each finishes once; a 6th waiting one gets 429.
8. Kill a web task (ECS console > Stop): no failed requests beyond those open on it; the service starts a new one; the load balancer marks it healthy via `/api/ready`.
9. Stop the worker task: a new one starts (old one first stops, then new); a video in progress is closed and refunded by the sweep; scheduled posts resume.
10. Measure requests per task at 55% CPU and put that number into the request-count policy (Step 7).

## Real-database check
`cd backend && node scripts/scaling-check.js` (nebulaa_dev only, throwaway rows, cleanup, non-zero on any FAIL or leftover): two limiter instances share one count, 50 counts at once are exact, a window ends, the TTL indexes exist, OAuth state single use / wrong purpose / expired, two image runners claim each job exactly once, the 6th waiting job is refused, a lost job is failed and not re-run. Last run: 9 PASS, 0 FAIL.
