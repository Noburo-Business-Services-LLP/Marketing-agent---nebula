# Gravity Light Mode — Design Spec

## Goal

Give the "Gravity by Nebulaa" page family (and its shared design-system
primitives) real light-mode support, driven by the `ThemeContext` that
already exists and already themes the rest of the app — plus a reachable
toggle in the sidebar for a logged-in user.

## Why these pages need work

`ThemeContext` (`frontend/context/ThemeContext.tsx`) already provides
`isDarkMode` / `toggleTheme` / `colors`, toggles a `dark` class on
`<html>`, and is already wired into most of the app (Dashboard, Settings,
Campaigns, BrandAssets, ContentCalendar, Inventory, ReelGenerator, and
the app shell `Layout.tsx` itself). But the five `Gravity*.tsx` pages,
`AIMemory.tsx`, and the shared primitives in `components/gravity/index.tsx`
were built dark-only: every color is a literal Tailwind utility
(`bg-white/[0.06]`, `text-[#F5A623]`, `border-white/[0.10]`, etc.) with no
theme awareness at all.

An inventory across those 7 files found:
- 12 distinct white-opacity steps used for surfaces/backgrounds
- 7 distinct white-opacity steps used for borders
- 13 distinct white-opacity steps used for text
- 107 literal uses of the gold accent `#F5A623` alone

That's real design-system density, not incidental — a bare
`isDarkMode ? x : y` ternary per occurrence (the pattern the rest of the
app uses) would roughly double these files' size and invite drift. This
spec instead defines a small set of CSS custom properties (design
tokens), each with one dark and one light value, and mechanically swaps
literal utilities for token references.

## Source of truth for the palette

`nebulaa-ai-website/app/globals.css` (a sibling repo, the public marketing
site) already has a considered, brand-consistent light+dark token system
built explicitly to match this app's design language — the code comments
say so directly ("matches the Gravity product's own design system",
"lifted from the Gravity app's `.gravity-label`"). Its dark values are
near-identical to Gravity's actual existing colors (`--surface: #151515`
is Gravity's own popover/card color; `--ink: #F5F4F1` is Gravity's own
primary text color), and it already solves the one genuinely hard part of
this problem with real math: **gold text fails contrast on a light
ground** (~2.1:1), so that system separates the gold *fill* color from
gold *text* color, with a WCAG-AA-passing darker amber for text use in
light mode.

Rather than re-deriving a palette from scratch, this spec adopts that
system's values directly and extends it only where Gravity's denser UI
needs intermediate opacity steps the website doesn't require.

## Token table

