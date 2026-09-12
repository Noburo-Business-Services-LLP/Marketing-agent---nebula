# Gravity Design System — extraction and first application

**Date:** 2026-09-03
**Status:** Approved, in implementation

## Problem

The Create tab (`pages/GravityCreate.tsx`) looks markedly better than the rest of
the app. Other pages read as cluttered and utilitarian by comparison.

The cause is not missing colour. A `gravity-shell` class is already applied
globally in `components/Layout.tsx`, and `index.html` carries an override layer
that rewrites legacy classes on every page — `bg-slate-900` becomes Gravity
black, `#ffcc29` becomes `#F5A623`, inputs get consistent focus rings.

What that layer cannot retrofit is **composition**: typographic hierarchy,
spacing rhythm, small-caps labelling, and the halo/beam treatments. Pages differ
in how much of the Gravity vocabulary they adopt:

| Page | Serif headlines | Gravity labels |
|---|---|---|
| GravityCreate, GravityHome, GravityApprove, GravityInsights | yes | yes |
| GravityCalendar | yes | no |
| UploadAndSchedule | yes | yes |
| ReelGenerator | no | yes |
| ConnectSocials, BrandAssets, AIMemory, Settings | no | no |

The vocabulary lives as ad-hoc JSX inside `GravityCreate.tsx`, so no other page
can reuse it. That is the gap this work closes.

## Approach

Extract Create's proven patterns into `components/gravity/`, then apply them to
one page end-to-end to prove the set before rolling out further.

Two approaches were rejected:

- **Splitting ReelGenerator's 13 steps into separate files first.** It would fix
  a real maintainability problem, but bundles a risky refactor of a wizard with
  heavily shared state into what should be a visual change.
- **Extending the CSS override layer only.** Near-zero risk, but it cannot reach
  composition — the actual problem — and grows an `!important` layer that is
  already large.

## The component set

All five are lifted from working code in `GravityCreate.tsx`, not invented.

| Component | Purpose | Source |
|---|---|---|
| `GravityHero` | Gold small-caps label, Playfair headline with italic gold emphasis, muted subcopy capped at 560px | GravityCreate:550-565 |
| `GravityPanel` | The metal card. `metalHalo` + `BorderBeam` + warm gradient + inset rim-light. Halo and beam are **opt-in props, off by default** | GravityCreate:570-600 |
| `GravityLabel` | The `.gravity-label` class as a component | `index.html` |
| `GravityMetaBox` | Labelled setting box: icon, label, value, EDIT affordance | GravityCreate:41-62 (`MetaBox`) |
| `GravityOptionPopover` | Dropdown panel anchored under a MetaBox | GravityCreate:64-87 (`OptionPopover`) |

### The glow rule

`GravityPanel` defaults halo and beam to **off**. Glow is opt-in, and the rule
governing it is:

> **One glow at a time, on the panel the current step is about.**

In a single-screen page that is the primary input — the campaign prompt on
Create, the video brief on Reels Step 1. In a multi-step flow the glow *follows
the user*: whichever panel is the focus of the active step carries it, and the
previous one drops back to a plain panel.

The glow is an attention device, not decoration. If every card glows, none of
them signals anything — it stops meaning "start here" and becomes noise, and
several breathing halos on one screen compete with each other and with the
content. Hence at most one, always on the thing you are meant to act on now.

Note that Create never had to decide this: it has only one panel. The rule is
chosen, not inherited.

## First application — ReelGenerator Step 1

Step 1 and Create are the same class of screen: describe the thing, set
parameters, generate. Create solved it as a calm hero; Reels solved it as a
dense form. The redesign applies Create's solution to the same problem.

1. `<h2>Step 1: Input</h2>` becomes a `GravityHero`.
2. The description textarea moves into a `GravityPanel` with halo and beam on —
   the page's single hero moment.
3. The six-column settings grid (`xl:grid-cols-6` of raw `<select>`/`<input>`)
   becomes a two-column `GravityMetaBox` grid. Native `<select>` cannot be
   styled to match the aesthetic, which is part of why the page reads as unclean.
4. Smart Calendar tiles keep all four states (loading / disabled / empty /
   populated), restyled to the panel and label vocabulary. Emoji markers
   (🎯 📢 📦) become lucide icons, matching Create.
5. Legacy classes inside Step 1's block are swept: `isDarkMode ? … : …`
   branches, `#ffcc29`, and off-palette `blue-300` / `red-300` accents.

### Settings grid mapping

Six boxes, three rows of two:

| Box | Value shown | Interaction |
|---|---|---|
| Duration | `{n} sec` | Popover: 15/30/45/60/90/120 |
| Aspect Ratio | `9:16 · Reels` etc. | Popover: 4 ratios |
| Video Language | Language name | Popover: 6 languages |
| Voice Gender | Female / Male | Popover: 2 options |
| Scene Count | `{n} scenes` or `Auto` | Popover: Auto, 1–10 |
| Product | Filename, product name, or `None` | Popover: `Upload image…` + product list |

`Product` merges the previous "Upload Product Image" and "OR Select Product"
controls. They are already mutually exclusive in the existing code — choosing a
product clears the uploaded image — so a single control expresses the existing
behaviour more honestly than two adjacent ones.

## Constraints

**Behaviour does not change.** No state, handler, or step logic moves. Every
edit is presentational. The one exception is the Product merge above, which
preserves the existing mutual-exclusion rule rather than altering it.

**Verification is visual.** `frontend/package.json` defines only `dev`, `build`
and `preview` — there is no test harness, so no meaningful automated test can be
written for this. Verification is driving the page in the browser and
screenshotting the result.

## Out of scope

- The remaining 12 wizard steps (follow-on work once the pattern is approved)
- Splitting `ReelGenerator.tsx` (4,938 lines) into per-step files
- The other eight legacy pages
- Any change to the `gravity-shell` override layer in `index.html`
