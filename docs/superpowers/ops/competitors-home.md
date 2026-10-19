# Competitors on Home and the Competitors page (`GET /api/competitors/best-posts`)

Built 2026-10-19 as Task 6 of the Home build (impact map: `docs/superpowers/impact-maps/home-and-plan.md`, sections 3.6 and 8). Not released.

## What it is

One read-only answer that shows what we already know about the account's competitors and what is worth posting next:

- a compact tile per tracked competitor (handle, followers with the week-on-week change, posts this week, best post, a "what worked" line, a status chip),
- "What's working for your competitors" (their strongest recent posts, at most three),
- "Trending for you" (at most four ideas, each saying what it is based on), each with "Make a post like this".

Everything comes from data we already hold: the weekly tracker's stored snapshots, the account's own measured posts (`ai_content_performance`), the newest finished plan's theme names and a fixed table of India days. The route reads nothing outside, calls no model, writes nothing and costs nothing. The weekly tracker is the only thing that ever reads a competitor's page, and it stays OFF unless `ENABLE_COMPETITOR_TRACKER=on`.

Code: `backend/routes/competitorBestPosts.js` (route and `build()`), `backend/services/competitors/bestPosts.js` (pure read model), `backend/config/festivals.js` (the India days), `backend/config/competitorWording.js` (the wording guard list), `backend/services/competitors/snapshot.js` (`compactPosts`). Frontend: `frontend/utils/competitorsHome.ts`, `frontend/components/CompetitorTiles.tsx` and `.css`, `api.getCompetitorBestPosts()`, used by `pages/GravityHome.tsx` (`HomeCompetitors`) and `pages/Competitors.tsx` (`CompetitorBoard`).

## What the snapshot now stores

Each weekly snapshot keeps `posts`: the posts the read already returned (at most 12), compact: `{ at, type: image | video | carousel, likes, comments, pinned, url }`. No caption and no picture link are stored (nothing is hotlinked); `url` is kept only when it is the post's own `https://www.instagram.com/p|reel|tv/...` link. Likes or comments Instagram hides (`-1`) are stored as `null` (unknown, never 0). Snapshots taken before this change have no `posts`; for them the tile shows the stored best post (`topPost`) and no pattern. No new read and no migration: the list fills in from the next weekly check.

## The answer

`{ success, asOf, weekStart, entitled, trackerOn, state, competitors[], working[], trending[], degraded[] }` (about 4.4 KB for five competitors in the real-database check).

| state | when | what the page says |
|---|---|---|
| `not_entitled` | the account does not hold the competitors add-on (free included). No competitor data is read at all. | "Following your competitors is an add-on." with See plans (no link inside a CSM or agency pass). Trending for you still shows the non-competitor sources. |
| `no_competitors` | add-on, nothing tracked | "Add the competitors you want to follow..." |
| `tracker_off` | add-on, competitors, nothing stored yet, switch off | "Your competitors' public posts have not been checked yet. Their numbers appear here after the first weekly check." (no date promised) |
| `waiting` | the same with the switch on (first check pending) | same sentence |
| `ready` | at least one competitor has a stored good reading (shown even while the switch is off, with "Last checked on" when it is not this week) | tiles and lists |
| `error` | the competitor or snapshot read failed | "We could not load your competitors just now." and Try again |

Staff on their own page get `{ staff: true }` and nothing is read. Inside an agency client or a CSM pass the signed-in account already is the client, so the client's own competitors and entitlement are used (the agency's own competitors never appear; checked on the real database).

Per competitor (`competitors[]`, the same five, newest first, that the tracker reads): `status` is `tracking`, `no_handle`, `unconfirmed` (a found handle nobody confirmed; never read, never linked), `waiting`, `failed`, `private` (the last reading said the account is private) or `paused` (three failed weeks). `followers` is `{ value, change }`; `change` is set only when the previous stored reading is exactly the week before; 0 followers is treated as unknown. `postsThisWeek` is `{ value, atLeast }` and only for a reading of the current India week (Monday to Sunday); `atLeast` is true when every post the read returned falls in this week, so the real count may be higher ("At least 12 posts"). `profileUrl` only for a confirmed or verified handle.

