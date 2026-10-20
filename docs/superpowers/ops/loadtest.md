# Load tools and pass targets (hardening H2, H3)

Everything here runs on this machine, with no database, no provider and no outside call. The tools live in `backend/scripts/loadtest/`, have no dependency beyond Node, and are covered by `backend/tests/loadtestTools.test.js`.

## What is in the folder

| File | What it does |
|---|---|
| `lib/runner.js` | The load generator. `node:http` with keep-alive, an OPEN loop (requests start on a fixed schedule whether or not the last one answered), p50/p90/p99/max/mean, error count (network failures plus any status outside `expectStatus`, default 4xx and 5xx), status histogram. |
| `load.js` | One URL at a fixed rate. Local only; `--allow-remote` for a staging server you own (names that look like production are refused). |
| `serve.js` | The server under test: the real `server-main.js` (no scheduler) on a random local port (never 3000, 3200, 5000) in its own process, with in-memory stand-ins and 20 seeded accounts. |
| `mixed.js` | Starts `serve.js`, runs the flows below at the same time, reads the server's event-loop lag, checks each flow against the targets, writes JSON. |
| `lib/memoryStore.js` | The stand-ins: every model except User answers reads with empty results (or the rows a flow supplies) and swallows writes; User is the in-memory store of `tests/helpers/authHttp.js`. |
| `lib/guard.js` | `assertSafeDatabase(uri)`: no URI is fine (memory), a URI is allowed only when its database is exactly `nebulaa_dev`, anything else throws. Even then nothing connects: the tools strip the URI. |

Event-loop lag: `utils/eventLoopMonitor.js` (`perf_hooks.monitorEventLoopDelay`, 10 ms timer, values are the lag above the timer's own interval). Staff can read it live with `GET /api/metrics/event-loop` (owner and admin roles, `run_jobs` permission; 401 without sign-in, 403 for a customer) and start a new window with `POST /api/metrics/event-loop/reset`. `mixed.js` resets it after the warm-up and reads it at the end.

## How to run

```
cd backend
npm run loadtest                                                   # 10 s, 15 req/s per read flow, sign-in 5/s
node scripts/loadtest/mixed.js --duration=5 --rate=15 --signin-rate=5   # the short smoke
node scripts/loadtest/mixed.js --rate=50 --duration=60 --strict --out=/tmp/mix50.json   # the 50 req/s column; exit 1 on a miss
node scripts/loadtest/load.js --url=http://127.0.0.1:4010/api/health --rate=15 --duration=10   # one URL against a server you started
```

`--rate` is requests per second for EACH read flow, so the whole mix is about 7 x rate + sign-in + 5 health calls (rate 15 gives about 115 req/s, the "whole mix at 100 req/s" row). `--strict` makes a missed target exit 1; without it the table is printed and the exit code is 0.

Flows: sign-in (real password hashing at the configured cost, random users, random source address), `/api/auth/me`, `/api/credits`, `/api/notifications/unread-count`, `/api/drafts` (150 rows, default page), `/api/campaigns` (100 rows, default page), `/api/home/summary`, `/api/content-calendar` (a stored calendar), plus `/api/health` as the "others unaffected" probe.

## Pass targets (tester's table, H3)

| Flow | At 15 req/s | At 50 req/s |
|---|---|---|
| Session check, credits, unread count, notifications, reminders, ideas, blueprint, plan, week, listening, videos list, hero-video polling, ad campaigns, saved prompts, brand assets | p90 <= 200 ms, 0 errors | p90 <= 400 ms, 0 errors |
| Home summary, dashboard overview, campaigns list, drafts list | p90 <= 300 ms | p90 <= 600 ms |
| Content calendar GET | p90 <= 150 ms | p90 <= 300 ms |
| Create reminder (small write) | p90 <= 250 ms | p90 <= 500 ms |
| Oversized write (200 KB description) | 400 in <= 300 ms | same |
| Prompt builder | 401 without token; p90 <= 150 ms | same |
| Sign-in | 5 per second sustained, p90 <= 800 ms, health p99 <= 200 ms | n/a (scale out) |
| Job start with stubbed providers | accepts in <= 200 ms with a job id; polling p90 <= 200 ms | per-user caps return 429 |
| Whole mix | p90 <= 400 ms at 100 req/s | p90 <= 300 ms; ceiling >= 150 req/s on one core |

Also asked for: 10-minute soak at 60 mixed req/s (zero errors, memory flat within 15%, event-loop p99 under 100 ms), a sign-in burst (200 sign-ins in 20 s while the mix runs, mix p90 <= 600 ms), a 30 MB upload while health is probed (health p99 < 200 ms), the two-process test.

`mixed.js` checks the rows it covers (the first four groups and sign-in, the whole mix, health p99, event-loop p99 under 100 ms). The rows below are not in the runner yet:

| Not covered by `mixed.js` | How to cover it now |
|---|---|
| Soak (10 min) | `node scripts/loadtest/mixed.js --rate=8 --duration=600 --out=soak.json` (about 60 req/s); compare `memory.before` and `memory.after` in the JSON |
| Sign-in burst | run `mixed.js` with `--signin-rate=10 --duration=20` (the sign-in flow already runs beside the others) |
| 30 MB upload while probing health | probe P13 in `tests/http/probes.test.js` does this at 5 MB; for 30 MB start `serve.js`, then `load.js` on `/api/health` while posting a large body with curl |
| Create reminder, 200 KB write, prompt builder, job starts | not built: they need a write path in the stand-ins; the probe pack covers their behaviour (P1, P3, P13) |
| Two processes (P18) | needs a real MongoDB for the lease lock; `schedulerLeases.test.js` and `leaseLock.test.js` cover the logic. A real run is a human step against `nebulaa_dev` with `RUN_BACKGROUND=1` in two processes |
| Atlas, real task size | needs a staging copy; not possible from this machine |

## What the numbers mean (and do not)

The stand-ins remove MongoDB, so these runs measure the application layer: middleware order, auth, validation, JSON serialisation, compression, password hashing and the event loop. They do NOT measure queries, indexes, Atlas latency or network. A pass here means "the app code is not the bottleneck at these rates". For numbers against a real database use `backend/scripts/bench-local.js` (refuses any database but `nebulaa_dev`, throwaway account, cleans up) and do not run it hard: the development database shares a cluster with production.

## Smoke result, 2026-10-20 (this laptop, 10 cores, Node 24, 5 s, in-memory)

`node scripts/loadtest/mixed.js --duration=5 --rate=15 --signin-rate=5`: 575 requests at 115 req/s, 0 errors. Sign-in p90 167 ms (target 800). Light flows p90 3.3 to 3.8 ms, list flows 5.7 to 6.1 ms, calendar 5.7 ms, whole mix p90 5.8 ms, health p99 8.4 ms, server event-loop lag p99 3.6 ms (max 9.7 ms), memory 199 to 277 MB over the run. All targets met, by a very wide margin, which is expected without a database. This is a 5-second smoke, not a verdict; the soak and the 50 req/s column were not run.
