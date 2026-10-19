# Impact map: Inbox, Google reviews, Automatic replies (second pass, 2026-10-19)

Written before building, under the area-complete rule. Branch `nebulaa-redesign`. The first pass (`impact-maps/inbox.md`) added the three part tiles and the explainer; this pass makes the three screens themselves appealing, makes every state honest, and fixes the backend gaps found while reading the code. Nothing here has run against a real Instagram, Facebook or Google account: the live test is the owner's (`ops/inbox-live-test.md`).

## Ledger items in this area and what this pass covers
| Ledger item | This pass |
|---|---|
| Tiles with art, status chips, sales-style explainer (DONE in pass 1) | Kept. Tiles now also show the last time a message arrived; chips stay in words (Connected, Needs setup, Add-on, On, Off). |
| Inbox has never been tested live | Not buildable: needs the owner's accounts after the release. Wording is changed so no screen claims that replies or automatic replies have worked (see "Ready to test" below). |
| Library chips (listed here by mistake) | Belongs to Library, already done. Untouched. |
| Landing page inbox claims (LANDING item: hold until the live test passes) | Untouched; still held. |
| This brief: messages list rows, platform marks, honest chips, welcoming empty states per state, reply sheet in brand colours, Google reviews look, Automatic replies settings look, phone, mock states | Built in phase 2. |

## What depends on it (unchanged contracts)
- Route `/inbox` with `?tab=reviews` and `?tab=auto-reply`, and `/inbox?conversation=<id>` (links from the "What people say about you" card on My plan). Home "Do this next" and the menu link to `/inbox`. `/connect-socials/inbox` redirects to `/inbox`.
- `ConnectSocials.tsx` calls `POST /social/inbox/webhooks/register` after each connect (three places). Phase 3 makes that call record its result; the call itself is unchanged.
- `ListeningCard` (Stage 5 listening) sits on the Inbox page; it is moved below the conversations, its behaviour is unchanged.
- Staff screens read `access.inbox` and `access.autoReply` only; no change.
- `PendingApprovals`, `InboxConfirmDialog`, `UpgradePrompt`, `utils/inbox.ts` helpers keep their behaviour; they gain styling and plain-word reasons.

## What it changes elsewhere (side effects)
- `GET /social/inbox/summary` gains `liveUpdates` ('on', 'off', 'failed') and `reviewsConnected` (boolean). The page stops calling `GET /home/summary` when `reviewsConnected` is present (one fewer request; Home is not affected).
- `inboxStatus` becomes `needs_setup` for a connected account whose live updates were never switched on or failed. **Every account connected before this release will show "Needs setup: switch on live updates" once**, with a button that runs the existing registration. This is the truth: those connections must be registered again (already noted in `ops/inbox-live-test.md`).
- `GET /social/inbox/reviews` no longer calls the provider when no Google Business Profile is connected, and a provider failure is reported as a failure (`loadFailed: true`), not as "not connected".
- `POST /social/inbox/dev/ingest` and `/dev/test` answer 404 in production (the developer-only Simulate button already exists only in a development build).
- A drafted reply made while the writing service was unavailable is held for approval instead of being sent automatically.

## Entitlement and add-on effects
- Inbox and automatic replies are one add-on (`auto_reply` maps to `inbox` in `backend/config/entitlements.js`); Agency and Managed include it. No prices, no Quarks, no "credit", "trial" or "7 days" on these screens.
- Replies are DRAFTED for approval by default. Automatic sending happens only when the owner switches it on (confirm dialog, `confirm: true` on the server) or when an own rule says "Reply automatically" on a switched-on platform and kind of message.
- Add-on missing (403 with `upgradeRequired`): three tiles with "Add-on" chips, a calm note per part and the explainer; one "See plans" button to `/trial-expired`. **Inside an agency client or a staff (CSM) pass the button is hidden** and the note says the Inbox is not part of this account's plan (the person working there cannot buy for the client).
- The messaging add-on of the publishing provider was inactive at last check: direct messages may not arrive at all. The screens never promise direct messages work; the Messages tile says "Comments and direct messages" only as what the list holds.

## Data and migration effects
- `User.ayrshare` gains `inboxWebhookAt` (Date, null) and `inboxWebhookError` (String, '') written by `registerInboxWebhook`. Defaults only; no migration; old users read as "never registered".
- `SocialInboxMessage.ai` gains `draftSource` ('ai' or 'fallback'). Old rows have none and are treated as drafted.
- No index change (no new query shape on large collections; `User` writes are by `_id`).

## Edge cases and what each shows
| State | Messages and comments | Google reviews | Automatic replies |
|---|---|---|---|
| Add-on missing | Add-on note, See plans (hidden in agency client or CSM pass) | Same | Explainer with See plans |
| No Instagram or Facebook connected | Connect tile with the Instagram and Facebook marks, Connect an account | Unaffected (depends on Google only) | Needs setup, settings can still be prepared |
| Connected, live updates never switched on or failed ("sync failing") | Needs setup chip, a warm note "Live updates are not on yet" with Switch on live updates (or "could not be switched on" with Try again); the list still shows anything stored | Unaffected | Unaffected |
| Connected, nothing yet | Illustrated "What will appear here" (comments, direct messages, replies waiting for you) | n/a | n/a |
| Full | Approval rows, compact conversation rows, thread, reply sheet | Rating summary from the provider (only when it sends one), review rows with a drafted reply to copy | Settings with three choice tiles for the mode |
| Google not connected | n/a | Connect note (Connected accounts) | n/a |
| Google connected but reviews could not load | n/a | "We could not load your reviews" with Try again | n/a |
| Google connected, no reviews | n/a | "No reviews yet" with what will appear | n/a |
| Summary fails | Could not load, Try again | Same | Same |
| A send fails | Failed bubble with the plain reason and Try again (unchanged) | n/a | Failed automatic sends are marked failed, never retried (unchanged) |
| Agency client / CSM pass | Same screens; only the See plans button is hidden | Same | Same |
| Staff (own account) | Staff do not use the customer Inbox; unchanged | | |
| Phone 375 px | Tiles as full-width short rows; list first, the thread opens over it with Back to list; suggestions shown as chips above the reply box (they were hidden below 1280 px before) | Rows stack | Mode tiles stack |
| Other languages | Page text is English (no translations exist for these screens); long words wrap; drafted Instagram and Facebook replies now follow the language of the person's message (prompt rule); Google drafts already did | | |
| Reduced motion | No art motion, no hover lift | | |

