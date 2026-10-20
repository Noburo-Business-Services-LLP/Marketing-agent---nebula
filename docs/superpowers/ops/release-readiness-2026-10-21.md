# Release readiness checklist (prepared 2026-10-21)

For: Dinesh. Written in plain words. Every command is in its own box and says which folder it runs from. Where I could not confirm something from the project's own documents, the line starts with **CHECK:** and says what to look at. Nothing here was run by the assistant: no database, provider, AWS or network was touched while writing it.

**Short version.** The code on branch `nebulaa-redesign` is far ahead of what is live (live = commit `3a281f2`, released 2026-10-20). The next release is big. The new risky features (Photoshoot, worker queues, competitor pictures and drafts) are all behind OFF switches, so releasing changes less than it looks. Three things can stop the release or hurt after it: the server will not start without `HASH_PEPPER`, the database disk may be near full, and the helper script that sets secrets does not yet know the new setting names (section 2, step 3).

Repo folder used in every command below:

```
/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign
```

Documents that disagree (I picked the safer one each time, and say so where it matters):
- Handover 27/28 say "run `cd backend && node scripts/create-perf-indexes.js`"; that script needs the database address in the environment, so I use the wrapper `create-staff-indexes.sh` with `INDEX_SCRIPT` (it reads the address from the secret and never prints it). Source: the script header and `performance-week1.md`.
- Handover 28 says "switches with `set-secret-value.sh`"; the script only accepts 20 names (see section 5). Most new switches are not on its list.
- `security-hardening.md` section 10 says the screens still ask for 8 characters; handover 27 says they were changed to 10. I trust handover 27 (newer) and the smoke check below proves it.
- `photoshoot.md` says the page shows "Photoshoots open soon."; decision D6 changed it to "Photoshoots are not switched on for your account yet." (checked in `frontend/pages/Photoshoot.tsx`). Look for the D6 wording.
- `mapping` doc says the Photoshoot money review is "pending"; the review file and D99/D100 show it was done and fixed (backend suite 3116 pass). I trust the review file.
- The ledger "OWNER STEPS" line still says "everything since `bc514a9`"; handover 27/28 say live is `3a281f2`. I trust the handovers.
- `release-checklist-2026-10-18.md` is the OLD release (already done). Do not follow it again; only its Razorpay and switch notes still matter.

---

## 1. What this release contains (what customers will notice)

1. **New left menu.** Home, Plan (tabs My plan, Calendar, Content ideas, Blueprint), Create (Create content, Create video, Photoshoot), Library, Inbox, Insights, and a folded Setup (Brand assets, Connected accounts, Settings, Help). Old web addresses still work and redirect. A five-step tour replaces the old one.
2. **Approval and the Bin.** Library has views Needs approval, Approved, Scheduled, Posted, All, Archived and Bin. Every post (and now videos and reels) has the same actions in the same place: Approve, Schedule, Post now, Download, Edit, Make again (with its price), Archive, Delete to Bin, Restore. Only posts made by automation need approval; posts you make yourself can be posted or scheduled at once.
3. **Photoshoot studio is built but switched OFF.** Customers see the six packs and prices with the note "Photoshoots are not switched on for your account yet." Nobody can be charged.
4. **Performance per platform** (Insights > Performance): numbers per platform, top posts of the week or month, which post got the most engagement, and plain findings.
5. **Insights > Competitors tab shows for everyone.** Accounts without the add-on see "Tracking competitors is an add-on. See plans to add it." Home and Competitors have richer competitor sections, but pictures and the draft buttons are OFF.
6. **Help page** (the menu entry used to do nothing) with the tour, how Quarks work, contact and quick answers. The empty Settings > Notifications tab is gone. Settings > Billing has a full "What things cost" list.
7. **Faster pages.** First-load scripts 3,240 KB to 550 KB; lists load in pages (Drafts 30, Campaigns 20); the Calendar no longer makes a month while you look (button "Prepare this month"). After a release, an open old tab shows "Nebulaa has been updated" with a Reload button.
8. **Safer sign-in.** Wrong-password waits (1, 2, 4, 8 seconds) and a 15-minute lock of that address after 5 wrong tries; unknown emails get the same answer as real ones; changing a password signs out other devices; the first-Owner door is closed unless `ALLOW_ADMIN_BOOTSTRAP=1`.
9. **New password rule: at least 10 characters**, with a letter and a number, not a very common password, not your email name. Applies to sign-up, reset and change only; existing accounts sign in unchanged.
10. **Sign-up and Settings share one set of business questions** (six languages; "Who do you sell to?" is now required, so sign-up has nine required answers).
11. **Prices that change:** Growth Blueprint 20 to 23 Quarks (derived from the planner cost); Create tiles show only the Quark amount.
12. **Behind the scenes:** Quarks come back automatically if a job fails (several free-Quark and double-charge bugs fixed after independent money reviews); upload, link and email safety; a locked-down server image (non-root); shared rate limits; ready to run as separate web and worker services; Inbox drafts are capped per account.

---

## 2. Do these BEFORE you release

