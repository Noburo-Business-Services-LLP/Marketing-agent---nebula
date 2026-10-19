# Performance view (`GET /api/analytics/performance`)

Built 2026-10-19 on branch `nebulaa-redesign` for the owner's request: per-platform numbers, the top posts of the week or the month, which post got the most engagement and likes, and findings that make the next posts better. Not released.

## What is really stored (audit, 2026-10-19)

| Source | Where | Written by | What it holds |
|---|---|---|---|
| Daily account numbers | `SocialSnapshot` (`socialsnapshots`), one row per account per day | `services/snapshotScheduler.js`, every 12 hours while an account is connected | per platform: `followers`, `following`, `posts` (lifetime count), `reach`, `impressions`, `engagementRate`, `likes` |
| Per-post measurements | `AIContentPerformance` (`ai_content_performance`), one row per post and platform | `services/performanceTracker.js`, 1 day, 3 days, a week, two weeks and a month after a post is published (at most 25 checks a run), and the old Campaigns page | `metrics` (likes, comments, shares, saves, reach, impressions, views, clicks, engagement) and `rawAnalytics` (the publishing service's own answer, cut at 6,000 characters) |
| Published posts | `Campaign` with `status: 'posted'` | the publish paths | `platforms`, `publishedAt`, `creative.type`, `creative.imageUrls`, `publishResult.postIds[].postUrl` |
| `Campaign.performance` | Campaign model | nothing writes it | always zeros (do not use) |

Findings during the audit:

- The tracker's normaliser (`aiMemoryService.normalizeAnalyticsMetrics`) reads a flat answer, but the publishing service answers per platform (`{ instagram: { analytics: { likeCount, commentsCount, ... } } }`). So the stored `metrics` object is normally all zero while the real figures sit in `rawAnalytics`. The view reads `rawAnalytics[platform].analytics` first (field names in `services/performance/metrics.js`, `POST_FIELDS`), then a stored metric above zero. Fixing the normaliser itself is left for later (it also feeds the learning score).
- Snapshot `likes` is not used: for Facebook the scheduler falls back to `fanCount` (page likes, a follower count), so it is not likes on posts. Likes, comments and shares on the page are the sums over measured posts.
- A stored `0` for reach or engagement rate means "not reported" (the scheduler writes 0 when a field is missing). Followers of 0 are shown as 0.

### Which figures each platform really gives (as stored)

| Platform | Followers | Reach | Engagement rate | Likes | Comments | Shares |
|---|---|---|---|---|---|---|
| Instagram | daily numbers | daily numbers (`reachCount`) | daily numbers (worked out from likes and comments over followers when missing) | measured posts | measured posts | measured posts |
| Facebook | daily numbers | daily numbers (`pagePostsImpressionsUnique`, often absent) | daily numbers (engagements over impressions) | measured posts (reactions) | measured posts | measured posts |
| LinkedIn | daily numbers | daily numbers (`uniqueImpressionsCount`) | daily numbers | measured posts | measured posts | measured posts |
| X | daily numbers | not stored ("Reach is not reported for X accounts.") | not stored | measured posts | measured posts (replies) | measured posts (reposts) |
| Google Business | none ("Google Business Profiles have no followers.") | when reported | not stored | when reported | when reported | when reported |

"When reported" means the view shows the figure only if a stored row holds it; otherwise the reason sentence.

## The endpoint

`GET /api/analytics/performance?range=week|month|90d&platform=instagram` (mounted on the analytics router before `GET /:id`; route `backend/routes/performanceView.js`). Signed in only; the account is always `req.user` (inside an agency or staff pass that already is the client); an id in the query is ignored. Reads only: no write, no model call, no outside call, nothing charged. Rate limit 600 per 15 minutes per account. Unknown platform: 400.

- Periods are rolling and in equal lengths: the last 7, 30 or 90 days ending now, compared with the same length just before (labels "This week", "This month", "Last 90 days"; the page shows the dates).
- Account numbers for a period: the newest daily number inside it against the newest one at or before its start (half a day of slack). No number at the start: no comparison.
- Code: `services/performance/metrics.js` (fields, platforms, ranges), `view.js` (assembly, pure), `learnings.js` (findings, pure), `service.js` (reads), `cache.js`.

Answer: `range`, `platform`, `account { free, canConnect, clientWorkspace, staff }`, `connected { count, platforms }`, `overall { followers, reach, engagementRate, likes, posts, postsMeasured, spark }`, `platforms[]` (`platform`, `label`, `connected`, `state` = ready, nodata, notconnected or error, `reason`, `asOf`, `postsMeasured`, `metrics { followers, reach, engagementRate, likes, comments, shares, posts }`, `spark { followers, reach, engagementRate }`), `topPosts { measured, reason, lists { engagement, likes, comments, reach } }` (top 3 each, only posts that reported that figure above 0: id, campaign id, platform, title, https picture, https link on the platform, date, format, the ranking value and all reported figures), `byFormat`, `byDay`, `byTime`, `insights[]`, `insightsReason`, `thresholds`, `capped`, `degraded`. Every metric is `{ value, previous, change, changePct, available, reason, unit?, asOf? }`; unavailable means `value: null` with a sentence.

Platforms listed: Instagram, Facebook, LinkedIn and X always (as "Not connected" when they are not), then any other connected platform or one with measured posts in the period. A platform that is not connected never shows its old stored numbers.

### Reasons

| Sentence | When |
|---|---|
| Connecting accounts comes with a paid plan. | nothing connected and the plan cannot connect |
| Connect an account to see this. / Connect Instagram to see its numbers here. | nothing (or not this platform) connected |
| Your first numbers arrive within a day of connecting. | connected, no daily number yet |
| No new numbers from Instagram in this period. The last ones arrived on (date). | only older numbers |
| Instagram has not reported this yet. | stored as 0 or missing |
| Your posts from this period have not been measured yet. Each post is measured a day, three days and a week after it goes out. | posts published, none measured |
| Nothing was published in this period. | no posts |
| We could not load this just now. Please try again in a moment. | that source failed (the answer is then not cached) |

## Thresholds for findings (`learnings.js`, `THRESHOLDS`)

| Rule | Value |
|---|---|
| Any post finding | at least 5 measured posts in the period |
| Format, platform or caption-length comparison | at least 3 posts on each side, one side at least 25 percent ahead |
| Best day and best time of day | at least 8 measured posts; a day needs 2 posts, a time of day 3; at least 20 percent above the average |
| Best post called out | 1.5 times the average of the other posts |
| Short caption | under 120 characters |
| Shown | at most 5 findings, strongest first |

Comparisons use likes when enough posts report likes, else engagement (likes, comments, shares and saves together). Times of day are India time: morning 6 am to 12 pm, afternoon 12 pm to 5 pm, evening 5 pm to 9 pm, night 9 pm to 6 am. Each sentence ends with its evidence, for example "Videos got 2.1 times the likes of image posts this month (from 9 posts)."

## Learnings for Brand memory (shape for the memory job; not wired yet)

`backend/services/performance/learnings.js` exports pure functions; the Brand memory job should call them with the measured posts built by `view.measuredPost(row, campaign)`:

- `computeLearnings({ posts, followers, range: { key, words } })` returns at most 5 objects:
  `{ id, kind, source, statement, metric, value, comparedWith, ratio, evidence: { posts | days, platform?, range, ... }, strength, subject, action }`
  - `kind`: `format`, `platform`, `top_post`, `caption_length`, `day`, `time`, `followers`
  - `source`: `post_performance` (measured posts) or `account_snapshots` (daily numbers)
  - `subject`: what it is about, for example `{ format: 'video', comparedFormat: 'image' }`, `{ weekday: 5, day: 'Saturday' }`, `{ timeOfDay: 'evening', hours }`, `{ platform }`, `{ postId, campaignId, format }`, `{ captionLength: 'short', limit: 120 }`
  - `action`: `{ kind: 'video' | 'post', mode: 'single' | 'carousel', platform, brief }` or null; the brief is neutral and written by code
- `topPostFacts(posts, range)` returns the best post per measure (`engagement`, `likes`, `comments`, `reach`): `{ id, kind: 'top_post_fact', source, metric, value, averageOfOthers, post { id, campaignId, platform, format, title, publishedAt }, evidence { posts, range } }`
- `formatComparison(posts)` and `timingComparison(posts)` give the tables behind the findings.
- `insightsFromLearnings(learnings)` is what the page shows.

The memory job should keep `source` and `evidence` with each note so "What Nebulaa learned" can say where a note came from and how many posts back it.

## Cache and bounds

- In memory, per account, look (own or a pass), range and platform, 60 seconds, at most 2,000 entries (`services/performance/cache.js`, the Home cache class). Only a complete answer is stored. `?refresh=1` skips it. The snapshot job and the post measuring job call `forgetAccount(userId)` after they store numbers.
- Reads (each with `maxTimeMS(15000)` and an index that leads with `userId`): daily numbers since the previous period (at most 200), measured posts published since the previous period (at most 400, newest first), their campaigns by id (at most 400), posted campaigns in both periods (at most 1,000; more is flagged `capped.posts`).
- Real-database check: `cd backend && node scripts/performance-view-check.js` (nebulaa_dev only, throwaway `zz.perfchk-` users, `cleanup` mode for leftovers). It checks the counts against independent loops, the three ranges, the platform filter, isolation from another account, free and new accounts, an agency client pass, index use by explain, the cache and the errors.

## The page

`frontend/pages/GravityInsights.tsx` (Insights, Performance tab), sections in `components/performance/PerformanceSections.tsx`, rules in `utils/performanceInsights.ts` (tested in `tests/performanceInsights.test.mjs`), styles in `components/performance/performance.css`.

- Hero card: the sentence for the period, the dates, the platform chosen, accounts connected, the range switch (kept for the visit in `sessionStorage`), Try again after a failure.
- Four KPI tiles for the period and the chosen platform (reach, engagement, new followers, posts published), lines only from two or more stored days.
- By platform: one tile per platform with its mark, followers and the change in the period, a follower line, reach, engagement, likes and posts; "Not connected" with the connect action (See plans on the free plan, nothing inside a client workspace); choosing a tile filters everything below and the KPI tiles (choose it again or All platforms to clear).
- Top posts: tabs Most engagement, Most likes, Most comments, Most reach; three fixed-size cards (340 px at desktop, 150 px rows on a phone) with the picture, rank, platform mark, format, title, date, number chips and Open post; empty places are dashed cards so the row stays full.
- What works: format bars, best day and time of day strips (India time), findings as coloured callouts with "Based on N posts" and "Make a post like this" (Create or Videos opens with the brief, `source: 'home'`).
- The sentiment and competitor cards are not on this page (they live on My plan, the Inbox and Competitors), so there was nothing to keep here.
- Sample states: `/?audit=normal&perfstate=full|oneplatform|empty|notconnected|error#/analytics`.