## Promises the screens make that the code did not keep (found in phase 1)
1. **"Connected" and "New comments and messages arrive on their own"** were shown whenever a profile key existed. Nothing recorded whether the webhook registration ever succeeded, and existing connections were never registered. Fix: record the result, show Needs setup and a button until it succeeds.
2. **Google reviews "not available yet"** was shown for every provider failure, including a temporary error for a connected profile, while the tile said "Connect your Google profile" or "Connected". Fix: separate not connected, failed, and empty.
3. **Explainer and tile wording stated automatic replies as working** ("Nebulaa reads each new comment ... writes a reply", "Replies go out on their own"). None of it has run live and direct messages depend on an inactive add-on. Fix: "set up and ready to test" wording behind one switch (`INBOX_LIVE_PROVEN = false` in `utils/inboxOverview.ts`), flipped only after the owner's live test.
4. **A canned generic reply was sent automatically when the writing service failed**, and the canned suggestions were labelled "Suggested reply" (one said "This is available", inventing stock). Fix: hold fallback drafts for approval, no stock claim, label them "Quick replies to start from".
5. **Mood "Neutral", "Looks like spam 4%" and "Importance Normal"** were shown as if measured; they are keyword guesses with default values. Fix: show a Mood or Importance chip only when the guess is not the default, spam only when it looks like spam.
6. **Suggested replies were invisible below 1280 px** (the side panel is `xl` only), so on a phone the owner never saw them. Fix: suggestion chips above the reply box at every width.
7. **Developer endpoints worked in production** (`/dev/ingest`, `/dev/test`): any Inbox customer could add made-up conversations, each one running a model call and, with automatic replies on, a real send attempt to a made-up person. Fix: 404 in production.
8. **Internal reasons shown to the owner** ("Approval required mode", "Negative sentiment requires approval") on approval cards, and alert titles like "New dm on instagram". Fix: plain words in the page.
9. **No language rule** in the Instagram and Facebook reply prompt: a Tamil comment could get an English draft. Fix: reply in the language of the latest message.
10. **The "Live" pill** means this page's own connection to Nebulaa, not to Instagram. Fix: label "Updating live" with a plain title.
Not fixed (stated reason): Google review drafts are free model calls with no daily cap (about USD 0.001 each; adding a cap or a price is a paid-feature decision for the owner). Comment replies under the comment and direct messages are fixed in code (pass of handover 13) but unproven live.

## Tests
- Frontend (TDD, pure helpers): `utils/inboxOverview.ts` (live-proven wording, last-message line, add-on note inside a client pass, reviews tile from the summary), new `utils/inboxView.ts` (conversation row view: initials, platform mark key, chips only from real non-default data, plain approval reasons, alert titles, review summary, empty-state choice per state), contrast pairs and symmetry in `inbox.css`, art budget for any new glyph.
- Backend (fakes only): dev routes 404 in production; reviews route states (not connected without a provider call, failed, connected); registration result recorded and summary `liveUpdates`/`inboxStatus`; fallback draft held for approval and never auto-sent; no stock claim in canned text; language rule in the prompt; `draftSource` on stored drafts.
- Real database (`backend/scripts/inbox-view-check.js`, `nebulaa_dev` only, throwaway `zz.` user, provider stubbed): registration fields written and read back by the summary; reviews context finds Google; cleanup.
- Look: audit preview `?inboxstate=full|empty|notconnected|noaddon|syncfailing|reviews|autoreplies` (old names kept) at 1280 and 375, rows measured, no sideways scroll; brand, voice and art-budget audits; `npx tsc --noEmit`.

## Build order
1. This map (commit).
2. Frontend helpers with tests, then components: overview tiles line, honest explainer, notes per state, conversation rows and thread and reply sheet, approval rows, reviews panel, settings choice tiles, mock states, look at 1280 and 375 (commit).
3. Backend fixes with tests, then the real-database check (commit).
4. Docs: `ops/inbox-reviews-visual.md`, ledger lines, `ops/inbox-live-test.md` updates (commit); `frontend/index.html` from `gen-layer-lists.mjs` last, separately.

## Decisions with recommended defaults (built with the default; the owner can change them)
1. **Wording until the live test passes**: "set up and ready to test" style, one switch to flip afterwards. Default: on (cautious wording).
2. **Old connections**: show Needs setup with Switch on live updates until registration succeeds. Default: yes.
3. **Fallback drafts** (writing service unavailable): held for approval, never sent automatically. Default: yes.
4. **Google review drafts**: stay free with no cap for now. Owner decision whether to cap (for example 30 a day) or price them.
5. **Order on the Messages part**: approvals, conversations, then "What people say about you". Default: this order (the work first).
6. **Preview state names**: the brief's names plus the old ones as aliases. Default: keep both.
