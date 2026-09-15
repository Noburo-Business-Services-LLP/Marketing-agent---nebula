# Gravity Light Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Gravity's page family (5 `Gravity*.tsx` pages, `AIMemory.tsx`, the shared `components/gravity/index.tsx` primitives, and the `Layout.tsx` sidebar) real light-mode support via CSS custom properties, plus a reachable sidebar toggle.

**Architecture:** Define a token set as CSS custom properties in `frontend/index.html`'s existing `<style>` block (`:root` for light, `.dark` overrides), keyed off the `dark` class `ThemeContext` already toggles on `<html>`. Every hardcoded literal Tailwind color utility across the 8 target files (`bg-white/[0.06]`, `text-[#F5A623]`, etc.) gets swapped for a token reference (`bg-[var(--gv-surface-2)]`). No new React state, no new context — purely a CSS-variable swap plus one new button.

**Tech Stack:** React 19 + Vite frontend. Tailwind loads via the Play CDN script (`<script src="https://cdn.tailwindcss.com">`) in `frontend/index.html` — there is no build-time Tailwind/PostCSS pipeline and no `.css` file to import from. Verified live that its JIT engine correctly compiles CSS-variable arbitrary values with a slash-alpha, e.g. `bg-[rgb(var(--x)/0.5)]` → `rgba(...)`.

**Spec:** `docs/superpowers/specs/2026-09-15-gravity-light-mode-design.md`

## Global Constraints

- Dark mode's *existing* visual output must not change. Every task's final verification step includes confirming dark mode still looks exactly as it did before.
- The gold accent hue (`#F5A623`) is identical in both themes — this is Gravity's own brand color, established in the approved spec, not a value to re-derive.
- Status colors (`#4ADE80` success green) and platform-brand icon colors (Instagram `#E1306C`, Facebook `#1877F2`, LinkedIn `#0A66C2`, YouTube `#FF0000`) are **not tokenized** — leave these exact literal values untouched everywhere they appear.
- `text-[#1A1208]` and `bg-[#1A1208]` (the near-black used for text/icons sitting on a solid gold fill) are **theme-invariant already** — do not change these; they stay the same literal value in both themes because the concern is contrast against gold, not against the page.
- No automated visual regression suite exists. Verification is manual: `preview_start` the frontend, toggle to light mode via the new sidebar control (once Task 9 lands; before that, toggle by temporarily removing the `dark` class from `<html>` in `frontend/index.html:2` or via the browser console: `document.documentElement.classList.remove('dark')`), screenshot the page, check for white-on-white/dark-on-dark text, popovers indistinguishable from the page behind them, and transparent-background images (logos) with no visible card behind them.

### Canonical token table (from the spec — copy verbatim into Task 1)

| Token | Light value | Dark value |
|---|---|---|
| `--gv-bg` | `#FAF9F6` | `#0A0A0A` |
| `--gv-panel` | `#FFFFFF` | `#151515` |
| `--gv-panel-2` | `#F2F0EA` | `#1A1A1A` |
| `--gv-ink-rgb` | `23 23 26` | `245 244 241` |
| `--gv-text-primary` | `#17171A` | `#F5F4F1` |
| `--gv-text-secondary` | `#44433F` | `#C9C6BE` |
| `--gv-text-tertiary` | `#78756D` | `#8A8780` |
| `--gv-text-muted` | `#9C998F` | `#6E6B65` |
| `--gv-surface-1` | `rgb(var(--gv-ink-rgb) / 0.03)` | `rgb(var(--gv-ink-rgb) / 0.03)` |
| `--gv-surface-2` | `rgb(var(--gv-ink-rgb) / 0.05)` | `rgb(var(--gv-ink-rgb) / 0.06)` |
| `--gv-surface-3` | `rgb(var(--gv-ink-rgb) / 0.08)` | `rgb(var(--gv-ink-rgb) / 0.10)` |
| `--gv-surface-4` | `rgb(var(--gv-ink-rgb) / 0.12)` | `rgb(var(--gv-ink-rgb) / 0.14)` |
| `--gv-border-subtle` | `rgb(var(--gv-ink-rgb) / 0.10)` | `rgb(var(--gv-ink-rgb) / 0.06)` |
| `--gv-border-default` | `rgb(var(--gv-ink-rgb) / 0.16)` | `rgb(var(--gv-ink-rgb) / 0.10)` |
| `--gv-border-strong` | `rgb(var(--gv-ink-rgb) / 0.24)` | `rgb(var(--gv-ink-rgb) / 0.14)` |
| `--gv-accent` | `#F5A623` | `#F5A623` |
| `--gv-accent-text` | `#96650A` | `#F5A623` |
| `--gv-accent-display` | `#B0770F` | `#F5A623` |
| `--gv-accent-hover` | `#D68C0F` | `#ffb833` |
| `--gv-accent-fill` | `rgba(245,166,35,0.10)` | `rgba(245,166,35,0.06)` |
| `--gv-accent-ink` | `#1A1208` | `#1A1208` |

### Deterministic migration table (apply to every task below)

| Old class(es) | New class | Notes |
|---|---|---|
| `bg-white/[0.005]`, `[0.01]`, `[0.02]`, `[0.03]` | `bg-[var(--gv-surface-1)]` | |
| `bg-white/[0.04]`, `[0.05]`, `[0.06]`, `[0.07]` | `bg-[var(--gv-surface-2)]` | |
| `bg-white/[0.08]`, `[0.10]` | `bg-[var(--gv-surface-3)]` | |
| `bg-white/[0.12]`, `[0.14]` | `bg-[var(--gv-surface-4)]` | |
| `border-white/[0.03]`, `[0.05]`, `[0.06]` | `border-[var(--gv-border-subtle)]` | |
| `border-white/[0.08]`, `[0.10]`, `[0.12]` | `border-[var(--gv-border-default)]` | |
| `border-white/[0.14]` | `border-[var(--gv-border-strong)]` | |
| `text-white/25`, `/30`, `/35`, `/40` | `text-[var(--gv-text-muted)]` | |
| `text-white/45`, `/50`, `/55`, `/60` | `text-[var(--gv-text-tertiary)]` | |
| `text-white/70`, `/75`, `/80` | `text-[var(--gv-text-secondary)]` | |
| `text-white/85`, `/90` | `text-[var(--gv-text-primary)]` | |
| `text-[#F5F4F1]` | `text-[var(--gv-text-primary)]` | |
| `bg-[#F5A623]` | `bg-[var(--gv-accent)]` | Always a fill/background context — safe uniform swap. |
| `border-[#F5A623]` | `border-[var(--gv-accent)]` | |
| `bg-[#ffb833]`, `hover:bg-[#ffb833]` | `bg-[var(--gv-accent-hover)]` / `hover:bg-[var(--gv-accent-hover)]` | |
| `text-[#ffb833]`, `hover:text-[#ffb833]` | `text-[var(--gv-accent-hover)]` / `hover:text-[var(--gv-accent-hover)]` | |
| `bg-[#151515]` | `bg-[var(--gv-panel)]` | |
| `[#F5A623]/[0.0X]` fill washes (e.g. `bg-[#F5A623]/[0.03]`, `bg-[#F5A623]/10`, `bg-[#F5A623]/15`) | `bg-[var(--gv-accent-fill)]` | |
| `text-[#1A1208]`, `bg-[#1A1208]` | **no change** | Theme-invariant, see Global Constraints. |
| `text-[#4ADE80]`, `text-[#60A5FA]`, platform hex colors | **no change** | Status/brand colors, see Global Constraints. |

**`text-[#F5A623]` is the one non-mechanical case — apply this rule per occurrence:**
1. Colors a `lucide-react` icon component (e.g. `<Sparkles className="text-[#F5A623]" />`) → `text-[var(--gv-accent)]` (icon glyph fill, not running text).
2. Colors actual word/text content at large/headline scale (rendered inside an element with a font-size class ≥ `text-[24px]`, e.g. `text-[42px]`, `text-[52px]`, `text-[clamp(34px,4.4vw,56px)]`, or inside a `<h1>`/`<h2>` serif headline) → `text-[var(--gv-accent-display)]`.
3. Everything else (small/body-scale text: labels, tab text, badges, links, `.gravity-label`) → `text-[var(--gv-accent-text)]`.

**Inline `style={{ background: 'linear-gradient(...)' }}` / `radial-gradient(...)` gradients** cannot be mechanically swapped — CSS vars work fine inside inline `style` (e.g. `` `linear-gradient(180deg, rgb(var(--gv-ink-rgb)/0.02), transparent)` ``), but each one needs its stops re-derived for light mode rather than blindly reusing the dark-mode rgba values, since a wash designed to *lighten* a dark background needs the opposite direction on a light one. Each task below that has one gives the exact replacement.

---

### Task 1: Token definitions + fix the unconditional background rule

**Files:**
- Modify: `frontend/index.html:67-73`, and a new insertion after `frontend/index.html:101` (end of the existing `body.gravity-shell { --grav-...: ...; }` block)

**Interfaces:**
- Produces: every `--gv-*` custom property in the canonical token table above, available globally via `:root` / `.dark`. All later tasks consume these by name.

- [ ] **Step 1: Insert the token block**

Open `frontend/index.html`. Find this existing block (ends at line 101, right after the `--grav-text-muted` line and its closing `}`):

```css
      body.gravity-shell {
        --grav-gold: #F5A623;
        --grav-gold-hover: #ffb833;
        --grav-bg: #0A0A0A;
        --grav-surface: #151515;
        --grav-surface-2: #1A1A1A;
        --grav-border: rgba(255,255,255,0.06);
        --grav-border-strong: rgba(255,255,255,0.12);
        --grav-text: #F5F4F1;
        --grav-text-muted: rgba(255,255,255,0.55);
      }
```

Immediately after that closing `}`, insert:

```css
      /* ============================================================
         GRAVITY LIGHT-MODE TOKENS
         Values adopted from nebulaa-ai-website/app/globals.css — the
         sibling marketing site's already-validated Gravity palette
         (dark values match this app's own existing colors; the
         gold-on-light text contrast is real WCAG math, not a guess).
         See docs/superpowers/specs/2026-09-15-gravity-light-mode-design.md
         ============================================================ */
      :root {
        --gv-bg: #FAF9F6;
        --gv-panel: #FFFFFF;
        --gv-panel-2: #F2F0EA;
        --gv-ink-rgb: 23 23 26;
        --gv-text-primary: #17171A;
        --gv-text-secondary: #44433F;
        --gv-text-tertiary: #78756D;
        --gv-text-muted: #9C998F;
        --gv-surface-1: rgb(var(--gv-ink-rgb) / 0.03);
        --gv-surface-2: rgb(var(--gv-ink-rgb) / 0.05);
        --gv-surface-3: rgb(var(--gv-ink-rgb) / 0.08);
        --gv-surface-4: rgb(var(--gv-ink-rgb) / 0.12);
        --gv-border-subtle: rgb(var(--gv-ink-rgb) / 0.10);
        --gv-border-default: rgb(var(--gv-ink-rgb) / 0.16);
        --gv-border-strong: rgb(var(--gv-ink-rgb) / 0.24);
        --gv-accent: #F5A623;
        --gv-accent-text: #96650A;
        --gv-accent-display: #B0770F;
        --gv-accent-hover: #D68C0F;
        --gv-accent-fill: rgba(245,166,35,0.10);
        --gv-accent-ink: #1A1208;
        /* Raw channels so Tailwind's own /NN opacity-modifier syntax can be
           applied to the accent — a bare var(--gv-accent)/NN silently
           resolves to transparent, since Tailwind cannot inject an alpha
           channel into an opaque var() reference. Use
           rgb(var(--gv-accent-rgb)/0.NN) everywhere a translucent accent is
           needed. Verified live before this plan was dispatched. Identical
           in both themes (the accent hue itself does not change), so this
           is declared once here and not repeated under .dark. */
        --gv-accent-rgb: 245 166 35;
      }
      .dark {
        --gv-bg: #0A0A0A;
        --gv-panel: #151515;
        --gv-panel-2: #1A1A1A;
        --gv-ink-rgb: 245 244 241;
        --gv-text-primary: #F5F4F1;
        --gv-text-secondary: #C9C6BE;
        --gv-text-tertiary: #8A8780;
        --gv-text-muted: #6E6B65;
        --gv-surface-2: rgb(var(--gv-ink-rgb) / 0.06);
        --gv-surface-3: rgb(var(--gv-ink-rgb) / 0.10);
        --gv-surface-4: rgb(var(--gv-ink-rgb) / 0.14);
        --gv-border-subtle: rgb(var(--gv-ink-rgb) / 0.06);
        --gv-border-default: rgb(var(--gv-ink-rgb) / 0.10);
        --gv-border-strong: rgb(var(--gv-ink-rgb) / 0.14);
        --gv-accent-text: #F5A623;
        --gv-accent-display: #F5A623;
        --gv-accent-hover: #ffb833;
        --gv-accent-fill: rgba(245,166,35,0.06);
      }
```

