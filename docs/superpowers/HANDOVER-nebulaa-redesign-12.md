# Handover 12 — 2026-10-18 (small update on top of handover 11)

Read handover 5, then 9 to 11, then this file. Everything here is committed and pushed to `origin/nebulaa-redesign`; nothing is released by this file's author.

## Done since handover 11
- **Stage 4 competitor card checked on screen** (My plan and the Competitors page, cream theme, readable, real highlights shown from real snapshots written through the real tracker with a fake scraper). The tracker is OFF unless `ENABLE_COMPETITOR_TRACKER=on` (a throwaway test script must set it, or the pass returns `disabled: true`).
- **Bug reported by the owner's CSM, fixed (`fadf348`):** on the Videos screen, a PHOTO added with "Add a picture or PDF" gave "Nothing readable was found in this file". That button only reads printed text from business documents. Now the message says no printed text was found, and for a photo the screen offers three buttons ("A person", "A place", "A product") that add the photo as a visual reference (it then shows under "Who appears" / "Where it happens" / "Your product" in step 2). Checked in the browser with a simulated "no text" answer (no real vision call). Report `docs/superpowers/ops/photo-reference-fix.md`; helpers in `frontend/utils/ideaFiles.ts`; limits: 2 people, 1 place, 2 products. Tell the CSM: for a photo of a person or place use "Choose a photo" under Make it yours, or the new buttons; the idea-box button is for pamphlets, posters, price lists.
- Tests at the last run: backend 1831, frontend 417, audits 0, tsc only the old Influencers.tsx error.

## Open (unchanged from handover 11 unless noted)
The "Do next" list of handover 11 still stands: landing page rework, website copy document, Inbox live-test sheet, the customer-facing Quarks sweep (owner has not answered), then the owner's release and the staff-index script. Observation to follow up: a CSM working inside a client that is on the free tier sees the banner "You are looking around. Choose a plan to start making posts and videos." and 0 Quarks, so video creation will stop at the paywall for that client; ask the owner whether such clients should have a plan or Quarks added by staff before the CSM works on them.
