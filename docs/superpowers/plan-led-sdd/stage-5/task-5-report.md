# Task 5 report: API for customers and staff

Status: done. Backend 1695/1695, frontend 368/368, tsc 1 old error, brand and voice audits 0 violations.

## Files
- `backend/routes/listening.js` (new): `createListeningRouter`, `viewFor`, `staffViewFor`, `staffScore`, `checkLimiter`.
- `backend/server-main.js`: `app.use('/api/listening', require('./routes/listening'))` right after the competitors mount.
- `backend/routes/staff.js`: `GET /clients/:id/listening` (`view_clients`, `clientFor`), `POST /clients/:id/listening/score` (`open_client`, `checkLimiter`, `recordStaffAction`), after the competitors staff routes.
- `frontend/pages/staff/StaffClientPage.tsx`: history label `score_listening: 'Scored their comments now'` (one line).
- `backend/tests/listeningRoutes.test.js`: 25 tests. RED seen first (module missing), then GREEN; mutation checks on kind, the not-enough guard, the per-account row filter and the live-item drop each fail a test.

## Behaviour
- Chain `protect, readLimiter(600/15min per user), requireFeature('inbox'), handler`. The account id comes only from the verified user; query, body, params and headers are ignored (tested). Agency pass and CSM acting: `/api/listening` is not in either block list, same as the Inbox (tested).
- Free: 403 "This is not included in the free plan..."; Starter/Growth without Inbox (and Publish) add-on: standard add-on 403; Agency, managed, legacy: 200.
- Below 20 scored items in the 28 IST-day window: no numbers, no quotes, inbox not read.
- Quotes: public scored pos/neg rows joined to live inbox items fetched `{ _id: {$in}, userId }`; private-ness is re-derived from the live item (`kindOf`), `pickQuotes` runs on the live body (safety filter again, spam from live item). Missing item dropped. Model name, vendor names, reason codes, author fields never returned (`topReason` is a plain word such as "delivery").
- Staff score: `runScorerOnce({ accountIds:[id], force:true, limit:1 })`. Switch, daily batch ceiling, spend guard, lease and pause still apply; counted by the shared batch ledger; audited as `score_listening` with `details.scored`.

## Response shapes (for Task 6)
`GET /api/listening` (200):
```
{ success: true,
  enabled: boolean,                 // ENABLE_LISTENING === 'on'
  state: 'ready' | 'not_enough' | 'waiting',
  message: string | null,           // 'Not enough comments yet to show a score.' (not_enough); 'Nothing is scored yet.' (not_enough and enabled is false and nothing scored); 'Your comments are waiting for the next weekly check.' (waiting); null when ready
  period: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' },   // India days
  asOf: 'YYYY-MM-DD',               // same as period.to
  total: number,                    // 0 unless ready
  counts: { positive, neutral, negative },
  percentages: { positive, neutral, negative },       // whole numbers summing to 100 when ready
  trend: string | null,             // built in code
  topReason: string | null,         // plain word: delivery, price, quality, service, the product, questions
  quotes: [{ id, label: 'positive'|'negative', platform, date: 'YYYY-MM-DD', text }],   // max 3
  recentNegative: [{ id, conversationId, platform, date, preview }],                    // max 5, preview max 80 characters
  lastScoredAt: ISO string | null, lastScoredOn: 'YYYY-MM-DD' | null }
```
Errors: 401 `{success:false,message}`, 403 `{success:false, upgradeRequired:true, reason, feature:'inbox', message}`, 429, 500 generic.
Note: when `enabled` is false but scores older than the switch exist and are >= 20, state is still `ready`; Task 6 should show "as of {lastScoredOn}".

`GET /api/staff/clients/:id/listening`: the same body plus `ledger: { batches (last 28 days), scoredItems, failures (consecutive failed runs), paused (failures >= 3), lastRunAt: ISO|null }`.
`POST /api/staff/clients/:id/listening/score`: `{ success: true, scored, skipped (0|1), busy, disabled }`.

## Concerns
- The brief lists three states and a fixed message; I added `message` variants for "waiting" and "switch off, nothing scored" and the fields `enabled`, `percentages`, `asOf`, `lastScoredOn` (spec asked for asOf/lastScoredOn/enabled).
- Staff `batches` reads `ListeningBatchLog` by `{userId, at}` (default dep, untested against a real database; Task 8). The default `inboxByIds`/`eligibleInbox` queries are likewise only exercised against fakes.
- `recentNegative` previews are not safety-filtered (per brief); the card must be shown only to the owner or scoped staff.
- Erasure of orphaned scores is still Task 7: a deleted item stays in the counts until swept.