(`--gv-surface-1` and `--gv-accent` are identical in both themes since they're defined via the same `rgb(var(--gv-ink-rgb)/0.03)` expression / literal `#F5A623` — `--gv-ink-rgb` itself already flips, so `--gv-surface-1` correctly resolves to a dark tint on a light background and a light tint on a dark background without needing to be redeclared under `.dark`. Same reasoning for why `--gv-accent`, `--gv-accent-ink`, `--gv-panel-2`'s formula... note `--gv-panel-2` and `--gv-bg`/`--gv-panel`/text tokens ARE literal hex, so those DO need explicit `.dark` overrides, which the block above provides.)

- [ ] **Step 2: Fix the unconditional background rule**

Find (currently lines 67-73):

```css
      /* Gravity redesign — applied when body has .gravity-shell class */
      body.gravity-shell,
      html.dark body.gravity-shell {
        background-color: #0A0A0A !important;
        color: #F5F4F1 !important;
      }
```

Replace with:

```css
      /* Gravity redesign — applied when body has .gravity-shell class.
         Uses the token pair above so this now actually varies by theme —
         previously hardcoded dark regardless of .dark, which is why light
         mode had no visible effect on Gravity pages at all. */
      body.gravity-shell {
        background-color: var(--gv-bg) !important;
        color: var(--gv-text-primary) !important;
      }
```

- [ ] **Step 3: Verify live**

Run (or confirm already running) `preview_start` with name `gravity-frontend`. Navigate to `http://localhost:3000/#/dashboard`. Confirm dark mode (the default) is visually unchanged — same near-black background, same warm white text.

Then in the browser console: `document.documentElement.classList.remove('dark')`. The page background outside the sidebar should turn to a soft warm off-white (`#FAF9F6`). It's fine that page *content* still looks broken/dark at this point — that's expected until Tasks 2-9 land. Only the outermost background/text should have changed.

- [ ] **Step 4: Commit**

```bash
git add frontend/index.html
git commit -m "Add Gravity light-mode tokens; fix the unconditional dark-only background rule"
```

---

### Task 2: `components/gravity/index.tsx` — shared primitives

**Files:**
- Modify: `components/gravity/index.tsx` (entire file, 335 lines)

**Interfaces:**
- Consumes: all `--gv-*` tokens from Task 1.
- Produces: `GravityLabel`, `GravityHero`, `GravityEmphasis`, `GravityPanel`, `GravityMetaBox`, `GravityOptionPopover`, `GravityStepRail`, `GravityFileInput`, `GravityButton` — unchanged exports/props, only their internal class strings and inline styles change. Every page task below imports these.

- [ ] **Step 1: Replace the file's content**

This file is small enough to give as a complete replacement rather than a diff. Replace the entire contents of `components/gravity/index.tsx` with:

```tsx
/**
 * Gravity design system — the vocabulary the Create tab established, extracted
 * so every other page can reuse it instead of re-deriving it.
 *
 * Colour and input styling already come free from the `gravity-shell` override
 * layer in index.html. What lives here is the part that layer cannot retrofit:
 * typographic hierarchy, spacing rhythm, and the halo/beam treatments.
 *
 * Lifted from pages/GravityCreate.tsx — these are proven, not invented.
 */
import React from 'react';
import { Upload } from 'lucide-react';
import { BorderBeam } from '../ui/border-beam';

/** Small-caps meta label. Pairs with the `.gravity-label` class in index.html. */
export const GravityLabel: React.FC<{
  children: React.ReactNode;
  gold?: boolean;
  className?: string;
}> = ({ children, gold = false, className = '' }) => (
  <div className={`gravity-label ${gold ? 'text-[var(--gv-accent-text)]' : ''} ${className}`}>
    {children}
  </div>
);

/**
 * Page hero: gold eyebrow, serif display headline, muted subcopy.
 * `emphasis` is rendered italic in gold, the way Create highlights one word.
 */
export const GravityHero: React.FC<{
  eyebrow?: string;
  headline: React.ReactNode;
  subcopy?: string;
  align?: 'center' | 'left';
  /** 'lg' is the full entry-point hero; 'md' is a working step header. */
  size?: 'lg' | 'md';
  className?: string;
}> = ({ eyebrow, headline, subcopy, align = 'center', size = 'lg', className = '' }) => {
  const lg = size === 'lg';
  return (
    <div className={`${align === 'center' ? 'text-center' : 'text-left'} ${lg ? 'mb-10' : 'mb-6'} ${className}`}>
      {eyebrow && <GravityLabel gold className={lg ? 'mb-4' : 'mb-2'}>{eyebrow}</GravityLabel>}
      <h1
        className={`font-serif-display leading-[1.1] tracking-[-0.02em] text-[var(--gv-text-primary)] ${
          lg ? 'text-[clamp(34px,4.4vw,56px)] leading-[1.05] mb-5' : 'text-[26px] mb-2'
        }`}
      >
        {headline}
      </h1>
      {subcopy && (
        <p
          className={`text-[var(--gv-text-secondary)] leading-relaxed ${lg ? 'text-[15px] max-w-[560px]' : 'text-[13.5px] max-w-[620px]'} ${
            align === 'center' ? 'mx-auto' : ''
          }`}
        >
          {subcopy}
        </p>
      )}
    </div>
  );
};

/** The gold italic emphasis word used inside a GravityHero headline (headline scale — uses the large-text-safe accent). */
export const GravityEmphasis: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="italic text-[var(--gv-accent-display)]">{children}</span>
);

const usePanelSurface = (): React.CSSProperties => ({
  background:
    'linear-gradient(180deg, rgb(var(--gv-ink-rgb) / 0.05) 0%, rgb(var(--gv-ink-rgb) / 0.01) 45%, rgb(var(--gv-ink-rgb) / 0.03) 100%), var(--gv-panel)',
  boxShadow:
    'inset 0 1px 0 0 rgb(var(--gv-ink-rgb) / 0.10), inset 0 -1px 0 0 rgba(0,0,0,0.12), inset 0 0 70px rgba(245,166,35,0.05)',
});

/**
 * The metal card.
 *
 * `halo` and `beam` are deliberately OFF by default: the glow reads as special
 * because it is rare. Give a page at most one panel with them enabled.
 *
 * With `beam` on, the travelling light IS the border, so the card carries no
 * 1px outline of its own — a competing outline would sit right on top of it.
 */
export const GravityPanel: React.FC<{
  children: React.ReactNode;
  halo?: boolean;
  beam?: boolean;
  className?: string;
  /** Classes for the inner content wrapper — spacing utilities belong here,
      since `className` lands on the outer surface whose children are the
      glow layer and this wrapper, not the content itself. */
  contentClassName?: string;
  padding?: string;
}> = ({ children, halo = false, beam = false, className = '', contentClassName = '', padding = 'p-5' }) => {
  const panelSurface = usePanelSurface();
  const surface = (
    <div className={`relative rounded-2xl ${padding} ${beam ? '' : 'border border-[var(--gv-border-subtle)]'} ${className}`} style={panelSurface}>
      {/* Ambient interior glow, warm to match the travelling beam. Clipped to
          the panel's radius here rather than with overflow-hidden on the
          surface, which would cut off popovers and dropdowns in the content. */}
      <div
        className="pointer-events-none absolute inset-0 -z-0 rounded-2xl overflow-hidden"
        style={{ background: 'radial-gradient(60% 100% at 50% 100%, rgba(245,166,35,0.09) 0%, transparent 60%)' }}
      />
      <div className={`relative ${contentClassName}`}>{children}</div>
    </div>
  );

  if (!halo && !beam) return surface;

  return (
    <div className="relative">
      {halo && <div className="metalHalo" aria-hidden />}
      {beam ? (
        <BorderBeam
          size="md"
          colorVariant="sunset"
          theme="dark"
          saturation={1.35}
          brightness={2.4}
          hueRange={18}
          duration={3.6}
          borderRadius={16}
          strength={1}
          className="relative block"
          style={{ zIndex: 1 }}
        >
          {surface}
        </BorderBeam>
      ) : (
        surface
      )}
    </div>
  );
};

/**
 * A labelled setting box — icon, label, current value, EDIT affordance.
 * Pair with GravityOptionPopover for the dropdown, anchored by a
 * `relative`-positioned wrapper.
 */
export const GravityMetaBox: React.FC<{
  label: string;
  value: string;
  Icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  actionText?: string;
}> = ({ label, value, Icon, onClick, actionText = 'Edit' }) => (
  <button
    type="button"
    onClick={onClick}
    className="group relative flex items-center gap-4 h-[68px] px-5 rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] hover:bg-[var(--gv-surface-2)] hover:border-[var(--gv-border-default)] transition-all text-left w-full"
  >
    <span className="w-9 h-9 rounded-md bg-[var(--gv-accent-fill)] border border-[rgb(var(--gv-accent-rgb)/0.20)] flex items-center justify-center flex-shrink-0">
      <Icon className="w-4 h-4 text-[var(--gv-accent)]" />
    </span>
    <div className="flex-1 min-w-0">
      <div className="gravity-label mb-0.5">{label}</div>
      <div className="text-[14px] font-semibold text-[var(--gv-text-primary)] truncate">{value}</div>
    </div>
    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--gv-text-muted)] group-hover:text-[var(--gv-accent-text)]">
      {actionText}
    </span>
  </button>
);

export type GravityOption = { value: string; label: string };

/** Dropdown panel for a GravityMetaBox. Renders nothing when closed. */
export const GravityOptionPopover: React.FC<{
  open: boolean;
  options: GravityOption[];
  onPick: (value: string) => void;
  onClose: () => void;
}> = ({ open, options, onPick, onClose }) => {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute top-full left-0 right-0 mt-2 rounded-xl border border-[var(--gv-border-default)] bg-[var(--gv-panel)] shadow-2xl z-50 overflow-hidden max-h-72 overflow-y-auto">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => { onPick(o.value); onClose(); }}
            className="w-full text-left px-4 py-2.5 text-[13px] text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] transition-colors"
          >
            {o.label}
          </button>
        ))}
      </div>
    </>
  );
};

export type GravityStep = {
  label: string;
  state: 'done' | 'active' | 'upcoming';
  clickable: boolean;
};

/**
 * Slim progress rail for multi-step flows — numbered nodes on a connecting
 * line, rather than a grid of buttons.
 *
 * The parent computes each step's state and clickability; this only renders.
 * Labels live in hover tooltips with the active step named underneath, so an
 * 11-step flow stays one compact row instead of a wrapping keypad.
 */
export const GravityStepRail: React.FC<{
  steps: GravityStep[];
  onStepClick: (index: number) => void;
  className?: string;
}> = ({ steps, onStepClick, className = '' }) => {
  const activeIndex = steps.findIndex((s) => s.state === 'active');
  const activeLabel = activeIndex >= 0 ? steps[activeIndex].label : '';

  return (
    <div className={className}>
      <div className="flex items-center">
        {steps.map((s, i) => (
          <React.Fragment key={`${s.label}-${i}`}>
            <div className="relative group flex-shrink-0">
              <button
                type="button"
                disabled={!s.clickable}
                onClick={() => s.clickable && onStepClick(i)}
                aria-label={s.label}
                aria-current={s.state === 'active' ? 'step' : undefined}
                className={`flex items-center justify-center rounded-full text-[11px] font-semibold transition-all ${
                  s.state === 'active'
                    ? 'w-8 h-8 bg-[var(--gv-accent)] text-[var(--gv-accent-ink)] shadow-[0_0_18px_rgba(245,166,35,0.45)] ring-2 ring-[rgb(var(--gv-accent-rgb)/0.25)]'
                    : s.state === 'done'
                      ? 'w-7 h-7 bg-[rgb(var(--gv-accent-rgb)/0.85)] text-[var(--gv-accent-ink)] hover:bg-[var(--gv-accent)] cursor-pointer'
                      : 'w-7 h-7 border border-[var(--gv-border-default)] text-[var(--gv-text-muted)]'
                } ${!s.clickable && s.state !== 'active' ? 'cursor-default' : ''}`}
              >
                {i + 1}
              </button>
              {/* Label on hover, above the node — below would collide with
                  the active step's name printed under the rail. */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 px-2.5 py-1.5 rounded-lg bg-[var(--gv-panel)] border border-[var(--gv-border-default)] text-[11px] text-[var(--gv-text-primary)] whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-30 shadow-xl">
                {s.label}
              </div>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`flex-1 h-px mx-1.5 sm:mx-2 ${
                  steps[i].state === 'done' ? 'bg-[rgb(var(--gv-accent-rgb)/0.35)]' : 'bg-[var(--gv-surface-3)]'
                }`}
              />
            )}
          </React.Fragment>
        ))}
      </div>
      {activeLabel && (
        <div className="mt-3.5 text-center">
          <span className="gravity-label">
            Step {activeIndex + 1} of {steps.length}
          </span>
          <div className="text-[13.5px] font-semibold text-[var(--gv-text-primary)] mt-0.5">{activeLabel}</div>
        </div>
      )}
    </div>
  );
};

/**
 * File picker.
 *
 * `<input type="file">` renders its button with native OS chrome that no
 * amount of CSS can restyle — the reason uploads looked pasted-in against
 * everything else. The only reliable fix is to hide the real input and drive
 * it from a element we control, which is what this does.
 */
export const GravityFileInput: React.FC<{
  accept?: string;
  onFile: (file: File | undefined) => void;
  disabled?: boolean;
  buttonText?: string;
  /** Name of the current selection, shown beside the button. */
  fileName?: string;
  className?: string;
}> = ({ accept, onFile, disabled = false, buttonText = 'Choose file', fileName, className = '' }) => {
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => ref.current?.click()}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12.5px] font-semibold transition-all border border-[var(--gv-border-default)] text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] hover:border-[var(--gv-border-strong)] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Upload className="w-3.5 h-3.5 text-[var(--gv-accent)]" />
        {buttonText}
      </button>
      <span className="text-[12px] text-[var(--gv-text-tertiary)] truncate">
        {fileName || 'No file chosen'}
      </span>
      <input
        ref={ref}
        type="file"
        accept={accept}
        disabled={disabled}
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          // Reset so picking the same file twice still fires onChange.
          e.target.value = '';
        }}
      />
    </div>
  );
};

/** Primary (gold) and ghost buttons, matching Create's action styling. */
export const GravityButton: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost';
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
}> = ({ children, onClick, variant = 'primary', disabled = false, className = '', type = 'button' }) => {
  const base =
    'inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed';
  const variants = {
    primary: 'bg-[var(--gv-accent)] text-[var(--gv-accent-ink)] hover:bg-[var(--gv-accent-hover)] shadow-[0_4px_18px_rgba(245,166,35,0.20)]',
    ghost: 'border border-[var(--gv-border-default)] text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] hover:border-[var(--gv-border-strong)]',
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
};
```

