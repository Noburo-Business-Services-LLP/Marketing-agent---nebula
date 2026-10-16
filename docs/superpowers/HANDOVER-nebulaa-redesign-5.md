# Handover 5 — 2026-10-16 (paywall-first launch work, account deletion, agency plan)

Read this first, then `HANDOVER-nebulaa-redesign-4.md` for older background. Written so a fresh Claude session can carry on without the earlier conversation.

## Who and how to work

- Owner: Dinesh (Nebulaa; gravity.nebulaa.ai; legal entity now **Noburo Systems Private Limited**). Plain, non-technical language in replies. Honest reporting. He types the release himself (`docs/superpowers/ops/release-prod.sh`, he types DEPLOY). Never push to a NEW remote branch (classifier blocks it) and never release or deploy on his behalf. Never run paid generation (fal/video) without his OK per run.
- Customers see posts and videos, never Quarks. No free tier (only the free Growth Blueprint). Plans: Starter Rs 999 (600 Quarks), Growth Rs 1,999 (2,000 Quarks), ex-GST. Managed-service clients (all current customers) are topped up by hand and are never blocked.
- Wording guard test bans "credit", "trial", "7 days" in customer-facing files (legal pages exempt).

## Repo and environment

- Worktree: `/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign`, branch `nebulaa-redesign`, remote `origin` = `git@github.com:Noburo-Business-Services-LLP/Marketing-agent---nebula.git`. Production last released at commit `b6f374b`. Everything after it (list below) is committed locally and **unreleased**.
- Backend tests: `cd backend && node --test tests/*.test.js` (1014 at last full run). Frontend: `cd frontend && node --test tests/*.test.mjs` (252). After any UI change run `node scripts/visual-audit/gen-layer-lists.mjs` in `frontend/`, then `node scripts/brand-audit.mjs` and `node scripts/voice-audit.mjs` (both must say 0 violations). `tsc` has one old error (Influencers.tsx).
- Local servers (Claude desktop app preview): `redesign-backend` (port 5000), `redesign-frontend` (3000), from `.claude/launch.json`. Dev DB is `nebulaa_dev` on Atlas. Scripts must refuse any other database (see `backend/scripts/add-dev-quarks.js` pattern). Throwaway test users: create with a script + `generateToken` (middleware/auth), delete afterwards; never leave test data. The dev user hello@nebulaa.ai (id 69ac31a91233351e41fe0945) has `staffRole` null.
- Production: ECS; secrets in AWS Secrets Manager `nebulaa-gravity/prod/backend` (ap-south-1); ops scripts in `docs/superpowers/ops/` (`release-prod.sh`, `set-secret-value.sh`, `check-secret-keys.sh`).

## Commits since the last release (oldest first, all unreleased)

b3f7d69 cost safety (daily AI spend ceiling, switches); f2fefee staff AI spend card; 37807f9 cancel plan + renewal reminder; 66ef65f GST invoice details; d907e74 Refund page + legal links; 3eaf161 consent at sign-up; **ed81036 account export and deletion**; 85c30a7 and e002bce agency spec; df4b72b agency plan; 8577221 and 37e657b agency Task 1. Check `git log b6f374b..HEAD` for anything newer (2cbcd31 is agency Task 2, unreviewed).

## Done this stretch

### Account export and deletion (finished, committed, verified for real on dev)
Download my data (password, once a day, one JSON file); Delete my account (password + type DELETE; billing stops at once; 14-day wait; Restore screen; then a purge job every 6 hours erases data, Cloudinary files and the connected social profile; invoices kept 8 years; one-way hashed-email tombstone stops repeat free Blueprints; staff log anonymised); one-time "agree to updated Terms" prompt for existing customers; Privacy page retention text updated. Key files: `backend/services/dataRegistry.js` (a test fails if any new model that references a user is not in its rules), `accountDeletion.js`, `accountExport.js`, `cloudinaryCleanup.js`, `routes/account.js`, `middleware/auth.js` (423 `deletion_pending`), frontend `components/AccountPrivacy.tsx`, `DeletionPending.tsx`, `TermsPrompt.tsx`, `utils/accountDeletion.ts`. Dry-run script: `backend/scripts/account-purge-dryrun.js <email>`.
Not proven: real Razorpay cancel during deletion, the two emails actually sending, real Cloudinary deletion of files. Needs Subashni (accountant) to confirm: 8-year retention, hashed-email tombstone, SAC code 997331, inter-state GST. Legal pages are drafts for lawyer review.

