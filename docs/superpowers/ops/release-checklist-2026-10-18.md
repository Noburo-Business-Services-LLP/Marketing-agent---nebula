# Release checklist: everything since `b6f374b` (prepared 2026-10-18)

One release carries all of it: 122 commits, 446 files. You run the release yourself (`release-prod.sh`, you type DEPLOY). Tick the boxes in order. "Check" commands print names or counts, never secret values. Nothing here is done by the app on its own.

## 0. What this release contains
- **Agency plan** (Rs 6,999 ex-GST, 5 client brands, shared pool, extra client Rs 1,499) with client passes, usage per client, Ayrshare profile watch (alert at 25).
- **Plans and billing changes:** cancel plan with renewal reminders, GST invoice details, Refund page and legal links, consent at sign-up, one-time "agree to updated Terms" prompt for existing customers.
- **Account export and deletion** (14-day wait, purge job every 6 hours).
- **Plan-led home:** My plan, This week card, setup path, plan-led calendar, six-step guided tour.
- **Competitor tracking** (weekly reads, "What your competitors did" card). OFF until you set a switch.
- **Social listening Phase A** (comment scoring, "What people say about you" card). OFF until you set switches.
- **Cost safety:** daily AI spend ceiling, kill switches, staff AI spend card; the secret scripts now also accept the new switches.
- Staff area: Home, Clients, Team, Money, Usage are already live; this release adds the Agency, spend and listening pieces to them.

## 1. Gate (I can run these; all passed at the last run)
- [ ] Backend `cd backend && node --test tests/*.test.js` (1735 pass), frontend `cd frontend && node --test tests/*.test.mjs` (386 pass), `npx tsc --noEmit` in `frontend` (1 old error in `Influencers.tsx`), `node scripts/brand-audit.mjs` and `node scripts/voice-audit.mjs` (0 violations).
- [ ] `git status` clean on `nebulaa-redesign` and `git log origin/nebulaa-redesign..HEAD` empty (all pushed). Last pushed commit at preparation time: `af0b1d8`.
- [ ] The two older "fix before release" items from the Agency checklist are already fixed in the code (verified 2026-10-18): the CSM pass now normalises case, slashes and encoding (`normalisePath`, tested with `/API/PAYMENT`), and campaign reminder emails are off by default and go to the post owner only (`CAMPAIGN_REMINDER_EMAILS=on`).

## 2. Before you release (your steps)
- [ ] **Atlas disk and IP:** the cluster was near its disk ceiling before. Open Atlas and check free space, because this release adds new collections (listening scores, competitor snapshots and read log, weekly proposals, plan runs, agency and deletion records). Confirm Network Access still lists the production NAT addresses (3.6.52.230 is in; 15.252.94.235 is the second NAT and was not: add it if production restarts fail to reach the database).
- [ ] **Secret check:** `bash docs/superpowers/ops/check-secret-keys.sh` and read the names it lists as MISSING. Needed for this release: `RAZORPAY_WEBHOOK_SECRET` (the payment webhook refuses to run without it), `OPENAI_API_KEY` (plans, posts and comment scoring need OpenAI credit: also check the OpenAI account has credit and a billing alert), `ALERT_EMAILS` (failure and Ayrshare alert emails stay silent without it), `FRONTEND_URL=https://gravity.nebulaa.ai` (not the load-balancer address), `APIFY_API_KEY` (already set).
- [ ] **Updated Terms prompt (decision):** the release shows existing customers a one-time "agree to updated Terms" prompt. The new Terms (section 21, Agency accounts) and Privacy text are DRAFTS not yet read by your lawyer. Either (a) get the lawyer's read first, or (b) accept releasing with the drafts. Controlled by `backend/config/legalVersions.js`.
- [ ] **Subashni (accountant):** GST rate and SAC code on Agency and extra-client invoices, retention period, inter-state GST.
- [ ] **Razorpay:** the Agency and slot plans are created by the app on first use, or create them and set `RAZORPAY_PLAN_ID_AGENCY` and `RAZORPAY_PLAN_ID_SLOT`. Slot and Agency checkouts have never run for real: either test with Razorpay TEST keys first (see `agency-launch-checklist.md` section 2) or keep the Agency plan hidden/unannounced until you have.
- [ ] **Tell managed clients and your team** before the new "My plan", Setup and "This week" cards and the tour appear (`plan-launch-checklist.md`, "Before release" step 4).