Note on `PANEL_SURFACE`: the original was a module-level `const` object with literal rgba values. It's now a `usePanelSurface()` function returning a fresh object using CSS var references — it doesn't need to be a hook (no hook calls inside), a plain function would do, but naming it with a `use` prefix is avoided on purpose to not imply it's a hook; if you prefer, rename to `buildPanelSurface()`. Either way, it must be **called inside** `GravityPanel`'s render (not hoisted to module scope like the original), since the CSS variables it references need to resolve fresh — though in practice since these are plain CSS variable *strings* (not JS-evaluated), a module-level constant would actually still work fine (the string `'...var(--gv-panel)'` doesn't need re-evaluation per render). Simplify back to a module-level `const PANEL_SURFACE` object exactly like the original if you prefer — functionally equivalent, and less churn from the original file's shape.

- [ ] **Step 2: Verify no leftover literal colors**

```bash
grep -n 'text-\[#F5A623\]\|bg-\[#F5A623\]\|border-\[#F5A623\]\|text-\[#F5F4F1\]\|bg-\[#151515\]\|white/\[0\.' components/gravity/index.tsx
```
Expected: no output (except inside comments, which is fine).

- [ ] **Step 3: Visual check**

With the dev server running, navigate to `http://localhost:3000/#/create` (uses `GravityHero`, `GravityMetaBox`, `GravityOptionPopover`, `GravityButton` extensively). Toggle dark mode off via the console command from Task 1. Screenshot. Confirm: hero headline text is dark and readable, the gold eyebrow label and emphasis word are legible (not washed out), MetaBox pills show a visible card background distinct from the page, popover dropdown is visibly a raised white card. Also specifically confirm the `BorderBeam` animated shimmer (visible when a `GravityPanel` is rendered with `beam` enabled, e.g. Create's main hero card) still reads correctly in light mode — the spec flagged this as "likely fine, gold-toned already" rather than confirmed; if it looks wrong (e.g. its own internal glow color assumes a dark backdrop), that's a real finding to fix here, not something to wave through. Toggle back on and confirm dark mode is pixel-identical to before this task.

- [ ] **Step 4: Commit**

```bash
git add components/gravity/index.tsx
git commit -m "Migrate Gravity shared primitives (Hero/Button/Panel/MetaBox/etc) to light-mode tokens"
```

---

### Task 3: `pages/GravityCalendar.tsx`

**Files:**
- Modify: `pages/GravityCalendar.tsx` (entire file, 278 lines)

**Interfaces:**
- Consumes: `--gv-*` tokens (Task 1), `GravityHero` (Task 2).

- [ ] **Step 1: Replace the file's content**

Replace the entire contents of `pages/GravityCalendar.tsx` with:

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Loader2 } from 'lucide-react';
import { apiService } from '../services/api';
import { Campaign } from '../types';
import { GravityHero } from '../components/gravity';

// Gravity Calendar — a real month grid: jump to any month, see every day at
// once, posts sit on the day they're actually scheduled for with a
// thumbnail. Previously a 2-week rolling window (±14 days); rebuilt to full
// months because a monthly client report needs "show me August," not a
// window that happens to include some of August.

const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const MONTH_LABELS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function startOfMondayWeek(d: Date) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  const dow = c.getDay(); // 0=Sun..6=Sat
  const diff = dow === 0 ? -6 : 1 - dow; // shift to Monday
  c.setDate(c.getDate() + diff);
  return c;
}

function addDays(d: Date, n: number) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const PLATFORM_DOT: Record<string, string> = {
  instagram: '#E1306C',
  facebook: '#1877F2',
  linkedin: '#0A66C2',
  x: '#F5F4F1',
  twitter: '#F5F4F1',
  youtube: '#FF0000',
};