### Agency plan (in progress, being built subagent-driven)
- Spec (approved): `docs/superpowers/specs/2026-10-16-agency-plan-design.md`. Plan (approved, 12 tasks): `docs/superpowers/plans/2026-10-16-agency-plan.md`.
- Design in one paragraph: each client brand is a hidden `User` record owned by the agency (`agency.ownerId`); the agency switches into a client with a pass token (same mechanism and same browser keys `csmReturnToken`/`csmActingClient`/`csmReturnTo` as the CSM pass); one shared Quark pool on the agency account, all spends/refunds redirected to the agency and tagged with the client in `QuarkLedger.workspace`; the agency's plan is mirrored onto each client; client limit enforced atomically (5 included, +1 per paid slot, max 25).
- Prices (config only, `backend/config/apiCosts.js`): Agency Rs 6,999 ex-GST, 5 clients, 6,000 shared Quarks, Publish/Inbox/Competitors included; extra client Rs 1,499, +500 Quarks each. Why Rs 1,499 and not Rs 799: Ayrshare Business plan is a flat USD 599 for the first 30 social profiles (7 in use now, so profiles 8 to 30 cost nothing extra), then USD 8.99 each (about Rs 790) from the 31st. Plan: alert the owner at 25 profiles; when the platform nears 30, new Agency sign-ups move to Rs 9,999. The same cliff affects the existing Rs 1,000 Publish add-on.
- **Progress (also kept in the git-ignored ledger `.superpowers/sdd/2026-10-16-agency-plan/progress.md`, which will NOT be in a fresh clone):**
  - Task 1 (config, entitlements): **complete**, reviewed, 1 fix round (Blueprint `tierAtStart` enum now follows `TIERS`). Commits 8577221, 37e657b.
  - Task 2 (pure rules `services/agency.js`, User `agency` block, `tests/agencyRules.test.js`): **implemented and committed (2cbcd31, base 37e657b), backend suite 1019 pass, but NOT yet reviewed.** Next step: run the task review (`review-package PLAN 37e657b 2cbcd31`, spec + quality reviewer), fix rounds if needed, then add `Task 2: complete` to the ledger.
  - Tasks 3 to 12: not started.
  - Deferred minors: Blueprint agency-tier test lacks a negative control; the Agency plan card's generic feature lines read oddly above the agency lines (check in Task 11); "Usage report for each client" is promised on the card and delivered by Tasks 7 and 11.
- **How to resume the SDD loop:** use the `superpowers:subagent-driven-development` skill. Its scripts are at `~/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/subagent-driven-development/scripts/` (`sdd-workspace`, `task-brief PLAN N`, `review-package PLAN BASE HEAD`). Per task: record BASE (`git rev-parse --short HEAD`), `task-brief` to extract the task, dispatch an implementer (general-purpose, model sonnet, always specify the model) with the brief path and a report-file path, then `review-package` and a reviewer, fix rounds by resuming the implementer, a scoped re-review, then add `Task N: complete (...)` to the ledger. Recreate the ledger if missing: first line `# SDD ledger — plan: docs/superpowers/plans/2026-10-16-agency-plan.md`, then one `Task N: complete` line per finished task. The owner said earlier: prefer mid-tier models and one final whole-branch review on the most capable model. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Known plan risks worth a second look while building: Task 5 touches about 15 places that read or write a Quark balance (list is in the plan; a guard test `creditAccessGuard.test.js` pins the reviewed files); Task 6 adds a new subscription kind `slot` to Razorpay handling (webhook and verify paths); Task 9 needs `defaultModels()` to include `QuarkLedger` if not already covered. Tasks 4, 5, 9 and 12 include real runs on `nebulaa_dev` with throwaway users.

## Still to do after the agency plan (the owner's queue)

- Per-user daily video limit/queue; plans-page restyle; greyed sidebar/look-around for new accounts; Pulsar untouched; Inbox and Competitors live proof with a real connected account; "Enhance" (upscale) untested; Tamil voice and created-person videos untested.
- Release of everything since `b6f374b` (he runs the script). Before it: set `RAZORPAY_PLAN_ID_AGENCY` and `RAZORPAY_PLAN_ID_SLOT` only if the agency plan is going live (add both names to `set-secret-value.sh` allowlist and `check-secret-keys.sh`).
- Owner steps: Razorpay/Meta/DLT/Zoho paperwork; Subashni reviews (SAC, GST, retention); lawyer review of Terms/Privacy/Refund and the planned agency clause; legacy secret keys cleanup (PROD_MONGODB_URI, RENDER/NGROK/GROQ); ask Ayrshare if a profile created and removed in one month is billed in full; re-measure the real cost per Quark (about Rs 0.70 assumed).

## Memory

The persistent memory index is at `~/.claude/projects/-Users-dineshkannaa-Documents-0-CONTENT-Claude-Agents/memory/MEMORY.md` (pricing, branch topology, redesign state, Omni videos, etc.); it is loaded automatically by Claude Code on this machine.
