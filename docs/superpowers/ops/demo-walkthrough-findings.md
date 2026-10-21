# Demo walkthrough findings (Stage 4), 2026-10-21

Every screen of the Zaya Naturals demo was opened in the built-in browser (app on port 3200, backend on 5000) signed in as `demo-zaya@example.test`, first at 1280 px, then at 375 px (page width reset to desktop afterwards). Console errors and failed requests were collected on each screen (a small hook on `console.error`, `fetch` and image errors, plus reading the page text and pictures). Nothing was clicked that spends Quarks, posts, sends or approves, and no paid call was made. Screenshots were looked at during the walk; none are stored in the repo.

The first pass found the problems below. The data problems were fixed in the seed (`backend/scripts/demo-brand/*`), the account was rebuilt (`remove` then `create`, and `create` again to check it is repeatable), and the screens marked "fixed" were looked at again. Stage 4 tests: `backend/tests/demoBrandStage4.test.js`.

## Per screen (desktop 1280 px)

| Screen | Result |
| --- | --- |
| Sign in | OK |
| Home | Problem found, fixed in data: "Posts this week 0, Down 100%" and an empty "Today's plan". Now 4, Up 100%, and a post is scheduled later today (or, on a run after 8 pm, one was posted this morning). UI note: the change chips on Home (Reach up 0.9%) use another window than Performance (up 6 percent on the month before), see UI list. |
| Plan > My plan | OK (9 of 9 parts, 7 channels, 5 themes). Small data oddity left: "Made on 18 October, day 3 of 90" for a five-month-old account. |
| Plan > Calendar (Month plan, Schedule) | Problem found, fixed: "18 of 7 made" and "8 of 7 made" (limit was 7, posts made were more). The limit is now 20. Schedule view had empty days Mon to Wed this week, now filled. |
| Plan > Content ideas | Problem found, fixed: empty ("No ideas have been added yet"). Seven saved ideas added. |
| Plan > Blueprint (list and the open Blueprint) | OK (1 ready, 9 tiles, designed pages draw). |
| Create > Create content | OK. Console: `/samples/create-linkedin.webp` 404 (UI list, item 8). |
| Create > Create video | Problem found, fixed: the poster pictures cut off the first line of the headline in the tiles. Pictures redrawn with the text and product in the middle. |
| Create > Photoshoot | OK for data (6 packs, 3 earlier shoots, saved to Library). Shows "Photoshoots are not switched on for your account yet": that is the backend switch `ENABLE_PHOTOSHOOT`, not demo data (see the script). Console: `/samples/pack-flatlay.webp`, `/samples/pack-white.webp` 404 (UI list, item 8). |
| Library: Needs approval, Approved, Scheduled, Posted, All, Archived, Bin, Images, Videos | Problems found, fixed: (a) the Archived view showed 0 tiles on its first page (the archived posts were old); now recent so it shows 6. (b) reels without a video (placeholder with a film icon) and reels that played the wide 16:9 video cropped in a tile; every reel now has a tall clip. (c) headlines hidden under the status badges; moved lower. Counts match Home: needs approval 8, approved 4, scheduled 10, posted 55, archived 6, bin 3. |
| Library post sheet (image post) and a video tile | OK. Video plays (11 s, 0 errors, served with range requests). |
| Inbox: Messages and comments (3 waiting, list, one thread), Reviews, Automatic replies | Problem found, fixed: the reply tone was "warm", which the page's dropdown does not offer (blank select); now "friendly". Reviews says "Needs setup" (not seeded, expected, noted in the script). 25 conversations, 7 unread, 3 waiting: matches Home. |
| Insights > Performance (This week, This month, Last 90 days, each platform) | Problems found, fixed: YouTube Reach and Engagement said "Not yet"; LinkedIn had 0 posts and "Likes Not yet"; every Top post said "No link was stored for this post"; Instagram showed 486 posts for a five-month-old account (now 168). Reach and engagement day-to-day noise was large enough to make Home say up and Performance say down; reduced. |
| Insights > Competitors | Problems found. Fixed in data: the console error `404 /auth/business-context` ("Business context not found", no onboarding record) and an empty "Competitor Activity Feed" ("No posts yet for this category"). Not data (UI list, item 1): the list at the bottom says "No Instagram handle yet" for all five competitors. |
| Insights > What Nebulaa learned | OK (25 things, 6 of 6 sources). |
| Brand assets | OK (6 of 6). UI note: "Watching 103 posts" counts platform rows, while Library says 55 posted. |
| Connected accounts | OK. Facebook and YouTube say "0 following" (looks odd, left). |
| Settings > Profile, Business profile, Security | OK (business profile fully filled). |
| Settings > Billing | OK: Growth, active, 1,355 Quarks, 12 payments, "What things cost". Invoice column is a dash on all rows (no invoice files exist; left, see "Not fixed"). |
| Help | OK |
| Notifications bell | Problem found, fixed: "No notifications yet". Four notifications added (the app lists only the last 24 hours, so run `create` on the recording day). |

