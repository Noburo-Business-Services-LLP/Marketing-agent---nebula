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
| Create content type chooser (five `choice` tiles in one row) | `frontend/pages/GravityCreate.tsx`, `frontend/utils/createTiles.ts` |

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

- Above a form or on a working screen, use `choice` or `compact` tiles: about 96 to 120 px tall at desktop, all in one even row, every tile the same structure (Video looks exactly like the four modes even though it opens another page).
- Big illustrated tiles (`standard`, `hero`) belong only on hero and landing areas, never above a form.
- Show selection with a thin gold ring, not a big tick badge. Keep headings small, borders light and avoid big filled panels; the form must be visible without scrolling at 1280 by 800 once a type is chosen.

A `DarkPanel` takes `eyebrow`, `title`, text children and an `action`. Use two or three per page at most.

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

## Not done yet (by design)

Photoshoot tile and page (the page does not exist yet), templates and packs, Home, Library, Inbox, Performance, My plan, Brand, Blueprint, Memory and Calendar tiles, photo tiles (none registered yet), a Lighthouse-style first paint comparison (the page weight was measured instead: see the build task report).
