# Staff pages: why they were slow, what changed, how to switch the fix on

Written 2026-10-18 for the Owner. Plain language. Nothing here is released: you run the release and the index step yourself.

## What you saw

After the release of 2026-10-18 the staff Home, Clients, Team and Usage pages each took several minutes, and Usage showed every source as "could not read". Money was fine.

## What was slow and why

I could not read the production log, so this comes from the code and from a local copy with production-like volume (20,000 clients, 200,000 drafts, 300,000 inbox messages, 400,000 activity events; see "How it was measured").

1. **Home did a huge amount of pointless work inside the server.** It counted the whole client list again for every page of 100 clients. With 20,000 clients that is about 200 passes over 20,000 clients. On the local copy this alone took **54 seconds**, and while a Node server is busy like that it answers nothing else. That is a likely reason the other pages stalled and Usage reads gave up, but I could not prove that link without the production log.
2. **Usage counted whole collections by date with no index that starts with a date.** Every index we have starts with the client id. "Drafts made in the last 30 days" therefore looked at all 200,000 drafts, "posts published" at all 60,000 campaigns, "replies drafted" at all 300,000 inbox messages. On a small database that is fast; on a database near its disk limit with little memory it is slow enough to time out.
3. **Every page read far more of each client than it shows.** Social account tokens, plan details, 50 Quark history entries per client, and so on.
4. A failed read looked the same as a slow one, so you could not tell a broken database from a busy one.

## What changed

