# Handover 31: 2026-10-22: demo real-video prep done; the owner makes six real videos, then runs `adopt`

Short addendum to handover 30 (read 30 first, it is the state document: demo account "Zaya Naturals", real photos, composed posts, landing headline, open lists). Standing rules unchanged: owner (Dinesh) non-technical, plain language, exact commands in separate code blocks, honest reporting; he runs releases himself; never read or print `.env` or the demo password; no paid or provider call without his explicit OK for that run; real DB work only on `nebulaa_dev`; stage by explicit path; push only to the existing `nebulaa-redesign`. At 98 to 99% of any limit stop, commit, push, handover. Check `ls docs/superpowers/HANDOVER-*` before the next number.

## State
Branch `nebulaa-redesign` (worktree `/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign`): everything committed and pushed (head `250d976` plus this file). Backend suite 3278 of 3278, eslint clean on touched files. The weekly usage limit was at 84% when this was written (resets 2026-10-26 around 14:00 UTC); keep to one small job at a time.

## Done this session (pushed)
Demo real-video prep (decisions D126 and D127, ledger updated):
1. **Preflight:** the demo account CAN run Create video after one fix: reference photos are `http://localhost:5000/demo-assets/...` but the Videos flow only downloads https, so photos would have been dropped silently. `readDemoReference` (`backend/services/demoProfile.js`, called first in `toRef` in `routes/studioVideos.js`, from the WIP branch `demo-real-videos-wip`, reviewed, 6 MB cap) reads the demo-assets folder directly, outside production only, no network. Tests `backend/tests/demoReference.test.js`.
2. **`docs/superpowers/ops/demo-real-videos.md`:** preflight table, start steps, cost (about USD 6 to 7 for six 10-second Omni clips; 161 Quarks each, 966 of the account's 1,355), six paste-ready entries (styles `product-showcase`, `get-ready-with-me`, `festive-campaign`, `behind-the-scenes`, `testimonial`, `unboxing`; English, Female, vertical, 1 clip; reference files in `backend/demo-assets/zaya/`; idea text with real product names and prices; a 15 to 20 word line said once).
3. **`backend/scripts/demo-real-videos.js`** (`status`, `adopt`; adopt is a DRY RUN unless `CONFIRM_ADOPT=yes`; refuses any database but nebulaa_dev and any non-demo user): keeps real videos with a new optional field `StudioVideo.demoKeep`, relinks the Library reels, removes the drawn clips they replace; `seed-demo-brand.js create` now KEEPS rows with `demoKeep` and does not redraw their slots. Pure logic `backend/scripts/demo-brand/realVideos.js`, 8 tests (`tests/demoRealVideos.test.js`). Dry run on dev: 0 real, 5 drawn, nothing to adopt.

## OWNER STEPS (plain)
1. In the dev env check: `GEMINI_API_KEY` (Omni), a text-model key (the free "Plan the video" step), Cloudinary settings (finished clips are stored with `uploadVideoFile`; without them the video fails and the Quarks are returned), Atlas free disk and your current home IP on the Atlas access list. `ENABLE_STUDIO_VIDEO_CONSUMER` must be unset or OFF (otherwise the video is only queued and nothing runs it). `RUN_BACKGROUND=0` is fine. `AI_KILLED` must not contain `google_video`.
2. Start the dev app as in handover 30, sign in as the demo user (`cat` the password file named in handover 30), and make the six videos from `docs/superpowers/ops/demo-real-videos.md`. Make them in pairs (two videos can run at once). Leave Logo OFF (the logo is a local http link; the finishing pass fetches https only).
3. Delete unwanted change-request versions in the app first (every completed row counts as real), then run `cd backend && node scripts/demo-real-videos.js adopt` (dry run), read the plan, then `CONFIRM_ADOPT=yes node scripts/demo-real-videos.js adopt`.
4. **Do NOT run `seed-demo-brand.js create` before adopt** (a rebuild before adopt still wipes real videos). After adopt, `create` keeps them. `remove` still deletes everything but does not delete the clips stored in Cloudinary.

## Open (carried forward)
- `adopt` and `create` DB paths (`apply`, `keptVideos`, the seed edits) are only tested through pure parts, guards and the dry run (there were zero real videos): after the six exist, dry run first and inspect.
- Handover 30 DO NEXT items 2 and 3 (demo polish list in the ledger "DEMO WALKTHROUGH UI FINDINGS", `/samples/*.webp` photos, next release contents, E9 stage B steps 3 to 6, hardening items, wrong-bucket refunds, owner decisions) all stand; the first release after this carries plan-card wording, OG tags, the new landing headline and the demo code (guarded and harmless in production).
- Handover 28's rule for E9 rollbacks still applies (switch the Videos worker feature off and let the queue drain before any image rollback).

## Method notes
Sonnet with a precise brief and a "commit after each step" instruction works well when usage is tight; park partial work on a WIP branch; never run paid calls from an agent.