## 3. Release
```bash
cd "/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign" && bash docs/superpowers/ops/release-prod.sh
```
- Needs Docker running and free disk (the script checks 6 GB). If it stops on a disk or build-cache error: `NO_CACHE=1 bash docs/superpowers/ops/release-prod.sh`. Never edit the script while it runs.
- Backend ships with or before the frontend (the tour saves its progress through a new route). The script deploys both; if you ever deploy by hand, backend first.
- ECS rolls back by itself if the new version cannot start. The manual rollback command is printed at the end of each deploy (task definitions `backend` and `frontend`).

## 4. Right after the release (about 10 minutes)
- [ ] Open `https://gravity.nebulaa.ai` (not the raw address) and sign in as the Owner. Staff area: Home, Clients, Team, Money, Usage all load.
- [ ] A normal customer account (or your test account): the Home screen shows Setup, This week and the tour once; My plan opens; Settings has "Download my data" and "Delete my account"; Refund and legal links in the footer work.
- [ ] Backend logs (CloudWatch group `/ecs/prod-nebulaa-gravity-backend-taskdef`): started cleanly, connected to MongoDB, schedulers started, no serious errors. Command: `docker run --rm -v "$HOME/.aws:/root/.aws:ro" amazon/aws-cli --region ap-south-1 logs tail /ecs/prod-nebulaa-gravity-backend-taskdef --since 10m`.
- [ ] Check the unique index on `weekly_proposals` exists (the app creates it on first use; confirm it rather than assume).
- [ ] Content Strategy PDF button in Settings still works (the Gemini model fix is in this release).
- [ ] Hero video: not part of this checklist; try one only with your own OK for the cost.

## 5. Plans for existing managed clients (after the release)
From `backend/`: `node scripts/plan-backfill.js --limit 20` (dry run by default, prints who gets a plan and the estimated cost, about Rs 5 each). Then `CONFIRM_PROD=yes node scripts/plan-backfill.js --limit 10 --yes` one batch at a time, and look at the first 3 or 4 plans before continuing. Details: `plan-launch-checklist.md`.

## 6. Switches to turn on, one at a time (all OFF by default)
Use `bash docs/superpowers/ops/set-secret-value.sh` once per setting (value is typed hidden; it offers a restart at the end). Do them one at a time and look at the staff Money and AI spend cards after each.
1. **Weekly competitor reads:** `ENABLE_COMPETITOR_TRACKER` = `on` (about USD 0.46 a day at the 200 read cap; reads only accounts with the Competitors add-on, Agency or managed). Optional: staff switch "Competitor checks" in the AI switches card.
2. **Comment scoring:** `LISTENING_MODEL` = `gpt-4o-mini`, then `ENABLE_LISTENING` = `on`, then switch "Comment scoring" on in the staff AI switches card (cost about USD 0.0003 per 24 comments; the model provider receives comment and message text: the Privacy sentence says so, lawyer to confirm).
3. **Campaign reminder emails (optional):** `CAMPAIGN_REMINDER_EMAILS` = `on` (post owner only).
4. Other kill switches, if you ever need them: `ENABLE_PLAN_SCHEDULER=off`, `ENABLE_WEEKLY_PROPOSAL=off`, `ENABLE_WEEK_RECOVERY=off`, `ENABLE_COMPETITOR_TRACKER` unset, `ENABLE_LISTENING` unset, `AI_KILLED=<action>` (see the staff AI spend card).

## 7. Still open after release (not blockers; all listed in handovers 6 to 10)
- Lawyer review of Terms section 21 and Privacy text (incl. the private-message sentence); accountant review; Ayrshare billing question (profile added and removed in one month); re-measure the real cost per Quark (about Rs 0.70 assumed).
- Agency: single extra-slot cancel route is built per the latest checklist but untested with real Razorpay; Starter/Growth to Agency upgrade is blocked; the automatic move of new Agency sign-ups to Rs 9,999 near 30 Ayrshare profiles is NOT built (change the price by hand when the 25-profile alert comes).
- Comment scoring: disconnecting a social account keeps its scores; the "See plans" note for accounts without the Inbox add-on; skipped Minors in `plan-led-sdd/stage-5/fix-round-report.md`.
- Competitor tracking: other customer scrapers (`routes/dashboard.js`, `services/aiDashboard.js`, `seoRoutes`) still sit outside the cost guard; "See plans" goes to `/trial-expired`.
- Replace the AWS root keys with a limited IAM user; set an ECR lifecycle policy; fix the test environment (it has never run successfully).
- Close any terminal window where you pasted an API key during the real-read and real-call checks.
