# Impact map and build plan: CALENDAR, LIBRARY and VIDEOS (tiles, month hero, style chips)

Written 2026-10-19 on branch `nebulaa-redesign`, before the code. Inputs read: `OWNER-REQUESTS-LEDGER.md` (rules at the top; areas Calendar, Videos, Create content; the Library line under Inbox), `ops/tile-system.md` (tile system, compact rule, symmetry rule, art budget, no dark panels), `HANDOVER-nebulaa-redesign-16.md` "Visible design rules", and the code listed below. Frontend only: no backend change, no new API, no new asset file.

Area-complete rule: every open ledger item of the three areas is covered here or stated as left out with a reason (section 8).

## 0. The short version

1. **Calendar**: a month hero at the top of the Plan tab (cover picture or the built-in cover, "<Business>'s <Month> posts", theme title and summary, counts of planned, approved and published days, one primary button) and a "What this plan was built from" card of small tiles, both drawn from stored calendar fields only. The month cards become equal-height tiles in filled rows. Everything on the classic page moves to the light cream theme (no `#141414`, black scrims, slate or white-on-dark classes left).
2. **Library**: every item is a tile with one picture height, a source chip and a status chip in words, and Open (and Edit where it exists) actions revealed on hover and focus (always visible on touch screens). Rows are equal height and filled (`fillRows()` spans by the grid's real column count).
3. **Videos**: category chips (All, Ads, Stories, Social, Explainers) above the 22 style tiles, grouping defined in one pure helper (`utils/videoStyleGroups.ts`, tested). Each style tile becomes the shared `VideoStyleTile` with a hover and focus preview: the existing photo enlarges slightly and the one-line hint shows in full over it. No autoplay, no new image. The same tile is reused in the old studio at `/reels/studio` and in Hero Studio's picker.

## 1. What exists and what each change touches

| Piece | Today | Change | Side effect to watch |
|---|---|---|---|
| `pages/CalendarHome.tsx` | Plan and Schedule tabs (dark-era translucent pill), a Blueprint promo card, then `ContentCalendar`. | Light pill (the cream tokens), Blueprint card kept but compact. | Both tabs stay mounted (kept). |
| `pages/ContentCalendar.tsx` | List view: GravityHero, language select, "Generate Next Month Plan", focus field, month cards (dark `#151515` cover box, black scrim, white text classes the override layer repaints). Detail view: dark banner, toolbar, three tabs, drafts grid in `slate-900`. | List view: month hero for the current (or newest) month, plan inputs card, "Plan next month" tile row (language, focus, button), month cards as tiles in filled rows. Detail view: the same hero replaces the dark banner (cover button kept), toolbar in light classes, drafts grid in tokens. | Every handler and API call is kept as is (generate next, regenerate, approve, auto generation switch and limit, cover request, week content, item edits). Cover polling (6 s while pending) kept. |
| `components/calendar/CalendarCover.tsx` | Built-in cover in deep brown-black with gold lines (commits 0052818, ac28a05). | Adds a `tone="light"` (cream to soft gold, gold lines, brown ink month) used on the light pages; the dark tone stays available. Fallback and image-error logic untouched. | `calendarPlan.test.mjs` cover tests unchanged. |
| `utils/calendarHero.ts` (new) | n/a | Pure: hero title, counts, current month pick, plan inputs from stored fields, the primary action. | Tested in `tests/calendarHero.test.mjs`. |
| `pages/Library.tsx`, `utils/library.ts` | Square tiles in a 2/3/4 grid, status chip only, open by clicking the whole tile. | Tiles with a fixed picture height, source and status chips in words, hover/focus actions, `fillRows()` spans. New pure helpers `SOURCE_WORD`, `libraryTileActions` in `utils/library.ts`. | Filters, polling, the post sheet, the Hero panel, delete and edit routes all kept. |
| `pages/CreateVideo.tsx` | 22 photo tiles in a 2/4 grid, phone shows 8 with "Show all". | Category chips above; the grid shows the chosen category; tiles are `VideoStyleTile`; rows filled. The chosen style stays chosen when its category is hidden (a "Chosen" line names it). | `orderStyles`, `visibleStyles`, remembered choices, the request body (`style`) unchanged. |
| `components/video/VideoStyleTile.tsx` and `videoStyles.css` (new) | n/a | Shared tile and chips. | Plain CSS, motion only under `prefers-reduced-motion: no-preference`. |
| `pages/ReelGenerator.tsx` (`/reels/studio`, and `/reels?jobId=`) | Its own style grid (same 22 photos). | Renders `VideoStyleTile` with the same click handler (Storytelling still sets strict character consistency). | Only the tile markup changes. |
| `components/HeroStylePicker.tsx` (`/reels/hero`) | Own cards, roving focus with arrow keys, 3:4 photos. | Renders `VideoStyleTile` (forwarded ref, tab index, key handler and label passed through). | Roving focus kept. |
| `scripts/visual-audit/mock-session.js` | One October plan calendar. | `?calstate=` variants for the preview only (section 6). | Audit only, never in a build. |

## 2. Money and entitlements

- No price, charge or allowance changes. No new paid call. "Plan next month" is the existing `POST /content-calendar/generate-next` (no Quark charge in the route today); "Make week N posts" is the existing `auto-generate-week` (queued in the background, one call per 10 minutes per account; whatever the queue charged before it still charges, nothing new). Cover requests keep their daily cap and free retries.
- The hero's primary button follows the stored state only: not approved: "Approve this month" (free); approved: "Make week N posts" (the existing week button, moved into the hero); in the list: "Open <Month>" (free).
- Free accounts: Calendar is reachable today; nothing new is unlocked or locked. Agency client workspaces and managed accounts see their own calendars (route scoped by `req.user`). Staff do not use this page.
- Videos chips are a view filter: the style sent and its price are unchanged. No Quark wording added; the Videos page keeps its posts-and-videos price line.

## 3. Data

- Read only. Hero and inputs use stored fields: `businessName`, `month`, `themeTitle`, `themeSummary`, `coverImageUrl`, `coverStatus`, `language`, `businessVertical`, `niche`, `approved`, `autoGenerate`, and per item `status`, `format`, `contentPillar`, `productNeeded`, `objective`.
- "Goals" are the distinct item objectives (awareness, engagement, leads, sales, community). "Products" are the distinct `productNeeded` values. "Content pillars" and "Formats" come from the items with counts.
- **Festivals are not shown**: the plan prompt asks the model to include festivals, but nothing about festivals is stored on the calendar, and the monthly focus typed by the customer is not stored either. Showing them would be invented. Left out with this reason.
- No migration, no index.

## 4. Edge cases

| Case | What the screen does |
|---|---|
| No calendar yet | Hero shows the built-in cover for next month, "Plan <Business>'s <Month> posts", a one-line explanation and the "Plan next month" button; no inputs card, no month grid. |
| Calendar generating (the request is running, about 30 to 60 s) | Hero switches to a "Planning <Month>" state with a calm progress line instead of the old full-page spinner; buttons disabled. |
| Cover pending | Built-in cover with the small spinner, "Making the cover" note, polling kept. |
| Cover failed or broken link | Built-in cover (existing fallback and retry kept); the cover button says "Make a cover". |
| Calendar with no theme | Hero uses "<Month> plan" and skips the summary line. |
| Items with empty pillars or products | The tile says "Not set in this plan" instead of hiding, so the card keeps its shape. |
| Business name missing | "Your <Month> posts". |
| Long names or Tamil, Hindi text | Titles wrap to two lines then clamp; tiles keep equal heights. |
| Phone (375) | Hero stacks (cover on top, short), counts in a three-up row, inputs tiles two columns, month cards one column; Library two columns; style chips scroll sideways inside their row. |
| Library: item being created | Tile shows the timer, no actions; failed items say "Did not finish". |
| Library: one source fails | Existing note kept; tiles fill rows with what loaded. |
| Videos: style list fails | Fallback two styles are both in a group, chips show only groups with styles. |
| Videos: unknown new style key from the server | Goes into All only (no chip invented). |
| Videos: chosen style in a hidden category | Still selected and sent; "Chosen: <label>" shows beside the Look heading. |
| Reduced motion | No enlarge, lift or slide; the hint still appears on hover and focus. |

## 5. Tests and checks

- New: `tests/calendarHero.test.mjs` (title, counts, month pick, inputs, action), `tests/videoStyleGroups.test.mjs` (all 22 keys grouped exactly once and the grouping matches the server list, filter, counts, unknown keys), additions to `tests/library.test.mjs` (source words, actions).
- Run: `node --test tests/*.test.mjs`, `npx tsc --noEmit` (only the old Influencers.tsx error), `node scripts/brand-audit.mjs`, `node scripts/voice-audit.mjs`, `node scripts/art-budget.mjs`.
- Look: audit preview on port 3103, `#/content-calendar`, `#/library`, `#/reels`, at 1280 and 375, rows measured with `getBoundingClientRect`.

## 6. Preview states (audit server only)

`?calstate=` ready (default: October plan, partly approved, real cover link), none (no calendar), pending (cover being made), failed (cover failed, built-in cover), generating (the generate request answers after 6 s), empty (calendar with no theme and empty pillars). Kept for the tab like the other states.

## 7. Build order

1. This map. 2. Pure helpers and tests. 3. Calendar hero, inputs card, light theme, month tiles. 4. Library tiles. 5. Video style tile, chips, reuse in the studio and Hero. 6. Look and measure, audits, commits (3 to 4, own files only).

## 8. Ledger items of these areas and what happens to each

- Calendar month hero and plan inputs card: built here.
- Calendar cover fallback, retry: kept (not changed beyond the light tone).
- Cover cost decision: still open (owner).
- Videos: "Video styles shown as visual tiles everywhere videos are chosen": built for Videos, old studio and Hero Studio.
- Videos: Hero Studio's richer style rules and adding it to the menu: DECISION NEEDED (owner), not touched.
- Videos: subtitles on a real 30 s video: needs the owner's paid OK, not touched.
- Library compact filter row: kept as is.
