# Handover 6 — 2026-10-16 (Agency plan: Tasks 1 to 10 built, Task 11 partly built)

Read `HANDOVER-nebulaa-redesign-5.md` first (who the owner is, how to work, environment, repo, release steps, rules), then this file. Handover 5 said Tasks 3 to 12 of the Agency plan were not started: this session built Tasks 3 to 10 and most of Task 11. Nothing is pushed or released by this file's author; see "Push" below.

## Branch state

- Worktree `/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign`, branch `nebulaa-redesign`. Production last released at `b6f374b` (handover 5). Everything after it is unreleased, including the whole Agency plan.
- Tests at the last run: backend 1188 (`cd backend && node --test tests/*.test.js`), frontend 296 (`cd frontend && node --test tests/*.test.mjs`), `npx tsc --noEmit` exactly 1 old error (`pages/Influencers.tsx`), `node scripts/brand-audit.mjs` and `node scripts/voice-audit.mjs` 0 violations. After any UI change run `node scripts/visual-audit/gen-layer-lists.mjs` in `frontend/` and commit `index.html`.
- **Push:** the last push to GitHub was before this session's agency work (`f026333`). Run `git push origin nebulaa-redesign` from the worktree (an existing remote branch; the owner or the assistant may do it, never push to a new branch or release on the owner's behalf).

## Agency plan: where it stands (plan `plans/2026-10-16-agency-plan.md`, spec `specs/2026-10-16-agency-plan-design.md`)

The git-ignored SDD workspace `.superpowers/sdd/2026-10-16-agency-plan/` was copied into the repo at **`docs/superpowers/agency-plan-sdd/`** (ledger `progress.md`, every task brief, report, review and fix report). A fresh clone has these. They hold the exact request/response shapes each later task needs.

| Task | State | Commits |
|---|---|---|
| 1 config, entitlements | complete, reviewed | 8577221, 37e657b |
| 2 pure rules `services/agency.js` | complete, reviewed (2 Important fixed) | 2cbcd31, affb749 |
| 3 client workspaces `services/agencyWorkspaces.js` | complete | d7aa5d9 |
| 4 pass into a client, auth, routes | complete, real dev run (12 checks) | 80f6116 |
| 5 one shared Quark pool (money path) | complete, opus review (3 Important fixed or routed) | c3639f3, 7d9f453 |
| 6 billing: Agency plan and extra client slots | complete, opus review (4 of 5 Important fixed) | 47c4659, 6c04128 |
| 7 usage per client (JSON, CSV) | complete, real dev run | 711b3cb |
| 8 Ayrshare profile watch, alert at 25 | complete | 7df350c, dd9e714 |
| 9 removing clients, deleting an agency, exclusions | complete, real dev run | 8c1591d |
| 10 frontend: switcher, return bar, Clients page | complete | 0874d86, 6f57d26 |
| 11 frontend: plans card, slot purchase, usage view | **PARTLY BUILT** (see below) | ea4ff7f (WIP) |
| 12 Terms, Privacy, verification, launch checklist | not started | |

Method used (ledger ruling): mid-tier (sonnet) implementers, per-task opus reviews only for Tasks 5 and 6, then ONE final whole-branch review on the most capable model (not yet done). Use the `superpowers:subagent-driven-development` skill; its scripts are in `~/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/subagent-driven-development/scripts/` (`task-brief PLAN N`, `review-package PLAN BASE HEAD`). Always set the model explicitly when dispatching. Recreate the ledger from `docs/superpowers/agency-plan-sdd/progress.md` if `.superpowers/` is missing.

### Task 11, what exists and what does not (commit `ea4ff7f`, labelled WIP)

