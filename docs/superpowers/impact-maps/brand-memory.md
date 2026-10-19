# Impact map: BRAND MEMORY ("What Nebulaa learned") learns from every source

Written 2026-10-20 on branch `nebulaa-redesign`, BEFORE building. Ledger items covered (area rule 2, both sections):

- PERFORMANCE: "Brand memory must keep LEARNING from everything cumulatively: the plan, the Blueprint, the ideal customer (ICP), the market, the products, post performance and the competitors, not only which posts performed; it needs more inputs over time and should show what it learned from each source." (2026-10-19)
- BRAND: "Brand assets, Brand Growth Blueprint and Memory as tiles with art and status" (done; the new sections keep that look).

Left out on purpose (stated reason): the business-profile questionnaire redo (BRAND, NOT STARTED) changes Settings and onboarding data and needs its own map; the memory reads whatever the profile holds today.

## 0. The short version

1. Today the memory has ONE learning path: `services/memoryDistillation.js` sends the account's best and worst measured posts to a text model once a week (and on "Refresh now") and stores up to 12 `learnedNotes`. It only learns from post performance, and it is a model call.
2. The new memory learns from SIX sources, in code, with NO model call: the plan, the Blueprint, the customers (ideal customer and market), the products, the post results (`services/performance/learnings.js`) and the competitors (stored weekly snapshots). Every learned item keeps where it came from, how much evidence backs it, when it was first learned and a confidence word.
3. It keeps learning: a daily bounded job (on by default, cheap, idempotent), a refresh when a source changes (plan or Blueprint finished, product saved or deleted, competitor snapshot stored or competitor removed, post measured, profile saved) and a "Refresh now" button with a 10-minute cooldown and a per-account lock.
4. Prompts read it through ONE helper (`services/brandMemory/prompt.js`): Create (single post, campaign, carousel, through `buildBrandMemoryBlock`), the monthly calendar and background drafts (same block), Home drafts and plan runs. Short plain lines, no digits, never a competitor name or caption, at most 10 lines and 900 characters (about 225 tokens). With nothing learned the prompts are byte-for-byte what they were.
5. The old notes keep working: they show under "your results", Edit and Delete stay, and they still reach the prompts. The weekly model distillation is NOT changed by this work (owner decision below).

## 1. Sources and the exact fields read