| Change | Effect |
|---|---|
| Home built in one pass over the clients | 54 s down to 0.35 s (output identical, proven by a test that keeps the old code as a reference) |
| Each page reads only the user fields it shows (no social tokens, no business text; plan as tier and flags only) | much less data moved and held |
| Usage for an Admin does not read Quark history at all (only the Owner's breakdown uses it); for the Owner it reads at most the last 100 entries per client (the cap the app already keeps) | numbers identical; see "Quark history" below |
| Every Usage, Clients and Home aggregate has a 20 second limit and may use disk | one bad read can no longer hang a page for minutes |
| Six new indexes (below), built only by a script you run, never by the app at start-up | Usage reads look at the last 30 days only: drafts 200,000 to about 50,000 documents, campaigns 60,000 to 11,000, inbox 300,000 to 22,000 on the local copy |
| The "published" funnel step reads Campaigns as two lookups instead of one `$or` | the new date index cannot make it slower (checked) |
| Home, Clients, Team and Usage keep their last result for 5 minutes | a second visit takes about 5 milliseconds (Clients about 0.2 s because the filter and search are applied fresh) |
| A source that ran out of time now says "took too long (over 20 seconds)", an error still says "could not read" | you can tell them apart on the Usage page |
| The four pages say "Still loading. This page reads a lot of data and can take a minute." after 8 seconds; when the numbers come from the stored copy they say "Last updated 2:14 pm" with a Refresh button | no silent spinner |

### The stored copy (cache)
- Per server process, in memory, 5 minutes. After 5 minutes the old copy is shown at once and refreshed in the background (up to 30 minutes old; after that the page waits for fresh numbers).
- The copy is kept separately for Owner, Admin and each CSM (a CSM's copy is per CSM), and for each Usage window (30 or 90 days). Nobody is ever given another level's copy.
- Two people opening the page at the same moment share one read.
- A failed read is never stored. At most 40 copies are kept.
- Any staff change (assign a CSM, switch a client off, add Quarks, hide, team changes) clears all copies. Changes customers make themselves (a new draft, a new sign-up) show within 5 minutes or when you press Refresh (`?refresh=1`).
- Each ECS task has its own copy, and a restart or release empties it, so the first visit after a release is a cold read.
- Kill switch if it ever misbehaves: set `STAFF_CACHE=off` in the production secret (restart needed). The pages then work exactly as before, just without the stored copy.

### The six indexes (`backend/config/staffIndexes.js`)
| Collection | Index | Used by |
|---|---|---|
| drafts | `staff_createdAt` `{createdAt:-1}` | images and posts drafted, last 30 days |
| campaigns | `staff_publishedAt` `{publishedAt:-1}` | posts published, last 30 days |
| video_jobs | `staff_status_createdAt` `{status:1, createdAt:-1}` | finished videos |
| hero_video_jobs | `staff_status_createdAt` | finished hero videos |
| blueprints | `staff_status_createdAt` | finished Blueprints |
| socialinboxmessages | `staff_ai_generatedAt` `{ai.generatedAt:-1}`, partial (only messages that have a drafted reply) | replies drafted |

The task suggested indexes starting with the client id. The existing ones already start with the client id and the Usage counts filter by date first, so the new ones start with the date. The "new clients" funnel reads are by client id and already have indexes.

**They are declared on the models as script-only** (`_autoIndex: false`), so a normal app start-up never builds them (a test checks this for all six). The release therefore causes no index build by itself. Until you run the script the pages still work, with the other fixes, but Usage reads stay slow on a big database.

## The exact steps to create the indexes on production

Pick a quiet time. You need Docker running and `~/.aws` set up (same as the other ops scripts). Run these from the repo folder.

```bash
# 1. DRY RUN. Connects, prints the database NAME and the kind of host, the size of each collection and its indexes,
#    the six indexes it would create, a rough extra disk estimate and the free disk the server reports. Changes nothing.
bash docs/superpowers/ops/create-staff-indexes.sh

# 2. Check the printed database name is the production one, and that the free disk is enough
#    (the script refuses to build if the new indexes would use more than half of the reported free disk).

# 3. REAL RUN. Builds the missing indexes one at a time and prints progress.
CONFIRM_CREATE_INDEXES=yes bash docs/superpowers/ops/create-staff-indexes.sh

# 4. Check: it should now say "Nothing to create: every index is already there."
bash docs/superpowers/ops/create-staff-indexes.sh
```
The wrapper reads the database address from the production secret and never prints it. The Node script itself is `backend/scripts/create-staff-indexes.js` and needs `MONGODB_URI` in the environment; without `CONFIRM_CREATE_INDEXES=yes` it can only do a dry run.

**How long:** on the local copy (560,000 documents in the six collections) all six took under a second. On Atlas the time depends on the collection sizes and the cluster; expect seconds to a few minutes per index for up to a few million documents, longest for drafts and the inbox. The build runs while the app is live (MongoDB 7 builds online), with a short pause at its start and end and some extra load meanwhile.

**Disk:** each index entry is roughly 25 bytes, so the total is about 25 bytes times the documents in the six collections (for 1 million drafts, about 25 MB; the inbox index is smaller still because it only covers messages with a drafted reply). While building, MongoDB may use about as much again as temporary space. The cluster is at 61% disk, so this is small, but the dry run prints the real estimate and the script will not build if it is more than half of the free space. **Check the Atlas disk chart before and after.**

**Undo:** `db.drafts.dropIndex('staff_createdAt')` (and the same for each name above) in mongosh. Dropping an index only makes Usage slower again.

If a build fails or is cancelled the script stops and says so; running it again continues with the missing ones.

## Before and after (local copy, seconds)

Machine: this Mac, one local `mongod` 7.0.24, everything in RAM or the system cache, no network. Rows seeded: users 20,005, drafts 200,000, campaigns 60,000, video jobs 20,000, hero jobs 5,000, Blueprints 5,000, inbox 300,000, events 400,000, spread over 120 days, 50 Quark history entries per client.

| Page (Owner unless stated) | BEFORE (code at bc514a9) | AFTER fixes, no new indexes | AFTER fixes + indexes, first visit | second visit (stored copy) |
|---|---|---|---|---|
| Home | **53.8** | 1.5 | 1.6 | 0.007 |
| Clients | 1.4 | 1.2 | 1.1 | 0.2 |
| Team | 0.4 | 0.3 | 0.5 | 0.005 |
| Usage, 30 days | 3.1 | 3.4 | 3.8 | 0.005 |
| Usage, 90 days | 3.8 | 3.7 | 4.1 | 0.006 |
| Usage, Admin | 2.5 | 0.9 | 1.2 | 0.004 |
| Home, CSM | 0.8 | 0.2 | 0.5 | 0.004 |
| Money (control, not changed) | 2.4 | 2.5 | 2.6 | not stored |

No Usage source was unavailable in any run on this machine (a local machine does not time out where Atlas did). Every page is under 5 seconds on the first visit and under 2 seconds from the stored copy.

**What is still the slowest part:** Usage for the Owner is about 3.8 s, and about 2.5 s of that is reading the Quark history of 20,000 clients (1,000,000 entries). Reading it on the server side and sending back only the last month measured 1.2 s instead of 2.3 s in a trial; I did not adopt it, because it would re-implement the spending rules in the database query and the gain was small. Home does not read history at all.

**Database work (the part that does not depend on this Mac)**, from the database's own plan (`--explain`), documents looked at:

| Read | BEFORE | AFTER |
|---|---|---|
| images and posts drafted (drafts) | 200,000, full scan | 49,800 by `staff_createdAt` |
| posts published (campaigns) | 60,000, full scan | 10,800 by `staff_publishedAt` |
| finished videos / hero / Blueprints | 14,000 / 4,000 / 4,000 | 3,400 / 1,000 / 1,000 |
| replies drafted (inbox) | 300,000, full scan | 22,500 by `staff_ai_generatedAt` |

## What is in the code

- `backend/services/staff/cache.js`, `readErrors.js`; routes in `backend/routes/staff.js`
- `backend/config/staffIndexes.js`, `backend/scripts/create-staff-indexes.js`, `docs/superpowers/ops/create-staff-indexes.sh`
- `backend/services/staff/clientList.js` (slim read, one-pass helpers), `home.js`, `usage.js`
- `frontend/pages/staff/StaffFreshness.tsx`, `frontend/utils/staffFreshness.ts`
- Tests: `staffCache`, `staffCacheRoutes`, `staffIndexes`, `staffProjections`, `staffPerfCheckGuard` (backend), `staffFreshness` (frontend)

### Quark history
For the Owner's "Quarks spent this month" the loader reads `credits.history` with `$slice: -100`, the same cap the app keeps and the report already states ("the last 50 to 100 entries"). Numbers are identical unless an account somehow holds more than 100 entries (staff grants add an entry without trimming, so it can briefly happen); then only the oldest are left out, which can only matter for spending older than the 100th latest entry. I did not use `QuarkLedger`: it is a different (complete) record, so the totals would not match the Money page.

## How to verify
1. After the release and the index step, open Usage as Owner. Look at the server log for `[staff] usage: could not read` (there should be none) and for slow-start lines. If a source still fails, the page now says whether it took too long.
2. Open Home twice: the second time should be instant and show "Last updated" with a time.
3. Press Refresh on any page: it reads again (`?refresh=1`) and the line disappears.
4. To repeat the local measurement: see `backend/scripts/staff-perf-check.js` (header). With a local `mongod` on port 27111:
   ```bash
   MONGODB_URI=mongodb://127.0.0.1:27111/nebulaa_seed_perf node backend/scripts/staff-perf-check.js --seed             # fill with made-up data
   MONGODB_URI=... node backend/scripts/staff-perf-check.js                    # time the pages
   MONGODB_URI=... node backend/scripts/staff-perf-check.js --create-indexes   # run the real index script, then time again
   MONGODB_URI=... node backend/scripts/staff-perf-check.js --explain          # documents looked at per read
   MONGODB_URI=... node backend/scripts/staff-perf-check.js --golden           # old reads against new reads: same numbers
   ```
   It refuses any host except localhost and any database not starting `nebulaa_seed_`. Stop the `mongod` and delete its data folder afterwards.

## What is still unproven (measured only on a local copy)
- **Real Atlas speed.** The local `mongod` has no network and a warm cache, so its read times are shorter than Atlas would give. The documents-examined numbers are the portable proof for the database part; the seconds are not. I could not see why production reads actually timed out (no production log, no Atlas access in this task).
- **That the minutes were the Home loop.** It is the largest cost I could reproduce and it blocks the server for everyone while it runs, but I did not see the production log line to confirm it caused the "could not read" messages.
- **Production size.** If production has far more than 20,000 clients or longer histories, the cold first visit will be slower than shown; the stored copy and the 20 second limits still protect the pages.
- **The 60 second load balancer limit.** If the load balancer or nginx cuts a request at 60 seconds, a very slow cold read could still show an error on the first visit. The read keeps running and the next visit gets it (or joins it), but I have not tested this on ECS.
- **The wrapper script** `create-staff-indexes.sh` was not run (it needs your AWS login). The Node script behind it was run for real on the local copy: dry run, real run, second run created nothing, refusal without the confirm word, refusal without an address.
- **Staff changes made on another ECS task** do not clear this task's stored copy; it is at most 5 minutes old, or press Refresh.
- The Money page and the client page were not changed; Money still reads every client's history (2.5 s locally).
- When one of the three client reads on Clients/Home (last activity, waiting drafts, failed posts) fails, the page still loads without that information, as before (it is logged, not shown). Only Usage shows per-source "unavailable".
