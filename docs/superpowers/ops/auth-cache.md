# Auth cache (protectCached)

Decision D26 (`docs/superpowers/DECISIONS-LOG-2026-10-20.md`). Audit behind it: `auth-cache-audit.md`.

## What it is

`protect` (`backend/middleware/auth.js`) loads the full user document from MongoDB on every signed-in request
(measured about 6 ms of work plus a database round trip, and the main limit on the session, credits and bell
requests in the load test). `protectCached` gives exactly the same answers (same checks, same order, same messages,
parity-tested over every case) but:

1. verifies the JWT as before;
2. looks up a short in-process cache keyed by the token context: `<userId>|c:<actingCsm>|a:<actingAgency>`, so an
   owner session, an agency client pass and a CSM pass never share an entry;
3. on a miss reads the user LEAN with only the fields the checks need (`email firstName lastName isActive isVerified
   deletion.status deletion.purgeAfter agency.ownerId agency.frozen staffRole isCsm assignedCsm`, schema defaults
   filled in), plus the CSM or agency owner of a pass (the same lean reads `protect` already made), and keeps the
   result only if the account exists, is active and the pass checks hold. A missing user, a deactivated user, a
   failed pass check or a bad token is never cached;
4. runs the URL checks (deletion pending, payment and password URLs blocked inside a pass) on every request, hit or
   miss;
5. sets `req.user` to a deeply frozen plain object with `_id` (ObjectId) and `id` (string). A write to it throws in
   strict code and is ignored otherwise; it is never a Mongoose document and never carries money or plan fields.
   `req.loadFullUser()` returns a FRESH full document (a database read, never the cache, once per request).
   `requireFullUser` (middleware) swaps `req.user` for that document when a route needs it.

Bounded: at most 5,000 entries, least recently used dropped first.

## Where it is used (and where it is not)

Only these hot reads use `protectCached`:

| Route | Why it is safe |
|---|---|
| `GET /api/auth/me` | reads only `req.user._id`; loads the full user itself |
| `GET /api/credits`, `GET /api/credits/history` | read only the id; the balance is read fresh from the database in the handler |
| `GET /api/notifications`, `GET /api/notifications/unread-count` | read only the id |
| `GET /api/home/summary` | on its own 60 s summary cache miss it builds from `await req.loadFullUser()` (fresh balance and plan); on a hit it reads no user at all |

Everything else keeps `protect`, unchanged: every spend, charge, refund, payment, Razorpay, plan, entitlement
(`requireFeature`, `trialGuard`, `creditGuard`), publish, schedule, approve, photoshoot, Home drafts, studio video,
blueprint, plan run, account, agency, staff, CSM and every write route. Their behaviour is identical to before.
A test (`tests/authCache.test.js`, "wiring") fails if a money route file starts using `protectCached`.

To move another route to the cache: confirm it reads only the id from `req.user` (or calls `req.loadFullUser()` for
anything else), change `protect` to `protectCached` on that route, and add it to the wiring test.

## Invalidation

Central, on the User schema (`backend/services/authCacheHooks.js`, attached in `models/User.js` before the model
is compiled): `save`, `updateOne`, `updateMany`, `findOneAndUpdate`, `findOneAndReplace`, `replaceOne`, `deleteOne`,
`deleteMany`, `findOneAndDelete` (query and document forms), `bulkWrite` and `insertMany`. Each clears the entries
of the user ids its filter names (`_id`, `_id.$eq`, `_id.$in`), and clears the WHOLE cache when the filter is wider
(for example `agency.ownerId`, email). It runs both before and after the write, and a lookup that started before any
invalidation is not stored (generation ticket), so a request racing a write cannot store the old state.

Every entry is indexed by every user it names, so a write to an agency owner (plan ends, subscription halts,
deletion) also clears its clients' pass entries, and a write to a CSM clears the passes they hold.

That covers, with no per-route code: password change and reset, plan change, renewal and the Razorpay webhooks,
every Quark spend, refund and top-up (`quarkBuckets`, `trialGuard`, `creditGuard`, payment routes), account
deletion request, restore and purge, deactivation, staff role and CSM assignment changes, agency workspace create,
rename, freeze and removal, email verification, sign-in counters.

Could not hook: nothing found in the app. The audit found no write to the `users` collection that bypasses the
model (the only raw driver use is `services/migrationService.js`, an insert into another database). A future raw
`db.collection('users')` write, a manual edit in Atlas, or a write made by ANOTHER server process is not seen by
this process's cache; the bound below applies.

## Staleness bound (be honest about this)

- Same process, write through the model: zero. The next request reads the database again.
- Another process (two or more web instances, a worker, a script, a manual edit): up to `AUTH_CACHE_TTL_MS`
  (default 15 s) during which a deleted, deactivated or deletion-pending account, an ended agency pass (plan
  downgrade) or a removed CSM assignment can still pass the auth check on the cached routes ONLY. What they can do
  in that window is read their own session, credits, notifications and Home summary (the cached routes are reads,
  and the balance is always read fresh). Every write and money route still uses `protect` and refuses them at once.
- There is no `tokenVersion` or "password changed at" field today, so a password change has never revoked old tokens
  (7 day JWTs) and still does not; the cache neither improves nor worsens that. Adding a token version would be the
  real fix (separate job).
- The real-database check (section 8) shows the bound: a write that skips the hooks is seen after the TTL.

## Switches

| Variable | Default | Meaning |
|---|---|---|
| `AUTH_CACHE` | on | `off` makes `protectCached` exactly `protect` (full document, no cache); read on every request, so it applies as soon as the process sees it (after a restart with the new environment) |
| `AUTH_CACHE_TTL_MS` | `15000` | entry life in ms; capped at `60000`; `0` turns the cache off |

## Proof

- Unit: `backend/tests/authCache.test.js` (22 tests: hit, miss, expiry, LRU, invalidation by any named id, the
  generation guard, settings, key isolation, freeze, filter parsing, hooks registered for every write op, parity
  with `protect` over 15 cases on a miss and a hit, protect untouched, lean user has `id`, deleted and deactivated
  users rejected, failures never cached, owner vs pass isolation, kill switch, `loadFullUser` fresh, a saving route
  still works, wiring, Home summary fresh on a miss).
- Real database: `node scripts/auth-cache-check.js` (nebulaa_dev only, throwaway `zz.authcache-` users, cleanup,
  non-zero exit on any FAIL or leftover).
- Benchmark: `node scripts/auth-cache-bench.js [seconds]` (reads only, gentle: the dev database shares its cluster
  with production).

Benchmark of 2026-10-20 (MacBook to the Atlas dev database, so every database round trip is about 70 ms; one node
process; the user document carries 200 credit history rows and a long business profile):

| Route | Mode | 50 TPS p50 / p90 / p99 (ms) | Max sustained TPS (10 in flight) |
|---|---|---|---|
| `/api/auth/me` | before | 1131 / 1426 / 2277 (could not keep up) | 62 |
| `/api/auth/me` | after | 73 / 117 / 251 | 123 |
| `/api/credits` | before | 493 / 968 / 1679 | 28 |
| `/api/credits` | after | 242 / 317 / 404 | 31 |
| `/api/notifications/unread-count` | before | 157 / 210 / 278 | 63 |
| `/api/notifications/unread-count` | after | 55 / 93 / 101 | 122 |

`/me` and the bell do one database read instead of two (or three). `/credits` still reads the full user, settles the
wallet and may save it in the handler (money path, left as is); making that handler lean is a separate job.
