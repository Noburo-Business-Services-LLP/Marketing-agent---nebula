# Nebulaa redesign: handover 2 (2026-10-04, supersedes the "Do next" of HANDOVER-nebulaa-redesign.md)

Branch `nebulaa-redesign` (worktree `nebula-worktrees/nebulaa-redesign`). Nothing is pushed or deployed. Backend tests 404, frontend 90, tsc exactly 3 pre-existing errors (AdminDashboard, AdminLogin, Influencers).

## Done

- Plans, Quarks, add-ons: spec `specs/2026-10-04-plans-and-quarks-design.md`, plan `plans/2026-10-04-plans-and-quarks.md`; built, reviewed once (3 Critical found and fixed in cecc9d1), welcome email and Ayrshare guards (c1c54e8), Terms and Privacy rewritten (677329a).
- Landing, sign-up questionnaire and showcase panel from `rebrand-on-prod` are already on this branch (1d60c87 and later), with plan cards and Quarks wording. Onboarding questions translated to English, Tamil, Hindi (b8f62d5); Tamil and Hindi need a native-speaker read (`scratchpad/onboarding-i18n-report.md`).
- Brand Growth Blueprint: spec `specs/2026-10-04-brand-growth-blueprint-design.md`, plan `plans/2026-10-04-brand-growth-blueprint.md` (owner rulings at its end). Tasks 1 to 5 done (facc3b5, fdfb212, c689be6, e33d56a, 53b5687).

## Do next, in order

1. Blueprint Task 6 (document page with A4 print stylesheet, in-app nav entry, guided checkpoints, calendar hand-off) and Task 7 (copy options, wording scan, final verification) from the plan. Task 5 left these notes: `BlueprintDocument` replaces the placeholder in `pages/BlueprintView.tsx`; tolerate null pillar `why`/`example`; render `closing.contact` (email, website, phone, Instagram, Facebook); "Change your answers" does not restore earlier answers because `GET /api/blueprint/:id` returns no input.
2. One final review (most capable model), focus: free tier cannot reach outside services; Blueprint charge-once and refund-once; no invented facts in Blueprint output; SSRF safety of `services/blueprint/safeFetch.js`; managed accounts never blocked; wording scan.
3. Test the two partial unique indexes of the `blueprints` collection against a real throwaway MongoDB (only fakes so far). Check collection sizes first (Atlas disk limit).
4. Look at the landing, sign-up, onboarding and Blueprint pages at 1280 px in a real browser (the audit pane caps at 1019 px).
5. Deploy decisions (owner): this branch is about 111 commits ahead of `origin/prod`; decide the deploy path. Before any production deploy: set `RAZORPAY_WEBHOOK_SECRET` (the webhook now refuses to run without it), test add-on cancellation with Razorpay test keys, confirm GST on inter-state invoices with the accountant, make sure the Razorpay plans are created on first use in the live account, and update AI prompt text that still names "Gravity" (socialInboxService.js, brandMemory.js, promptRegistry.js).

## Hard rules (unchanged)

No real video generation or fal call without the owner's OK for that run. No app run against a database other environments use. Do not use localhost:5000 or :3000 (the owner's servers); use `frontend/scripts/visual-audit` on 127.0.0.1:3100 with its stub. No .env, keys, `backend/public` build output or `node_modules` symlinks in commits. Do not touch the Kling files. Nothing is pushed or deployed without the owner's explicit OK. Use nvm for Node.

## Update, 2026-10-04 evening (supersedes "Do next" items 1 and 2 above)

- Blueprint **Task 6** (document page, A4 print stylesheet, in-app nav entry, calendar hand-off) is done: `e3b5616`. Blueprint **Task 7** (copy options, wording scan) is done: `d697fbc`. Backend tests 416, frontend 98, tsc exactly 3 pre-existing errors.
- **The one final review of the Blueprint was NOT completed.** It was dispatched on the most capable model and failed immediately with "out of usage credits" (HTTP 429), so it produced no findings. Tasks 1 to 5 were built in an earlier session without per-task reviews, and Tasks 6 and 7 had none either, so the Blueprint has had **no independent review at all**. Run it before any deploy. Range: base `32445d5` to HEAD. Focus (owner's list): a free account cannot reach outside services; Blueprint charges once and refunds once (including the two partial unique indexes, only tested with fakes); no invented facts in Blueprint output (try hostile model output against `services/blueprint/qa.js`); SSRF safety of `services/blueprint/safeFetch.js` (hostile hosts, Instagram lookalikes, redirects, DNS rebinding, gzip bombs); managed accounts never blocked; wording scan.
- Open points the implementers left for the reviewer:
  - `blueprint-new` shows 17 "unknown background" items in the visual audit (text over the `GravityPanel` gradient). Compute contrast against the gradient stops, then sign them off in `frontend/scripts/visual-audit/unknown-signoff.json` or fix.
  - The print preview was only emulated (703 px, print rules on; every page fits one A4 sheet, tallest page 5 at 931 of 1032 px). Black-and-white output and the print dialog filename are unverified. `documentFileName` ends in `.pdf`; Chrome may append `.pdf` again.
  - "Change your answers" does not restore earlier answers (the API returns no input).
  - `coverStyle` uses the visitor's first colour as the band and the second as a stripe (two side-by-side halves failed contrast).
- Everything above, and the deploy checklist in item 5 of the list above, still applies. Nothing is pushed or deployed.
