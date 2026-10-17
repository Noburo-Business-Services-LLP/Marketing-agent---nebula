# Stage 4 real-read report (2026-10-17)

One approved real read of the public Instagram account `nebulaa.os` through the existing profile scraper (about USD 0.0023). The sanitised result is `backend/tests/fixtures/instagram-profile-real-nebulaa-os.json` (captions and biography cut to 40 characters, signed image URLs removed, numbers, types and timestamps exact). Tests: `backend/tests/competitorRealShape.test.js`. No further scraper, AI or database call was made for this check.

## The real shape
`{ success: true, data: [ profile ] }`, one profile. Profile: `username`, `fullName`, `biography`, `externalUrl`, `followersCount` (70), `followsCount`, `postsCount` (55, the lifetime total), `private` (false), `verified` (false), `isBusinessAccount` (false even though `businessCategoryName` is "Software Company"), `latestPosts` (12 items), `relatedProfiles` (empty). Each post: `type` ('Image' | 'Video' | 'Sidecar'), `timestamp` (ISO string), `likesCount`, `commentsCount`, `videoViewCount` (videos only), `isPinned`, `caption`, `shortCode`, `url`, `ownerUsername`, `childPosts`, `hashtags`, `mentions`. The first item was an old pinned post (2026-05-06); the other 11 ran 2026-09-16 to 2026-10-15 in newest-first order.

## Assumptions
| Assumption in the code | Result |
|---|---|
| Result is `{success, data:[profile]}` and the tracker reads `data[0]` | Confirmed |
| `latestPosts` holds the posts | Confirmed (`posts` is not used) |
| `timestamp` is read as a date | Confirmed (it is an ISO string; the code already handled strings) |
| `likesCount` / `commentsCount` / `type` / `hashtags` / `url` / `caption` names | Confirmed |
| `followersCount` | Confirmed (70) |
| `private` flag name | Confirmed present (false); the private-account response itself is unproven |
| Posts are newest first, so the first item is the latest | WRONG. A pinned post can come first. Nothing used order, but see the week fix below |
| "This week" = posts in the last 7 days | WRONG against the week key. The snapshot is stored under the Monday-to-Sunday week in India, but posts were counted by a rolling 7 days, so the count and the key disagreed (on a Monday morning it counted last Thursday and Friday as "this week") |
| `-1` likes means zero | WRONG in effect. Hidden likes (`-1`) were averaged in as 0 and pulled the average down |
| 12 posts are enough for a weekly count | Holds for this account (12 posts cover about a month); it does not hold for an account posting several times a day |
| `videoViewCount` | Present on videos only; the snapshot does not use it (no field for it, nothing breaks). Left as is |

## Fixes
- Posts in the week are counted by the IST Monday-to-Sunday week of each post's `timestamp` (same `weekStartOf` as the snapshot key). The best-post sentence uses the same week. A pinned old post is outside the 30-day window, so it is never counted as this week and never the top post; a pinned post inside the window is treated like any other post.
- Real numbers: week of 2026-10-05 gives 2 posts, week of 2026-10-12 gives 1; followers 70; 8 posts in 30 days; average likes 5; top post the 2026-09-21 reel (10 likes, 2 comments). No highlight is produced for these two weeks (a drop of 1 is below the 2-post threshold; the 2-like latest post is not above average); first-week and "1 time" / "2 times" wording checked.
- Hidden likes or closed comments (`-1`) are left out of the averages (the post still counts as a post).
- Maybe-cut-short counts: the read asks for 12 posts. Raising it costs more per read, so the cost is unchanged. The snapshot now records `postsInWindowMayBeTruncated: true` when every returned post (pinned ones ignored) is inside the counted week and the account has more posts than were returned (`postsCount`). The sentence then says "posted at least N times this week"; it never says "down" from such a count and never says "up" over an earlier cut-short week. New model field, default false; old snapshots read as false.
- A response that is a profile-shaped item carrying an `error`, or that has no numbers at all, is now a plain failed check ("Could not read this profile") instead of an empty snapshot.
- `validateProfileMatch` moved unchanged into `backend/services/competitors/profileMatch.js` (the route requires it). Tested with the real profile (name, website) and a mismatch.

## Still unproven
- The private account response (assumed `private: true`, written from the code's own assumption).
- The response for a handle that does not exist (assumed an empty `data` array; the code now also survives an item carrying an `error`).
- Very active accounts: the "at least" path is tested with made-up posts only.
- Whether the actor's `resultsLimit` can be raised, and what it would cost.
- `isBusinessAccount` was false for a profile with a business category, so it must not be used to decide anything.
