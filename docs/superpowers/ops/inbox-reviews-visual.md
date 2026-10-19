# Inbox, Google reviews and Automatic replies: how the screens look and behave

Built 2026-10-19 on branch `nebulaa-redesign` (second pass; first pass in `impact-maps/inbox.md`, this pass in `impact-maps/inbox-reviews.md`). Not released. Nothing here has run against a real Instagram, Facebook or Google account; the owner's live test is `ops/inbox-live-test.md`.

## Where things are
| Piece | File |
|---|---|
| Page, part tiles, notes per state | `frontend/pages/SocialInbox.tsx`, `frontend/components/inbox/InboxOverview.tsx` |
| Conversations (rows, thread, reply sheet) | `frontend/pages/UnifiedInbox.tsx` |
| Replies waiting for approval | `frontend/components/PendingApprovals.tsx` |
| Google reviews | `frontend/components/ReviewsPanel.tsx` |
| Automatic replies settings (mode tiles) | `frontend/pages/AutoReplySettingsPage.tsx` |
| Rules for tiles and the explainer (tested) | `frontend/utils/inboxOverview.ts`, `tests/inboxOverview.test.mjs` |
| Rules for rows, chips, states, reasons (tested) | `frontend/utils/inboxView.ts`, `tests/inboxView.test.mjs` |
| Styles (plain CSS, light theme only, brand gold) | `frontend/components/inbox/inbox.css` |
| Small glyphs | `frontend/components/art/inbox/` (Connect, Careful, Run, Live, Stars; each under 2 KB) |
| Platform marks | `PlatformMark` from `components/plan/PlanMarks.tsx` (simple generic glyphs, not copies of logos) |

## What the owner sees
- **Three part tiles** (one even row on a computer, short rows on a phone): Messages and comments, Google reviews, Automatic replies. Each has a status chip in words (Connected, Needs setup, Add-on, On, Off) and one line from real data: replies waiting for approval, conversations waiting for a reply, when the last message arrived ("Last message 12 min ago"), or what to do next ("Switch on live updates").
- **Messages and comments**: the approval list as compact rows (who, where, their message, why it waits in plain words, the drafted reply to edit, Approve and send, Discard; hidden when nothing waits), then the conversations: compact rows with an initials avatar and the Instagram or Facebook mark, the kind (Comment or Direct message) and Importance or Mood chips only when the server's guess is not the default. The thread shows bubbles (theirs white, yours cream and gold, a failed one peach with the reason and Try again) and a cream and gold reply sheet with the suggestions as chips at every width. On a phone the list shows first and a conversation opens over it with Back to list. "What people say about you" now sits below the conversations.
- **Google reviews**: a rating summary only when the provider sends both numbers, then one row per review: who, stars, date, text, and beside it the reply on Google, or the drafted reply with Copy, or Draft a reply. Nothing is posted to Google from here.
- **Automatic replies**: the warm gold explainer with a "Set up and ready to test" badge and three step tiles, then the settings with the mode as three choice tiles (Only suggest, Ask me first, Send on its own; choosing Send on its own still asks first).

## States (each has its own note; preview names in brackets)
| State | What shows |
|---|---|
| Add-on missing (`noaddon`) | Add-on chips, a calm note with See plans, the explainer. Inside an agency client or with a staff pass: no button, the note says the owner can add it from their plans page. |
| Nothing connected (`notconnected`) | Connect Instagram or Facebook with the two marks and Connect an account; Google reviews say Connect your Google Business Profile. |
| Live updates not on or failed (`syncfailing`) | Needs setup chip, a warm note with Switch on live updates or Try again (it runs the existing registration and reads the summary again). The stored conversations still show under it. |
| Nothing yet (`empty`) | "Nothing here yet" with what will appear: comments, direct messages, replies waiting for you. |
| Full (`full`), reviews (`reviews`), automatic on (`autoreplies`) | The screens above. |
| Could not load | The page note with Try again; Google reviews have their own "We could not load your reviews". |

