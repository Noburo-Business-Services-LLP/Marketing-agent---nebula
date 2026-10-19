# Tile system and illustration set

Built 2026-10-18 on branch `nebulaa-redesign` (foundation of the visual refresh, design draft `docs/superpowers/specs/2026-10-18-visual-refresh-and-photoshoot-design.md`, sections 3 and 8 phase 1). Not released.

## What exists

| Piece | File |
|---|---|
| Tile (a real link or button with picture, title, one line, footer, badge, arrow) | `frontend/components/Tile.tsx` |
| Responsive grid (1 column under 640 px, 2 up to 1024 px, 3 or 4 above) | `frontend/components/TileGrid.tsx` |
| Deep-ink feature panel with a gold glow border | `frontend/components/DarkPanel.tsx` |
| Accent map, labels, badge text, lazy-photo attributes (pure helpers) | `frontend/utils/tiles.ts` |
| Tile and glow styles, glow tokens `--gv-glow-gold`, `--gv-glow-amber`, `--gv-glow-cool` | `frontend/index.html` (plain CSS, `.nb-tile*`, `.nb-darkpanel*`) |
| 22 illustrations plus the shared frame `Svg.tsx` and a barrel `index.ts` | `frontend/components/art/` |
| Developer showcase (all pieces, every accent, variant and state, Tamil and Hindi titles) | `frontend/pages/ArtShowcase.tsx`, route `/art-showcase` (development and the sample-data preview only; not in a production build) |
| Art budget | `frontend/scripts/art-budget.mjs`, enforced by `frontend/tests/art-budget.test.mjs` |
| Cover tile (the art fills the card like a poster; title, one line and price over a dark scrim) | `frontend/components/CoverTile.tsx`, styles in `frontend/components/CoverTile.css`, checked by `frontend/tests/coverTile.test.mjs` |
| Create content type chooser (five cover tiles in one row) | `frontend/pages/GravityCreate.tsx`, `frontend/utils/createTiles.ts` |

## How to use a Tile

```tsx
import Tile from '../components/Tile';
import TileGrid from '../components/TileGrid';
import { ReviewQueueArt } from '../components/art';

<TileGrid columns={4} phone="row" label="What do you want to create?">
  <Tile title="Review queue" subtitle="Approve what Nebulaa prepared" footer="3 waiting"
        accent="review" art={<ReviewQueueArt />} to="/drafts" badge={3} />
</TileGrid>
```

Props: `title`, `subtitle`, `art` (an art component, or `{ src, width, height, alt }` for a small photo), `accent`, `badge` (text or a count; 0 is hidden, over 99 reads 99+), `footer`, `to` (link) or `onClick` (button), `locked` (lock mark, grey-toned art, "Locked" read out), `disabled`, `variant`, `selected` (for choosing between options: `aria-pressed`, a tick and an accent ring; on `choice` tiles only a thin gold ring), `dataAttrs` (for example `{ 'data-tour': 'x' }`).

Variants: `standard` (picture above text), `hero` (spans two columns from 640 px, picture beside text), `compact` (a row with a small picture), `idea` (3:2 picture, small title, footer for the format and cost), `choice` (a small quiet tile for picking between options: a 38 by 30 px framed picture beside the title, one line and a muted price below, no stripe, no arrow, no tick; the current one gets a thin gold ring). `TileGrid phone="row"` turns standard and idea tiles into rows on a phone. `TileGrid size="small"` is the tight grid for `choice` tiles: 2 columns on a phone, 3 on a tablet, then `columns` (up to 5) in one even row.

### Lesson (owner, 2026-10-19): tiles must be compact

The first Create content tiles (four 300 px picture tiles in a 2 by 2 grid plus a different-looking Video row) pushed the form far down and read as "so ugly, big blocks". Rules since then:

- Above a form or on a working screen, use `choice`, `compact` or one row of cover tiles (below): about 96 to 120 px tall at desktop, all in one even row, every tile the same structure (Video looks exactly like the four modes even though it opens another page).
- Big illustrated tiles (`standard`, `hero`) belong only on hero and landing areas, never above a form.
- Show selection with a thin gold ring, not a big tick badge. Keep headings small, borders light and avoid big filled panels; the form must be visible without scrolling at 1280 by 800 once a type is chosen.

### Cover tiles (owner, 2026-10-19): a marketing tool should market itself