All tokens live in a new file, `frontend/styles/gravity-tokens.css`,
imported once from the app's entry stylesheet. Defined on `:root` (light,
the default) and overridden under `.dark` — the same class
`ThemeContext` already toggles, so no new plumbing is needed anywhere.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--gv-bg` | `#FAF9F6` | `#0A0A0A` | Page background |
| `--gv-panel` | `#FFFFFF` | `#151515` | Solid card / popover / modal background |
| `--gv-panel-2` | `#F2F0EA` | `#1A1A1A` | A second, slightly-different solid surface (nested cards, code blocks) |
| `--gv-ink-rgb` | `23 23 26` | `245 244 241` | Raw RGB channels of the primary text color, for opacity-based washes below |
| `--gv-text-primary` | `#17171A` | `#F5F4F1` | Headlines, primary copy |
| `--gv-text-secondary` | `#44433F` | `#C9C6BE` | Sub-copy, labels (was `white/70–85`) |
| `--gv-text-tertiary` | `#78756D` | `#8A8780` | Metadata, timestamps (was `white/45–60`) |
| `--gv-text-muted` | `#9C998F` | `#6E6B65` | Placeholders, disabled, faint hints (was `white/25–40`) |
| `--gv-surface-1` | `rgb(var(--gv-ink-rgb) / 0.03)` | `rgb(var(--gv-ink-rgb) / 0.03)` | Barely-there panel wash (was `white/[0.01–0.03]`) |
| `--gv-surface-2` | `rgb(var(--gv-ink-rgb) / 0.05)` | `rgb(var(--gv-ink-rgb) / 0.06)` | Default panel fill (was `white/[0.04–0.06]`) |
| `--gv-surface-3` | `rgb(var(--gv-ink-rgb) / 0.08)` | `rgb(var(--gv-ink-rgb) / 0.10)` | Hover / active fill (was `white/[0.07–0.10]`) |
| `--gv-surface-4` | `rgb(var(--gv-ink-rgb) / 0.12)` | `rgb(var(--gv-ink-rgb) / 0.14)` | Raised / selected fill (was `white/[0.12–0.14]`) |
| `--gv-border-subtle` | `rgb(var(--gv-ink-rgb) / 0.10)` | `rgb(var(--gv-ink-rgb) / 0.06)` | Hairline dividers (was `border-white/[0.05–0.08]`) |
| `--gv-border-default` | `rgb(var(--gv-ink-rgb) / 0.16)` | `rgb(var(--gv-ink-rgb) / 0.10)` | Visible borders (was `border-white/[0.10–0.12]`) |
| `--gv-border-strong` | `rgb(var(--gv-ink-rgb) / 0.24)` | `rgb(var(--gv-ink-rgb) / 0.14)` | Emphasis / focus (was `border-white/[0.14]`) |
| `--gv-accent` | `#F5A623` | `#F5A623` | Gold used as a **fill** — icon backgrounds, solid buttons, progress, active-tab state. Never for text on light. |
| `--gv-accent-text` | `#96650A` | `#F5A623` | Gold used as **body-size text** (e.g. `GravityEmphasis` italic words). 4.79:1 on light — passes AA. |
| `--gv-accent-display` | `#B0770F` | `#F5A623` | Gold used as **large text** (≥24px — headline emphasis, big numbers). 3.63:1 — passes AA for large text only. |
| `--gv-accent-hover` | `#D68C0F` | `#ffb833` | Hover state for solid-gold buttons. Light mode **darkens** on hover (more contrast against a light page); dark mode **lightens** (more contrast against a dark page) — this direction flip is intentional, not a mistake to "fix" during implementation. |
| `--gv-accent-fill` | `rgba(245,166,35,0.10)` | `rgba(245,166,35,0.06)` | Low-opacity gold wash (was `F5A623]/[0.03–0.08]`) |
| `--gv-accent-ink` | `#1A1208` | `#1A1208` | Text/icon color *sitting on* a solid gold fill (e.g. the label inside a filled gold button). Stays dark in both themes — this is about contrast against gold, not against the page. |

Note on `rgb(var(--gv-ink-rgb) / 0.06)`: this is the modern CSS
relative-color syntax (`rgb(R G B / A)`), already usable via Tailwind's
arbitrary-value classes (`bg-[rgb(var(--gv-ink-rgb)/0.06)]`) — no new
build tooling required.

**What stays hardcoded, deliberately not tokenized:** status colors
(`#4ADE80` success green) and platform-brand icon colors (Instagram pink
`#E1306C`, Facebook blue `#1877F2`, LinkedIn blue `#0A66C2`, etc.) — these
need to read as "that specific brand/status," identically, regardless of
theme. `#60A5FA` (one existing usage) gets a quick check during
implementation to confirm it's a status color and not something that
should have been thematic.

## A correction made while writing this spec

This app has no build-time Tailwind pipeline and no CSS file to "import
tokens from" — Tailwind loads via the Play CDN script in
`frontend/index.html`, configured inline there. Verified live that its
JIT engine correctly compiles CSS-variable arbitrary values with a
slash-alpha (`bg-[rgb(var(--x)/0.5)]` → `rgba(...)`), so the token
approach itself still works — it just needs a different home for the
token *definitions* (a `<style>` block, not a `.css` import).

More importantly, `frontend/index.html` already has a global
`<style>` block (the "GRAVITY OVERRIDE LAYER") that:
- Applies to **every page in the app**, not just the 7 files in scope —
  `Layout.tsx` adds a `gravity-shell` class to `<body>` unconditionally
  for every authenticated route (`useEffect` with an empty dependency
  array, line 64-67).
- Auto-restyles legacy dark-mode Tailwind class *names* it recognizes
  (`bg-slate-800`, `text-white`, etc., via `[class*="..."]` attribute
  selectors) toward Gravity's dark palette. This only ever fires in dark
  mode already, since legacy pages' own `isDarkMode` ternaries only emit
  those dark-named classes when dark mode is active — in light mode they
  emit light-named classes this layer doesn't match. **No change needed
  here**; it's already effectively dark-only by construction and this
  spec doesn't touch it.
- But also contains one **unconditional** rule, independent of theme:
  ```css
  body.gravity-shell,
  html.dark body.gravity-shell {
    background-color: #0A0A0A !important;
    color: #F5F4F1 !important;
  }
  ```
  This is what actually paints the page background for the 5
  `Gravity*.tsx` pages (none of them paint their own full-page
  background — this is why). It ignores theme entirely today. **This
  line is the real reason light mode currently has no visible effect at
  all on these pages**, independent of any per-component token work.

