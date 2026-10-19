# Impact map: Inbox, Google reviews, Automatic replies (frontend only)

Written 2026-10-19 before building the ledger item "Tiles with art for Messages and comments, Google reviews, Automatic replies; a sales-style explainer for automatic replies; status chips (Connected, Needs setup, Add-on)". Branch `nebulaa-redesign`. No backend change.

## Ledger items in this area and what this build covers
| Item | This build |
|---|---|
| Tiles with art, status chips | Built: an overview strip of three compact tiles on `/inbox` that also switch between the three parts. |
| Sales-style explainer for automatic replies | Built: a warm gold card with three small art step tiles, shown on the Automatic replies part and when the add-on is missing. |
| Inbox never tested live (`ops/inbox-live-test.md`) | Not buildable here: needs the owner's real accounts after the release. The screens claim nothing beyond what the code keeps; nothing says "tested". |
| Library chips (listed under this area by mistake) | Already done; belongs to Library. Untouched. |

## What depends on it
- Route `/inbox` (`App.tsx`) renders `pages/SocialInbox.tsx`. `?tab=reviews` and `?tab=auto-reply` deep links stay the same (Home "Do this next" links to `/inbox`; the menu item too).
- `UnifiedInbox` (list, approval queue, failed-reply bubble, robot toggle with confirm), `ReviewsPanel` (read-only, copy a drafted reply), `AutoReplySettingsPage` (settings, confirm before Fully automatic) and `ListeningCard` are kept as they are. Their behaviour from commits 39d01ef and 948733b is not changed.
- `components/art` barrel: three existing pieces are reused (`InboxArt`, `ReviewsArt`, `AutoReplyArt`); three small step glyphs are new in `components/art/inbox/` (imported from the piece files, not the barrel), counted by `scripts/art-budget.mjs`.

## Data the page reads (all already available, no new endpoint)
- `GET /api/social/inbox/summary` (gated by the `inbox` entitlement): Instagram and Facebook connected platforms, `inboxStatus`, unread count, `pendingCount`, `aiEngagement.autoReplyEnabled` and `automationMode`. A 403 with `upgradeRequired` means the add-on is missing.
- `GET /api/social/inbox/settings` (same gate): `enabled`, `automationMode`, platforms, channels, channel overrides and own rules. Needed because an own rule with "Reply automatically" sends on its own even when the mode is "Only suggest", so the chip must say On then.
- `GET /api/home/summary` (60 s server cache, database only, no provider call): `connected.platforms` tells whether a Google Business Profile is connected (`gmb`). The Google reviews list itself (`/social/inbox/reviews`) calls the provider, so it is NOT fetched for the overview; it loads only when the owner opens Google reviews, as before.
- Failures: summary fails (not 403) shows a plain "could not load" note with Try again; home summary fails leaves the Google reviews chip out and says "Open to see your reviews" (no guess).

## Status chip rules (pure helpers in `utils/inboxOverview.ts`, tested)
| Tile | Add-on missing | No Instagram or Facebook | Otherwise |
|---|---|---|---|
| Messages and comments | Add-on | Needs setup | Connected (Needs setup when the summary says `needs_setup`) |
| Google reviews | Add-on | (not related) | Connected when `gmb` is connected, Needs setup when not, no chip when unknown |
| Automatic replies | Add-on | Needs setup | On when replies can go out on their own (enabled and Fully automatic, or an enabled own rule that replies automatically, on a platform and kind of message that is switched on); otherwise Off |

Counts line (one line, words then number): "Waiting for your approval 3", else "Waiting for a reply 5", else "Nothing waiting right now"; Google: "Replies ready to copy into Google" or "Connect your Google profile"; Automatic: "Replies go out on their own", "Each reply waits for your approval", "Suggested replies only", "Your rules send some replies".

## Side effects
- The page used to treat a 403 (add-on missing) or any failure as "no connected account" and showed "Connect an account". Now: add-on missing shows the three tiles with Add-on chips, the explainer and one button to the plans page; a failure shows a load error. This is a behaviour change, intended and more honest.
- The plain tab bar is replaced by the tile strip (each tile is a real button with `aria-pressed`); the URL parameter is unchanged.
- The settings page tells the page when it saved, so the Automatic replies chip updates without a reload. The settings are also re-read when the owner switches parts (the robot toggle in the conversation header can change them).
- No change to Home, Layout, menu, billing or the landing page.

## Money and entitlement effects
- Inbox and automatic replies are one add-on (`auto_reply` maps to `inbox` in `backend/config/entitlements.js`). No price or Quark amount is shown on these screens (no "Quarks", "credit", "trial", "7 days").
- Free or Starter without the add-on: Add-on chips, explainer, "See the Inbox add-on" to `/trial-expired` (the plans page used by `UpgradePrompt`). Nothing else is called after the 403.
- Professional with the add-on, Agency (included), Managed (included): normal screens. An agency client workspace uses the same calls under the client context; the server decides access.
- Staff: staff do not open a customer's inbox from the staff screens; nothing changes for staff.

## Data and migration effects
None. Read-only calls only; no writes added. No migration.

## Edge cases
- No connected accounts (with the add-on): Messages and Automatic replies say Needs setup; the Messages part shows the connect card; settings can still be prepared.
- Connected but nothing has arrived: Connected, "Nothing waiting right now"; the list's own empty state stays.
- Add-on missing: see above; no further inbox calls.
- Failed sends: unchanged (the failed-reply bubble and the approval card keep their reason and Try again).
- Automatic replies switched on through the header robot toggle: chip shows On after switching parts or reloading.
- Fully automatic chosen but "Use automatic replies" unticked: Off ("Suggested replies only"), which is what the server does.
- Long counts (over 99): the number is shown as 99+.
- Phone 375 px: tiles become full-width rows about 76 px tall; steps stack as rows. 1280 px: three tiles in one even row; three steps in one row.
- Reduced motion: no art motion, no hover lift.
- Other languages: the page has no translations; long words wrap (`overflow-wrap: anywhere`).

## Wording rules
Plain sentences, no exclamation marks, no em dashes, no vendor names, no Quarks, no "credit", "trial" or "7 days", no promise of results. Replies are drafted for approval by default, sent automatically only when switched on, can be switched off any time. Only Instagram and Facebook. Google reviews are copied into Google by the owner. Nothing says the inbox was tested live, and nothing says it was not (that note is for the owner only).

## Tests
- `tests/inboxOverview.test.mjs`: chip rules for every state above, the counts line, 99+, the explainer wording (no banned words, mentions approval and switching off), and that the step art stays within the art budget rules.
- Existing: `tests/inbox.test.mjs`, `art-budget`, `tiles`, voice and brand audits, `npx tsc --noEmit`.
- Look: audit preview with `?inboxstate=full|empty|nosocials|addon|auto|error` at 1280 and 375, rows measured with `getBoundingClientRect`.
