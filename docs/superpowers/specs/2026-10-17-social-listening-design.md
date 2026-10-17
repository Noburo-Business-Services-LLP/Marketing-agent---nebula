# Social listening, Phase A: what people say about you (Stage 5)

Status: spec for build, 2026-10-17. Owner decision (chat): "go ahead with Stage 5". Scope is Phase A only. Parent: the "Stage 5: social listening" section of `2026-10-17-plan-led-home-design.md`, and its "Cost and limits", "Error handling" and "Testing" sections. Follows the Stage 4 patterns (`2026-10-17-competitor-tracking-design.md`, build records in `docs/superpowers/plan-led-sdd/stage-4/`).

## What this is

Phase A scores the comments and messages that customers' own audiences already sent to the connected account. Those items are already stored by the Social Inbox (`backend/services/socialInboxService.js`, `ingestEvent`, collection `SocialInboxMessage`). No new data is bought, no other person's post is read. The only new cost is one cheap batched model call per account per week.

## Not included

- Phase B, X (Twitter) mentions through the official API: later, owner decision. Not designed here.
- Anything that reads other people's posts or comments on Instagram or Facebook (scraping). Meta is never scraped. Not planned, not "later".
- Reddit, Google reviews, other sources: not in this plan.
- Replying, auto-reply and the Inbox itself are unchanged. The existing keyword rule `analyzeEngagement` (the `sentiment` field on inbox messages) is NOT used for the score: it is a word list (for example "price" counts as positive) and would give misleading numbers.
- No new price and no new add-on in Phase A.

## What the customer sees

A card titled "What people say about you", in two places: on My plan (below the competitor card, `pages/MyPlan.tsx`) and as a section at the top of the Inbox page (`pages/SocialInbox.tsx`, route `/inbox`).

When there is enough data (at least 20 scored items in the last 28 days):
- A split bar with counts: positive, neutral, negative, and the line "Based on 86 comments and messages, 20 September to 17 October."
- One plain trend sentence built by code from the numbers, for example "More negative comments than usual this week: 9 of 21, against 14% over the four weeks before." The trend line is shown only when both the last 7 days (at least 8 items) and the four weeks before (at least 20 items) have enough items and the negative share moved by at least 15 percentage points; otherwise it says nothing or "About the same as the four weeks before." (only when both have enough items and the move is under 15 points).
- Up to 3 quotes, each labelled "Positive" or "Negative", with the platform and the date, for example "Instagram, 14 October". No author names on the card. Quotes come only from public comments, never from private messages.
- A "Recently negative" list (up to 5 items: platform, date, a short preview) where each row links to that item in the Inbox (`/inbox?conversation=<id>`). The Inbox already shows who wrote it; the card does not.

When there is not enough data: the card shows "Not enough comments yet to show a score." with one line: "This card appears once at least 20 comments and messages have arrived in the last 28 days." No numbers, no bar. A score is never invented, estimated or padded.

When the account cannot use the Inbox: nothing is shown on My plan; on the Inbox page the existing add-on prompt applies. When scoring has not run yet but there are enough items: "We are reading your recent comments. The first result appears within a week." (staff can run it sooner, below).

## Entitlement

Who can see it: accounts where `canUse(user, 'inbox').allowed` (`backend/config/entitlements.js`): the Inbox add-on (which also needs the publish add-on), the Agency plan (bundle), and managed accounts. Free accounts, and paid accounts without the add-on, never see it and are never scored. Staff accounts and CSM accounts are never scored.

Owner pricing decision: whether this stays inside the Inbox add-on, moves to the competitor insights add-on, or gets its own price. The data cost is a few paise per 100 comments on a small model (to be measured, see Cost), so Phase A proposes no new price and ships inside the Inbox entitlement. No price is written in code; any future price must derive from `backend/config/apiCosts.js`.

## Scoring method