const GravityCalendar: React.FC = () => {
  const navigate = useNavigate();
  const [anchorMonth, setAnchorMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await apiService.getCampaigns();
        if (!cancelled) setCampaigns(Array.isArray(res?.campaigns) ? res.campaigns : []);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  // A calendar grid always shows whole weeks — the last few days of the
  // previous month and the first few of the next fill out the first/last
  // row rather than leaving a ragged edge. Those days still render (a post
  // scheduled on Aug 31 should be visible from September's view too) but
  // dimmed, so it's obvious at a glance which days belong to this month.
  const weeks = useMemo(() => {
    const monthStart = anchorMonth;
    const monthEnd = new Date(anchorMonth.getFullYear(), anchorMonth.getMonth() + 1, 0);
    const gridStart = startOfMondayWeek(monthStart);
    const gridEnd = addDays(startOfMondayWeek(monthEnd), 6);

    const days: Date[] = [];
    let cursor = gridStart;
    while (cursor.getTime() <= gridEnd.getTime()) {
      days.push(cursor);
      cursor = addDays(cursor, 1);
    }

    const rows: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
    return rows;
  }, [anchorMonth]);

  const monthLabel = MONTH_LABELS[anchorMonth.getMonth()];
  const yearLabel = anchorMonth.getFullYear();

  // Group campaigns by day
  const postsByDay = useMemo(() => {
    const map = new Map<string, any[]>();
    campaigns.forEach((c: any) => {
      const raw = c?.scheduling?.startDate || c?.scheduledDate;
      if (!raw) return;
      const d = new Date(raw);
      if (isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const arr = map.get(key) || [];
      arr.push({
        id: c._id,
        date: d,
        time: d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        title: c.name || c.creative?.textContent?.slice(0, 40) || 'Post',
        image: c.creative?.imageUrls?.[0] || null,
        platform: (c.platforms || [])[0] || 'instagram',
        status: c.status || 'scheduled',
      });
      map.set(key, arr);
    });
    // Sort within each day
    map.forEach((arr) => arr.sort((a, b) => a.date.getTime() - b.date.getTime()));
    return map;
  }, [campaigns]);

  const postsFor = (d: Date) => postsByDay.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`) || [];

  const totalPosts = useMemo(() => {
    const all = weeks.flat();
    return all.reduce((sum, d) => sum + postsFor(d).length, 0);
  }, [weeks, postsByDay]);

  const awaitingApproval = campaigns.filter((c: any) => String(c.status || '').toLowerCase() === 'draft').length;

  const today = new Date();

  return (
    <div className="max-w-[1440px] mx-auto pb-16">
      {/* Header */}
      <div className="flex items-start justify-between mb-8 gap-6">
        <GravityHero
          align="left"
          eyebrow="Schedule"
          headline={<>{monthLabel} <span className="italic text-[var(--gv-accent-display)]">{yearLabel}</span></>}
          className="!mb-0"
        />
        <div className="flex items-center gap-2 flex-shrink-0 mt-8">
          <button
            onClick={() => setAnchorMonth((m) => addMonths(m, -1))}
            title="Previous month"
            className="w-9 h-9 rounded-lg border border-[var(--gv-border-default)] flex items-center justify-center text-[var(--gv-text-tertiary)] hover:text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)]"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setAnchorMonth(startOfMonth(new Date()))}
            className="h-9 px-4 rounded-lg border border-[var(--gv-border-default)] text-[13px] font-semibold text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)]"
          >
            Today
          </button>
          <button
            onClick={() => setAnchorMonth((m) => addMonths(m, 1))}
            title="Next month"
            className="w-9 h-9 rounded-lg border border-[var(--gv-border-default)] flex items-center justify-center text-[var(--gv-text-tertiary)] hover:text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)]"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Legend + totals */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          {['instagram','facebook','linkedin','x'].map((p) => (
            <div key={p} className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: PLATFORM_DOT[p] || 'var(--gv-text-primary)' }} />
              <span className="text-[11.5px] text-[var(--gv-text-tertiary)] capitalize">{p === 'x' ? 'X' : p}</span>
            </div>
          ))}
        </div>
        <div className="text-[11.5px] text-[var(--gv-text-tertiary)]">
          <span className="text-[var(--gv-text-primary)] font-semibold tabular-nums">{totalPosts}</span> posts this month
          {awaitingApproval > 0 && (
            <>
              <span className="mx-2 text-[var(--gv-text-muted)]">·</span>
              <span className="text-[var(--gv-accent-text)] font-semibold tabular-nums">{awaitingApproval}</span>
              <span> awaiting approval</span>
            </>
          )}
        </div>
      </div>

      {/* Weekday header row — the grid below has no per-day label once it
          spans 4-6 rows, so this anchors which column is which day. */}
      <div className="grid grid-cols-7 gap-3 mb-2">
        {DAY_LABELS.map((label) => (
          <div key={label} className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--gv-text-muted)] px-1">
            {label}
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-[var(--gv-text-tertiary)]">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading calendar…
        </div>
      ) : (
        <div className="space-y-3">
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 gap-3">
              {week.map((d) => {
                const posts = postsFor(d);
                const isToday = sameDay(d, today);
                const inMonth = d.getMonth() === anchorMonth.getMonth();
                return (
                  <div
                    key={d.toISOString()}
                    className={`rounded-xl border p-3 min-h-[150px] flex flex-col transition-colors ${
                      isToday
                        ? 'border-[rgb(var(--gv-accent-rgb)/0.40)] bg-[var(--gv-accent-fill)]'
                        : inMonth
                          ? 'border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] hover:bg-[var(--gv-surface-2)]'
                          : 'border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] opacity-40'
                    }`}
                  >
                    <div className="flex items-baseline justify-end mb-2">
                      <span className={`text-[14px] font-serif-display tabular-nums ${isToday ? 'text-[var(--gv-accent-text)]' : inMonth ? 'text-[var(--gv-text-primary)]' : 'text-[var(--gv-text-muted)]'}`}>
                        {d.getDate()}
                      </span>
                    </div>
                    <div className="flex-1 space-y-1.5">
                      {posts.slice(0, 3).map((p) => (
                        <button
                          key={p.id}
                          onClick={() => navigate('/drafts')}
                          className="w-full flex items-center gap-2 p-1.5 rounded-md bg-[var(--gv-surface-1)] hover:bg-[var(--gv-surface-3)] transition-colors text-left group"
                        >
                          <div className="w-7 h-7 rounded flex-shrink-0 bg-[var(--gv-surface-2)] overflow-hidden">
                            {p.image && <img src={p.image} alt="" className="w-full h-full object-cover" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[9px] font-semibold text-[var(--gv-text-tertiary)] uppercase tracking-wider tabular-nums">
                              {p.time}
                            </div>
                            <div className="text-[10px] text-[var(--gv-text-primary)] truncate leading-tight">
                              {p.title}
                            </div>
                          </div>
                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: PLATFORM_DOT[String(p.platform).toLowerCase()] || 'var(--gv-text-primary)' }} />
                        </button>
                      ))}
                      {posts.length > 3 && (
                        <div className="text-[9.5px] text-[var(--gv-text-muted)] text-center pt-0.5">
                          +{posts.length - 3} more
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 flex justify-center">
        <button
          onClick={() => navigate('/campaigns')}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-[var(--gv-border-default)] hover:border-[rgb(var(--gv-accent-rgb)/0.50)] hover:text-[var(--gv-accent-text)] text-[var(--gv-text-secondary)] text-[13px] font-medium transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New post
        </button>
      </div>
    </div>
  );
};

export default GravityCalendar;
```

Note: `PLATFORM_DOT`'s hex values (Instagram/Facebook/LinkedIn/YouTube brand colors, plus `#F5F4F1` used as the X/Twitter dot color) are platform-brand colors per Global Constraints — left untouched, **except** the two inline `style={{ background: PLATFORM_DOT[p] || '#F5F4F1' }}` fallbacks, which used the literal white as a fallback dot color for an unrecognized platform — that fallback is swapped to `'var(--gv-text-primary)'` so an unknown platform's dot still uses a theme-correct neutral instead of hardcoded white-on-white-in-light-mode.

- [ ] **Step 2: Verify no leftover literal colors**

```bash
grep -n 'text-\[#F5A623\]\|bg-\[#F5A623\]\|border-\[#F5A623\]\|text-\[#F5F4F1\]\|white/\[0\.\|white/[0-9]\+"' pages/GravityCalendar.tsx
```
Expected: no output.

- [ ] **Step 3: Visual check**

Navigate to `http://localhost:3000/#/calendar`. Toggle light mode. Confirm: today's cell is a visible warm gold tint, other in-month cells show a subtle card fill distinct from the page background, out-of-month cells are visibly dimmer, platform legend dots are still their correct brand colors. Toggle back to dark, confirm unchanged.

- [ ] **Step 4: Commit**

```bash
git add pages/GravityCalendar.tsx
git commit -m "Migrate GravityCalendar to light-mode tokens"
```

---

### Task 4: `pages/GravityHome.tsx`

**Files:**
- Modify: `pages/GravityHome.tsx` (entire file, 380 lines)

**Interfaces:**
- Consumes: `--gv-*` tokens (Task 1), `GravityHero`, `GravityEmphasis` (Task 2).

- [ ] **Step 1: Replace the file's content**

Replace the entire contents of `pages/GravityHome.tsx` with:

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ArrowRight, Sparkles } from 'lucide-react';
import { apiService, draftsAPI } from '../services/api';
import { Draft, Campaign } from '../types';
import { GravityHero, GravityEmphasis } from '../components/gravity';

// Gravity Home — matches the prototype's Home screen exactly, wired to
// real backend data (drafts, campaigns, credits) so it drops in as
// /dashboard without losing information.

const DAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTH_LABELS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

function startOfDay(d: Date) { const c = new Date(d); c.setHours(0,0,0,0); return c; }
function isSameDay(a: Date, b: Date) { return startOfDay(a).getTime() === startOfDay(b).getTime(); }
function isThisWeek(a: Date) {
  const now = new Date();
  const start = startOfDay(now);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(start); end.setDate(end.getDate() + 7);
  return a >= start && a < end;
}
function formatTime12h(d: Date) {
  let h = d.getHours(); const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const s = status.toLowerCase();
  if (s === 'posted' || s === 'published') {
    return <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[#4ADE80]"><Check className="w-3 h-3" /> Posted</span>;
  }
  if (s === 'scheduled') {
    return <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--gv-text-tertiary)]">Scheduled</span>;
  }
  return <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--gv-text-muted)]">{status}</span>;
};