### 2.1 Check the database disk first (5 minutes)
Why: the Atlas cluster already blocked all writes once because the disk filled (2026-09-03), and production, demo and dev share that cluster. New collections arrive with this release.
Do: Atlas console, open the cluster, read the Storage / Disk usage chart. The only figure I can find is "61% disk" in `staff-pages-performance.md`, which is old. **CHECK:** today's percentage. Rule I suggest: above about 80%, do not release until you have freed or added space.
Worked if: you can write down today's percentage.

### 2.2 Make a backup note (Atlas)
Why: if something corrupts data you want a known restore point.
Do: Atlas console, Backup, take an on-demand snapshot and write the time down. **CHECK:** the documents do not say your cluster tier; on-demand snapshots need a paid tier (M10 or above). If your tier has none, write down that there is no snapshot and decide whether to go ahead.
Worked if: a snapshot shows "Completed" (or you have written down that none exists).

### 2.3 Set `HASH_PEPPER` (the server will NOT start without it)
Why: it keys the one-way hashes kept after account deletion and the sign-in lock records. In production the server refuses to boot without it (at least 32 characters). Pick it once and keep it: lookups try the pepper and `JWT_SECRET` only (D52), so changing it later loses older deletion records.
Make a random value (printed on screen, copy it):

```
openssl rand -hex 32
```

**Problem you must know about:** `docs/superpowers/ops/set-secret-value.sh` only accepts these names: RAZORPAY_WEBHOOK_SECRET, ALERT_EMAILS, APP_PUBLIC_URL, SIGNUPS_PER_DAY, SIGNUP_MODE, SIGNUP_INVITE_CODES, TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY, GEMINI_API_KEY, FAL_KEY, APIFY_API_KEY, SERPER_API_KEY, CLAUDE_API_KEY, RAZORPAY_PLAN_ID_AGENCY, RAZORPAY_PLAN_ID_SLOT, ENABLE_COMPETITOR_TRACKER, ENABLE_LISTENING, LISTENING_MODEL, FRONTEND_URL. **`HASH_PEPPER` is not on the list**, and neither are `ENABLE_PHOTOSHOOT`, `ENABLE_COMPETITOR_DRAFTS`, the two consumer switches, `RATE_LIMIT_STORE`, `LIMIT_*`, `TRUST_PROXY_HOPS` or `UNHANDLED_REJECTION_POLICY`. The script refuses unlisted names on purpose. Two ways forward:
- **Best:** ask the assistant to add the new names to the list in `set-secret-value.sh` and `check-secret-keys.sh` (a one-line code change, tested), commit it, then continue. I did not change code here.
- **Fallback (my suggestion, not in the project documents):** AWS console, Secrets Manager, secret `nebulaa-gravity/prod/backend`, Retrieve secret value, Edit, Add row `HASH_PEPPER` with the value, Save. AWS keeps the previous version. **CHECK:** that your login can edit the secret.

Once the name is allowed, run it (folder: the repo; needs Docker running and `~/.aws` set up). Type `HASH_PEPPER`, paste the value (hidden), type `UPDATE`. When it asks about restarting the backend, press Enter to skip (the old live code does not need it; the release restarts everything):

```
cd "/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign" && bash docs/superpowers/ops/set-secret-value.sh
```

Worked if: step 2.4's length command shows `HASH_PEPPER length: 64`.

### 2.4 Check `JWT_SECRET` is at least 32 characters (and `HASH_PEPPER` is there)
Why: the server also refuses to boot in production if `JWT_SECRET` is shorter than 32. Do NOT change `JWT_SECRET` (it would sign everyone out); only check it.
`check-secret-keys.sh` says "set" or "MISSING" but not the length, and `HASH_PEPPER` is not in its list. This one-liner prints only two numbers, never a value. It was written for this checklist and not tested by me (**CHECK:** run it and read the numbers; if it errors, use the console and count the characters):

```
cd "/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign" && export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null 2>&1; docker run --rm -v "$HOME/.aws:/root/.aws:ro" amazon/aws-cli --region ap-south-1 secretsmanager get-secret-value --secret-id nebulaa-gravity/prod/backend --query SecretString --output text | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('JWT_SECRET length:',(j.JWT_SECRET||'').length,' HASH_PEPPER length:',(j.HASH_PEPPER||'').length)})"
```

Worked if: both numbers are 32 or more. **CHECK:** task-definition variables beat the secret (`bootstrap.js`); if `JWT_SECRET` or `HASH_PEPPER` were also typed in the ECS task definition, that value is the one used.
Also: `MONGODB_URI` must exist (step 2.5 shows it).

### 2.5 Check the other secrets
Why: a missing key makes a feature fail only after release.
Do (read-only, prints names and "set" or "MISSING", never values):

```
cd "/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign" && bash docs/superpowers/ops/check-secret-keys.sh
```

Worked if: nothing under "Needed" is MISSING (`MONGODB_URI`, `JWT_SECRET`, OpenAI, Gemini, fal, Razorpay, Cloudinary). Also note whether `ENABLE_COMPETITOR_TRACKER` and `ENABLE_LISTENING` are already set (they decide what section 5 means for you). `ALLOW_ADMIN_BOOTSTRAP` must NOT be set.