- Which items: `SocialInboxMessage` rows with `direction: 'inbound'`, `senderType: 'customer'`, `messageType` in `comment`, `mention`, `dm`, `message`, `spamScore` below 50, body 3 to 1,000 characters, `createdAt` within the last 35 days (28 for the card plus 7 of lookback for the trend baseline), not yet scored. The 35-day window means the first run on an old account scores at most the last 35 days of items, newest first.
- One model call per batch of 40 items, through `callTextLLM` (`backend/services/openAI.js`) in JSON mode, with a small model chosen by config (`LISTENING_MODEL`, a cheap-tier model, never the writing model by default; the choice and measured cost are an open item). At most 400 items per account per run (10 batches) and at most one run per account per 7 days.
- The model returns only, per item index, a label (`pos`, `neu` or `neg`) and a reason code from a fixed list (`delivery`, `price`, `quality`, `service`, `product`, `praise`, `question`, `other`). It returns no text, no summary and no score. Anything outside the list is dropped and the item is left unscored (and not retried that week).
- The comment text is data, not instructions: it is passed inside a delimited block, each item cut to 300 characters, and the reply is validated item by item. A comment that tries to instruct the model cannot make the model write anything customers see, and the reply is validated item by item. Inside one batch it can still nudge the labels of other comments in that same batch, which only affects that account's own counts.
- The trend sentence, the counts, the dates and the reason summary ("mostly about delivery") are built by code from the stored labels and reason codes. The model writes no customer-facing sentence.
- Quotes are chosen by code, by rules: public comments only; 20 to 160 characters after trimming; scored in the last 28 days; at most one quote per author and per conversation; first the most recent positive with reason `praise` or `product`, then up to two negatives with the most common negative reason, newest first. A safety filter removes any item that contains an email address, a phone number, a long run of digits (order or account numbers), a web address, an @handle, a street-address pattern, or a word on the abuse and slur list (`config/listening.js`), or whose spam score is 20 or more. If no item passes, the card shows the split without quotes. Text is shown as stored and never edited or paraphrased.

Cost and caps (all numbers in `backend/config/listening.js`, never in code paths):
- `BATCH_SIZE` 40; `MAX_ITEMS_PER_RUN` 400; `RUN_EVERY_DAYS` 7; `MAX_ITEMS_PER_ACCOUNT_PER_DAY` 400; `MAX_BATCHES_PER_DAY` 300 for all accounts together; `ACCOUNTS_PER_PASS` 60 (oldest last run first); `LEASE_MINUTES` 45.
- The model call records its spend with the spend guard under a new action `listening_score` (one unit per batch), priced in `backend/config/apiCosts.js` from new rate keys. It is checked with `spendGuard.check('listening_score')` before each batch, so the staff switch, `AI_KILLED` and the daily AI spend ceiling (`AI_DAILY_SPEND_CAP_USD`) all apply.
- Estimated model cost: 100 comments is about 6,000 input and 1,500 output tokens in two or three batches. On a small model this is a few paise; on the default writing model it would be about Rs 6, which is why the small model is a requirement. The figure is measured with one real call, with the owner's OK, before release.

## Storage

- `ListeningScore` (collection `listening_scores`): `userId`, `inboxItemId` (the `SocialInboxMessage` `_id`), `platform`, `kind` (`public` or `private`), `label`, `reason`, `itemAt`, `scoredAt`, `modelVersion`. Unique index `{ userId, inboxItemId }`. It stores no comment text and no author, so a quote can only be shown by reading the inbox item live; if the item is deleted from the Inbox the quote disappears at once. (No field is named `type`: nested Mongoose keys named `type` break silently, a Stage 4 lesson.)
- `ListeningWeekly` (collection `listening_weekly`): `userId`, `weekStart` (Monday, India time, `weekStartOf` in `services/week/weekMath.js`), `counts { positive, neutral, negative }`, `total`, `reasons` (counts by reason for negatives), `computedAt`. Unique index `{ userId, weekStart }`. Rebuilt from `ListeningScore` after every run, last 8 weeks kept.
- `ListeningBatchLog` (collection `listening_batch_log`): one row per batch ATTEMPT, written before the model call: `userId`, `day` (UTC), `at` (expires after 14 days), `itemIds`, `source`. With an in-process mirror (`services/listening/ledger.js`, same design as `services/competitors/readLedger.js`) so the daily caps and "do not pay twice for the same items" hold even when a save fails or the database is full. Items attempted in the last 7 days are never sent again.
- `User.listeningRunAt` (Date) for fair rotation, like `competitorsReadAt`.
- Single-runner lease: an `OpsState` row `listening_scorer_lease`, same mechanism as `services/competitors/lease.js` (made reusable by taking the key as a parameter).
- Deletion: the account's `ListeningScore`, `ListeningWeekly` and `ListeningBatchLog` rows are erased with the account (`services/dataRegistry.js`, action delete; the registry test fails if one is missing). When inbox items are deleted, `eraseForInboxItems(userId, ids)` removes their scores and rebuilds the affected weeks; the Inbox has no delete path today, so a pass also sweeps scores whose inbox item no longer exists.