## Phone view (375 px)

Home, Plan (all tabs), Create (3), Library, Inbox (3 parts), Insights (3 tabs), Brand assets, Connected accounts, Settings and Help: no sideways page scroll on any screen (scroll width equals 375), no console errors apart from the missing sample pictures (item 8), no broken pictures. Seen by eye on Home, Library and Inbox. Findings: UI list items 6 and 11.

## Data problems found and fixed (all in `backend/scripts/demo-brand/*`)
1. Calendar auto-generation limit 7 smaller than posts made (shown "18 of 7 made"): limit 20.
2. Nothing posted this week, so Home showed "Posts this week 0, Down 100%": two posts a day on the days so far, and a post or schedule for today.
3. Content ideas empty: 7 ideas.
4. Notifications empty: 4 notifications (campaign live, post goes out soon).
5. Missing business context row: console 404 on the Competitors page. Added.
6. "Competitor Activity Feed" empty: posts stored on each competitor (last 30 days, with pictures).
7. Archived view empty on its first page: archived posts are recent.
8. Reels: six reels had no video (empty tile), and reels for the Saffron Mask played the wide video: four tall reel-only clips added (`videos/reel-<product>.mp4`, flat names because the Library only finds posters for `videos/<name>.mp4`).
9. Video and post pictures: headlines moved clear of the badges and into the part of the picture the tile shows.
10. Performance: YouTube reach and engagement, LinkedIn posts (every sixth non-reel post goes to LinkedIn too), https links on every posted campaign (the "Open post" link; the pages do not exist, see script), smaller day-to-day noise in reach.
11. Social account counts: Instagram posts 486 to 168, YouTube 64 to 14. The create step now refreshes these on an existing account.
12. Auto-reply tone "warm" to "friendly".

## UI issues for the owner's ledger (app code, not changed)
1. Competitors page, "Competitors (5)" list: `GET /api/competitors/posts` returns each competitor without `socialHandles`, so the page says "No Instagram handle yet" for all (backend/routes/competitors.js, the `competitorsList` map; the page reads `comp.socialHandles?.instagram`). The same section shows raw labels such as MARKET_LEADER and POSITIVE.
2. Library tiles for Scheduled and Posted posts show the date the post was made, not the scheduled or posted date (a post scheduled for 23 Oct shows 17 Oct).
3. Library filters work on the newest page only: Posted (55) shows 3 tiles and Archived showed 0 until Load more is pressed. Counts on the tabs are server-wide, tiles are not.
4. Performance: Reach and Engagement show the same value under This week, This month and Last 90 days (the latest account figure); only the "up/down" text changes. Home's change chips (week) and Performance's (month) disagree in size and are not labelled on Home.
5. Brand assets "Watching 103 posts", Performance "66 measured" and Library "55 posted" count different things (rows per platform versus posts).
6. Library tile status badges sit on top of the picture text; on a phone the two-row badge stack covers more of the headline.
7. Photoshoot page copy "not switched on for your account yet" appears whenever the backend switch is off; it reads like an account problem to a viewer.
8. The sample pictures `/samples/create-*.webp` and `/samples/pack-*.webp` return 404 in this worktree (`frontend/public/samples` is empty), so the Create and Photoshoot tiles fall back to plain art and the console shows resource errors.
9. Inbox thread: for a moment after opening a conversation the "Suggested replies" list shows the draft of another conversation (Priya's) before the right ones load.
10. Competitors cards and Home say "posted 0 times this week, down from 2" on a Wednesday (the wording compares a part-finished week).
11. Phone Home: the "Posts this week" tile puts its change chip next to the number, the other tiles put it below.
12. `/api/auth/business-context` answers 404 (a console error) for any account without a business context record; the Competitors page calls it on every visit.
13. Inbox "From" filter offers Instagram and Facebook only, so the 2 YouTube conversations show only under All.

## Not fixed, on purpose
- Invoice column in Billing is a dash for every payment (no invoice files exist; a link would 404).
- Google reviews in the Inbox says "Needs setup" (it reads live from Google; nothing to seed).
- GST number in the business profile is empty (a made-up GSTIN would look like a real identifier).
- Facebook and YouTube "0 following".
- Plan "made on 18 October, day 3 of 90" against a five-month-old account (the plan was refreshed recently; harmless).

## Could not check
- Mobile screenshots of every screen (page width and console were checked on all; pictures looked at on Home, Library and Inbox only).
- Photoshoot with the switch on (the backend was already running without it, and it was not restarted).
- Any Quark-spending, posting, sending or approving flow, by instruction (Approve, Create post, Create photos, Approve and send, Turn into a post, Refresh my plan, Download designed PDF).
- The Quark pill dropdown and the sign-out and tour flows.