### 2.6 Rotate the Ayrshare profile key that was in the code history
Why: a file with a real Ayrshare profile key (`test-ayrshare-jwt.js`, commits `51b2ecd`, `f5e2928`, `39619a7`) was deleted but the key is still in git history.
Do: in the Ayrshare dashboard, rotate/regenerate that profile's key. **CHECK:** the project documents say "rotate in Ayrshare" but not the exact button, nor whether the new key must also be saved anywhere in our database or secret. Ask the assistant before you do it if that profile belongs to a live account. Optional later: a full-history secret scan (`gitleaks`).
Worked if: the old key no longer works in Ayrshare.

### 2.7 Confirm all tests are green
Why: it proves the code you will ship still passes. **CI (the automatic GitHub test run) has never been run**, so these local runs are the only proof. Easiest: ask the assistant to run them and show the totals. Numbers last recorded: backend 3116 pass (includes 22 HTTP checks), frontend about 876 pass, type check 0 errors, lint 0 errors. **CHECK:** your numbers may be higher; what matters is 0 failing.
Backend tests and lint (folder: `backend`):

```
cd "/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign/backend" && npm test
```

```
cd "/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign/backend" && npm run lint
```

Frontend tests and type check (folder: `frontend`). CI uses Node 24 for these tests (92 of them load `.ts` files). **CHECK:** which Node your Mac uses (`node -v`):

```
cd "/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign/frontend" && npm test
```

```
cd "/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign/frontend" && npm run typecheck
```

Worked if: every command ends with 0 failing / 0 errors.

### 2.8 Make sure what you ship is committed and pushed
Why: `release-prod.sh` refuses uncommitted changes but does NOT check that the commit is pushed.
Both commands should print nothing (folder: the repo):

```
cd "/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign" && git status --short
```

```
cd "/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign" && git log origin/nebulaa-redesign..HEAD --oneline
```

Worked if: both are empty and `git branch --show-current` says `nebulaa-redesign`.

### 2.9 Practice run of the build (changes nothing live)
Why: builds both images and runs the image smoke test (native libraries, bcrypt, ffmpeg, new modules), pushes nothing, deploys nothing, asks no DEPLOY. Needs Docker Desktop running and about 6 GB free disk (it cleans Docker leftovers itself if short).

```
cd "/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign" && DRY_RUN=1 bash docs/superpowers/ops/release-prod.sh
```

Worked if: it ends with "Dry run: images built and checked, nothing pushed, nothing deployed." and "backend image smoke test: ok".

---

## 3. The release itself

What the scripts really do, in order: `release-prod.sh` (1) refuses uncommitted changes, (2) names the images `prod-<commit>`, (3) builds backend and frontend images for the live server type, (4) smoke-tests the backend image with no network, (5) **asks you to type DEPLOY**, (6) pushes both images to ECR, (7) runs `deploy-ecs-release.sh`, which (8) checks both images exist, (9) **asks you to type DEPLOY a second time**, then switches **backend service first, then the worker service only if it exists, then the frontend service**, copying each service's current task definition and changing only the image, and waiting up to 15 minutes each for COMPLETED. The frontend is switched only if the earlier rollouts completed. Services roll one task at a time and ECS rolls back by itself if new tasks cannot start.

### 3.1 Start it
Backend and frontend ship together in this one command (the approval screens need the new backend, and the new backend needs the new screens). Never deploy only one half.

```
cd "/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign" && bash docs/superpowers/ops/release-prod.sh
```

If it stops on a disk or build-cache error, run the same command with `NO_CACHE=1` in front. Do not edit the script while it runs.

### 3.2 Type DEPLOY (twice)
First prompt: before pushing images. Second prompt: before changing the live services. Typing anything else cancels with nothing changed. Write down the three "TO GO BACK ... run:" commands it prints at the end; they are your rollback (section 8).

### 3.3 What to watch while it runs
- Lines `rollout: IN_PROGRESS` then `COMPLETED` for each service. `FAILED` or "ROLLOUT DID NOT COMPLETE" means ECS is rolling back or has; go to section 8.
- This image is new: it runs as a non-root user, starts through a new entrypoint, and has its own health check. The load balancer health path is `/api/ready` (answers 200 only when MongoDB answers; 503 otherwise or while shutting down).
- The most likely cause of a failed first start is a missing or short `HASH_PEPPER` / `JWT_SECRET` / `MONGODB_URI` (the task exits at once). The logs say so.
Read the last 10 minutes of backend logs (folder: anywhere):

```
docker run --rm -v "$HOME/.aws:/root/.aws:ro" amazon/aws-cli --region ap-south-1 logs tail /ecs/prod-nebulaa-gravity-backend-taskdef --since 10m
```

Good signs: `[role] single process (RUN_BACKGROUND not set): background jobs run in this process`, MongoDB connected, scheduler start lines once. Bad signs: boot errors naming a missing setting; lines with `"type":"unhandledRejection","action":"exiting"` (see section 8).

### 3.4 Open the live site
Open `https://gravity.nebulaa.ai` (not the raw load-balancer address). If the page loads and you can sign in, go to section 4.

---

## 4. Right after the release

