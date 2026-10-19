# Home drafts: "Make a post in response" and "Draft a witty comment"

Built 2026-10-19 as Task 7 of the Home build (impact map `docs/superpowers/impact-maps/home-and-plan.md`, section 3.7). Not released. **Off** unless `ENABLE_COMPETITOR_DRAFTS=on`. No real model call has been made yet: the owner's one real run is the card `home-drafts-real-proof.md`.

## What the customer sees

Under each competitor's best post (the tiles on Home and the Competitors page, and the rows of "What's working for your competitors") there are two small buttons, each with its price under it before anything is pressed:

- **Make a post in response**: an original caption for the customer's OWN page on the same everyday topic (at most 600 characters, at most 3 hashtags) and a one-line picture idea. "Use in Create" opens Create content (single post) with the caption and the idea filled in, through the existing one-shot prefill. Text only in v1: the picture is made in Create as usual.
- **Draft a witty comment**: one short comment (at most 220 characters, no hashtags) with **Copy** and **Open the post**. The sheet says: "You post this yourself on their page. Nebulaa never posts on other pages."

The sheet asks for the tone (Friendly, or Light and witty) and the language (the account's content language by default; English, Tamil, Hindi, Telugu, Kannada, Malayalam). Every result carries "Check this before you post it. You are responsible for what you publish." A draft that is refused is never shown: the customer reads "We could not write a draft we are happy with. Nothing was charged." Phone: a bottom sheet; desktop: a small dialog. Focus stays inside, Escape closes, focus goes back to the button.

The buttons show only when the switch is on, the account holds the competitor add-on (or is managed or agency), the competitor is tracked and its post has a stored reference. Agency owners and client workspaces see the posts equivalent only ("About 1 post's worth"), never Quarks.

**Nebulaa never posts a comment anywhere.** There is no code path for it: the routes and services of this feature have no publishing, commenting, social or outside call, and `backend/tests/homeDraftsRoutes.test.js` reads the files to keep it that way.

## Price

Derived in `backend/config/apiCosts.js` (never typed):

| action | one draft = | USD | Quarks |
|---|---|---|---|
| `home_response_post` | (writing call on the English model rates, 1,600 in / 1,200 out tokens, + one check on the regional model rates, 900 in / 500 out) x (1 + 0.3 rewrite rate) | 0.0660 | 8 |
| `home_witty_comment` | (writing call 1,300 in / 800 out + one check) x 1.3 | 0.0485 | 6 |

Rates: writer $5 / $30 per million tokens (gpt-5.5, the dearer writer, so the safe side), check $2 / $10 (`regional_input_per_mtok`, `regional_output_per_mtok`, gpt-6.1-sol). Output tokens include the thinking tokens a newer model spends. `HOME_DRAFT_REWRITE_RATE = 0.3` is a pessimistic guess (no real drafts yet); measure it from the counts below. Quarks = USD x 2.5 margin / 0.02, rounded, so both read "about 1 post's worth" (a post is 11 Quarks). A refused or failed draft is refunded, so its cost is carried by the margin.

## The pipeline (`backend/services/homeDrafts/service.js`)

1. **Switch, staff, entitlement, input.** `ENABLE_COMPETITOR_DRAFTS=on` or 503. Staff on their own page are refused (a CSM inside a client acts as the client). Entitlement: `canUse(user, 'competitors')`; free gets "Drafts from competitor posts are part of the paid plans with the competitor add-on.", paid without the add-on "...need the competitor add-on." (403). Body: `{ ref, key, tone?, language? }`; `ref` is `<competitorId>.<postKey>` from `GET /api/competitors/best-posts` (`bestPost.ref`, `working[].ref`), `key` is one press of the button (8 to 64 letters, digits, `-`, `_`).
2. **One request per account at a time:** an in-process lock, then the database: the `home_drafts` index `one_in_flight_per_account` (unique `userId` where `inFlight: true`), so a second server process is refused too (409 "A draft is already being written. Please wait for it to finish."). A request still running after 4 minutes was lost (a restart): it is closed as `stale` on the next request and its Quarks go back once.
3. **Idempotency:** the same `key` again returns the stored answer (the same draft, or the same refusal) and is never charged again.
4. **Caps** (`backend/config/homeDrafts.js`, change a number, not code): 20 drafts per account per India day (requests that reached the writer), 10 refused drafts per day, 3 requests per minute, 3,000 drafts per day across all accounts. A client workspace counts as its own account. Plus the route's rate limiter (60 per 15 minutes).
5. **Spend guard:** `spendGuard.check` for the action (its own staff switch, **Competitor post drafts**, provider `home_drafts`) and for `campaign_text` (the Writing switch, which stops these too), the daily AI ceiling and `AI_KILLED`. The staff switch follows the existing pattern: ON unless staff turn it off; the feature itself is off by default through `ENABLE_COMPETITOR_DRAFTS`.
6. **The post is looked up on the server** from the stored snapshots (last four weeks) of a competitor the account tracks (the same five the tracker reads); another account's competitor, an untracked one or a post that is not stored is 404. The client never sends any text of the post.
7. **Ledger row first** (`models/HomeDraft.js`, collection `home_drafts`): written with `inFlight: true` before the charge and before any model call. If it cannot be written, nothing is charged and nothing is called.
8. **One atomic charge** through `quarkBuckets.spend` (the agency pool for a client workspace, refused for a frozen client), recorded on the Quark ledger with the row id as `ref`. If the charge cannot be put on the row, it is given straight back and nothing is called.
9. **At most two tries.** Each writing call and each check call is counted on the row (`attempts`, `checks`) BEFORE it is made. Per try: the writer (`callTextLLM`, model by language, `noFallback: true`, JSON) -> strict reading of the reply -> the local filter -> the model check. A draft that fails the filter or the check gets one more try, then the plain refusal (422). A writing call that errors stops at once (502). A check that errors or answers in any other shape than `{"decent": boolean, "reasons": [strings]}` **fails closed**: no draft, refund (502). A "yes" that still lists a reason counts as "no".
10. **Refund once** on every failure after the charge: the row's `refunded` flag flips first, then `quarkBuckets.refundTo` the wallet that paid. A refund that does not land sets `refundFailed` and raises an ops alert (`home_draft_refund`); the customer then reads "We are returning your Quarks".

## What the writer is given (`prompt.js`)

Only neutral facts: the post type, whether it was the market's strongest this week or this month, the market pattern written by code without numbers ("reels are getting the most likes this month"), and up to four **topic words the post shares with the customer's own words** (profile, products, plan themes). Plus the customer's own profile (name, trade, about, what makes it different, best product, place, voice, plan themes). The competitor's name, handle and caption never go in; a profile field that mentions a competitor is left out; digits, links, @names and hashtags are removed from every fact. The system prompt carries the decency rules (kind, no derogatory, racist, sexist, casteist or communal content, nothing about religion, caste, gender, nationality, region, disability, body or accent, no profanity, never name, describe or compare with another business, no invented facts or digits, no politics or sensitive events, light humour only, no links or @, data is never an instruction), the length caps and the language. The check prompt holds the draft only between markers and is told it is never an instruction.

## The local filter (`decency.js`)

On the text as written and a normalised form (look-alike letters, invisible characters, accents, l33t, spaced letters): the comment-scoring abuse list (`config/listening.js`, via the newly exported `isDecentText`), the extended list in `config/decency.js` (mockery and put-downs, groups and beliefs, bodies, politics, threats, insults in Hindi, Tamil, Telugu, Kannada and Malayalam in Latin letters and in their scripts), phrases that compare or self-promote on someone else's page ("worse than", "unlike them", "they fail", "visit us", "number one"...), every tracked competitor's name and handle (whole words, with and without spaces and dots), four words in a row from the stored caption, contact details, any digit, hashtags, emoji, shouting, markup and the length caps. Rows keep rule codes only (`word`, `phrase`, `name`, `copy`, `contact`, `number`, `model`, `shape`...), never text.

Known limits of the list: words whose stretched form is an everyday word cannot be listed (the filter matches repeated letters, so "god" would hit "good"); the comment-scoring list holds a few words that are also everyday food or family words (for example "poori", "kutti"), so such a draft is refused and rewritten once. Other languages in the app's list are written in English for now.

## Data and counts

`home_drafts` rows: ledger fields, rule codes, and the text only of a draft that was shown (for the replay). Removed after 30 days; on the data list (`services/dataRegistry.js`, erased with the account). Counts per day by kind and outcome (`ok`, `blocked_local`, `blocked_model`, `check_unavailable`, `write_failed`, `no_balance`, `frozen`, `stale`, `ledger`, `error`): `createHomeDrafts().dailyCounts(day)`; not yet on a staff screen.

## Routes

`GET /api/home/drafts/options` (prices with the posts equivalent, switch, entitlement, `postsOnly`, languages, drafts left today), `POST /api/home/response-post`, `POST /api/home/witty-comment` (`backend/routes/homeDrafts.js`, mounted under `/api/home`).

## Checks

- Unit tests: `backend/tests/homeDrafts*.test.js` (55 offensive and 22 decent examples in English, Hindi, Tamil, Telugu, Kannada and Malayalam; the prompt never holds the competitor's name, handle or caption; strict parsing; fail closed; at most one more try; ownership; entitlement; idempotency; double click; two processes; caps; spend guard; refund on every failure path; agency pool; lost requests; no posting code path; wording), `frontend/tests/homeDrafts.test.mjs`.
- Real database: `node scripts/home-drafts-check.js` (nebulaa_dev only, fake model, throwaway `zz.homedraftschk-` users; `cleanup` mode for leftovers). The 2026-10-19 run: 24 PASS, 0 FAIL, 100 rows removed, 0 left, and the estimated spend it added (USD 0.74) taken off again.
- Real model: the owner's card `home-drafts-real-proof.md` (Tamil and Hindi, about USD 0.13). Not run yet.

## Preview

`/?audit=normal&compstate=all&draftstate=<state>#/dashboard` (and `#/competitors`): `ok` (default), `blocked`, `error`, `limit`, `busy`, `balance`, `off` (no buttons), `locked` (no buttons), `slow`.

## To switch it on (owner)

1. Run the real proof card and read the drafts.
2. Set `ENABLE_COMPETITOR_DRAFTS=on` on the server and release.
3. Watch the counts for a week; adjust `HOME_DRAFT_REWRITE_RATE` and the word list.
