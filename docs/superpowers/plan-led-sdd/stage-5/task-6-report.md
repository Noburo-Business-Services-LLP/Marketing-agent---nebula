# Task 6 report: card on My plan and the Inbox page

Status: done. Frontend 382/382 (368 + 14 new), tsc 1 old error (Influencers.tsx), brand-audit 0, voice-audit 0, layer lists unchanged. Backend untouched.

## Files
- New: `frontend/utils/listening.ts`, `frontend/components/ListeningCard.tsx`, `frontend/tests/listening.test.mjs` (RED seen first: module missing; GREEN after).
- Modified: `services/api.ts` (`getListening`, 403 -> `{ locked: true }`), `types.ts`, `pages/MyPlan.tsx` (card after both competitor placements, `showListening`), `pages/SocialInbox.tsx` (card above the list on the messages tab, `showRecent`; tab row got `overflow-x-auto`, it overflowed 375 px before), `pages/UnifiedInbox.tsx` (reads `?conversation=<id>` so the Recently negative links open that conversation), `scripts/visual-audit/mock-session.js` (`?listenstate=ready|notenough|off|error|locked|empty|waiting`, and the inbox summary mock now reports 2 connected accounts so the page renders), `routes.json` (`inbox`, `my-plan-listening`), `tests/voice-scope.json`.

## Decisions
- Server states are `ready|not_enough|waiting`; "never scored / switch off" is a `not_enough` with the API message "Nothing is scored yet." (shown as the headline). `enabled:false` with a ready score shows "As of <day>." after the Based-on line.
- Locked: Inbox page renders nothing (already gated); My plan shows the calm line "Comment insights come with the Inbox add-on. See plans." with a link to `/trial-expired`. The brief said "nothing" on My plan, your instruction said the note; I followed the instruction (prop `lockedNote`). One-line change if you prefer nothing.
- Bar: three segments (accent / muted / striped coral), `role="img"` with a full text alternative, and a visible table (Kind, Comments, Share) as the fallback; colour is never the only signal. Server percentages are used when they sum to 100, else computed (largest remainder).
- `recentNegative` links appear only on the Inbox page (`showRecent`).
- Year is added to the date range only when it crosses a year.

## States verified (127.0.0.1:3101, my own server, stopped afterwards)
All seven states on `/plan` and `/inbox` at 375 and 1280 (text, no sideways scroll, no overflow inside the card), locked shows nothing on Inbox and the note on My plan, error retry button works, recent-negative links point to `#/inbox?conversation=<id>`, a long unbroken string wraps. Contrast audit (`__auditRoute`) inbox and plan at 375: 0 failures, 0 unknown. At 1280 each shows 1 failure: the shell avatar chip "S" (4.5 vs 4.5 rounding), not part of this change. Screenshots: `scratchpad/stage5-shots/` (375 inbox: off, notenough, error, locked, empty, waiting; 1280: inbox ready, empty, waiting, plan ready, notenough, off, error, locked). 375 plan and ready screenshots were checked live, not saved as files.

## Unverified
- Real backend responses (mock mirrors the Task 5 shapes; trend wording copied from `trendSentence`).
- The link target selects the conversation only when it is in the loaded list (first page, current filters).
- Dark mode not checked.