The five Create content choices were small tiles with a tiny framed picture, which read as boring. They are now cover tiles: the illustration fills the card edge to edge like a video thumbnail or a movie title card, on its own colour grade, with the white title (Playfair Display 700, slightly tracked), the one line and the price over a dark scrim.

```tsx
import CoverTile from '../components/CoverTile';
<TileGrid columns={5} size="small" label="What do you want to create?">
  <CoverTile title="Carousel" subtitle="Swipeable slides" price="4 Quarks for each slide"
             palette="teal" art={<CarouselArt />} selected={mode === 'carousel'} onClick={() => setMode('carousel')} />
</TileGrid>
```

- Props: `title`, `subtitle`, `price` (the chip at the top left; the amount is set in bold, the words are shown as given), `art` (any piece from `components/art`, no new files needed), `palette` (`gold`, `coral`, `teal`, `blue` for LinkedIn, `ink` for video), `to` or `onClick`, `selected`, `dataAttrs`.
- Shape: wide and short, 132 px tall from 640 px up and 124 px on a phone, all the same height. In `TileGrid size="small"` that is five in a row at 1280 and two columns on a phone; an odd last tile spans both columns on a phone as a wide title card.
- The art is sized by the tile height and offset in pixels per palette (`--art-h`, `--art-right`, `--art-top`, `--art-rot` in `CoverTile.css`), so a wide tile keeps the same crop. Keep the object that explains the option (the LinkedIn mark, the play button) in the clear upper right, away from the price chip and the title. The frame's pale blob becomes a soft white halo.
- Background: a colour-graded gradient with a glow behind the art, two faint light streaks and a fine grain (an inline SVG noise in the stylesheet). No raster files.
- Contrast: the scrim and the chip are in each palette's deepest tone. `tests/coverTile.test.mjs` computes white text over the scrim (and over the chip) laid over pure white art, the worst case: at least 4.5 to 1 for every palette (title about 5.2 to 5.7, description 4.6 to 5.0, price 6.0 to 7.7). If you move the text higher or lighten the scrim, keep that test green.
- Selected: a gold ring that reads on the dark cover (inner, #FFCB2E) and on the light page (outer, #F5A623), plus a small gold tick. Focus: the 3 px ink ring, offset further when selected. Hover lift, glow and a slow art zoom only without reduced motion.
- Where: Create content now, and later hero areas (a page's main two to five choices). Not for dense lists, dashboards or anything repeated many times on a screen: use `choice` or `compact` tiles there. At most one row of cover tiles on a screen.
- A new palette needs a `.nb-cover[data-palette="..."]` rule (with `--cover-deep-rgb`), an entry in `COVER_PALETTES`, and an art offset rule; the test reads both lists.

A `DarkPanel` takes `eyebrow`, `title`, text children and an `action`. **Do not use it on the light pages** (the owner, 2026-10-19: the dark navy "Do this next" panel on Home was "odd, everything else is light"). For the one thing a page most wants noticed, use a warm gold card instead, like Home's "Do this next" (`.nb-home-next` in `components/home/home.css`): cream to soft gold gradient (#FFF9EC to #FFF1D2), a soft gold border (#EFD089) and gold glow shadow, brown ink text (#2B1D0E, details #5E4A31, eyebrow #8A5200), gold numbered badges (#FFE2A1 with #6B3F00; the first one solid #F5A623 with #1A1208), white quiet buttons and ONE gold primary button (#F5A623 with #1A1208); every pair is at least 4.5 to 1 (computed in `frontend/tests/homeBrandColours.test.mjs`). No dark blue on Home at all: Home sets its text tokens to brown ink, focus rings are #7A4A00, shadows are warm brown. `DarkPanel` stays only for the art showcase and any future dark hero the owner asks for.

Text boxes where the customer describes an idea share one look: `components/ideaBox.css` (`.nb-ideabox` on the box, `.nb-ideabox-field gravity-bare` on the field): the values of Create content's idea box (12 px radius, soft default border, panel fill, gold border and light ring while typing, muted placeholder). Home uses it; Create content and Videos should move onto the same classes.

## Symmetry rule (owner, 2026-10-19): equal-height rows, full rows, no masonry

The owner: "I want everything symmetrical and properly filling the width or the height." It applies to every tiled screen from now on.

- Every row of tiles is completely filled: no empty cell at the end of a row and no tile alone in a row unless it is full width. Where the count is not known, use one of: `fillRows(wants, columns)` from `utils/rowSpans.ts` (keeps the order, widens the last tile of a short row; tested), a flex row that wraps with `flex: 1 1 <basis>` children (a short last row stretches across), or count selectors (`:last-child:nth-child(odd)` full width on two columns; six half columns for three, so a last pair takes half each).
- Tiles in one row have the same height: CSS grid or flex with `align-items: stretch`, the tile body a flex column, and its link or button at the foot (`margin-top: auto`). Never `align-items: start` on a tile grid; that is the masonry look the owner rejected.
- Opening a tile's details grows that tile's whole row evenly (or opens inside the tile); it must not move tiles of other rows out of line.
- Side-by-side columns end on one line (Home: the last card of the shorter column takes up the rest).
- A row of option groups (Create content: Language, Platforms, Aspect ratio, Logo, Look) shares the full width in proportion to the room each group needs, its tiles stretch evenly across the group, every tile is the same height, and the row ends flush with the idea box above. When it wraps (tablet, phone), each line is filled the same way. See `components/createOptions.css`.
- Prefer a container query over a screen-width media query for the column count of a tile grid inside the page, so the side menu does not leave narrow, tall tiles.
- Check with measurements, not only by eye: for each row, `getBoundingClientRect()` on the tiles gives the same height, and the row's left and right edges meet the container, at 1280, 1024, 768 and 375 wide.

## Accent map (one colour per area)

| Accent | Area | Bar | Tint |
|---|---|---|---|
| create | Create content, Home create tiles | #F5A623 | #FFF0C7 |
| review | Review and approve | #3E8B5A | #DDF2E6 |
| inbox | Inbox, reviews, automatic replies | #3B82C4 | #DCEBFA |
| performance | Performance | #7B5CC4 | #ECE6FB |
| plan | My plan | #1F9D9A | #D6F1EF |
| brand | Brand assets, Blueprint, Memory | #D8527A | #FBDCE5 |
| competitors | Competitors, trends | #EE6330 | #FFE3D0 |
| video | Videos | #5B6BDC | #E1E5FB |
| photoshoot | Photoshoot | #A63EBB | #F4E1F8 |

The values live in two places that a test keeps equal: `ACCENT_COLORS` in `utils/tiles.ts` and the `.nb-tile[data-accent="..."]` rules in `index.html`. Ink text on every tint is at least 4.5 to 1 (tested). Keep new accent bars at 4.5 to 1 against white, otherwise `gen-layer-lists.mjs` lists the hex under "needs a fix".

## Rules a tile follows

- A real `<a>` (via the router) or `<button>`, never a clickable div. Native keyboard activation. A 3 px ink focus ring (`:focus-visible`).
- Decorative art is `aria-hidden`. A photo with `alt: ''` is hidden too. The picture area has a fixed aspect ratio, so nothing shifts when art or a photo arrives.
- Hover lift and the glow shadow run only inside `@media (prefers-reduced-motion: no-preference)`.
- All styling is plain CSS in `index.html`. Tiles add no Tailwind classes, so the browser has nothing extra to compile at start-up.
- Wording: plain professional sentences, no exclamation marks or em dashes, no "credit", "trial", "7 days", no vendor names. The tile files are in `tests/voice-scope.json`.
- Photos: only through `rasterAttrs()` (lazy loading, async decoding, width and height, own files only). Registered in `frontend/public/assets/tiles/`, at most 40 KB each, at most 6 above the fold on a page.

## How to add an illustration within the budget

1. Add `frontend/components/art/<Name>.tsx` exporting `<Name>Art`, wrapping the drawing in `<Svg {...p} tint="#...">`. The frame gives a 160 by 120 canvas and a soft background blob in the tint. Draw with shapes only (flat fills from the tokens: ink #14203A, gold #F5A623, sun #FFCB2E, coral #EE6330, cream #FFFDF8, plus the accent colours). Use readable shapes at 160 px wide: a recognisable object, two or three colours, one small sparkle at most.
2. Export it from `components/art/index.ts` and add it to the `PIECES` list in `pages/ArtShowcase.tsx`.
3. Run `node scripts/art-budget.mjs`. Each file must stay at most 2 KB raw. No `<image>`, `<text>`, `<script>`, `<foreignObject>`, no `dangerouslySetInnerHTML`, no external URL, at most one gradient (give its id a unique `nb-art-` name). The whole set must stay under 40 KB gzip (currently about 11 KB counted file by file).
4. Look at it on `/art-showcase` at 1280 and 375 wide before using it.

Import art from the barrel (`../components/art`) or from the piece file. The production build keeps only the pieces a page uses (checked: a build with the Create tiles contains the four Create pieces and none of the other 18).

## Checks

- `cd frontend && node scripts/art-budget.mjs` (prints the table; exit 1 on a violation) and `node --test tests/*.test.mjs` (includes `art-budget`, `tiles` and `createTiles` tests).
- After any class change: `node scripts/visual-audit/gen-layer-lists.mjs`, `node scripts/brand-audit.mjs`, `node scripts/voice-audit.mjs`.
- Sample-data preview: `AUDIT_PORT=3101 npx vite --config scripts/visual-audit/vite.audit.config.mjs`, then `http://127.0.0.1:3101/?audit=normal#/art-showcase` and `#/campaigns`.

## What was looked at (2026-10-18, sample-data preview at 127.0.0.1:3101)

- `/art-showcase` at 1280 wide: all 22 pieces, each accent, the hero, badge, locked, not available, selected, count badge, compact and idea tiles, the Tamil, Hindi and unbroken long titles, the feature panel. Fixed on the way: the arrow icon inheriting the picture sizing, compact tiles showing a cut-out of the art, tiles on the dark panel looking grey.
- Create content at 1280 and 375: the four mode tiles and the Video entry (a compact link tile to the Videos page), selecting by click and by keyboard (Tab then Enter), the focus ring, the hover lift. On 375 the tiles were four full-width stacked cards (about 360 px each); they are now rows (picture left), about 125 px each.
- Contrast audit (the repo's runner) on the showcase and Create content at 1280 and 375: no failure on any tile text. The failures that remain on Create content are the old small option captions and the account initial (they were there before).

## My plan illustration style (2026-10-19)

The owner asked for My plan to be "all tiles and beautiful with images and animations and vector images", with no dark navy panels. What was built and the rules for adding to it:

- Files: `frontend/pages/MyPlan.tsx` (states), `frontend/components/StrategyFunnel.tsx` (nine strategy tiles and the no-plan preview), `frontend/components/plan/` (`PlanHero`, `PlanDetails`, `PlanCharts` for the donut and timeline, `PlanMarks` for channel marks and mini posts, `PlanBits` for chips and opened details, `plan.css`), numbers in `frontend/utils/planVisuals.ts` (tested in `tests/planVisuals.test.mjs`).
- Level glyphs: `frontend/components/art/plan/` (a 64 by 56 frame with a tinted disc, one piece per level plus the sparkle). Same drawing rules as the main set: flat shapes, two or three colours, ink only as a soft outline, no text; each well under 1 KB. They are imported from the piece files, not the barrel, and are not on `/art-showcase`.
- Colour: cream panels and the gold glow; one category tint per level from five soft tones (gold #FFF0C7, coral #FFE3D0, teal #D6F1EF, sage #E3EFD9, lilac #ECE6FB), each with a deep mark colour and a text colour that keeps 4.5 to 1 on the tint. No dark panels anywhere on the page.
- Data drawings show stored numbers only: the donut's outer ring is the average organic and paid split of the channels that have one, the inner ring counts online and offline channels; without a split the ring stays dashed and the legend says "not split yet". The timeline marker sits on the real plan day. KPI tiles never show made-up values, only the metric and who reads it.
- Channel marks are simple generic glyphs on a colour square, not copies of any logo; every mark colour keeps 4.5 to 1 against white so `gen-layer-lists.mjs` does not list it.
- Layout: the columns follow the width the grid really has (a container query, because the side menu takes part of the screen): three from 900 px (positioning and channels span two, the 90 days and the numbers the full row), two from 560 px (those four full width), one below. Spans come from `fillRows()` in `utils/rowSpans.ts`, so a level that is not decided yet (one column) never leaves a hole: its neighbour widens. Tiles of a row have the same height and the details toggle sits at the foot; opening a tile grows its row evenly and leaves the other rows alone. Detail cards are full width with tiles inside, laid out under the symmetry rule below.
- Motion (only without reduced motion): staggered rise on first render (fill mode `backwards`, so hover lift still works afterwards), donut and ready ring draw-in, timeline fill, a slow pulse on today's marker, the twinkling sparkle, hover lift.
- Honesty: every claim keeps its tag in words, a missing level says "Not decided yet" with its reason behind "Why it is empty", and nothing is drawn for data the plan does not have.

## Photoshoot (2026-10-19)

- Create content has six cover tiles now (`TileGrid columns={6}`): Video, Photoshoot (palette `plum`, the Photoshoot accent family), then the four modes.
- The pack choice on `/photoshoot` is six cover tiles (one column under 560 px, two up to 900 px, then three) with their own small drawings in `frontend/components/art/packs/` (imported from that folder, not the barrel; same drawing rules and budget as the main set). Palettes: product plum, marketplace blue, festival gold, lifestyle teal, flat lay coral, clean white ink.
- Page styles: `frontend/components/photoshoot/photoshoot.css` (brown ink like Home, one warm gold summary card, no dark panel). The Home packs rail is a sideways row of compact `choice` tiles (`.nb-home-packs-rail`).

## Calendar, Library and Videos (2026-10-19)

- Calendar month hero and plan inputs: `frontend/components/calendar/MonthHero.tsx` (`MonthHero`, `PlanInputsCard`), styles `components/calendar/calendarHero.css` (warm gold card like Home's "Do this next", brown ink, one gold primary button; month cards, plan-next strip, tabs and toolbar on the cream tokens). Numbers and words from `utils/calendarHero.ts` (tested). The built-in cover has `tone="light"` (cream to soft gold) for the cream pages; `tone="dark"` stays the default.
- Library tiles: `components/library/library.css`; columns from `libraryColumns()` on the grid's real width, spans from `fillRows()`; source and status chips in words (`SOURCE_WORD`, `STATUS_WORD`), actions from `libraryTileActions()` (`utils/library.ts`).
- Video style tiles: `components/video/VideoStyleTile.tsx` (`VideoStyleTile`, `VideoStyleChips`) and `videoStyles.css`. Wide, short tiles with one picture height in a wrapping flex row (container query: 4, 3 or 2 across; a short last row stretches). Category grouping lives only in `utils/videoStyleGroups.ts`; a new server style must be added to a group there (the test fails otherwise). Hover and focus show the full hint over the photo; nothing autoplays.
- Preview states: `?calstate=ready|none|pending|failed|generating|empty` (Calendar); the audit mock also answers `GET /api/videos/options` and `/api/hero-video/styles` with the real 22 styles.

## Brand memory page (2026-10-19)

`frontend/pages/AIMemory.tsx` (route `/ai-memory`, "What Nebulaa has learned") in the My plan style: a cream and gold hero with the brain drawing (`art/Memory.tsx`) and the sparkle, the tracked post count, patterns learned, last update and Refresh now; the learned notes as colour-coded pattern tiles, one per stored category (best days and times, formats, words and tone, calls to action, hashtags and topics, visual style), each note with its stored strength as a small bar and Edit and Delete kept; while nothing is learned, an illustrated card (`art/memory/Grow.tsx`, imported from the piece file) with the real tracked count, the three steps and what will show; the three history pages as small icon tiles. Grouping and wording in `utils/memoryView.ts` (tested); styles in `components/memory/memory.css`. Only stored notes are shown. Preview: `/?audit=normal&memorystate=empty|tracking|filled#/ai-memory`.

## Inbox overview (2026-10-19)

`/inbox` (`pages/SocialInbox.tsx`) opens with three compact `Tile`s in a `TileGrid` (`components/inbox/InboxOverview.tsx`, styles `components/inbox/inbox.css`): the existing `InboxArt`, `ReviewsArt` and `AutoReplyArt`, the status chip as the tile badge (shown above the title so the title keeps the width; colour per `data-status`), one counts line as the footer, the current part with a gold ring. One even row from 560 px of room (container query), full-width rows below, where the one-line description is left out. The Automatic replies explainer is a warm gold card (no dark panel) with three step tiles and small glyphs from `components/art/inbox/` (64 by 56 frame, imported from the piece files; the dial needle sways, the link spark pulses, the play button pops, all only without reduced motion). Rules in `utils/inboxOverview.ts`, tested in `tests/inboxOverview.test.mjs`. Preview: `/?audit=normal&inboxstate=full|quiet|auto|nosocials|addon|error#/inbox`. Second pass (rows, reply sheet, reviews, mode tiles, notes per state, honest wording switch): `docs/superpowers/ops/inbox-reviews-visual.md`.

## Performance, Brand assets and Blueprint (2026-10-19)

- Performance (`pages/GravityInsights.tsx`, styles `components/performance/performance.css`, rules `utils/performanceView.ts`, tested in `tests/performanceView.test.mjs`): a compact cream hero, then one grid of four columns (a container query, two below 880 px of room): four KPI cards (reach lilac, engagement coral, new followers teal, posts gold) with the figure, a one-word unit line, a sparkline and a change chip in words with an arrow, then the best post of the month and the 30-day reach chart, two columns each. Lines come only from stored points (daily `SocialSnapshot`, weekly published campaigns); fewer than two points draws no line and says when it will. The line reveals with a clip animation, cards rise, the sparkle twinkles, all only without reduced motion. Preview: `/?audit=normal&perfstate=full|latest|oneday|nosocials|new|partial|error#/analytics`.
- Status tiles (`components/brand/StatusTiles.tsx`, `statusTiles.css`): compact wide tiles (about 66 to 100 px tall) with a 64 by 56 glyph, the title, a status chip in words (`added` green, `partly` gold, `missing` coral, `unknown` grey), one line and small pictures, swatches or a font sample. A real link or button. `StatusTileGrid wide={4|3} dense?`: one column on a phone (two when `dense`, the glyph steps aside), two from 520 px of room, three from 700 px or four from 880 px; spans from `tileSpans()` (`fillRows`) close every row.
- Brand assets: `components/brand/BrandGlance.tsx` above the tabs; Blueprint: `components/brand/BlueprintTiles.tsx` (four answer tiles above the form, nine page tiles on the finished Blueprint). Statuses in `utils/brandTiles.ts` (tested in `tests/brandTiles.test.mjs`). Glyphs in `components/art/brand/` (Logo, Palette, Fonts, Bulb, Globe, Target, Binoculars, Month, Checklist; imported from the piece files, not the barrel) plus the My plan glyphs. Preview: `/?audit=normal&brandstate=full|empty|error#/brand-assets`, `#/blueprint/new`, `#/blueprint/audit-done`.

## Cover photos (owner, 2026-10-19): real photographs, not drawings

The owner could not read the drawn cover art on the pack tiles (cut off, unclear) and asked for real photographs, and for Create content as two rows of three larger tiles.

- **Where the photos live.** One small webp per slot in `frontend/public/samples/<slot>.webp` (768 x 480, 16:10, at most 36 KB, the art budget allows 40 KB and checks this folder). The twelve slots are in `frontend/utils/samplePhotos.ts` (six Photoshoot packs `pack-*`, six Create choices `create-*`); the prompts are in `backend/config/samplePhotoPrompts.js` (a test keeps the two lists equal). They are made once by the owner: `docs/superpowers/ops/sample-photos.md`.
- **How a tile shows one.** `CoverTile` takes `image={packPhoto(key)}` or `image={createPhoto(key)}` (and `overlay="play"` for Video, `overlay="slides"` for Carousel). `components/SamplePhoto.tsx` lays the photo over the drawn art: the photo goes through `rasterAttrs()` (own file, lazy, async decoding, fixed width and height), `alt=""` because the title beside it names it, `object-fit: cover`. The art stays visible until the photo has loaded; a missing file or any load error removes the photo for the rest of the visit, so there is never a broken-image icon and nothing breaks before the photos exist.
- **Text over a photo.** The same scrim and price chip as over the art; the contrast test assumes pure white behind the text, so it holds for any photo. Prompts ask for calmer, darker space at the lower left where the title sits, no faces, no logos and no text in the image.
- **Layout.** Create content: `.nb-cover-grid` (in `CoverTile.css`), three columns from 640 px (two rows of three, 164 px tall), two columns below (three rows of two, 148 px), every tile exactly its row height. Photoshoot packs: one, two or three columns with fixed row heights (148, 156, 164 px), six packs fill every row. Home: the five create tiles and the packs rail are compact cover tiles (116 and 128 px) with the same photos.
- **A new photo slot.** Add the slot to both lists, add its prompt, run the script with `--only <slot>`, check the contact sheet, type PROMOTE, then run `node scripts/art-budget.mjs`.

## Not done yet (by design)

Post templates, Library, Memory and Calendar tiles, the sample photos themselves (the owner makes them, see above), a Lighthouse-style first paint comparison (the page weight was measured instead: see the build task report).
