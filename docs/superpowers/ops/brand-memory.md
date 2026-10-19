# What Nebulaa learned (Brand memory), how it works

Built 2026-10-20 on branch `nebulaa-redesign`. Not released. Impact map: `docs/superpowers/impact-maps/brand-memory.md`.

## In one paragraph
The memory learns from six sources, in code, with no model call and nothing charged: the plan, the Growth Blueprint, the customers (business profile answers and the plan's ideal customer), the products, the post results (`services/performance/learnings.js`, same thresholds as the Performance page) and the competitors (stored weekly snapshots; never a competitor name, handle, caption or hashtag). Each item keeps its source, an evidence count and sentence ("from 14 posts"), the date it was first learned and a confidence word (Strong, Good, Early). A source without enough evidence says why in plain words. Prompts read the items through one shared helper.

## Code
- `backend/services/brandMemory/common.js` settings (limits, timings, prompt cap) and helpers.
- `fromPlan.js` (plan and Blueprint), `fromCustomers.js`, `fromProducts.js`, `fromResults.js`, `fromCompetitors.js`: pure, one per source.
- `merge.js`: same key keeps `learnedAt`; owner edits are kept (and stay even without evidence); deleted keys never come back; a source that failed keeps its old items; fingerprint for idempotency.
- `runner.js`: `createBrandMemory()` with `refreshAccount`, `getView`, `editItem`, `hideItem`, `runDailyOnce`; `refreshSoon` (change triggers); `startBrandMemoryJob` (started in `server-main.js`).
- `prompt.js`: THE shared helper. `memorySectionLines` (used by `services/brandMemory.js` `buildBrandMemoryBlock`, so Create single post, campaign, carousel, the monthly calendar and background drafts), `loadMemoryLines` (Home drafts: up to 4 lines through the decency filter; plan runs: up to 6 lines without the plan's own items, sent as typed facts "What Nebulaa learned"; the public Blueprint form cannot send them). Caps: 10 lines and 900 characters for the whole section, header included (about 225 tokens). Code-written lines have no digits. With nothing new learned, prompts are exactly as before (the old notes section).
- Stored on the account's `ai_brand_memory` document (`models/AIBrandMemory.js`): `learnedItems`, `learnedHidden`, `learnedSources`, `learnedRefreshedAt`, `learnedCheckedAt`, `learnedFingerprint`, `learnedManualAt`, `learnedLockUntil`. Old documents keep working. Account deletion already erases the document (`dataRegistry`).
- Routes (`backend/routes/aiMemoryLearned.js`, mounted on `/api/ai-memory`): `GET /learned` (refreshes first if nothing was learned yet or a source changed), `POST /learned/refresh` (429 with minutes left during the 10-minute cooldown, 409 while a refresh runs, 403 for staff), `PATCH /learned/:key`, `DELETE /learned/:key`.
- Page: `frontend/pages/AIMemory.tsx` (Insights, What Nebulaa learned), helpers `frontend/utils/memorySources.ts` (tests `frontend/tests/memorySources.test.mjs`), styles `components/memory/memory.css`. Sample states: `/?audit=normal&memorystate=empty|tracking|partial|filled|sources#/analytics?tab=learned`.

## When it learns
| Way | Details |
|---|---|
| Page visit | first visit, or a source changed after the last look (newest plan or Blueprint, product, measured post, snapshot, competitor, profile) |
| Triggers | plan or Blueprint finished, product saved/imported/deleted, competitor changed, competitor snapshot stored, post measured, profile saved; debounced 2 minutes per account in that server; only while the job is started |
| Daily job | every 24 hours (first run 10 minutes after start); at most 100 accounts, oldest check first; recomputes only accounts with a change or older than 7 days; each account cut off after 10 seconds, the run after 5 minutes; one server at a time (OpsState lease `brand_memory_refresh_lease`) |
| Refresh now | one at a time per account (60-second lock on the document), then a 10-minute cooldown stored on the document; a failed refresh does not start the cooldown |

## Switches
- `ENABLE_MEMORY_REFRESH`: the daily job and the triggers are ON by default (no model call, bounded, idempotent). Set to `off` to stop both; the page still learns on a visit and with Refresh now.
- Unchanged and separate: `ENABLE_MEMORY_DISTILLATION` (the OLD weekly model notes, `services/memoryDistillation.js`, on unless `false`). This one IS a model call with no spend-guard check: owner decision pending. The page no longer calls it (the old `POST /api/ai-memory/distill` route still exists).

## Real-database check
```
cd backend && node scripts/brand-memory-check.js
```
`nebulaa_dev` only (refuses any other database), throwaway `zz.memchk-` users, deletes everything it made (`cleanup` mode for leftovers). Seeds a plan, a Blueprint, products, measured posts (two old rows with zeros), two competitors with snapshots; checks the empty account, all six sources with counts, no competitor text stored, idempotency, Refresh now cooldown over HTTP, the lock, edit and delete, the prompt section caps, learning again after a change, an ignored competitor, other accounts, free and staff, the daily job (over the throwaway accounts only) and deletion. Last run 2026-10-20: 14 PASS, 0 FAIL, 0 left.