## Privacy

Own accounts only: every query is filtered by the signed-in account's `userId`, and every inbox item is read by `{ _id, userId }`. No cross-account data, no benchmarks against other customers. Quotes come only from the account's own public comments. Private messages are scored for the counts but never quoted and never shown outside the Inbox. The model provider receives only the comment text and an index, not names, handles or ids. Agency client workspaces are separate accounts and are scored and shown separately.

## Honesty rules

- Minimum 20 scored items in the last 28 days, otherwise only the "not enough" message.
- Always "based on N comments and messages" and the date range. N is the scored count, not the inbox count.
- Items the model could not label are not counted and not hidden in the total.
- No score is estimated for a thin week; no percentage is shown without its count.
- The trend sentence is only produced under the thresholds above. Every sentence is checked by a test against the numbers it was built from.

## Switches, failure handling

- Off by default: the scheduler starts only when `ENABLE_LISTENING` is exactly `on`, in every environment. Staff "Comment scoring" switch (provider `listening_score` in `services/spendGuard.js`, shown on the staff AI spend screen), plus `AI_KILLED` and the daily ceiling.
- The scorer does nothing for an account without the Inbox entitlement, a paused or frozen account (`services/backgroundGate.js`), a staff or CSM account, or an account with fewer than 20 eligible items in the window (it will not spend money on an account that cannot show a card yet; it waits until the count could reach 20).
- Model error or invalid JSON: the batch is logged as attempted, the items stay unscored, nothing is retried before the next weekly run, the last result stays on the card with its date. Three failed runs in a row pause the account until a new item arrives, and an owner alert is sent once a day at most.
- A failed save never repeats a paid call (ledger above). A dead process is covered by the lease expiry.
- The API never returns a half-built card: it returns the last good weekly aggregate or "not enough".

## Wording rules

Plain sentences per `2026-10-03-nebulaa-app-voice-design.md`: no personification, no exclamation marks, sentence case, "you" and "Nebulaa". Customer-facing text never says Quark, credit, trial or "7 days", never names a vendor or model ("comments and messages", not "scored by AI model X"; "Nebulaa reads and sorts your comments"). The brand-audit and voice-audit scripts must stay at 0 and the layer lists are regenerated.

## Testing

- Pure helpers: batching, label and reason normalisation, aggregation, minimum-data rule, trend thresholds and sentence, quote selection, the safety filter (emails, phones, digits, links, handles, abuse words, private messages).
- Scorer with a fake model: valid reply, garbage reply, partial reply, injection text in a comment, a model that throws, caps (per run, per account per day, global), lease contention, spend guard refusal, switch off, two failed saves do not repeat the paid call.
- API: entitlement refusal, no cross-account data, below 20 shows "not enough", quotes read live from the inbox (a deleted item disappears).
- Registry: deletion coverage test.
- Real-database check (script refuses any database except `nebulaa_dev`, throwaway users and inbox items with the prefix `rdbcheck5-`, a fake model, no AI cost): unique indexes exist, lease, ledger caps survive a failed save, erasure on account delete and on item delete, the API shape on real documents. This check is required for the new models.
- One real model call to confirm cost and label quality only with the owner's OK (a few paise).
- Frontend: helper tests, mock data states and the visual-audit route.

## Open decisions for the owner

1. Pricing home: inside the Inbox add-on (proposed, no new price), or a separate price later.
2. The small model to use and its measured cost per 100 comments (needs one approved real call).
3. Phase B (X mentions through the official API): later, owner decision.