## Files touched, in order

1. **`frontend/index.html`** — add the token `<style>` block (a `:root
   {...}` / `.dark {...}` pair, same mechanism as this file's existing
   `.dark`-scoped rules just below the override layer) with the full
   token table above. Then fix the one unconditional rule identified
   above to read `background-color: var(--gv-bg); color:
   var(--gv-text-primary);` (dropping `!important` and the redundant
   dark-specific selector, since the token itself now already varies by
   `.dark`).
2. **`components/gravity/index.tsx`** — `GravityHero`, `GravityEmphasis`,
   `GravityLabel`, `GravityButton`. Highest leverage: every page below
   imports these, so getting this file right (in particular,
   `GravityEmphasis`'s gold italic text using `--gv-accent-text` /
   `--gv-accent-display` correctly rather than the flat `--gv-accent`
   fill color) fixes a large share of every page at once.
3. **`pages/GravityCreate.tsx`**, **`pages/GravityApprove.tsx`**,
   **`pages/GravityCalendar.tsx`**, **`pages/GravityHome.tsx`**,
   **`pages/GravityInsights.tsx`**, **`pages/AIMemory.tsx`** — each
   file's own local panels, cards, popovers (`MetaBox`, `OptionPopover`,
   etc. in `GravityCreate.tsx`), and any inline `style={{ background:
   linear-gradient(...) }}` gradients get individual attention (CSS vars
   work fine inside inline `style`, e.g. `linear-gradient(180deg,
   rgb(var(--gv-ink-rgb)/0.02), transparent)`, but each gradient's stops
   need to be re-derived for the light palette rather than blindly
   swapped, since a wash designed to lighten a dark background needs the
   opposite direction on a light one).
4. **`components/Layout.tsx`** — add a sun/moon toggle icon button in the
   sidebar, next to the account chip, calling the `toggleTheme()` that
   already exists on `useTheme()`. This is the only new *behavior* in
   this spec; everything else is visual.

## Known edge cases

- **Gold-on-gold contrast inside GravityHero's ambient glow.** The hero
  card's background gradient in `GravityCreate.tsx`
  (`linear-gradient(180deg, rgba(255,214,150,0.055) ...)`) currently
  lightens a dark base toward warm gold. In light mode this needs to
  *not* wash the page toward white-on-white — the fix is a much lower
  opacity or a token-driven `--gv-surface-2`-based tint instead of a
  literal warm-gold rgba value.
- **Transparent-background logo swatches** (the small logo picker
  buttons in `GravityCreate.tsx`) sit on `bg-white/[0.04]` today so a
  white/gold logo stays visible against dark. In light mode that
  container needs a *visible* card background (`--gv-panel` or
  `--gv-surface-2`, not a near-invisible wash) or transparent-background
  logos become nearly invisible against a light page.
- **`BorderBeam`'s animated conic-gradient shimmer** (used around
  `GravityCreate`'s hero panel) is already gold-toned, not black/white —
  likely needs no change, confirmed visually during implementation
  rather than assumed.
- **Focus/selected states that currently rely on darkness for
  contrast** (e.g. `bg-[#F5A623]/12 text-[#F5A623]` active-tab styling)
  need `text-[#F5A623]` swapped to `--gv-accent-text` specifically in
  light mode for the reason in the token table — this is the single most
  important swap to get right, since it's the one place the "just
  reference a variable" mechanical pass isn't literally 1:1 (a fill-gold
  usage and a text-gold usage look identical in the dark-mode source but
  need different tokens).

## Testing

No automated visual regression suite exists for this app. Verification
is manual: after implementation, toggle to light mode via the new
sidebar control and screenshot each of the 7 surfaces (Create, Approve,
Calendar, Home, Insights, AI Memory, plus `DraftPreviewModal` since it's
reachable from Approve) checking for:
- No white-on-white or dark-on-dark text
- Popover/dropdown backgrounds visually distinct from the page behind them
- Gold text (emphasis words, active states) legible, not the flat fill
  color misused as text
- Transparent-background images (logos) have a visible card behind them
- Toggling back to dark mode still looks exactly as it did before this
  change (a regression check, not just a new-feature check)

## Out of scope

- Any page not in the 7 listed above (already either theme-aware or not
  part of the Gravity rebrand).
- Changing the *dark* mode palette's actual values — this spec only adds
  light-mode values alongside the existing dark ones.
- A system-preference auto-detect beyond what `ThemeContext` already
  does (it already checks `prefers-color-scheme` as a fallback when
  nothing is saved to `localStorage`).