## Rules (all in `bestPosts.js`, tested)

- **Score of a post:** likes + 3 x comments (the same weight the snapshot's own top post uses: a comment takes more effort than a like). A post with hidden likes has no score and is never "best". A post with nothing on it is never best.
- **Best post:** the highest score in this India week; if none, in the last 30 days. Posts from the last four stored weeks are merged by link (the newest reading of a post wins), so a month has up to about 48 posts to look at.
- **What worked:** only when the last 30 days hold at least **6 posts with known likes** (`MIN_POSTS_FOR_PATTERN`). Three comparisons, each needing at least **2 posts per side** (`MIN_GROUP`) and the better side's average likes at least **1.5 times** the other's (`MIN_RATIO`), with the other side averaging at least 1 like (never an infinite ratio):
  - format: the best type against every other post ("Reels got 3 times the likes of photos on average this month.", or "...of their other posts..." when two other types are mixed),
  - India weekend (Saturday, Sunday) against weekdays, either way round,
  - India evening (from 5 pm) against earlier, either way round.
  The strongest ratio wins (format, then day, then time on a tie). Ratios read "1.5 times", "2.4 times", "2 times", and from 3 up as whole numbers. Nothing is said otherwise; the tile then says "Not enough posts yet to see a pattern."
- **What's working:** the best post of each tracked competitor, strongest score first, at most three.
- **Trending for you** (at most four, in this order, each only when it exists):
  1. "From a competitor": the strongest competitor's pattern (or its best post when there is no pattern). Only with the add-on.
  2. "From your own posts": the account's best measured post of the last 30 days (likes above 0).
  3. "Coming up": the next approved India day within 30 days.
  4. "From your plan": the first theme of the newest finished plan.
- **Briefs ("Make a post like this"):** written by code, never by a model, at most 200 characters, and never containing a competitor's name, handle or caption (a plan theme that mentions one is replaced by "your business"). Examples:
  - "A reel about Fresh bakes, in the style that works: reels are getting the most likes this month."
  - "A carousel about Fresh bakes, in the style of the best recent posts in your market."
  - "A new reel about Our new sourdough loaf is here, in the style of your best post this month." (the first plain phrase of the customer's OWN caption, without tags, mentions, links or emoji)
  - "A post for Children's Day on 14 November, about Fresh bakes."
  - "A post about Fresh bakes, one of the themes in your plan."
  A reel opens Videos (`setPrefill('video', { idea, source: 'home' })`); a photo or carousel opens Create content in single or carousel mode (`setPrefill('carousel', { mode, topic, source: 'home' })`, so the screen does not say it came from the plan). Nothing is charged until the customer makes the post there.

## The India days (`backend/config/festivals.js`)

Only days whose date is certain: New Year's Day (1 Jan), Republic Day (26 Jan), Valentine's Day (14 Feb), Independence Day (15 Aug), Teachers' Day (5 Sep), Children's Day (14 Nov), Christmas (25 Dec), Mother's Day (second Sunday of May, computed) and Father's Day (third Sunday of June, computed). Lunar-calendar festivals (Diwali, Holi, Eid, Ganesh Chaturthi, Pongal, Onam, Navratri, Raksha Bandhan and the like) move every year and are deliberately left out (`LUNAR_DAYS` is empty). To add one, put the owner-approved date for each year in `LUNAR_DAYS` (`{ id, name, dates: { 2026: 'YYYY-MM-DD' } }`) and extend `tests/festivals.test.js`; never guess a date. Days are counted from today's India date.

## Wording

Plain professional sentences: no exclamation marks or long dashes, no "credit", "trial" or "7 days", no vendor names, and nothing unkind about a competitor (the guard list in `config/competitorWording.js` also refuses words such as worse, bad, beat, weak, poor, mock, failing). The read model drops any trend item whose words fail the guard. Tests: `backend/tests/competitorBestPosts.test.js` (every sentence the model can write), `frontend/tests/competitorsHome.test.mjs` (the page copy, the same rule as `isPlainCopy`). New frontend files are in `tests/voice-scope.json`.

## Queries and indexes

Four reads, each bounded and with `maxTimeMS` 20 s: competitors (`competitorsQuery`, limit 25), snapshots (one query for the tracked ids, `{ userId, competitorId in [...] }`, newest week first, limit 12 per competitor, no caption or hashtags selected), own posts (`{ userId, publishedAt in the last 30 days }`, most liked first, limit 25), plan themes (newest finished plan run, theme names only). The real-database check ran `explain` on all four: none is a collection scan, each examines only the account's own rows (7, 6, 3 and 1 documents). No new index was needed.

## Real-database check

`backend/scripts/competitors-home-check.js` (refuses any database except `nebulaa_dev`; throwaway `zz.comphomechk-` users; the real route in this process on a random 127.0.0.1 port with real tokens; snapshots written through the real `summarise()` and snapshot store; expected numbers computed independently from the raw posts; deletes everything it made):

```
cd backend
node scripts/competitors-home-check.js            # run, then clean up
node scripts/competitors-home-check.js cleanup    # remove leftovers of an interrupted run
```

The 2026-10-19 run: 25 PASS, 0 FAIL, 34 rows removed, 0 left.

## Profile pictures (`backend/services/competitors/avatar.js`)

Owner request of 2026-10-19: show each competitor's logo or photo, not only the name. Each tile (Home and the Competitors page) and the draft sheet's header show a round 40 px picture: our own stored copy of their public profile picture, or their initials on a soft colour that stays the same for a handle (six warm tints, each at least 4.5 to 1). Nothing else about the competitor is shown that was not shown before.

- Source: the `profilePicUrl` (else `profilePicUrlHD`) field of the weekly Instagram profile read the tracker ALREADY makes (see the real-read fixture `backend/tests/fixtures/instagram-profile-real-nebulaa-os.json`). No new paid call.
- When: inside the tracker, right after a good read has been saved. Best effort: it never throws and never fails the read; any failure leaves the old picture.
- Download rules: https only; host must end in `cdninstagram.com` or `fbcdn.net` (allow-list; no user, no odd port, no IP literal); every host, also after a redirect, must resolve to public addresses only (checked before the request and again at connect time through a guarded DNS lookup: no loopback, private, link-local, carrier, multicast, reserved, or IPv4 inside IPv6); redirects only to another allowed host, at most two; `image/jpeg`, `image/png` or `image/webp` only; at most 200 KB (declared or actual, the download stops at the cap); 5 s in all.
- Stored: resized with sharp to 96 x 96 WebP, uploaded to the app's image storage (the Cloudinary account the uploads use) as `nebula-competitor-avatars/<competitorId>`, overwritten in place. The record keeps only our link: `avatarUrl`, `avatarUpdatedAt`, and `avatarSourceKey` (a hash of the picture link's path, so the same picture with a new signature or CDN host is not fetched again). Instagram's link is never stored or sent to the browser.
- Refresh: at most once a week (6.5 days), and only when the picture changed.
- API: `GET /api/competitors/best-posts` and `GET /api/competitors/insights` return `avatarUrl` (our stored link only, checked by pattern) or `null`.
- Page: `frontend/components/CompetitorAvatar.tsx` (lazy loading, alt text the @handle, `onError` falls back to the initials, no referrer); the page loads only links of our own avatar folder (`avatarView` in `utils/competitorsHome.ts`).
- Privacy: kept only for tracked competitors. The file is deleted when the competitor is removed (`removeCompetitorsWithSnapshots` in `cleanup.js`, used by every removal path), ignored (`PUT /api/competitors/:id/ignore`) or given a different handle (`PUT /api/competitors/:id/handle`), when a picture finishes after its competitor was removed, and with the account or a client workspace (the account erase deletes every file in our `nebula*` folders found on the customer's records, and competitors are on the erase list).
- Tests: `backend/tests/competitorAvatar.test.js` (fakes for the read, DNS, download and storage: allow-list, SSRF, redirects, size cap, bad type, time limit, resize, weekly rule, failure keeps the old one, removal, ignore, handle change, account erase, API output) and `frontend/tests/homeBrandColours.test.mjs`.
- Real-database check: `backend/scripts/competitor-avatar-check.js` (nebulaa_dev only, throwaway `zz.avatarchk-` users, fake read, download and storage). The 2026-10-19 run: 11 PASS, 0 FAIL, 5 rows removed, 0 left.

## Preview

Sample-data preview (`AUDIT_PORT=3101`): `/?audit=normal&compstate=<state>#/dashboard` and `#/competitors`, states `all` (default: data, a cut-short count, a stale reading, unconfirmed, private), `locked`, `empty`, `error`, `trackeroff`, `waiting`, `states` (one tile per handle state without data), `few` (too few posts for a pattern). Mock: `bestPostsAnswer()` in `frontend/scripts/visual-audit/mock-session.js`.

## Known limits

- Only Instagram is tracked (the tracker reads Instagram only).
- "What worked" compares average likes; it says nothing about why, and it needs at least 6 posts with visible likes in 30 days.
- Followers of exactly 0 are shown as unknown.
- Own best posts need the performance tracker to have measured them (`ENABLE_PERFORMANCE_TRACKER`, a connected account); otherwise that source is simply absent.
- The tile and lists show English only, like the rest of Home.
- Drafts from a best post ("Make a post in response", "Draft a witty comment") are a separate feature with its own routes and checks: `home-drafts.md`. This answer only adds each post's reference (`bestPost.ref`, `working[].ref`: `<competitorId>.<postKey>`, the Instagram shortcode or the post time); it still drafts nothing and posts nothing.

## Post pictures (`backend/services/competitors/postThumbs.js`, 2026-10-19)

Owner request of 2026-10-19: the Competitors page and the Home competitor sections were "boring, too much text; show the actual posts". The page now shows real pictures of competitors' top public posts, made the same way as the profile pictures.

- **Switch:** `ENABLE_COMPETITOR_THUMBS`, OFF unless set to exactly `on` (every environment, like `ENABLE_COMPETITOR_TRACKER`). Off: the tracker fetches nothing, and the best-posts answer has `thumbsOn: false` and every `thumbUrl` null, so the page shows the same cards with the post type on a soft tint instead of a picture. Stored copies are not deleted by switching off (they are only hidden); they go with the usual removal paths.
- **Source:** the `displayUrl` field of each post in the weekly profile read the tracker already makes (`images[0]` as the fallback for a carousel). Field names verified in the real-read fixture `backend/tests/fixtures/instagram-profile-real-nebulaa-os.json` (keys of `latestPosts[]`: `displayUrl`, `images`, `url`, `shortCode`, `type`, `likesCount`, `commentsCount`, `timestamp`; there is no `thumbnailUrl`). No new paid call.
- **Which posts:** the best post of this India week, the best 3 of the last 30 days (likes + 3 x comments) and the newest 3 that are not among the best, from the stored weeks and this read together. At most `THUMBS_PER_COMPETITOR` (6) per competitor and no new file once `THUMBS_GLOBAL_MAX` (3000) are stored across all accounts (both in `config/competitors.js`); an unknown count adds nothing.
- **Download:** the profile picture's safe download (`avatar.fetchImage`: https only, `cdninstagram.com` or `fbcdn.net`, public addresses only also after a redirect, at most two redirects, jpeg/png/webp only), with a 1.5 MB and 8 s cap. Resized to 360 x 450 (4:5, centre crop) WebP, quality stepping down until it is at most 40 KB. Stored as `nebula-competitor-posts/<competitorId>-p-<shortcode>`.
- **Record:** `Competitor.postThumbs: [{ postKey, thumbUrl, sourceKey, at }]`, our link only. A post already stored is never fetched again; a post that drops out of the chosen set is deleted at the next weekly read.
- **Deleted:** with the competitor (`removeCompetitorsWithSnapshots`), on ignore (`PUT /api/competitors/:id/ignore`), on a different handle (`PUT /api/competitors/:id/handle`), when pictures finish after the competitor was removed, and with the account (the erase finds every file in our `nebula*` folders on the customer's records).
- **API:** `GET /api/competitors/best-posts` adds `thumbsOn`, `competitors[].bestPost.thumbUrl`, `competitors[].gallery[]` (`{ ref, pick: best | latest, type, likes, comments, at, url, thumbUrl }`, at most 6) and `working[].thumbUrl`. Each is our stored link or null. The page loads only our folder's links (`thumbSrc` in `utils/competitorsHome.ts`; inline pictures are accepted for the sample-data preview only, they make no request).
- **Page:** "What's working for your competitors" is a gallery of post cards (picture filling the card at 4:5, likes and comments chip, the post type mark, the competitor's picture and "From @handle", "Why it worked" from the stored pattern, "Make a post like this", the two draft actions under "More drafts", "Open the post on Instagram"); the competitor tile shows a small picture beside its best post; the Competitors page has "Their best posts", one gallery row per competitor (Best and New chips, likes, each opens the original). Rows are equal height and always full.
- **Tests and check:** `backend/tests/competitorPostThumbs.test.js` (fakes only); `backend/scripts/competitor-thumbs-check.js` (nebulaa_dev only, throwaway `zz.thumbchk-` users, fake read, download and storage). The 2026-10-19 run: 10 PASS, 0 FAIL, 3 rows removed, 0 left.

### Legal and terms (owner and lawyer to confirm before switching on)

Showing small copies of other businesses' public posts is a step beyond showing their numbers. What the build does to keep it reasonable: only public posts of competitors the customer chose and confirmed; a small 360 x 450 copy, never the full picture; the handle is credited on every card ("From @handle") and every card links to the original post; nothing says or suggests the post is ours or the customer's; copies are kept only while the competitor is tracked and only for the top few posts. Still open: Instagram's terms on storing and showing content read through a third-party scraper, copyright in the pictures themselves (a small credited thumbnail with a link might be argued as fair dealing for review or comment, but we have no legal view on this and it is not settled for a paid product), and whether customers' own terms should say so. Default: OFF until the owner (with a lawyer if needed) confirms; switching off hides every picture at once.

## From the news calendar (`backend/config/trendingEvents.js`)

"Trending for you" now has a fifth honest source: up to two dated public events for the account's industry within 30 days ("From the news calendar"), each with its date and one plain idea of how a business can use it, and "Make a post like this" with a code-written brief. Only certain dates are listed: fixed national and international days, two computed shopping days (Black Friday, Cyber Monday) and two officially announced events (FIFA Women's World Cup 2027, Olympic Games Los Angeles 2028); film and streaming releases, IPL and other unannounced schedules are in `NEEDS_A_DATE` and never shown. The account's free-text industry is mapped to tags by keywords (`industryTags`); an unknown industry sees only entries for everyone. No live trend source exists yet: options and costs for the owner in `docs/superpowers/ops/trends-sources.md`; a future source plugs in through `backend/services/trends/provider.js` (an interface, no network). Tests: `backend/tests/trendingEvents.test.js`. Preview: `?compstate=all` shows two news items; `?compstate=nothumbs` shows the pages with the post pictures switched off.