Preview: `cd frontend && AUDIT_PORT=3101 npx vite --config scripts/visual-audit/vite.audit.config.mjs`, then `http://127.0.0.1:3101/?audit=normal&inboxstate=<state>#/inbox` (add `?tab=reviews` or `?tab=auto-reply` after `#/inbox`). Old names still work: quiet, auto, nosocials, addon, error.

## Honest wording until the live test passes
`INBOX_LIVE_PROVEN` in `frontend/utils/inboxOverview.ts` is `false`. While it is false the explainer says Nebulaa "is set up to read" comments and messages and "draft a reply", shows the badge "Set up and ready to test", and the Automatic replies tile says "Set to send on its own" instead of "Replies go out on their own". After Tests 2, 3 and 5 of `ops/inbox-live-test.md` pass, a developer sets it to `true` (the tests cover both wordings). No screen says the Inbox was tested, and no screen says direct messages work.

## Rules kept on these screens
- Light theme only; no dark panels; brand gold (#F5A623 with #1A1208) for the one main button; brown ink text; every text and background pair at least 4.5 to 1 (tested).
- Equal-height rows with no gaps: the three tiles, the three mode tiles and the three step tiles share one row each; approval rows and review rows are two equal columns from 760 px of room, one column below.
- Focus rings (#7A4A00, 3 px) on every button, field and choice tile; the mode tiles are real radio buttons; avatars and marks are decorative.
- No sideways scroll at 375 px (measured on every state); long words wrap.
- Motion only without reduced motion (tiles' art, step glyphs, the welcome list, the newest bubble).
- Wording: plain sentences, no vendor names, no Quarks, no "credit", "trial" or "7 days", no exclamation marks.

## Backend facts the screens rely on (phase 3 of this pass)
- `GET /social/inbox/summary`: `liveUpdates` ('on' after a successful registration, 'failed' when only failed tries are recorded, otherwise 'off'), `reviewsConnected`, and `inboxStatus` 'active' only when live updates are on. Registration is recorded by `registerInboxWebhook` (`ayrshare.inboxWebhookAt`, `ayrshare.inboxWebhookError`).
- `GET /social/inbox/reviews`: `connected: false` without a provider call when no Google profile is stored; `loadFailed: true` when a connected profile's reviews could not be read.
- `GET /social/inbox/conversations/:id/messages`: `ai.suggestionsSource` is 'drafted' or 'general' (the general replies are used when the writing service was unavailable; they are never sent automatically and wait for approval instead).
- Real-database check: `node backend/scripts/inbox-view-check.js` (nebulaa_dev only, no provider or model call): 8 of 8 on 2026-10-19.

## Conversations panel, third pass (owner, 2026-10-19: "so ugly and cramped, difficult to understand")

- List 300 to 380 px wide (the thread takes the rest), rows of at least 76 px with a two-line preview, an unread dot on the left and a bolder name, the selected row in soft gold with a gold edge.
- Filter bar with labels: **Show** (All, Needs reply, Important; a segmented control) and **From** (All, Instagram, Facebook; chips with the platform marks). Needs reply asks the server for unread conversations; Important asks for high and urgent (`priority=important`, `priorityFilter` in `backend/services/socialInboxService.js`, unknown words ignored). On a narrow list the labels sit above the chips. The old Read and Replied choices are gone (Needs reply covers the work).
- Thread header on one calm row: picture, name, then "@handle · Instagram · Comment" and only real mood or importance chips; Automatic replies is a labelled switch (`role="switch"`) that reads On or Off, and turning it on still asks first.
- Suggested replies: a wrapped list of full-width cards with "Use this" (or "In your reply box"); nothing scrolls or clips sideways. The reply box is larger (at least 96 px, can be made taller).
- Empty thread: the inbox drawing, "Pick a conversation to read it here" and what opening one shows.
- The developer "Simulate" button is no longer on any customer screen: only a development build opened with `?devtools=1` shows "Add a test comment" (the backend route is 404 in production).