### 4.1 Staff indexes, dry run (changes nothing)
Why: the staff Usage page needs six extra indexes or it takes minutes. The script reads the production address from the secret and never prints it. Needs Docker, `~/.aws`, Node.

```
cd "/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign" && bash docs/superpowers/ops/create-staff-indexes.sh
```

Worked if: it lists what it would build and a disk estimate. It will not build if the estimate is more than half of the free disk (another reason for step 2.1).

### 4.2 Staff indexes, build (after you read the dry run)

```
cd "/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign" && CONFIRM_CREATE_INDEXES=yes bash docs/superpowers/ops/create-staff-indexes.sh
```

Safe to run twice. Check the Atlas disk chart after.

### 4.3 Performance indexes, dry run
Why: two tiny indexes stop the campaign scheduler and the new status sync from reading the whole campaigns collection (one scan took over two minutes on the dev copy). I use the same wrapper so the address comes from the secret (the handover's plain `node scripts/create-perf-indexes.js` needs the address typed in by you).

```
cd "/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign" && INDEX_SCRIPT=create-perf-indexes.js bash docs/superpowers/ops/create-staff-indexes.sh
```

Worked if: it lists 2 indexes (`perf_scheduled_scheduledFor`, `perf_scheduled_startDate`), about 0 MB.

### 4.4 Performance indexes, build

```
cd "/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign" && CONFIRM_CREATE_INDEXES=yes INDEX_SCRIPT=create-perf-indexes.js bash docs/superpowers/ops/create-staff-indexes.sh
```

**CHECK:** I read the wrapper and the script header; I have not seen the wrapper run with `INDEX_SCRIPT=create-perf-indexes.js`. If it errors, ask the assistant for the exact variant.

### 4.5 Click through the site (10 minutes; tell the assistant anything odd, it goes in the ledger first)
1. Sign in with an existing account (works unchanged). Then try Forgot password or Settings > change password with a 10-character password containing a letter and a number: it must work, and a 9-character one must be refused on the screen.
2. Sign-up (use a test email): "Who do you sell to?" is required; nine required answers.
3. Home loads; the "Needs approval" tile and the competitor sections show a calm state (no pictures, no draft buttons).
4. Library: open Needs approval; approve one post; check Scheduled, Archived, Bin and Restore work; a video tile shows Download, Make again, Delete.
5. Create content: tiles show only Quark amounts; Carousel says 8 per slide.
6. Photoshoot page (Create > Photoshoot): packs and prices show with "Photoshoots are not switched on for your account yet." and Create is unavailable.
7. Insights > Competitors tab is visible; a free or no-add-on account sees the add-on note.
8. Insights > Performance loads (empty states are fine for new accounts).
9. Help (left menu, and the "?" menu) opens the Help page.
10. Plan > Calendar: a month with no plan shows "Prepare this month"; Settings > Billing shows "What things cost" and Blueprint at 23.
11. Staff area (Home, Clients, Team, Money, Usage) loads; Usage should be fast after 4.2.
12. Leave one browser tab from BEFORE the release open, then click a menu entry: it should show "Nebulaa has been updated" with Reload, and Reload fixes it.
13. Rate-limit address check: open `https://gravity.nebulaa.ai/api/health/details` in the browser and compare the client address it shows with your own (search "what is my IP"). **CHECK:** I did not read which field holds it. If it shows a load-balancer or server address instead of yours, every visitor shares one rate limit: tell the assistant; the fix is `TRUST_PROXY_HOPS=2` (the frontend nginx also forwards `/api` calls, `nginx.conf`) and it is not on the script's list.

Steps counted in sections 2 to 4: 9 (section 2) + 4 (section 3) + 5 (section 4) = 18, with 13 click checks inside 4.5.

---

## 5. Switches: leave OFF at first, turn on one at a time

Rules: one switch, then look at the staff Money and AI spend cards, then the next. "Turn on" means set the value `on`; "turn off" means set the value `off` (the script cannot delete a name). After setting, restart the backend (the script offers it: type RESTART) or wait for the next release. Names not on the script's list (see 2.3) need the assistant's small list change first. Daily AI spend ceiling and staff kill switches exist as a second brake (`AI_DAILY_SPEND_CAP_USD`, `AI_KILLED`).

| Switch | What it does | Risk | Turn on / off | Needs first |
|---|---|---|---|---|
| `ENABLE_PHOTOSHOOT` | Opens Photoshoot for paid plans (10 Quarks a photo; packs 40 to 80) | Real photo cost is an estimate until measured; refunds are automatic | on / off. NOT on the script list | One real proof, about USD 0.06 to 0.10, `photoshoot-real-proof.md`; your OK |
| `ENABLE_COMPETITOR_TRACKER` | Weekly competitor reads (add-on accounts only) | About USD 0.46 a day at the 200-read cap | on / off; on the list | Check 2.5 shows whether it is already on |
| `ENABLE_COMPETITOR_THUMBS` | Small copies of competitors' top posts | Legal terms open (Instagram terms, copyright) | on / off. NOT on the list | Your lawyer's OK. Recommend: keep OFF at launch |
| `ENABLE_COMPETITOR_DRAFTS` | "Make a post in response" and "Draft a witty comment" (8 and 6 Quarks) | Real writer and decency check never run for real | on / off. NOT on the list | One real proof, about USD 0.13 (max 0.19), `home-drafts-real-proof.md` |
| `LISTENING_MODEL` then `ENABLE_LISTENING` | Scores comments ("What people say about you") | Comment text goes to the model provider; Privacy sentence needs the lawyer | `gpt-4o-mini`, then `on`; then staff switch "Comment scoring". On the list | Lawyer; order matters |
| `CAMPAIGN_REMINDER_EMAILS` | Reminder emails to the post owner | Customer emails | on / off. NOT on the list | Optional |
| `LOGIN_CHALLENGE` | Bot check after 3 wrong passwords | No screen exists for it | Leave off | A sign-in screen change |
| `RATE_LIMIT_STORE` | `mongo` shares limits across several web tasks | Slows requests slightly; fails open | `mongo` only when 2+ web tasks | Section 6 |
| `ENABLE_STUDIO_VIDEO_CONSUMER` | Videos made by workers, not the web task | Money flow; see E9 below | see below | See below |
| `ENABLE_PHOTOSHOOT_CONSUMER` | Photoshoots made by workers | Money flow; see E9 below | see below | See below |

Switches that are ON by default and exist only as emergency stops (set `off` to stop that job; not on the script list; **CHECK:** I verified the default only for those named in the documents: `ENABLE_MEMORY_REFRESH`, `ENABLE_CAMPAIGN_STATUS_SYNC`, `ENABLE_PLAN_SCHEDULER`, `ENABLE_WEEKLY_PROPOSAL`, `ENABLE_WEEK_RECOVERY`, `ENABLE_MEMORY_DISTILLATION`, `ENABLE_PHOTOSHOOT_RESUME`, `ENABLE_HOME_DRAFTS_SWEEP`, `ENABLE_IMAGE_JOB_RUNNER`; also in code: `ENABLE_BIN_PURGE`, `ENABLE_STUDIO_VIDEO_SWEEP`, `ENABLE_RENEWAL_REMINDERS`, `ENABLE_REFUND_SWEEP`, `ENABLE_PERFORMANCE_TRACKER`, `ENABLE_CAMPAIGN_SCHEDULER`, `ENABLE_BILLING_SCHEDULER`, `ENABLE_ACCOUNT_PURGE`, `ENABLE_CONTENT_CALENDAR_SCHEDULER`). Leave them alone.

**Settings with a launch effect (all have safe defaults):** `SIGNUPS_PER_DAY` default 300 (most new accounts in 24 hours; 0 = no cap; on the list: raise it if you expect a big launch day); `BCRYPT_ROUNDS` 11; `AUTH_CACHE` on; `LIMIT_HEAVY_AI_MAX` 30 / 15 min, `LIMIT_LIGHT_AI_MAX` 100, `LIMIT_UPLOAD_MAX` 20, `LIMIT_SPEND_MAX` 10, `LIMIT_SCRAPE_MAX` 20 per hour; `JOB_CAP_ACTIVE` 2 and `JOB_CAP_QUEUED` 5 per account; `PROVIDER_SLOTS_IMAGE`/`_VIDEO` 2 each per worker; `MONGO_MAX_POOL_SIZE` 20; `SHUTDOWN_DRAIN_MS` 20000; `UNHANDLED_REJECTION_POLICY` unset (a stray error restarts the task). In production only three are REQUIRED: `MONGODB_URI`, `JWT_SECRET` (32+ characters), `HASH_PEPPER` (32+ characters). Everything else in `backend/.env.example` is optional and shown with its default.

### Real proof cards (each is a paid or real run; ONLY with your OK for that run)
| Card | Cost | Unlocks |
|---|---|---|
| `photoshoot-real-proof.md` | about USD 0.06 to 0.10 | `ENABLE_PHOTOSHOOT` |
| `home-drafts-real-proof.md` | about USD 0.13 (max 0.19) | `ENABLE_COMPETITOR_DRAFTS` |
| `plan-additions-real-proof.md` | about USD 0.19 (max 0.37) | confirms the new planner blocks (and the 23-Quark Blueprint) |
| `subtitle-real-proof.md` | about one cent | confirms subtitle timing |
| `sample-photos.md` | about USD 0.66 once | real photos on tiles (drawings stay until then) |
| `inbox-live-test.md` | your own accounts only | Inbox has never run for real; the Ayrshare messaging add-on was inactive at last check |

### E9: the two worker-queue switches (`ENABLE_STUDIO_VIDEO_CONSUMER`, `ENABLE_PHOTOSHOOT_CONSUMER`)
**Recommendation: leave both OFF for the launch, and launch as one backend service doing everything (as today).** Do the web/worker split (section 6) on a separate, quiet day, and turn these on last, if ever. They only matter for scale and for surviving restarts without refunds.
**MANDATORY rule before ANY rollback to an older image, while a consumer switch is on:** switch it OFF (web service first), then wait until `GET /api/metrics/queue` (staff) shows `studioVideos.queueDepth` and `studioVideos.running` (or `photoshoot.queueDepth` and `photoshoot.running`) both at 0, then switch off the worker, and only then roll back. Reason: an older image never claims or refunds waiting jobs; the live image `3a281f2` would even refund a Photoshoot IN FULL after 3 minutes although photos were delivered. Leftovers: `studio-video-drain-queued.js` / `photoshoot-drain-queued.js` (dry run by default; `CONFIRM_DRAIN=yes` acts; never against the real database without asking the assistant).
**Turn-on order (only after the release is live and checked):** (1) worker service with `RUN_JOB_CONSUMERS=1` running; (2) the switch on the WORKER task definition, deploy, wait for the log line `[videos consumer] started` / `[photoshoot consumer] started`; (3) the switch on the WEB task definition; (4) make one small video / photoshoot (your OK for the cost) and watch `queueDepth` return to 0. Never turn it on in the web service while no worker runs. Do not release a version with the switch already on in a task definition. Because these must be set per service in the ECS task definition, **do not use the shared secret for them in a split**. In a single task the switch works from the secret.
Slot defaults (2 per worker; Photoshoot 2 jobs x 2 photos) are guesses: **CHECK:** your fal.ai and Gemini concurrency limits before raising any.

---

## 6. Web and worker services (optional for launch, recommended for scale)

**This is the riskiest part of the whole plan: it changes AWS by hand. Not needed for launch.** Rehearse the whole thing on the test environment first (names: `stratschool-test-cluster`, `test-nebulaa-gravity-backend-svc`, `test-nebulaa-gravity-worker-svc`; **CHECK:** the older checklist says the test environment "has never run successfully"). Full text and the JSON shape: `docs/superpowers/ops/ecs-web-worker.md`. Names below are production: cluster `stratschool-prod-cluster`, web `prod-nebulaa-gravity-backend-service`, worker `prod-nebulaa-gravity-worker-svc`.
1. Release the code first and run on one task (Step 0). Nothing changes until you set the new variables.
2. Shortcut for AWS commands (paste once per terminal window):

```
aws() { docker run --rm -v "$HOME/.aws:/root/.aws:ro" -v "$PWD:/work" -w /work amazon/aws-cli --region ap-south-1 --output json "$@"; }
```

3. Save today's task definition, then make a worker copy (family `prod-nebulaa-gravity-worker`, 2 vCPU / 4 GB, 40 GB disk, `RUN_BACKGROUND=1`, `RUN_JOB_CONSUMERS=1`, `RATE_LIMIT_STORE=mongo`, health check, `stopTimeout` 30) and a new web revision (1 vCPU / 2 GB, `stopTimeout` 120, `RUN_BACKGROUND=0`, `RATE_LIMIT_STORE=mongo`, `SHUTDOWN_DRAIN_MS=110000`). Do not put `RUN_BACKGROUND` in the shared secret (the task definition wins over the secret):

```
aws ecs describe-task-definition --task-definition "$(aws ecs describe-services --cluster stratschool-prod-cluster --services prod-nebulaa-gravity-backend-service --query 'services[0].taskDefinition' | tr -d '"')" --query taskDefinition > backend-td.json
```

4. Register the worker definition, then create the worker service with 0 tasks and no load balancer (command with your subnets and security group: `ecs-web-worker.md` Step 4). Point the load balancer target group health check at `/api/ready` and set deregistration delay 120 s.
5. Switch, in this order and no other: web to the new revision (wait for COMPLETED); IMMEDIATELY start the worker; check logs; then web to 2 tasks; then autoscaling min 2, max 6:

```
aws ecs update-service --cluster stratschool-prod-cluster --service prod-nebulaa-gravity-worker-svc --desired-count 1
```

6. Log checks: worker prints `[role] worker (RUN_BACKGROUND=1)` and each scheduler once; every web task prints `[role] web only (RUN_BACKGROUND=0)` and no scheduler lines. Between step 5's first and second move, scheduled posts wait a minute or two.
7. Atlas connections: (web tasks + 1) x 20; with 6 web tasks 140. **CHECK:** your cluster's connection limit on its page.

**One-line rollback (worker first, so two copies never run the schedulers):** set the worker to 0 tasks, then put the web service back on its previous revision (the one WITHOUT `RUN_BACKGROUND`):

```
aws ecs update-service --cluster stratschool-prod-cluster --service prod-nebulaa-gravity-worker-svc --desired-count 0
```

then (replace `<previous web revision>` with the revision `deploy-ecs-release.sh` printed):

```
aws ecs update-service --cluster stratschool-prod-cluster --service prod-nebulaa-gravity-backend-service --task-definition <previous web revision> --desired-count 1
```

If a consumer switch was on, do the drain rule in section 5 first.

---

## 7. AWS and security steps only you can do

Nothing here was done by the assistant. All in region `ap-south-1`.
1. **WAF** (AWS console, WAF, Web ACL, Regional, attach to load balancer `stratschool-prod-alb`): rate rule 2,000 requests per 5 minutes per IP (start in Count for a day, read sampled requests, then Block); AWS managed rules Common and Known Bad Inputs; in the Common set put `SizeRestrictions_BODY` in Count mode (our uploads are bigger than 8 KB); default Allow; turn on CloudWatch metrics. Check: normal use still works for a day; blocked requests are visible in sampled requests.
2. **Security groups:** backend tasks accept port 5000 ONLY from the load balancer's group (remove any 0.0.0.0/0 on 5000); frontend tasks accept port 80 only from the load balancer's group; the load balancer accepts 80/443 from the internet. Check: `http://<server address>:5000` from outside no longer answers.
3. **CloudFront in front of the static files** and **HTTP/2 on the load balancer** (confirm the listener has it on): the biggest remaining speed gain; not required for launch. In CloudFront enable "Compress objects automatically". Keep old `/assets/` files for a few days if you can.
4. **Key rotation:** Ayrshare profile key (step 2.6); close any terminal window where you pasted an API key during real proofs; replace the AWS root keys with a limited IAM user; set an ECR lifecycle policy (these three are from the ledger's OWNER STEPS line).
5. **Atlas:** Network Access must list the production NAT addresses (`3.6.52.230` and `15.252.94.235`, from the older checklist; **CHECK:** both still current).
6. **After 2+ web tasks:** `RATE_LIMIT_STORE=mongo`, `TRUST_PROXY_HOPS` as in step 4.5 item 13.
7. **Not built, so nothing to do yet:** signed S3 uploads (needs a bucket and an `s3:PutObject` permission when it is built), cookie sessions (login token still lives in the browser), enforced CSP (report-only now).

---

## 8. If something goes wrong

How to go back: the deploy script printed, per service, "TO GO BACK to the previous revision, run:". Use those. They have this shape (replace the two `<...>` with the service name and the old task definition it printed; services are `prod-nebulaa-gravity-backend-service`, `prod-nebulaa-gravity-frontend-svc`, `prod-nebulaa-gravity-worker-svc`):

```
docker run --rm -v $HOME/.aws:/root/.aws:ro amazon/aws-cli --region ap-south-1 ecs update-service --cluster stratschool-prod-cluster --service <service name> --task-definition <old task definition>
```

Roll back backend AND frontend together (approval needs both). Rolling back is safe for the data: the new collections are harmless to older code. If a consumer switch was ever on, do the section 5 drain first.

| Symptom | Likely cause | What to do |
|---|---|---|
| Release says ROLLOUT DID NOT COMPLETE; tasks start and stop | Missing or short `HASH_PEPPER`, `JWT_SECRET` (under 32) or `MONGODB_URI`; ECS rolls back by itself | Read the logs (3.3), fix the secret (2.3, 2.4), run the release again. Nothing to roll back if ECS did it |
| Load balancer health checks fail, site 502/503 | The database is not answering (`/api/ready` is 503 by design), Atlas disk full, IP list changed, cluster paused | Atlas first: disk, Network Access, status. Then logs. Roll back only if the old version works and the new does not |
| Everyone cannot sign in | `JWT_SECRET` value changed, or the sign-in lock (5 wrong tries = 15 minutes for that address, not a bug) | Restore the previous secret version in Secrets Manager (AWS keeps AWSPREVIOUS); never change `JWT_SECRET` casually. **CHECK:** nothing in the documents ties `HASH_PEPPER` to sign-in failing after boot; D52 says setting it equal to `JWT_SECRET` gives the old single-key behaviour |
| Pages blank or "Nebulaa has been updated" | Open tab from before the release asking for deleted files (normal) | Click Reload. If blank with no message after a hard refresh, check the frontend service finished its rollout |
| Many "too many requests" (429) | Limits too tight or every visitor counted as one address (proxy hops) | Raise `LIMIT_HEAVY_AI_MAX`, `LIMIT_LIGHT_AI_MAX`, `LIMIT_UPLOAD_MAX` etc.; with several web tasks `RATE_LIMIT_STORE=mongo`; for the shared-address case `TRUST_PROXY_HOPS=2` (4.5 item 13); emergency back-out of shared limits: `RATE_LIMIT_STORE=memory` |
| Tasks keep restarting; logs show `"action":"exiting"` | A stray error now restarts the task (new crash policy) | Set `UNHANDLED_REJECTION_POLICY=log`, tell the assistant the log line |
| Approval/Library errors, buttons missing, wrong counts | Backend and frontend on different releases | Release or roll back both together; reload the page |
| Staff Usage page takes minutes | Indexes not built | Steps 4.1 to 4.4 |
| Sign-ups refused after a busy day | `SIGNUPS_PER_DAY` default 300 reached | Raise it (on the script's list) |
| Videos or Photoshoots stay "making", or Quarks look wrong | Consumer switch on without a worker, or a lost job | Switch off by the section 5 order; the sweeps refund after 30 minutes; do not edit balances by hand, ask the assistant |
| A job-stopper is needed fast | A provider or cost problem | Staff AI switches card, or `AI_KILLED=<provider>` (e.g. `openai,fal`), or lower `AI_DAILY_SPEND_CAP_USD` |

---

## 9. Open decisions for you (assistant's recommendation after each)

1. **Blueprint price 20 to 23 Quarks** (derived from the planner's cost; goes live with this release). Accept 23; every price follows `apiCosts.js`, and 20 would sell below cost.
2. **Carousel 8 Quarks per slide vs 11 for one image** (ledger). Keep 8; it is cost-derived (picture plus a fifth of a planning pass, no caption pass).
3. **Google review reply drafts: free, no daily cap** (about USD 0.001 each). Leave free for now; the daily AI ceiling is the backstop; add a cap of 30 a day only if you see abuse.
4. **Notification emails** (weekly summary, approval, low-Quark, receipt do not exist; the Settings tab was removed). Keep removed; build real ones after launch as their own job.
5. **Daily AI ceiling and charged Photoshoots (D99, my policy call).** The ceiling now blocks only NEW starts; already-charged jobs finish. Accept; reverse steps are in D99.
6. **Calendar tab with two pill rows (D5).** Leave as is; look at it live first.
7. **Landing page Inbox lines** (hide until the Inbox live test passes). Hide them: the Inbox has never run with real accounts and your rule is nothing unproven shown to customers.
8. **Wrong-bucket refunds / refund expiry rule** (deferred wallet redesign). Book a dedicated session after launch with a read-only review first.
9. **Model-written memory sentences** (about USD 0.001 to 0.003 per account per day). Not now.
10. **Competitor post pictures** (`ENABLE_COMPETITOR_THUMBS`) and the old weekly memory distillation (kept on, now under the spend guard, D2). Keep pictures OFF until a lawyer agrees; keep distillation as is.
11. **Live trend source** (`trends-sources.md`, no live source today). Launch with the news calendar only.
12. **Agency:** upgrade path from Starter/Growth, single-slot cancel, moving new Agency sign-ups to Rs 9,999 near 30 Ayrshare profiles. After launch.
13. **Hero Studio's richer style rules** into the new Videos styles. After launch.
14. **Should covers ever cost Quarks?** Default free; keep free.
15. **Smaller infra choices:** make the frontend image non-root (changes the port, D60); remove the plain-HTTP load-balancer address from the allowed origins once the domain is the only way in (D49); one shared disk (EFS) for the hidden old video maker (D38); trying Fargate Spot for the worker. All after launch; none blocks it.

---

## 10. Known limits at launch (honest list)

- **The automatic GitHub test run (CI) has never run.** The first real run may fail on something. Only local runs back the test numbers.
- **No real load test.** Only a 5-second smoke run and database-free local tools; no 10-minute soak, no 50 requests a second, nothing on a staging copy. The web/worker plan is untested under load.
- **Photoshoot, competitor drafts, the new planner blocks and Videos on workers have never run against the real AI models**; all were tested with fakes and on a throwaway copy of the dev database.
- **Inbox has never been tested with real accounts**; automatic replies have never run for real.
- **Some visuals use drawings or sample data** until the USD 0.66 sample-photo run; a few screens only show real numbers once data exists (for example the Influencers screen always shows "0 Mega, 0 Macro, 0 Micro" because the backend never sends the breakdown).
- **Demo account ("Nilaa Botanics") is not built** (branch `demo-brand-wip`, paused).
- **Hero video, Blueprint, plan runs and Drafts redo still run inside the web task that accepted them**; if that task stops they are resumed or refunded by sweeps, not handed to a worker. Videos and Photoshoot can move only with the OFF switches above.
- **Wrong-bucket refunds are deferred**, older inline charge/refund spots in campaigns, drafts, carousels, dashboard and content remain, and Razorpay `refund.*` events are not handled. Jobs queued by old code and failing after this ships are not refunded automatically (support refunds by hand).
- **Heavy stored documents:** drafts average 740 KB and campaigns 1.7 MB because pictures are stored inside them; a full campaigns scan took 134 s on dev. Lists are paged, background jobs use the new indexes, but the weight is still there (and the Atlas disk is finite).
- **Not built from the hardening list:** login token in an HttpOnly cookie, signed S3 uploads, enforced CSP, a per-campaign claim before posting, staff two-step sign-in, full-history secret scan.
- **Calendar "being prepared" mark and caches are per task**; with several web tasks a page can look stale for up to 15 seconds or say "not prepared" for a moment.
- **Without Redis, live Inbox updates are per task** (a message may show on the next refresh).
- **Razorpay:** live webhook and live purchase test are parked by you; real delivery of webhooks to our server is not proven.
- **Lawyer and accountant reviews** of Terms section 21, Privacy text and GST are still open from the last release.
- **Tamil and Hindi wording** on the questionnaire is machine-careful and needs a native read.

---

## CHECK items I could not resolve (collected)
1. Today's Atlas disk percentage (61% is an old figure).
2. Cluster tier and whether on-demand snapshots exist.
3. Exact Ayrshare rotation steps, and whether the new key must be saved anywhere.
4. The `JWT_SECRET`/`HASH_PEPPER` length one-liner (2.4) is untested; whether either also sits in the ECS task definition.
5. Your Mac's Node version for the frontend tests (CI uses Node 24).
6. The `INDEX_SCRIPT=create-perf-indexes.js` wrapper run (4.3/4.4) was read, not run.
7. Which field of `/api/health/details` shows the client address, and whether `TRUST_PROXY_HOPS` should be 1 or 2 in production.
8. Default on/off of each emergency kill switch not named in the documents.
9. Whether the test environment works for rehearsing section 6; Atlas connection limit; fal.ai / Gemini concurrency limits.
10. Whether the production competitor tracker and listening are already on (run 2.5).