The agent was stopped mid-way to save usage. Tests, types and audits were green when committed (frontend 296, tsc 1 old error, brand/voice 0, layer lists up to date). Built: `frontend/utils/agencyPlan.ts` and `utils/slotPurchase.ts` (pure helpers, tests in `tests/agencyPlan.test.mjs` and `tests/slotPurchase.test.mjs`), `components/AgencyDialog.tsx`, `AgencyUsage.tsx`, `ExtraClientDialog.tsx`, edits to `pages/TrialExpired.tsx` (plans page), `pages/AgencyClients.tsx`, `pages/GravityHome.tsx`, `services/api.ts`, `App.tsx`, mock data in `scripts/visual-audit/mock-session.js` and `routes.json`. `tsconfig.json` gained `allowImportingTsExtensions` because the new helpers import with `.ts` extensions so the Node test runner can load them: check Vite builds fine (`npm run build` writes into `backend/public`: restore tracked files afterwards and commit nothing there), or change the helper imports instead.
**Not done:** the visual check at 375 and 1019 px for the plans page Agency card (3 states: not subscribed, subscribed with slots, at the 25 cap, plus the managed state), the slot dialog, the usage view (data, empty, error); fixing the Task 1 minor (the Agency card's generic feature lines read oddly above the agency lines); a review of the wording against the voice spec; the report `task-11-report.md`. The brief is `docs/superpowers/agency-plan-sdd/task-11-brief.md`. Customers must never see `quarksSpent`, `total.quarksSpent` or `poolLeft` (show posts and videos).

### Task 12 (not started): see the plan. Legal wording for "Agency accounts and client brands" in the Terms and Privacy pages, bump `backend/config/legalVersions.js`, run everything, a real end-to-end on `nebulaa_dev` with throwaway users (the plan lists six scenarios; the account in step 2 needs one real low-cost image generation: ask the owner for an OK for that spend), and write `docs/superpowers/ops/agency-launch-checklist.md` (owner steps: create the Razorpay plans or set `RAZORPAY_PLAN_ID_AGENCY` and `RAZORPAY_PLAN_ID_SLOT`, add both to the secret, confirm Ayrshare headroom, test slot checkout with Razorpay TEST keys, accountant and lawyer reviews). Legal pages are drafts for lawyer review.

## Then: the final whole-branch review (most capable model, read-only)

Focus: managed and existing accounts never blocked; no way for a client workspace to reach billing, plan, deletion or export; every Quark read and write for a client goes to the agency pool atomically, no double spend or refund; Razorpay webhook fail-closed, idempotent, config-sourced, strict amount check on verify and webhook; slot cap (20 paid slots, 25 clients) and freeze/unfreeze on cancel or plan end; removal refused while work runs; deletion of an agency purges clients; staff/scheduler exclusions; customers never see Quarks or vendor names; Terms/Privacy wording. Include the owner flags below.

## Things the reviews and agents flagged (decide or fix)

1. **Hard-coded personal email in `services/notificationScheduler`** (every campaign reminder goes to it). Existing code, not changed: fix before release.
2. **CSM pass path bypass:** `isBlockedWhileActing` (existing CSM pass) does not lower-case or decode the path, so `/API/PAYMENT` might get past it. The agency pass already handles it (`isBlockedInsideClient`). Fix the CSM one separately.
3. **Frozen-client race:** the frozen check in `quarkBuckets.spend` is a separate read from the atomic spend (tiny window). Weigh in the final review.
4. **Refused payments** are recorded (`payments` row with `needsRefund: true`, shown in staff Money failures) and emailed to the owner once; they are NOT retried automatically and need a manual Razorpay refund.
5. **Terms prompt inside a client:** client workspaces have no consent record, so the frontend suppresses the "updated Terms" prompt; a backend consent record for workspaces may still be wanted.
6. Content-calendar auto-generation and snapshot collection still run for client workspaces (they may spend the agency pool): owner decision. Account export covers only the agency's own data, not its clients': owner decision. Staff can open a workspace by id on the single-client staff page.
7. Real-Mongo risk: the atomic update filters (`$elemMatch`, `$or`, `arrayFilters`, `$ne` on arrays) were judged valid by review and exercised in real dev runs for Tasks 4, 5, 7 and 9, but the billing paths (Task 6) ran against fakes only: do a short dev run in Task 12.
8. After an agency plan ends, the usage report returns 403 (export access ends): relax if the owner wants.

## Owner decisions still open

- **Single-slot cancel** route/button (no later task builds it; slots cancel only with the plan or via Razorpay).
- A **Starter/Growth to Agency upgrade path** (none today: blocked like Starter to Growth).
- "When the platform nears 30 Ayrshare profiles, new Agency sign-ups move to Rs 9,999" is in the spec but **not wired** (Task 8 only alerts at 25).
- Rs 1,499 per extra client and the Agency price Rs 6,999 are config values (`backend/config/apiCosts.js`); the Ayrshare cliff (USD 599 flat for 30 profiles, then about USD 8.99 each) is in `backend/config/vendorPlans.js`.
- Items from handover 5 still stand (release of everything since `b6f374b`, paperwork, Subashni and lawyer reviews, Razorpay plan ids for the Agency plan only when it goes live).

## Rules (unchanged, see handover 5)

Plain, non-technical replies; honest reporting; the owner types the release himself (`docs/superpowers/ops/release-prod.sh`, he types DEPLOY); never release or deploy on his behalf; never push to a NEW remote branch; no paid generation without his OK for that run; real runs only on `nebulaa_dev` through scripts that refuse any other database, with throwaway users deleted afterwards; never read or print `.env` or secrets; no keys, build output or `node_modules` symlinks in commits; customers see posts and videos, never Quarks; wording guard bans "credit", "trial", "7 days" in customer-facing files; read test output before committing and never commit over a failing test.