| Source (chip) | Read from | Fields | What is learned (code only) | Minimum evidence |
|---|---|---|---|---|
| Your plan | newest `Blueprint` with `kind: 'plan'`, `status: 'completed'` | `result.plan.pillars[].name`, `result.plan.positioning.territory.name`, `result.plan.positioning.line.text`, `result.plan.channels[].channel` (priority order), `result.plan.calendar[].format`, `completedAt`, `blueprintId` | Themes; position and line; channel order; format mix of the 30-day calendar | a completed plan; themes need 3 or more; format mix needs 10 or more calendar days |
| Your Blueprint | newest `Blueprint` with `kind: 'blueprint'`, `status: 'completed'` | the same `result.plan` fields; `completedAt` | Themes; position; channels; themes shared with the plan | a completed Blueprint; shared themes need a plan too and at least one shared theme |
| Your customers | the account's `businessProfile` (`targetCustomerProfile`, `targetAudience`, `businessType`, `reachAreas` / `geographicReach`, `pricePositioning`, `keyDifferentiator`, `industry`) and the plan's `result.plan.icp` (`who`, `pains`, `where`, `triggers`, each `[{ text }]`) and `positioning.audience` | Who buys; what worries them; where to find them; what makes them buy; the market (sells to, where, price level, what makes it different) | one stored answer for each item; nothing is guessed (no gender guess, B2B only when stated) |
| Your products | `Product` rows of the account (at most 50, `name type price priceNote currency category imageUrl images createdAt`) | Catalogue size (products, services); photo coverage; price range (same currency only); the main category | 1 product for the catalogue; price range needs 2 priced items in one currency; main category needs 3 items and at least half of them in it, never "General" |
| Your results | `AIContentPerformance` of the last 90 days (at most 400) and their `Campaign` rows (at most 400), built with `performance/view.measuredPost`, then `learnings.computeLearnings` | Format, platform, best post, caption length, best day, best time (followers are not used: those come from daily numbers, not posts) | `learnings.THRESHOLDS` unchanged: 5 measured posts with numbers for any finding, 3 a side, 25 percent ahead, 8 posts for timing |
| Your competitors | `Competitor` rows that are active and not ignored (the tracker's own list, at most 5) and their `CompetitorSnapshot` rows with `ok: true` from the last 8 weeks (`posts[] { at, type, likes, comments }`, `postsInWindow`, `weekStart`) | Which format gets more likes across the competitors you track; weekend or weekday; how often they post | the competitor add-on (`canUse(user, 'competitors')`); 2 competitors with posts; 10 posts with known likes; 3 a side; 25 percent ahead; posting rhythm needs 2 competitors with 2 weeks each |

Never read: competitor captions, handles, names, pictures or hashtags (hashtags can carry a brand name). The competitor lines say "the competitors you track" and a count.

## 2. Stored shape (backwards compatible, same document)

The memory stays one `ai_brand_memory` document per account (`models/AIBrandMemory.js`). New optional fields; nothing existing changes:

- `learnedItems[]`: `{ key, source, kind, text, promptLine, evidenceCount, evidenceUnit, evidenceText, confidence, learnedAt, updatedAt, userEdited }`
  - `key`: stable, for example `plan-pillars`, `results-format-video-image`; the same finding keeps its key across refreshes, so `learnedAt` (first learned) survives and `updatedAt` moves.
  - `source`: `plan`, `blueprint`, `customers`, `products`, `results`, `competitors`.
  - `confidence`: words only, `strong`, `good` or `early` (results: 20 posts or more strong, 10 good, else early; competitors: 30 posts strong, 15 good; stated facts from the owner or his plan: strong; the plan's own reading of the customer: good).
  - `text`: what the page shows (may carry numbers that are real counts); `promptLine`: what prompts read, written by code with no digits; empty when a clean line cannot be written (that item is shown, never sent).
  - `userEdited`: the owner's own words win: the text is kept on every refresh and also becomes its prompt line (cut to 200 characters).
- `learnedHidden[]`: keys the owner deleted (at most 200, newest kept). A deleted item never comes back unless its evidence produces a new key.
- `learnedSources`: per source `{ state, reason, evidenceCount, evidenceUnit, itemCount, checkedAt }`; `state` is `learned`, `not_enough`, `none`, `not_on_plan` or `error`; `reason` is the plain sentence the page shows.
- `learnedRefreshedAt`, `learnedCheckedAt`, `learnedFingerprint`, `learnedManualAt`, `learnedLockUntil`.

Old documents without these fields read as "nothing learned yet"; the first visit or the daily job fills them. `learnedNotes` (the model notes) are untouched and are shown as items of "your results" with their stored strength.

## 3. Refresh: schedule, triggers, bounds

| Way | When | Bounds |
|---|---|---|
| First visit | GET finds no `learnedRefreshedAt` | same lock as below |
| Change on visit | GET finds a source newer than `learnedRefreshedAt` (plan or Blueprint completed, product updated, snapshot taken, post measured, profile saved, competitor changed) by six small indexed reads | same lock |
| Trigger | plan or Blueprint completed, product saved, imported or deleted, competitor snapshot stored, competitor ignored, post measured, business profile saved | debounced 2 minutes per account in this process, only while the job is started (never in tests) |
| Daily job | every 24 hours (first run 10 minutes after start) | at most 100 accounts a run, oldest check first; an account is only recomputed when a source changed or it is older than 7 days; each account time-boxed to 10 seconds; the run to 5 minutes; one server at a time (OpsState lease `brand_memory_refresh_lease`); `ENABLE_MEMORY_REFRESH=off` stops it (on by default) |
| Refresh now | the page button | per account: one at a time (database lock, 60 seconds), then 10 minutes cooldown stored on the document (survives restarts and several servers); 429 with the minutes left |

Idempotent: the same inputs give the same items and the same fingerprint; a second run only moves `learnedCheckedAt`. Every query is narrowed by the account id, limited and has `maxTimeMS(5000)`.

## 4. Costs

- No model call anywhere in the new memory. No provider call. Nothing is charged, no Quark moves.
- Prompts grow by at most about 225 input tokens when items exist (900 characters cap, tested). At the most expensive text rate in `apiCosts.js` (USD 5 per million input tokens) that is about USD 0.0011 a call, well under one Quark (USD 0.02); no price in `apiCosts.js` changes. Plan runs (free to customers) and the paid Blueprint price are unchanged (the paid Blueprint form does not send learned lines).
- A model call I would like but did NOT build: none is needed. Writing nicer sentences from the items with a model would cost about USD 0.001 to 0.003 an account a day (about 1,500 tokens in, 300 out at the regional rate); not built, no switch, listed for the owner.
- EXISTING model call found (not changed): `services/memoryDistillation.js` runs weekly for up to 50 accounts (`ENABLE_MEMORY_DISTILLATION`, on unless set to `false`) and on the old `POST /api/ai-memory/distill`. It has no spend-guard check and no ledger row. The page's Refresh now no longer calls it (it now calls the code-only refresh). Owner decision: keep it, switch it off, or put it behind the spend guard.

## 5. Entitlements

| Account | Behaviour |
|---|---|
| Free | Learns from what it has (profile, products, results); plan and Blueprint only if one exists; competitors: "Competitor tracking comes with the competitor add-on." |
| Starter, Growth | Same; competitors with the add-on |
| Managed | Everything (managed is never blocked) |
| Agency client workspace | `req.user` is the client; learns from the client's own data; the agency's own memory is never mixed in |
| Staff on their own login | GET returns an empty memory with "Staff accounts have no memory of their own."; POST refresh 403 |
| Inside a CSM pass | the client's memory; refresh allowed (it changes nothing but the memory) |

## 6. Data and deletion

- Same collection, same document: `dataRegistry` already deletes `AIBrandMemory` by `userId` on account deletion and exports it; a test proves the new fields live in that document (no new collection, no new index).
- Deleting a product, ignoring a competitor or a plan being replaced changes the next refresh: items that are no longer backed disappear (except the owner's own edits, which stay as his words).
- Deleting an item hides its key; editing an item marks it `userEdited`.

## 7. Honesty rules

- Never invent: every item is a count, a stored answer or a computed comparison above a threshold. Below a threshold the source says why in plain words ("Nebulaa has measured 3 of your posts. It needs at least 5 to find a pattern.").
- Evidence line on every item ("from 14 posts", "from your plan of 12 October", "from 3 answers in your business profile").
- No percentages for confidence: the words Strong, Good, Early.
- Prompt lines have no digits, no links, no @names, no hashtags and are filtered by the Home drafts decency filter there.

## 8. Edge cases

| Case | Result |
|---|---|
| Empty account | every source "none" with its own sentence; prompts unchanged |
| New plan replaces an old one | items keyed by kind, so the same key updates (learnedAt kept), dropped themes disappear |
| Plan run in flight or failed | only completed runs are read |
| Deleted or ignored competitor | not in the list, its snapshots are not read |
| Old performance rows with zero metrics | not counted as having numbers ("12 posts were measured, but the platforms sent no numbers for 9 of them") |
| Mixed currencies | no price range |
| Products all "General" | no category item |
| One source query fails | that source `error` ("We could not read this just now."), others still learn; the old items of that source are kept |
| Two refreshes at once | the database lock lets one through; the other is told it is already running |
| Owner edits then evidence disappears | the edited item stays |
| Very long texts (Tamil, Hindi) | cut by characters (not bytes) at 200 for text, 160 for prompt lines |
| Phone 375 px | sections one column, chips wrap |

## 9. Tests

- `backend/tests/brandMemory.test.js`: each source with fakes (thresholds both sides), keys stable, confidence words, merge (learnedAt kept, edits kept, hidden kept out), fingerprint idempotency, prompt helper (caps, no digits, no competitor names, identical output when empty), runner (lock, cooldown, error per source, staff, entitlement, time box), daily job bounds, routes, `dataRegistry` coverage, Home drafts and plan input carry the lines.
- `backend/scripts/brand-memory-check.js`: real database `nebulaa_dev` only, throwaway `zz.memchk-` users, every source seeded, refresh, cooldown, lock, idempotency, deletion, cleanup; prints PASS and FAIL counts.
- `frontend/tests/memorySources.test.mjs`: grouping per source, evidence and time words, cooldown words, empty states.
- Look: audit preview on port 3121, `?memorystate=empty|tracking|filled|partial|sources`, equal heights measured at 1280 and 375.
