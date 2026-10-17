# Stage 4 competitor card: browser check (2026-10-17)

## How it was checked
- `backend/scripts/competitors-ui-check.js setup` (refuses any database except `nebulaa_dev`) made four throwaway accounts (email prefix `uicheck4-`), a finished plan for each, and ran the real tracker twice with a FAKE profile reader (a week ago, then now, through the `now` and `deps` seams; spend guard and gate faked). No scraper and no AI call was made.
  - entitled: add-on, 3 competitors with handles, two weekly snapshots (one competitor reads fine in week 1 and fails as private in week 2)
  - empty: add-on, one competitor with a handle and one without, no snapshots
  - none: add-on, no competitors
  - locked: no add-on
- Browser pane at 1280 and 375 wide, against the already running servers (see below). `setup` prints a login token per account; the token went into `localStorage.authToken`.
- `cleanup` deleted every row (users, competitors, snapshots, plan rows) and reported 0 left; a read-only scan of every other collection found no rows for these accounts.

## What was already running
Port 3000 (vite) and port 5000 (`node server.js`) were already listening, both started from this worktree (backend at 12:43, before this run). I used them as they were, did not start, restart or stop either, and killed nothing of theirs. Vite hot reload picked up my frontend edits.

## What I saw
- My plan, entitled, 1280 and 375: card readable, three highlights in plain language ("Cake House posted 6 times this week, up from 2.", "Brew Lane posted 1 time this week, down from 4.", "Cake House's best post this week was a reel with 410 likes."), one row per competitor with handle, status and "Posts a week: 2, 6". Failed handle row reads "We could not read this account. Check the handle." No horizontal scroll at 375.
- Competitors page: it is a light page now (the "leans dark" note in the handover is out of date). Measured contrast in the card: 14.9 headings and highlights, 9.5 and 10.2 secondary text, 5.9 handle and "Posts a week" lines (all pass AA 4.5).
- Loading state ("Loading…") seen on both pages; error state (insights request forced to fail) shows the message and a "Try again" button; the empty states read correctly: no snapshots yet ("We have started looking at your competitors' public posts. What changed shows from next week." with a "Add their Instagram handle" row), no competitors at all.
- Not entitled: the card renders nothing on My plan (correct) and on Competitors.

## Defects and fixes
1. Competitors page at 375: the "Competitor Activity Feed" header kept a fixed 256 px search box beside the title, which overflowed its card and produced a horizontal scroll bar. Fix: header wraps, search box is full width on phones (`pages/Competitors.tsx`).
2. The card link always said "Open Competitors to fix handles", even when nothing needed fixing. New pure helper `linkLabel` (test first, red then green) says "Open Competitors" unless a competitor has no handle, failed or is paused (`utils/competitorInsights.ts`, `components/CompetitorInsights.tsx`, `tests/competitorInsights.test.mjs`).
3. Not entitled, Competitors page: nothing told the customer the page needs the add-on until they pressed Add (the card hides itself). The card now has an `onLocked` callback and the page shows its existing upgrade prompt as soon as the insights call says locked.

## Not changed, worth knowing
- The upgrade prompt wording is pre-existing ("add-on pack or Quarks", button "View plans and Quarks"). It is a billing prompt, passes the voice audit, but names Quarks to a customer. Owner decision.
- `/api/auth/me` is rate limited to 20 a 15 minutes per address; repeated page reloads during testing hit 429 and the app signed the account out. Only matters for dev testing.
- The running backend's 6-hourly tracker (first pass 20 minutes after start) uses the REAL scraper for any entitled dev account with a handle and no good read this week. My throwaway accounts all had a good read for the current week (or no handle in the case of the competitors without snapshots, which are due), so the "empty" account's one competitor with handle `cakehouse.check` could have been read for real if a pass had started while it existed. Cleanup removed it within the first pass window as far as I could tell, but I cannot prove no pass ran; no tracker log line or spend row was inspected.

## Screenshots
`/private/tmp/claude-501/-Users-dineshkannaa-Documents-0-CONTENT-Claude-Agents/09560377-72af-47d7-b772-e6de37dcc6da/scratchpad/stage4-shots/`: 01 My plan 1280, 02 and 03 Competitors 1280 (loading, loaded), 04 and 05 Competitors 375 before and after the overflow fix, 06 My plan 375, 07 My plan empty state 375, 08 Competitors loading 375, 09 no competitors 375, 10 and 11 not entitled 375 before and after, 12 My plan error state 375.

## Unverified
- Staff view of the same data, dark mode, tablet widths, a competitor whose handle is paused, and the real Instagram profile shape (still waiting for the owner's OK for one real read).
- 1280 wide was only looked at for the entitled account.