const GravityHome: React.FC = () => {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [d, c] = await Promise.all([
          draftsAPI.getDrafts().catch(() => ({ drafts: [] as Draft[] })),
          apiService.getCampaigns().catch(() => ({ campaigns: [] as Campaign[] })),
        ]);
        if (!cancelled) {
          setDrafts(Array.isArray(d?.drafts) ? d.drafts : []);
          setCampaigns(Array.isArray(c?.campaigns) ? c.campaigns : []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const pendingDrafts = useMemo(
    () => drafts.filter((d: any) => ['pending', 'draft', 'ready', 'processing'].includes(String(d?.status || '').toLowerCase()) === false ? false : true),
    [drafts]
  );

  const todaysPlan = useMemo(() => {
    const today = new Date();
    return campaigns
      .map((c: any) => {
        const raw = c?.scheduling?.startDate || c?.scheduling?.scheduledFor || c?.scheduledDate;
        if (!raw) return null;
        const d = new Date(raw);
        if (!isSameDay(d, today)) return null;
        return {
          id: c._id,
          time: formatTime12h(d),
          title: c.name || c.creative?.textContent?.slice(0, 60) || 'Untitled post',
          subtitle: (c.creative?.textContent || '').slice(0, 80),
          image: (c.creative?.imageUrls && c.creative.imageUrls[0]) || null,
          status: (c.status || 'scheduled'),
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.time.localeCompare(b.time))
      .slice(0, 6);
  }, [campaigns]);

  const weeklyStats = useMemo(() => {
    const posted = campaigns.filter((c: any) => {
      const raw = c?.scheduling?.startDate || c?.scheduledDate;
      if (!raw) return false;
      return isThisWeek(new Date(raw)) && ['posted', 'published'].includes(String(c.status || '').toLowerCase());
    });
    const totalPosts = campaigns.filter((c: any) => {
      const raw = c?.scheduling?.startDate || c?.scheduledDate;
      return raw && isThisWeek(new Date(raw));
    }).length;
    const platforms = new Set<string>();
    campaigns.forEach((c: any) => (c.platforms || []).forEach((p: string) => platforms.add(p)));
    return { postedCount: posted.length, totalPosts, platforms: Array.from(platforms).slice(0, 4) };
  }, [campaigns]);

  // Must match what the Approve page counts, or the hero and the sidebar
  // badge disagree. Anything already published/scheduled/rejected is done.
  const AWAITING = new Set(['pending', 'draft', 'ready', 'processing', 'failed', 'completed']);
  const heroReadyCount = drafts.filter((d: any) => {
    const status = String(d?.status || 'draft').toLowerCase();
    const source = String(d?.sourceType || d?.contentType || 'post').toLowerCase();
    if (source === 'reel' || source === 'video') return false;
    return AWAITING.has(status);
  }).length;

  const now = new Date();
  const dateLabel = `${DAY_LABELS[now.getDay()]}, ${MONTH_LABELS[now.getMonth()]} ${now.getDate()}`;

  // Shown only when the account has made nothing yet. Deliberately marked as
  // examples on the card: an unlabelled stack of stock imagery on a personal
  // dashboard reads as "these are your posts", which would be a lie.
  const SAMPLE_STACK = [
    'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&q=80&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&q=80&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1600185365483-26d7a4cc7519?w=400&q=80&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=400&q=80&auto=format&fit=crop',
  ];

  // Card stack — real artwork, real platform, real date. Previously the
  // labels were hardcoded to "IG · TOMORROW/THU/FRI/SAT" regardless of what
  // was actually scheduled, which made the whole panel decorative.
  //
  // Drafts come first and campaigns second: the artwork this account actually
  // generated lives on drafts, so sourcing campaigns alone left the stack as
  // four empty gradient blocks for anyone who had made posts but not yet run
  // a scheduled campaign.
  const stackCards = useMemo(() => {
    // While the fetch is still in flight, drafts/campaigns are both still
    // their initial empty arrays — indistinguishable from a genuinely empty
    // account. Rendering SAMPLE_STACK here was a real bug, not the
    // documented empty-state fallback: on every mount (including navigating
    // back to this tab, which remounts the component and resets this state
    // to []) it flashed real stock photography for however long the fetch
    // took, before snapping to the actual state. Four blank placeholder
    // cards keep the layout stable without claiming to be anyone's content.
    if (loading) {
      return [{ img: '', tag: '', sample: false }, { img: '', tag: '', sample: false }, { img: '', tag: '', sample: false }, { img: '', tag: '', sample: false }];
    }

    const fromDrafts = drafts
      .map((d: any) => ({
        img: d?.imageUrl || d?.creative?.imageUrls?.[0] || '',
        platform: (d?.platforms?.[0] || '').toString(),
        when: d?.scheduledDate || d?.createdAt || null,
      }))
      .filter((d: any) => d.img);

    const fromCampaigns = campaigns
      .map((c: any) => ({
        img: c?.creative?.imageUrls?.[0] || '',
        platform: (c?.platforms?.[0] || '').toString(),
        when: c?.scheduling?.startDate || c?.scheduledDate || null,
      }))
      .filter((c: any) => c.img);

    const real = [...fromDrafts, ...fromCampaigns];

    if (real.length === 0) {
      return SAMPLE_STACK.map((img) => ({ img, tag: 'EXAMPLE', sample: true }));
    }

    const upcoming = real
      .sort((a: any, b: any) => new Date(b.when || 0).getTime() - new Date(a.when || 0).getTime())
      .slice(0, 4);

    return upcoming.map((c: any) => {
      let label = '';
      if (c.when) {
        const d = new Date(c.when);
        if (!isNaN(d.getTime())) {
          const today = new Date(); today.setHours(0, 0, 0, 0);
          const day = new Date(d); day.setHours(0, 0, 0, 0);
          const diff = Math.round((day.getTime() - today.getTime()) / 86400000);
          label = diff === 0 ? 'TODAY' : diff === 1 ? 'TOMORROW' : DAY_LABELS[d.getDay()];
        }
      }
      const platform = c.platform ? c.platform.slice(0, 2).toUpperCase() : '';
      return { img: c.img, tag: [platform, label].filter(Boolean).join(' · '), sample: false };
    });
  }, [drafts, campaigns, loading]);

  return (
    <div className="max-w-[1240px] mx-auto pb-16">
      {/* Setup notice — only shows when there's actual setup to do */}
      {drafts.length === 0 && campaigns.length === 0 && !loading && (
        <div className="mb-8 flex items-center gap-3 px-5 py-4 rounded-xl bg-[var(--gv-surface-1)] border border-[rgb(var(--gv-accent-rgb)/0.25)] relative overflow-hidden">
          <span className="absolute inset-y-0 left-0 w-[3px] bg-[var(--gv-accent)]" />
          <span className="w-2 h-2 rounded-full bg-[var(--gv-accent)]" />
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-semibold text-[var(--gv-text-primary)]">Finish setting up Gravity</div>
            <div className="text-[12px] text-[var(--gv-text-tertiary)] truncate">Connect your social accounts and confirm brand voice — 2 minutes.</div>
          </div>
          <Link to="/connect-socials" className="flex items-center gap-2 text-[12px] font-semibold text-[var(--gv-accent-text)] hover:text-[var(--gv-accent-hover)]">
            <span>0 of 2 done</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {/* HERO */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-8 items-center mb-14">
        <div>
          <GravityHero
            align="left"
            eyebrow={`${dateLabel} · Bengaluru`}
            headline={
              <>
                <span className="tabular-nums">{heroReadyCount}</span> {heroReadyCount === 1 ? 'post' : 'posts'}<br />
                <span>{heroReadyCount === 1 ? 'is' : 'are'} ready for </span>
                <GravityEmphasis>your eye</GravityEmphasis>
                <span>.</span>
              </>
            }
            subcopy="Gravity drafted the week ahead while you slept. Take a minute, tap through, and we'll handle the rest — scheduled, posted, measured."
            className="!mb-8"
          />

          <div className="flex items-center gap-3">
            <Link
              to="/drafts"
              className="flex items-center gap-2 h-11 px-5 rounded-lg bg-[var(--gv-accent)] hover:bg-[var(--gv-accent-hover)] text-[var(--gv-accent-ink)] text-[14px] font-semibold transition-colors shadow-[0_8px_30px_rgba(245,166,35,0.25)]"
            >
              <Check className="w-4 h-4" strokeWidth={3} />
              Review queue
            </Link>
            <Link
              to="/campaigns"
              className="flex items-center gap-2 h-11 px-5 rounded-lg border border-[var(--gv-border-default)] hover:border-[var(--gv-border-strong)] hover:bg-[var(--gv-surface-1)] text-[var(--gv-text-primary)] text-[14px] font-medium transition-colors"
            >
              <Sparkles className="w-4 h-4" />
              Start fresh
            </Link>
          </div>
        </div>

        {/* Photo card stack */}
        <div className="relative w-[440px] h-[300px] hidden lg:block">
          {/* Ambient glow — gold-toned, unchanged by theme */}
          <div className="absolute inset-[-40px] rounded-full blur-3xl opacity-70" style={{ background: 'radial-gradient(60% 50% at 50% 50%, rgba(245,166,35,0.20), transparent 70%)' }} />
          {stackCards.map(({ img, tag, sample }: any, i) => {
            const angle = (i - 1.5) * 6;
            const offsetX = (i - 1.5) * 60;
            const z = i === 2 ? 4 : i === 1 ? 3 : i === 3 ? 2 : 1;
            const scale = i === 2 ? 1.05 : 0.95;
            return (
              <div
                key={i}
                className="absolute top-1/2 left-1/2 w-[160px] h-[220px] rounded-xl bg-[var(--gv-panel)] border border-[var(--gv-border-subtle)] overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
                style={{
                  transform: `translate(-50%, -50%) translateX(${offsetX}px) rotate(${angle}deg) scale(${scale})`,
                  zIndex: z,
                }}
              >
                {img ? (
                  <img src={img} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-[var(--gv-surface-2)] to-[var(--gv-surface-1)]" />
                )}
                {tag && (
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-2 py-1.5 bg-gradient-to-t from-black/70 to-transparent">
                    <span className={`text-[9px] font-semibold tracking-widest ${sample ? 'text-white/55' : 'text-white/80'}`}>{tag}</span>
                    {!sample && (
                      <span className="text-[9px] text-white/60 tabular-nums">{i + 1}/{stackCards.length}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* TODAY'S PLAN + THIS WEEK */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-8">
        {/* Today's Plan */}
        <section>
          <div className="flex items-center justify-between mb-5">
            <div className="gravity-label">Today's Plan</div>
            <div className="text-[11px] text-[var(--gv-text-muted)]">
              {todaysPlan.length} post{todaysPlan.length !== 1 ? 's' : ''} · {weeklyStats.platforms.length} platform{weeklyStats.platforms.length !== 1 ? 's' : ''}
            </div>
          </div>
          {todaysPlan.length === 0 ? (
            <div className="rounded-xl border border-[var(--gv-border-subtle)] p-8 text-center">
              <div className="text-[var(--gv-text-muted)] text-[14px]">Nothing on the schedule for today. Enjoy a slower day.</div>
              <Link to="/content-calendar" className="mt-3 inline-block text-[12px] text-[var(--gv-accent-text)] hover:text-[var(--gv-accent-hover)] font-semibold">
                Open Calendar →
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-[var(--gv-border-subtle)]">
              {todaysPlan.map((item: any) => (
                <div key={item.id} className="flex items-center gap-4 py-4">
                  <div className="flex items-center gap-3 min-w-[110px]">
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      item.status === 'posted' || item.status === 'published' ? 'bg-[var(--gv-accent)]' :
                      item.status === 'scheduled' ? 'bg-[#60A5FA]' : 'bg-[var(--gv-text-muted)]'
                    }`} />
                    <span className="text-[12px] font-medium text-[var(--gv-text-tertiary)] tracking-wider tabular-nums">{item.time}</span>
                  </div>
                  <div className="w-11 h-11 rounded-md bg-[var(--gv-surface-2)] border border-[var(--gv-border-subtle)] overflow-hidden flex-shrink-0">
                    {item.image && <img src={item.image} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-semibold text-[var(--gv-text-primary)] truncate">{item.title}</div>
                    <div className="text-[12px] text-[var(--gv-text-tertiary)] truncate">{item.subtitle}</div>
                  </div>
                  <StatusBadge status={item.status} />
                </div>
              ))}
            </div>
          )}
        </section>

        {/* This Week */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="gravity-label">This Week</div>
            <div className="text-[11px] text-[var(--gv-text-muted)]">vs. last 7d</div>
          </div>

          <div className="rounded-2xl border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] p-6 relative overflow-hidden">
            <div className="absolute -top-16 -right-10 w-40 h-40 rounded-full blur-3xl opacity-40" style={{ background: 'radial-gradient(circle, rgba(245,166,35,0.25), transparent 70%)' }} />
            <div className="relative">
              {/* Posts published — a number we can actually count. Reach and
                  engagement need real analytics; inventing them (this used to
                  render postedCount * 12.4 as "reach") is worse than blank. */}
              <div className="gravity-label mb-3">Published this week</div>
              <div className="flex items-baseline gap-2">
                <span className="font-serif-display text-[56px] leading-none text-[var(--gv-text-primary)] tabular-nums">
                  {weeklyStats.postedCount}
                </span>
                {weeklyStats.totalPosts > 0 && (
                  <span className="text-[15px] text-[var(--gv-text-tertiary)]">of {weeklyStats.totalPosts} planned</span>
                )}
              </div>
              <div className="text-[12px] text-[var(--gv-text-tertiary)] mt-3">
                {weeklyStats.platforms.length > 0
                  ? `across ${weeklyStats.platforms.join(', ')}`
                  : 'No platforms connected yet'}
              </div>
            </div>
          </div>

          {campaigns.slice(0, 1).map((c: any) => (
            <Link to="/campaigns" key={c._id} className="block rounded-2xl border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] p-4 hover:bg-[var(--gv-surface-2)] transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-md bg-[var(--gv-surface-2)] border border-[var(--gv-border-subtle)] overflow-hidden flex-shrink-0">
                  {c.creative?.imageUrls?.[0] && <img src={c.creative.imageUrls[0]} alt="" className="w-full h-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-semibold text-[var(--gv-text-primary)] truncate">{c.name || 'Recent campaign'}</div>
                  {/* Real fields only. This line used to read "24.8K reach ·
                      3,184 likes" for every campaign — both hardcoded. */}
                  <div className="text-[11px] text-[var(--gv-text-tertiary)] capitalize">
                    {[c.status, (c.platforms || []).join(', ')].filter(Boolean).join(' · ') || 'No platforms set'}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </section>
      </div>
    </div>
  );
};

export default GravityHome;
```

Note: the photo-card-stack tag overlay text (`text-white/55`, `text-white/80`, `text-white/60`) is **left as literal white on purpose** — that text sits on `bg-gradient-to-t from-black/70 to-transparent`, a dark scrim drawn over a photo *inside* the card, not on the page background. It needs to stay white-on-dark-scrim regardless of the surrounding page theme, the same reasoning as the `bg-black/[NN]` overlay patterns noted in the spec.

- [ ] **Step 2: Verify no leftover literal colors**

```bash
grep -n 'text-\[#F5A623\]\|bg-\[#F5A623\]\|border-\[#F5A623\]\|text-\[#F5F4F1\]\|bg-\[#151515\]\|white/\[0\.' pages/GravityHome.tsx
```
Expected: no output.

- [ ] **Step 3: Visual check**

Navigate to `http://localhost:3000/#/dashboard`. Toggle light mode. Confirm: hero headline and "your eye" emphasis both legible, "Review queue" gold button has dark text on it (readable), photo-stack card backs show as white cards with dark border, "This Week" panel is a visible light card. Toggle back to dark, confirm unchanged.

- [ ] **Step 4: Commit**

```bash
git add pages/GravityHome.tsx
git commit -m "Migrate GravityHome to light-mode tokens"
```

---

### Task 5: `pages/GravityInsights.tsx`

**Files:**
- Modify: `pages/GravityInsights.tsx` (entire file, 277 lines)

**Interfaces:**
- Consumes: `--gv-*` tokens (Task 1).

- [ ] **Step 1: Replace the file's content**

Replace the entire contents of `pages/GravityInsights.tsx` with:

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { Filter, Download, Loader2 } from 'lucide-react';
import { apiService } from '../services/api';
import { Campaign } from '../types';

// Gravity Insights — matches the prototype's Insights screen: cinematic
// serif hero, big +% growth on right, 4 stat cards, 14-day reach chart,
// top posts list.

const compactK = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
};

const wordsForNumber = (n: number): string => {
  return n.toLocaleString();
};

const GravityInsights: React.FC = () => {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await apiService.getCampaigns();
        if (!cancelled) setCampaigns(Array.isArray(res?.campaigns) ? res.campaigns : []);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  // Compute derived stats from campaigns (real backend data).
  const stats = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
    const twoWeeksAgo = new Date(now); twoWeeksAgo.setDate(now.getDate() - 14);

    const inLast7 = (d: Date) => d >= weekAgo && d <= now;
    const inPrev7 = (d: Date) => d >= twoWeeksAgo && d < weekAgo;

    let reach7d = 0, reachPrev = 0;
    let engagement = 0, engagementPrev = 0;
    let newFollowers = 0;
    let approved = 0, drafts = 0;

    const topPosts: any[] = [];

    campaigns.forEach((c: any) => {
      const raw = c?.scheduling?.startDate || c?.scheduledDate || c?.createdAt;
      const d = raw ? new Date(raw) : null;
      const reach = Number(c?.metrics?.reach || c?.analytics?.reach || 0);
      const eng = Number(c?.metrics?.engagement || c?.analytics?.engagement || 0);
      if (d && !isNaN(d.getTime())) {
        if (inLast7(d)) { reach7d += reach; engagement += eng; }
        if (inPrev7(d)) { reachPrev += reach; engagementPrev += eng; }
      }
      if (String(c?.status || '').toLowerCase() === 'draft') drafts += 1;
      else approved += 1;
      newFollowers += Number(c?.metrics?.newFollowers || 0);

      if (reach > 0) {
        topPosts.push({
          id: c._id,
          title: c.name || c.creative?.textContent?.slice(0, 60) || 'Post',
          image: c.creative?.imageUrls?.[0] || null,
          reach,
          likes: Number(c?.metrics?.likes || 0),
          platform: (c.platforms || [])[0] || 'instagram',
        });
      }
    });

    topPosts.sort((a, b) => b.reach - a.reach);

    const total = approved + drafts;
    const approvalRate = total > 0 ? Math.round((approved / total) * 100) : 0;

    const reachChangePct = reachPrev > 0
      ? Math.round(((reach7d - reachPrev) / reachPrev) * 100)
      : (reach7d > 0 ? 100 : 0);
    const engChangePct = engagementPrev > 0
      ? Math.round(((engagement - engagementPrev) / engagementPrev) * 100)
      : (engagement > 0 ? 100 : 0);

    // Build a 14-day reach series (day-by-day)
    const series: { date: Date; reach: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const day = new Date(now); day.setDate(now.getDate() - i); day.setHours(0,0,0,0);
      let dayReach = 0;
      campaigns.forEach((c: any) => {
        const raw = c?.scheduling?.startDate || c?.scheduledDate || c?.createdAt;
        if (!raw) return;
        const cd = new Date(raw);
        if (cd.getFullYear() === day.getFullYear() && cd.getMonth() === day.getMonth() && cd.getDate() === day.getDate()) {
          dayReach += Number(c?.metrics?.reach || 0);
        }
      });
      series.push({ date: day, reach: dayReach });
    }

    return {
      reach7d, reachPrev, reachChangePct,
      engagement, engChangePct,
      newFollowers, approvalRate,
      topPosts: topPosts.slice(0, 5),
      series,
    };
  }, [campaigns]);

  const hasAnyReach = stats.reach7d > 0;

  // Sparkline path
  const chartPath = useMemo(() => {
    const s = stats.series;
    if (!s.length) return '';
    const max = Math.max(...s.map((p) => p.reach), 1);
    const W = 100, H = 100;
    const step = W / Math.max(1, s.length - 1);
    let d = `M 0 ${H - (s[0].reach / max) * H}`;
    s.forEach((p, i) => {
      if (i === 0) return;
      d += ` L ${(i * step).toFixed(2)} ${(H - (p.reach / max) * H).toFixed(2)}`;
    });
    return d;
  }, [stats.series]);

  const chartFillPath = chartPath ? `${chartPath} L 100 100 L 0 100 Z` : '';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-[var(--gv-text-tertiary)]">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading insights…
      </div>
    );
  }

  return (
    <div className="max-w-[1240px] mx-auto pb-16">
      {/* Header row (right-side actions) */}
      <div className="flex items-center justify-end gap-2 mb-6">
        <button className="flex items-center gap-2 h-9 px-4 rounded-lg border border-[var(--gv-border-default)] text-[var(--gv-text-secondary)] text-[13px] font-medium hover:text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)]">
          <Filter className="w-3.5 h-3.5" />
          Filter
        </button>
        <button className="flex items-center gap-2 h-9 px-4 rounded-lg border border-[var(--gv-border-default)] text-[var(--gv-text-secondary)] text-[13px] font-medium hover:text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)]">
          <Download className="w-3.5 h-3.5" />
          Export
        </button>
      </div>

      {/* HERO */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6 items-end mb-14">
        <div>
          <div className="flex items-center gap-2 mb-5">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--gv-accent)]" />
            <span className="gravity-label">Last 7 days</span>
          </div>
          <h1 className="font-serif-display text-[52px] leading-[1.05] tracking-[-0.02em] text-[var(--gv-text-primary)] mb-4">
            You reached <span className="italic text-[var(--gv-accent-display)] tabular-nums">{wordsForNumber(stats.reach7d)}</span> people<br />
            without lifting a finger.
          </h1>
          <p className="text-[14px] text-[var(--gv-text-secondary)] max-w-[540px]">
            {hasAnyReach
              ? `${stats.reachChangePct >= 0 ? 'Up' : 'Down'} ${Math.abs(stats.reachChangePct)}% week-over-week. Keep the cadence Gravity set for you.`
              : `Once your posts go live, this is where you'll see how many people saw them — no dashboards to build, no spreadsheets to open.`}
          </p>
        </div>

        {hasAnyReach && (
          <div className="text-right">
            <div className="font-serif-display text-[68px] leading-none tabular-nums text-[var(--gv-text-primary)]">
              {stats.reachChangePct >= 0 ? '+' : ''}{stats.reachChangePct}%
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#4ADE80] mt-2">vs. last 7 days</div>
          </div>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        <StatCard label="Reach (7d)" value={hasAnyReach ? compactK(stats.reach7d) : '—'} delta={hasAnyReach ? `${stats.reachChangePct >= 0 ? '+' : ''}${stats.reachChangePct}%` : null} />
        <StatCard label="Engagement" value={stats.engagement > 0 ? compactK(stats.engagement) : '—'} delta={stats.engagement > 0 ? `${stats.engChangePct >= 0 ? '+' : ''}${stats.engChangePct}%` : null} />
        <StatCard label="New Followers" value={stats.newFollowers > 0 ? `${stats.newFollowers}` : '—'} delta={stats.newFollowers > 0 ? '+12%' : null} />
        <StatCard label="Approval Rate" value={`${stats.approvalRate}%`} delta={stats.approvalRate > 0 ? '+3%' : null} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-6">
        {/* CHART */}
        <div className="rounded-2xl border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="gravity-label">Reach · Last 14 Days</div>
            <div className="text-[11px] text-[var(--gv-text-muted)]">
              {hasAnyReach ? '↑ trending' : 'awaiting data'}
            </div>
          </div>
          {hasAnyReach ? (
            <div className="relative h-[220px]">
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
                <defs>
                  <linearGradient id="gravityChartFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#F5A623" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#F5A623" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={chartFillPath} fill="url(#gravityChartFill)" />
                <path d={chartPath} fill="none" stroke="#F5A623" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              </svg>
              <div className="absolute inset-x-0 -bottom-6 flex justify-between text-[10px] text-[var(--gv-text-muted)]">
                <span>{stats.series[0]?.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                <span>{stats.series[stats.series.length - 1]?.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              </div>
            </div>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-[var(--gv-text-muted)] text-[13px]">
              No reach data yet.
            </div>
          )}
        </div>

        {/* TOP POSTS */}
        <div className="rounded-2xl border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] p-6">
          <div className="gravity-label mb-4">Top Posts</div>
          {stats.topPosts.length === 0 ? (
            <div className="text-[var(--gv-text-muted)] text-[13px] py-6 text-center">
              No posts yet. Once you publish, your best-performing posts will show up here.
            </div>
          ) : (
            <div className="divide-y divide-[var(--gv-border-subtle)]">
              {stats.topPosts.map((p, i) => (
                <div key={p.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="text-[11px] font-serif-display text-[var(--gv-text-muted)] tabular-nums w-6">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="w-10 h-10 rounded-md bg-[var(--gv-surface-2)] border border-[var(--gv-border-subtle)] overflow-hidden flex-shrink-0">
                    {p.image && <img src={p.image} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-[var(--gv-text-primary)] truncate leading-tight">{p.title}</div>
                    <div className="text-[10.5px] text-[var(--gv-text-tertiary)] mt-0.5">
                      {p.platform} · {p.likes} likes
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-serif-display text-[16px] text-[var(--gv-text-primary)] tabular-nums leading-none">{compactK(p.reach)}</div>
                    <div className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-[var(--gv-text-muted)] mt-1">reach</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: string; delta: string | null }> = ({ label, value, delta }) => (
  <div className="rounded-2xl border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] p-5">
    <div className="gravity-label mb-3">{label}</div>
    <div className="flex items-baseline gap-2">
      <span className="font-serif-display text-[32px] leading-none text-[var(--gv-text-primary)] tabular-nums">{value}</span>
    </div>
    {delta && (
      <div className={`text-[11px] font-semibold mt-2 ${delta.startsWith('+') ? 'text-[#4ADE80]' : 'text-red-400'}`}>
        {delta}
      </div>
    )}
  </div>
);

export default GravityInsights;
```

Note: the SVG `stopColor="#F5A623"` / `stroke="#F5A623"` values are left as literal hex — SVG presentation attributes don't resolve CSS custom properties the same reliable way class-based Tailwind utilities do across all renderers, and gold is theme-invariant per Global Constraints anyway, so there's no correctness reason to change them.

- [ ] **Step 2: Verify no leftover literal colors**

```bash
grep -n 'text-\[#F5A623\]\|bg-\[#F5A623\]\|border-\[#F5A623\]\|text-\[#F5F4F1\]\|white/\[0\.' pages/GravityInsights.tsx
```
Expected: no output.

- [ ] **Step 3: Visual check**

Navigate to `http://localhost:3000/#/insights`. Toggle light mode. Confirm: big headline number and "reached X people" text legible, stat cards show visible light card backgrounds, chart area has a visible card background with the gold sparkline still clearly gold. Toggle back to dark, confirm unchanged.

- [ ] **Step 4: Commit**

```bash
git add pages/GravityInsights.tsx
git commit -m "Migrate GravityInsights to light-mode tokens"
```

---

### Task 6: `pages/AIMemory.tsx`

**Files:**
- Modify: `pages/AIMemory.tsx` (entire file, 230 lines)

**Interfaces:**
- Consumes: `--gv-*` tokens (Task 1), `GravityHero`, `GravityEmphasis`, `GravityLabel`, `GravityButton` (Task 2), `useConfirm` (unrelated, pre-existing — do not change confirm-dialog behavior).

- [ ] **Step 1: Replace the file's content**

Replace the entire contents of `pages/AIMemory.tsx` with:

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Brain, Pencil, Trash2, RefreshCw, Loader2, ArrowRight, Check, X } from 'lucide-react';
import { aiMemoryAPI } from '../services/api';
import { useConfirm } from '../context/ConfirmContext';
import {
  GravityHero,
  GravityEmphasis,
  GravityLabel,
  GravityButton,
} from '../components/gravity';

type LearnedNote = {
  _id: string;
  text: string;
  category: 'copy' | 'hashtags' | 'cta' | 'visual' | 'timing' | 'format';
  confidence: number;
  updatedAt?: string;
  createdAt?: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  copy: 'Copy',
  hashtags: 'Hashtags',
  cta: 'Calls to action',
  visual: 'Visual style',
  timing: 'Timing',
  format: 'Format'
};

const Panel: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <section className={`rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] p-5 ${className}`}>{children}</section>
);

const NoteRow: React.FC<{
  note: LearnedNote;
  onSave: (id: string, text: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}> = ({ note, onSave, onDelete }) => {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!draft.trim() || draft.trim() === note.text) { setEditing(false); return; }
    setBusy(true);
    try {
      await onSave(note._id, draft.trim());
      setEditing(false);
    } catch {
      // error already surfaced via the parent's statusMsg; keep editing open so the draft isn't lost
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-[var(--gv-border-subtle)] last:border-b-0">
      <span className="mt-0.5 inline-flex items-center rounded-full border border-[rgb(var(--gv-accent-rgb)/0.25)] bg-[var(--gv-accent-fill)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--gv-accent-text)] flex-shrink-0">
        {CATEGORY_LABELS[note.category] || note.category}
      </span>
      {editing ? (
        <div className="flex-1 flex items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="flex-1 px-2.5 py-1.5 rounded-md bg-[var(--gv-surface-2)] border border-[var(--gv-border-default)] text-[13px] text-[var(--gv-text-primary)] outline-none focus:border-[rgb(var(--gv-accent-rgb)/0.40)]"
            autoFocus
          />
          <button onClick={save} disabled={busy} title="Save" className="p-1.5 rounded-md text-emerald-500 hover:bg-[var(--gv-surface-2)] disabled:opacity-40">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => { setDraft(note.text); setEditing(false); }} title="Cancel" className="p-1.5 rounded-md text-[var(--gv-text-muted)] hover:bg-[var(--gv-surface-2)]">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <>
          <p className="flex-1 text-[13px] text-[var(--gv-text-primary)] leading-relaxed">{note.text}</p>
          <button onClick={() => setEditing(true)} title="Edit" className="p-1.5 rounded-md text-[var(--gv-text-muted)] hover:text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] flex-shrink-0">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={async () => { if (await confirm('This removes it from what Gravity uses to plan future posts.', { title: 'Delete this note?', confirmLabel: 'Delete', danger: true })) onDelete(note._id); }} title="Delete" className="p-1.5 rounded-md text-[var(--gv-text-muted)] hover:text-red-500 hover:bg-[var(--gv-surface-2)] flex-shrink-0">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </div>
  );
};

const AIMemory: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [distilling, setDistilling] = useState(false);
  const [data, setData] = useState<any>(null);
  const [statusMsg, setStatusMsg] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await aiMemoryAPI.getSummary();
      setData(res);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const notes: LearnedNote[] = useMemo(() => data?.brandMemory?.learnedNotes || [], [data]);
  const notesUpdatedAt: string | null = data?.brandMemory?.learnedNotesUpdatedAt || null;
  const performanceCount: number = data?.summary?.performanceMemories || 0;

  const saveNote = async (id: string, text: string) => {
    try {
      await aiMemoryAPI.updateNote(id, { text });
      await load();
    } catch (err: any) {
      setStatusMsg(err?.message || 'Could not save the note. Please try again.');
      window.setTimeout(() => setStatusMsg(''), 4000);
      throw err;
    }
  };

  const deleteNote = async (id: string) => {
    try {
      await aiMemoryAPI.deleteNote(id);
      await load();
    } catch (err: any) {
      setStatusMsg(err?.message || 'Could not delete the note. Please try again.');
      window.setTimeout(() => setStatusMsg(''), 4000);
    }
  };

  const refreshNow = async () => {
    setDistilling(true);
    setStatusMsg('');
    try {
      const res = await aiMemoryAPI.distillNow();
      setStatusMsg(res.skipped ? 'No new performance data since the last update.' : 'Updated with the latest performance data.');
      await load();
    } catch (err: any) {
      setStatusMsg(err?.message || 'Could not refresh.');
    } finally {
      setDistilling(false);
      window.setTimeout(() => setStatusMsg(''), 4000);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--gv-accent)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <GravityHero
          align="left"
          eyebrow="AI Memory"
          headline={<>What Gravity has <GravityEmphasis>learned</GravityEmphasis></>}
          subcopy="A small, curated set of patterns learned from your real published-post performance — not a raw log."
          className="!mb-0"
        />
        <GravityButton variant="ghost" onClick={refreshNow} disabled={distilling} className="flex-shrink-0">
          {distilling ? <Loader2 className="w-4 h-4 animate-spin text-[var(--gv-accent)]" /> : <RefreshCw className="w-4 h-4 text-[var(--gv-accent)]" />}
          Refresh now
        </GravityButton>
      </div>

      {statusMsg && (
        <div className="rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-surface-2)] px-4 py-2.5 text-[12.5px] text-[var(--gv-text-secondary)]">
          {statusMsg}
        </div>
      )}

      <Panel>
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-[var(--gv-accent)]" />
            <GravityLabel gold>Learned patterns</GravityLabel>
          </div>
          <span className="text-[11px] text-[var(--gv-text-muted)]">
            Based on {performanceCount} tracked post{performanceCount === 1 ? '' : 's'}
            {notesUpdatedAt ? ` · last updated ${new Date(notesUpdatedAt).toLocaleDateString()}` : ''}
          </span>
        </div>
        {notes.length ? (
          <div className="mt-3">
            {notes.map((note) => (
              <NoteRow key={note._id} note={note} onSave={saveNote} onDelete={deleteNote} />
            ))}
          </div>
        ) : (
          <p className="mt-3 text-[13px] text-[var(--gv-text-tertiary)]">
            Nothing learned yet — this fills in once enough published posts have been tracked
            for at least a few days. Try "Refresh now" after some posts have been live for a while.
          </p>
        )}
      </Panel>

      <div className="grid gap-3 md:grid-cols-3">
        {[
          { to: '/ai-history', label: 'Campaign history' },
          { to: '/ai-history?type=video', label: 'Video history' },
          { to: '/ai-performance', label: 'Performance log' },
        ].map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="group flex items-center justify-between gap-3 rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] px-5 py-4 text-[13.5px] font-semibold text-[var(--gv-text-primary)] transition-all hover:bg-[var(--gv-surface-2)] hover:border-[var(--gv-border-default)]"
          >
            {link.label}
            <ArrowRight className="w-4 h-4 text-[var(--gv-text-muted)] group-hover:text-[var(--gv-accent-text)] transition-colors" />
          </Link>
        ))}
      </div>
    </div>
  );
};

export default AIMemory;
```

Note: the delete/save icon buttons' hover colors (`text-emerald-500 hover:...`, `hover:text-red-500`) were `text-emerald-400`/`hover:text-red-400` in the original — bumped from the `-400` to the `-500` shade, since `-400` (a lighter, saturated green/red tuned for a dark background) loses contrast against the new light `--gv-surface-1`/`--gv-surface-2` backgrounds; `-500` reads clearly on both. This is the one deliberate value change in this file beyond straight token substitution.

- [ ] **Step 2: Verify no leftover literal colors**

```bash
grep -n 'text-\[#F5A623\]\|bg-\[#F5A623\]\|border-\[#F5A623\]\|text-\[#F5F4F1\]\|white/\[0\.\|bg-black/30\|text-white' pages/AIMemory.tsx
```
Expected: no output.

- [ ] **Step 3: Visual check**

Navigate to `http://localhost:3000/#/ai-memory`. Toggle light mode. Confirm: category pills are legible gold-on-cream, note text is dark and readable, "Refresh now" ghost button is legible, bottom link cards show visible borders. Toggle back to dark, confirm unchanged.

- [ ] **Step 4: Commit**

```bash
git add pages/AIMemory.tsx
git commit -m "Migrate AIMemory to light-mode tokens"
```

---

### Task 7: `pages/GravityApprove.tsx`

**Files:**
- Modify: `pages/GravityApprove.tsx` (856 lines — too large to give as a full replacement; apply the deterministic migration table mechanically, plus the specific judgment calls below)

**Interfaces:**
- Consumes: `--gv-*` tokens (Task 1), Gravity primitives (Task 2).

This file is too large to paste as a complete replacement without an unacceptable risk of silently dropping unrelated logic (confirm dialogs, drag/drop, polling) that isn't part of this task. Apply the **deterministic migration table** from Global Constraints across the whole file — every occurrence of a literal class in the left column becomes the token class in the right column, mechanically, with no other changes. The file contains (verified by count at plan-writing time): 18 `bg-white/[…]`, 17 `border-white/[…]`, 40 `text-white/N`, 15 `text-[#F5F4F1]`, 6 `text-[#F5A623]`, 11 `bg-[#F5A623]`, 1 `bg-[#151515]`, 1 gold fill-opacity wash, 1 inline gradient.

- [ ] **Step 1: Apply the deterministic table**

Using your editor's find-and-replace (or a scripted `sed`), apply every row of the "Deterministic migration table" from Global Constraints to `pages/GravityApprove.tsx`. This covers the 18/17/40/15/11/1/1 occurrences above except the 6 `text-[#F5A623]` cases, which need the per-occurrence rule below.

- [ ] **Step 2: Resolve the `text-[#F5A623]` occurrences by hand**

Six occurrences, found at plan-writing time (line numbers may drift slightly if Step 1 changes line counts — search for the surrounding text shown, not just the number):

```
411:        processing: 'bg-[#F5A623]/15 text-[#F5A623]',
532:          You're all <span className="italic text-[#F5A623]">caught up</span>.
696:                  <Loader2 className="w-10 h-10 text-[#F5A623] animate-spin absolute inset-0" strokeWidth={1.5} />
760:                  <span key={i} className="text-[13px] text-[#F5A623]">{h}</span>
793:              <label className="gravity-label block mb-1.5 text-[#F5A623]">Describe the change</label>
829:                  ? 'border-[#F5A623]/50 bg-[#F5A623]/10 text-[#F5A623]'
```

Apply the decision rule from Global Constraints:
- Line 411 (`processing: 'bg-[#F5A623]/15 text-[#F5A623]'`) — a status-badge className string, small text → `bg-[var(--gv-accent-fill)] text-[var(--gv-accent-text)]`.
- Line 532 (`className="italic text-[#F5A623]"` around "caught up") — check the surrounding `<h2>`/`<p>` font-size; if it's a large headline (`text-[28px]` or bigger — confirm by reading the 5 lines above line 532), use `text-[var(--gv-accent-display)]`; otherwise `text-[var(--gv-accent-text)]`.
- Line 696 (`<Loader2 ... text-[#F5A623] ...>`) — icon glyph → `text-[var(--gv-accent)]`.
- Line 760 (hashtag chip text, `text-[13px]`) — small text → `text-[var(--gv-accent-text)]`.
- Line 793 (a `<label>` styled with `.gravity-label`, inherently small-caps/small) → `text-[var(--gv-accent-text)]`.
- Line 829 (an active-state pill: `border-[#F5A623]/50 bg-[#F5A623]/10 text-[#F5A623]`) — small pill text → `border-[rgb(var(--gv-accent-rgb)/0.50)] bg-[var(--gv-accent-fill)] text-[var(--gv-accent-text)]`.

- [ ] **Step 3: Resolve the inline gradient**

Found at plan-writing time:
```
674:          <div className="absolute inset-[-20px] rounded-3xl blur-3xl opacity-70" style={{ background: 'radial-gradient(60% 55% at 50% 50%, rgba(245,166,35,0.16), transparent 70%)' }} />
```
This is a gold ambient glow (identical pattern to `GravityHome.tsx`'s two glows, left unchanged there) — gold-toned radial glows read fine on both a dark and a light background at this opacity. **No change needed**; leave as-is.

- [ ] **Step 4: Verify no leftover literal colors**

```bash
grep -n 'text-\[#F5A623\]\|bg-\[#F5A623\]\|border-\[#F5A623\]\|text-\[#F5F4F1\]\|bg-\[#151515\]\|white/\[0\.\|text-white/[0-9]' pages/GravityApprove.tsx
```
Expected: no output.

- [ ] **Step 5: Visual check**

Navigate to `http://localhost:3000/#/drafts`. Toggle light mode. Check both the grid view and a single-card view (click into one draft). Confirm: status badges (processing/ready/etc.) legible, hashtag chips legible, the "Describe the change" edit-prompt label legible, active tab/filter pills show visible gold accent without disappearing into the background. Toggle back to dark, confirm unchanged.

- [ ] **Step 6: Commit**

```bash
git add pages/GravityApprove.tsx
git commit -m "Migrate GravityApprove to light-mode tokens"
```

---

### Task 8: `pages/GravityCreate.tsx`

**Files:**
- Modify: `pages/GravityCreate.tsx` (1675 lines — largest file in scope; same mechanical-table approach as Task 7, more judgment-call occurrences)

**Interfaces:**
- Consumes: `--gv-*` tokens (Task 1), Gravity primitives (Task 2).

Counts at plan-writing time: 27 `bg-white/[…]`, 28 `border-white/[…]`, 48 `text-white/N`, 20 `text-[#F5F4F1]`, 23 `text-[#F5A623]`, 17 `bg-[#F5A623]`, 2 `bg-[#151515]`, 3 gold fill-opacity washes, 2 inline gradients.

- [ ] **Step 1: Apply the deterministic table**

Same as Task 7 Step 1 — apply every row of the migration table mechanically across the whole file.

- [ ] **Step 2: Resolve the `text-[#F5A623]` occurrences by hand**

23 occurrences, found at plan-writing time (line numbers may drift):

```
67:      <Icon className="w-4 h-4 text-[#F5A623]" />
73:    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35 group-hover:text-[#F5A623]">
120:        danger ? 'hover:text-red-400' : 'hover:text-[#F5A623]'
150:            <Loader2 className="w-6 h-6 animate-spin text-[#F5A623]" />
151:            <div className="gravity-label text-[#F5A623]">Generating</div>
997:          <CalendarIcon className="w-4 h-4 text-[#F5A623]" />
1004:          <SlidersHorizontal className="w-4 h-4 text-[#F5A623]" />
1011:          <Package className="w-4 h-4 text-[#F5A623]" />
1018:            Loaded: <span className="text-[#F5A623]">{pickedIdea}</span>
1083:            <span className="gravity-label text-[#F5A623]">{mode === 'campaign' ? 'Campaign' : 'Post'}</span>
1205:                      ? 'border-[#F5A623] bg-[#F5A623]/12 text-[#F5A623]'
1225:                  ? 'border-[#F5A623] bg-[#F5A623]/12 text-[#F5A623]'
1246:                className="text-[11.5px] text-white/40 hover:text-[#F5A623] underline underline-offset-2"
1327:            <div className="gravity-label text-[#F5A623] mb-3">
1331:              Making something <em className="italic font-normal text-[#F5A623]">good</em>.
1365:            <div className="gravity-label text-[#F5A623] mb-3">
1376:                <>Making something <em className="italic font-normal text-[#F5A623]">good</em>.</>
1378:                <>Your campaign is <em className="italic font-normal text-[#F5A623]">ready</em>.</>
1380:                <>Your carousel is <em className="italic font-normal text-[#F5A623]">ready</em>.</>
1382:                <>Your post is <em className="italic font-normal text-[#F5A623]">ready</em>.</>
1484:                              <div className="gravity-label text-[#F5A623]">Prompt sent to the image model</div>
1542:                              <div className="gravity-label text-[#F5A623]">Describe the change</div>
1623:                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#F5A623]/15 text-[#F5A623] text-[11.5px] font-semibold disabled:opacity-40"
```

Apply the decision rule from Global Constraints:
- Lines 67, 150, 997, 1004, 1011 (`<Icon>`/`<Loader2>`/`<CalendarIcon>`/`<SlidersHorizontal>`/`<Package>` — all lucide icon components) → `text-[var(--gv-accent)]`.
- Lines 73, 120, 151, 1018, 1083, 1246, 1327, 1365, 1484, 1542, 1623 (small labels, `.gravity-label` text, hover links, a `13px`-scale badge, "Loaded: X" inline text) → `text-[var(--gv-accent-text)]` (and for the two `hover:text-[#F5A623]` occurrences, `hover:text-[var(--gv-accent-text)]`).
- Lines 1205, 1225 (`border-[#F5A623] bg-[#F5A623]/12 text-[#F5A623]` — an active-tab-style pill, small text) → `border-[var(--gv-accent)] bg-[var(--gv-accent-fill)] text-[var(--gv-accent-text)]`.
- Lines 1331, 1376, 1378, 1380, 1382 (`<em className="italic font-normal text-[#F5A623]">` inside `<h2 className="text-[42px] ...">Making something <em>...` — confirmed large headline scale, 42px) → `text-[var(--gv-accent-display)]`.

- [ ] **Step 3: Resolve the two inline gradients**

```
1075:          background: 'linear-gradient(180deg, rgba(255,214,150,0.055) 0%, rgba(255,255,255,0.012) 45%, rgba(255,196,84,0.028) 100%), #0f0d0a',
1080:        <div className="pointer-events-none absolute inset-0 -z-0" style={{ background: 'radial-gradient(60% 100% at 50% 100%, rgba(245,166,35,0.09) 0%, transparent 60%)' }} />
```

These are the exact same "hero panel surface" and "ambient interior glow" pattern already migrated in Task 2's `GravityPanel`/`usePanelSurface` (this page has its own inline copy, predating the shared component). Replace line 1075's value with the same expression used in Task 2:
```
'linear-gradient(180deg, rgb(var(--gv-ink-rgb) / 0.05) 0%, rgb(var(--gv-ink-rgb) / 0.01) 45%, rgb(var(--gv-ink-rgb) / 0.03) 100%), var(--gv-panel)',
```
Line 1080's radial gold glow stays unchanged (gold-toned, same reasoning as Task 7 Step 3).

Also check the `boxShadow` on the same style object as line 1075 (immediately adjacent) for a matching `rgba(255,214,150,...)`/`rgba(0,0,0,0.6)` pair — if present, apply the same swap as `GravityPanel`'s `usePanelSurface` in Task 2: the highlight rgba becomes `rgb(var(--gv-ink-rgb) / 0.10)` and the shadow rgba becomes `rgba(0,0,0,0.12)`.

- [ ] **Step 4: Verify no leftover literal colors**

```bash
grep -n 'text-\[#F5A623\]\|bg-\[#F5A623\]\|border-\[#F5A623\]\|text-\[#F5F4F1\]\|bg-\[#151515\]\|white/\[0\.\|text-white/[0-9]' pages/GravityCreate.tsx
```
Expected: no output.

- [ ] **Step 5: Visual check**

Navigate to `http://localhost:3000/#/create`. Toggle light mode. Walk through all three modes (Campaign/Single post/Carousel tabs). Confirm: the hero prompt card shows a visible warm-tinted panel (not invisible against the page), all MetaBox pills (Duration/Cadence/Tone/Visual Style/Language/Logo position) are legible, the pending-generation "Making something good" headline is legible with gold emphasis, the edit-prompt panel's "Describe the change" label and hashtag chips are legible.

Specifically check the logo-picker swatches (the small square buttons next to "No logo" in the Logo row) — the spec flagged these as a known risk: they sit on `bg-white/[0.04]`, which the deterministic table maps to `--gv-surface-2`, a fairly subtle ~5% tint even in light mode. If a white or light-colored logo becomes hard to distinguish from its own swatch background, bump that specific swatch's background from `bg-[var(--gv-surface-2)]` to `bg-[var(--gv-panel-2)]` (a flat, more visible card tone) — this is a legitimate deviation from the mechanical table for this one element, not a bug to leave in.

Toggle back to dark, confirm unchanged.

- [ ] **Step 6: Commit**

```bash
git add pages/GravityCreate.tsx
git commit -m "Migrate GravityCreate to light-mode tokens"
```

---

### Task 9: `components/Layout.tsx` — sidebar tokens + toggle

**Files:**
- Modify: `components/Layout.tsx` (464 lines)

**Interfaces:**
- Consumes: `--gv-*` tokens (Task 1), `useTheme()` (already imported in this file — `isDarkMode`/`toggleTheme`, from `frontend/context/ThemeContext.tsx`).

Counts at plan-writing time (sidebar-specific hardcoded classes, separate from this file's pre-existing `isDarkMode`-gated legacy sections, which are untouched): 13 `bg-white/[…]`, 11 `border-white/[…]`, 26 `text-white/N`, 14 `text-[#F5F4F1]`, 6 `text-[#F5A623]`, 6 `bg-[#F5A623]`, 1 `bg-[#151515]`.

- [ ] **Step 1: Apply the deterministic table to the sidebar-specific markup**

This file already has legacy sections correctly gated by `isDarkMode ? x : y` ternaries — **do not touch those**; only the hardcoded-dark sidebar markup identified in this plan's investigation (the `aside` sidebar, its nav items, account chip, mobile header — roughly the region from the `NavLink`/nav-item renderer function through the end of the sidebar's JSX, based on the line numbers found: 184-311 and 394-429 at plan-writing time). Apply the deterministic migration table from Global Constraints to every hardcoded class in that region.

- [ ] **Step 2: Resolve the `text-[#F5A623]` occurrences by hand**

Six occurrences found at plan-writing time:

```
191:        <Icon className={`w-[15px] h-[15px] ${active ? 'text-[#F5A623]' : 'text-white/45 group-hover:text-white/70'}`} />
255:                <span className="w-7 h-7 rounded-md bg-gradient-to-br from-[#3a2410] to-[#1a0f04] border border-white/[0.08] text-[11px] font-semibold text-[#F5A623] flex items-center justify-center">
311:              className="text-white/80 hover:text-[#F5A623]"
394:                              trialInfo.daysLeft <= 2 ? 'bg-red-500/10 text-red-400' : 'bg-[#F5A623]/10 text-[#F5A623]'
416:                            <span className="text-[#F5A623]">See in Settings →</span>
429:                              className="text-[11px] font-semibold text-[#F5A623] hover:text-[#ffb833] transition-colors"
```

- Line 191 (nav icon, `<Icon>` component) → `text-[var(--gv-accent)]`.
- Line 255 (account-chip avatar initial letter — small text on a dark gradient badge). The badge's own background (`from-[#3a2410] to-[#1a0f04]`, a dark brown gradient used specifically to hold gold text) is a **self-contained dark badge, not the page background** — leave the gradient colors and `text-[#F5A623]` unchanged here; this badge is meant to look the same in both themes, the same reasoning as the photo-stack tag overlays in Task 4.
- Line 311 (a hover link on light body text) → `hover:text-[var(--gv-accent-text)]`.
- Line 394 (a trial-days-left badge, small text) → `bg-[var(--gv-accent-fill)] text-[var(--gv-accent-text)]`.
- Line 416 ("See in Settings →" link, small text) → `text-[var(--gv-accent-text)]`.
- Line 429 (small link with a gold hover state) → `text-[var(--gv-accent-text)] hover:text-[var(--gv-accent-hover)]`.

- [ ] **Step 3: Add the theme toggle**

Find the account-chip section (around where the `ChevronDown` at line 262 sits, part of the account-chip button described in the earlier investigation). Import the icons and add a toggle button next to the account chip. At the top of the file, alongside the existing `lucide-react` import, add `Sun, Moon` to the import list. Then, immediately after the account-chip `<button>` block closes (the block spanning roughly lines 252-263 in the pre-Task-1-through-8 file), insert:

```tsx
              <button
                type="button"
                onClick={toggleTheme}
                title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                className="w-full flex items-center justify-center gap-2 mt-2 h-8 rounded-lg border border-[var(--gv-border-subtle)] text-[var(--gv-text-tertiary)] hover:text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] transition-colors"
              >
                {isDarkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                <span className="text-[11px] font-medium">{isDarkMode ? 'Light mode' : 'Dark mode'}</span>
              </button>
```

Confirm `isDarkMode` and `toggleTheme` are already in scope at this point in the component — the file already calls `const { isDarkMode } = useTheme();` per the earlier investigation (grep found `useTheme` imported and `isDarkMode` destructured). If only `isDarkMode` is destructured and not `toggleTheme`, change that line to `const { isDarkMode, toggleTheme } = useTheme();`.

- [ ] **Step 4: Verify no leftover literal colors in the sidebar region**

```bash
grep -n 'text-\[#F5A623\]\|bg-\[#F5A623\]\|border-\[#F5A623\]\|text-\[#F5F4F1\]\|bg-\[#151515\]\|white/\[0\.\|text-white/[0-9]' components/Layout.tsx
```
This file also has pre-existing, correctly-`isDarkMode`-gated legacy sections that may still show matches inside ternaries like `isDarkMode ? 'text-white' : 'text-black'` — that's expected and fine (those aren't in scope for this task; they already work in both themes). Only investigate matches that are **unconditional** (not inside an `isDarkMode ? ... : ...` ternary) — those are the ones this task should have caught.

- [ ] **Step 5: Visual check**

With any page loaded, toggle light mode via the new sidebar button (not the console command — this is the first task where the real UI control exists). Confirm: clicking it flips the whole app including the sidebar itself, the sidebar's "GRAVITY" wordmark and nav items are legible in both states, the active nav item's highlight is visible in light mode, the account chip and avatar badge still read correctly, clicking again flips back to dark and the app looks pixel-identical to before this entire plan started.

- [ ] **Step 6: Commit**

```bash
git add components/Layout.tsx
git commit -m "Migrate sidebar to light-mode tokens; add the theme toggle"
```

---

## Final verification (after all 9 tasks)

- [ ] Toggle to light mode via the sidebar button. Click through every page in the app (not just the 7 in scope) to confirm nothing outside this plan's scope broke — particularly pages that mix Gravity components (`GravityHero`, etc.) with their own legacy `isDarkMode` styling, e.g. `BrandAssets.tsx`, `ContentCalendar.tsx`, `ReelGenerator.tsx`, `Inventory.tsx`, `UploadAndSchedule.tsx` (these already had light-mode support before this plan; confirm the tokenized `GravityHero`/`GravityButton` they embed now matches rather than clashes).
- [ ] Toggle back to dark mode. Confirm the whole app is pixel-identical to a fresh checkout of `dev-dk` before this plan's first commit — this is the actual regression check.
- [ ] Refresh the page while in light mode — confirm the choice persists (via `localStorage`, already handled by `ThemeContext`, not something this plan touches).
