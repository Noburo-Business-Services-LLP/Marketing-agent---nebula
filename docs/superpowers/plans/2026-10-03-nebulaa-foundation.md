# Nebulaa Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Correction (2026-10-03, owner instruction):** the shell uses the NEW logo `/assets/brand/logo-nebulaa.png` (navy wordmark with sun, as on the website navbar). Wherever this plan says `logo-horizontal-light.png`, read `logo-nebulaa.png`; the old horizontal "Founder OS" logo was removed in commit 5a54ad7.

**Goal:** Turn the Gravity app shell into Nebulaa: website palette and font in the design tokens, light only, the Nebulaa logo, an app switcher (Content active, Outreach and Lead generation "Coming soon"), and no customer-visible "Gravity" text.

**Architecture:** The app already styles the `Gravity*` pages and the shell through `--gv-*` CSS tokens in `frontend/index.html`, so one token remap re-skins them. `ThemeContext` keeps its API (36 files import it) but is forced to light. The switcher is a small component driven by one data array in a pure module that has real tests. Visible-string renames are protected by a scanning test with an explicit allowlist.

**Tech Stack:** React 19 + TypeScript + Vite + Tailwind (CDN config in `index.html`), `lucide-react`; tests are Node's built-in runner (`node --test`, Node 24 strips TypeScript types, so `.mjs` tests can import `.ts` utility modules).

**Spec:** `docs/superpowers/specs/2026-10-03-nebulaa-foundation-design.md` (read it first). This plan is part 1 of 3; do NOT start the page sweep (part 2) or the landing/sign-in/deploy work (part 3).

## Global Constraints

- Customer-facing name is **Nebulaa** (two a's). Never show the words Gravity, Pulsar or Orbit to customers.
- Internal identifiers stay as they are: CSS classes (`gravity-shell`, `gravity-label`), `Gravity*.tsx` file names, component names, route paths, API paths, DB fields, `localStorage` keys, URLs such as `gravity.nebulaa.ai`, sender addresses.
- Light only: `ThemeContext` keeps its API (`isDarkMode`, `theme`, `toggleTheme`, `colors`) but `isDarkMode` is always `false`, `toggleTheme` is a no-op, the `dark` class is never added (removed if present), the stored `nebulaa-theme` value and the system dark preference are ignored. The `.dark` token block in `index.html` stays, unused, with a comment saying why.
- Token values (light, `:root` in `frontend/index.html`): `--gv-bg #FBF5EA`, `--gv-panel #FFFDF8`, `--gv-panel-2 #F3E8D4`, `--gv-ink-rgb 20 32 58`, `--gv-text-primary #14203A`, `--gv-text-secondary #33405C`, `--gv-text-tertiary #6D6250`, `--gv-text-muted #8F836E`, `--gv-accent #F5A623` (unchanged), `--gv-accent-text #9A5B00`, `--gv-accent-display #D07A00`; borders derive from the website rules `#E5D8BF` (subtle) / `#D4C4A4` (default), strong a step darker, keeping the existing three-step scale; new tokens `--gv-coral #EE6330`, `--gv-coral-text #C4471A`, `--gv-peach #FFE3D0`, `--gv-mint #DDF2E6`, `--gv-sky #DCEBFA`, `--gv-lav #ECE6FB`; card shadow `0 1px 2px rgba(20,32,58,.05), 0 12px 32px rgba(20,32,58,.07)`.
- Contrast (WCAG AA): primary, secondary, tertiary and accent-text must reach 4.5:1 on `--gv-bg`, `--gv-panel` and `--gv-panel-2`; muted (placeholders/disabled only) must reach 3:1. If a pair fails, darken that one token minimally and record the new value; never waive. (Controller pre-check: accent-text `#9A5B00` on panel-2 is about 4.47:1, so expect to nudge it slightly darker.)
- Font: Plus Jakarta Sans replaces Inter as the app sans (Google Fonts link in `index.html`; keep Inter as fallback). Playfair Display stays for existing serif display usages.
- No backend changes except display strings in Task 4; never change URLs, sender addresses, route paths or DB fields. No new network calls.
- Do not edit pages still on `isDarkMode` ternaries to restyle them (part 2). Pages already on tokens may be touched only for visible-string renames.
- Verification limits: do not run the backend, do not touch any database, do not copy or create `.env`. Browser checks use the frontend dev server with stubbed API responses (no real backend), as in the Hero Studio work.
- Test commands: frontend tests `cd frontend && node --test tests/*.test.mjs`; type-check `cd frontend && npx tsc --noEmit` (exactly 4 pre-existing errors: AdminDashboard, AdminLogin, Influencers, LandingPage); build `cd frontend && npm run build` (restore everything it writes under `backend/public` afterwards; commit nothing there). Backend (Task 4 only): `cd backend && node --test tests/*.test.js` (180 pass at start; every file must exit by itself).
- Never commit `.env`, keys, or `backend/public` build output.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## File Structure

- Create `frontend/public/assets/brand/logo-horizontal-light.png`, `frontend/public/assets/brand/logo-nebulaa.png` (copied from the website project).
- Create `frontend/utils/theme.ts` (pure helper `forceLightTheme`), `frontend/utils/appSwitcher.ts` (data + pure logic).
- Create `frontend/components/AppSwitcher.tsx` (the UI).
- Create `frontend/tests/theme.test.mjs`, `frontend/tests/tokens-contrast.test.mjs`, `frontend/tests/appSwitcher.test.mjs`, `frontend/tests/brand-names.test.mjs`.
- Create `frontend/scripts/brand-audit.mjs` (the scanner shared by the test and by hand), `frontend/tests/brand-allowlist.json` (justified exceptions).
- Modify `frontend/index.html` (tokens, font, `<title>`, meta), `frontend/context/ThemeContext.tsx`, `frontend/components/Layout.tsx` (logo, switcher, toggle removal, mobile header), visible strings across `frontend/**` (Task 3) and `backend/**` display strings (Task 4).

---

### Task 1: Look — tokens, font, logo assets, light-only theme

**Files:**
- Modify: `frontend/index.html` (the `:root` token block ~l.112-142, the `.dark` block ~l.144-160, the Google Fonts `<link>` ~l.9, Tailwind `fontFamily.sans` ~l.43, body font rules)
- Modify: `frontend/context/ThemeContext.tsx`
- Create: `frontend/utils/theme.ts`, `frontend/public/assets/brand/*`
- Test: `frontend/tests/theme.test.mjs`, `frontend/tests/tokens-contrast.test.mjs`

**Interfaces:**
- Produces: `forceLightTheme(doc, storage?) -> void` in `frontend/utils/theme.ts`; the token names above in `:root`; brand images at `/assets/brand/logo-horizontal-light.png` (420x126) and `/assets/brand/logo-nebulaa.png` (784x360).
- Consumed later: Task 2 uses the logo path and tokens.

- [ ] **Step 1: Write the failing theme test** `frontend/tests/theme.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { forceLightTheme } from '../utils/theme.ts';

function fakeDoc(initial = ['dark', 'x']) {
  const classes = new Set(initial);
  return {
    classes,
    documentElement: { classList: { remove: (c) => classes.delete(c), contains: (c) => classes.has(c) } },
  };
}

test('removes the dark class and the stored dark preference', () => {
  const doc = fakeDoc();
  const removed = [];
  forceLightTheme(doc, { removeItem: (k) => removed.push(k) });
  assert.equal(doc.classes.has('dark'), false);
  assert.equal(doc.classes.has('x'), true);
  assert.deepEqual(removed, ['nebulaa-theme']);
});

test('works without storage and survives a throwing storage', () => {
  const doc = fakeDoc();
  forceLightTheme(doc, null);
  forceLightTheme(doc, { removeItem: () => { throw new Error('blocked'); } });
  assert.equal(doc.classes.has('dark'), false);
});
```

- [ ] **Step 2: Write the failing contrast test** `frontend/tests/tokens-contrast.test.mjs`. It reads `../index.html`, takes the text between `:root {` and the first `.dark {`, extracts `--gv-<name>: #RRGGBB;` pairs into a map, and asserts, using the WCAG relative-luminance formula (`L = 0.2126R + 0.7152G + 0.0722B` on linearised sRGB; ratio `(L1+0.05)/(L2+0.05)` with the lighter on top): for each text token in `['text-primary','text-secondary','text-tertiary','accent-text']` and each background in `['bg','panel','panel-2']` the ratio is >= 4.5; for `text-muted` it is >= 3.0. Also assert the token values from Global Constraints for `bg`, `panel`, `panel-2`, `text-primary`, `text-secondary`, `text-tertiary`, `text-muted`, `accent` (exact hex; `accent-text` only has to pass contrast and be a hex starting `#9` or `#8`), and that the new tokens `coral`, `coral-text`, `peach`, `mint`, `sky`, `lav` exist. Print the ratio table with `console.log` inside the test so the report can quote it.
- [ ] **Step 3: Run** `cd frontend && node --test tests/theme.test.mjs tests/tokens-contrast.test.mjs`. Expected: FAIL (module missing; old token values).
- [ ] **Step 4: Implement.**
  - `frontend/utils/theme.ts`:

```ts
interface DocLike { documentElement: { classList: { remove(c: string): void } } }
interface StorageLike { removeItem(k: string): void }

/** Nebulaa is light only: strip any dark class and any stored dark preference. */
export function forceLightTheme(doc: DocLike, storage?: StorageLike | null): void {
  doc.documentElement.classList.remove('dark');
  try { storage?.removeItem('nebulaa-theme'); } catch { /* storage blocked: nothing to clear */ }
}
```

  - `ThemeContext.tsx`: remove the `useState` initialiser, the `matchMedia` check and the effect that writes `nebulaa-theme`. Make `isDarkMode` a constant `false`, `theme` `'light'`, `toggleTheme` a no-op function, and run `forceLightTheme(document, window.localStorage)` once in a `useEffect(..., [])`. Keep the `colors` object (light branch only) and the provider/hook exports exactly as they are so the 36 importers compile unchanged.
  - `index.html`: set the `:root` tokens to the Global Constraints values (derive `--gv-border-*` and `--gv-surface-*` from the new `--gv-ink-rgb`; borders may use the rule colours or ink alpha as long as the scale stays three steps and visibly lighter than text); add the six new tokens and the card shadow token; add a comment above `.dark` that it is intentionally unused (light only, kept so dark can return). Swap the Google Fonts `<link>` to include `Plus+Jakarta+Sans:wght@400;500;600;700` (keep the other families already loaded), set Tailwind `fontFamily.sans` and the body/`.gravity-shell` font rules to `'Plus Jakarta Sans', Inter, -apple-system, BlinkMacSystemFont, sans-serif`.
  - Copy `logo-horizontal-light.png` and `logo-nebulaa.png` from `/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebulaa-ai-website/public/images/brand/` into `frontend/public/assets/brand/`.
  - Favicon: the website has `app/icon.png` and `app/apple-icon.png` under `/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebulaa-ai-website/`. If `index.html` declares a favicon / apple-touch-icon, copy these into `frontend/public/` (`favicon.png`, `apple-touch-icon.png`) and point the `<link>` tags at them; if `index.html` declares none, add the two links. Report what was done.
  - If the contrast test fails for a pair, nudge only that token darker (smallest step that passes) and note the final value and ratio.
- [ ] **Step 5: Run** both test files: expected PASS. Then `cd frontend && npx tsc --noEmit` (4 pre-existing errors only) and `npm run build` (restore `backend/public` changes).
- [ ] **Step 6: Commit** `feat: Nebulaa tokens, Plus Jakarta Sans, brand logos, light-only theme`.

---

### Task 2: App shell — logo, app switcher, toggle removed

**Files:**
- Create: `frontend/utils/appSwitcher.ts`, `frontend/components/AppSwitcher.tsx`
- Modify: `frontend/components/Layout.tsx` (brand block ~l.231-247, theme toggle button ~l.266-276, mobile header ~l.322-336, the account-chip avatar's dark gradient ~l.259)
- Test: `frontend/tests/appSwitcher.test.mjs`

**Interfaces:**
- Consumes: Task 1 tokens and `/assets/brand/logo-horizontal-light.png`.
- Produces (`frontend/utils/appSwitcher.ts`):

```ts
export type NebulaaAreaId = 'content' | 'outreach' | 'leads';
export interface NebulaaArea { id: NebulaaAreaId; label: string; path: string | null; available: boolean }
export const NEBULAA_AREAS: NebulaaArea[];            // content, outreach, leads in that order
export const CURRENT_AREA_ID: NebulaaAreaId;          // 'content'
export function areaTarget(area: NebulaaArea): string | null;   // path only when available and path set
export function nextEnabledIndex(areas: NebulaaArea[], from: number, dir: 1 | -1): number; // wraps; skips unavailable; returns `from` if none other
```

  and `<AppSwitcher />` (no props) in `frontend/components/AppSwitcher.tsx`.

- [ ] **Step 1: Write the failing test** `frontend/tests/appSwitcher.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { NEBULAA_AREAS, CURRENT_AREA_ID, areaTarget, nextEnabledIndex } from '../utils/appSwitcher.ts';

test('areas are Content (available) then Outreach and Lead generation (not available)', () => {
  assert.deepEqual(NEBULAA_AREAS.map((a) => [a.id, a.label, a.available]), [
    ['content', 'Content', true],
    ['outreach', 'Outreach', false],
    ['leads', 'Lead generation', false],
  ]);
  assert.equal(CURRENT_AREA_ID, 'content');
});

test('unavailable areas never produce a navigation target', () => {
  const [content, outreach, leads] = NEBULAA_AREAS;
  assert.equal(areaTarget(content), '/dashboard');
  assert.equal(areaTarget(outreach), null);
  assert.equal(areaTarget(leads), null);
  assert.equal(areaTarget({ ...content, path: null }), null);
});

test('no agent names appear in labels', () => {
  const text = JSON.stringify(NEBULAA_AREAS).toLowerCase();
  for (const word of ['gravity', 'pulsar', 'orbit']) assert.equal(text.includes(word), false);
});

test('nextEnabledIndex skips unavailable items and wraps', () => {
  const a = (id, available) => ({ id, label: id, path: available ? '/' + id : null, available });
  const areas = [a('one', true), a('two', false), a('three', true)];
  assert.equal(nextEnabledIndex(areas, 0, 1), 2);
  assert.equal(nextEnabledIndex(areas, 2, 1), 0);
  assert.equal(nextEnabledIndex(areas, 0, -1), 2);
  assert.equal(nextEnabledIndex([a('only', true), a('x', false)], 0, 1), 0);
});
```

- [ ] **Step 2: Run** `cd frontend && node --test tests/appSwitcher.test.mjs`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `appSwitcher.ts`** to satisfy the interface and test (Content path `/dashboard`; Outreach and Lead generation `path: null`, `available: false`; `nextEnabledIndex` loops at most `areas.length` steps).
- [ ] **Step 4: Run** the test file. Expected: PASS.
- [ ] **Step 5: Implement `AppSwitcher.tsx`.** A button showing the current area label and a chevron; it opens a menu (`role="menu"`, items `role="menuitem"`). Content row: check icon, label, navigates via `useNavigate()` to `areaTarget(area)` and closes. Outreach and Lead generation rows: `aria-disabled="true"`, `tabIndex={-1}`, muted text, a "Coming soon" pill (`--gv-accent-fill` background, `--gv-accent-text` text), no click handler effect. Keyboard: Enter/Space/ArrowDown on the button opens it and focuses the first enabled item; ArrowUp/ArrowDown move with `nextEnabledIndex`; Escape closes and returns focus to the button; Tab closes. Closes on outside `mousedown`. Style only with `--gv-*` tokens (no literal colours), `min-h` 40px touch targets, works at 240 px sidebar width and in the mobile drawer. Wire all copy from `NEBULAA_AREAS`.
- [ ] **Step 6: Edit `Layout.tsx`.**
  - Replace the dot plus "GRAVITY / BY NEBULAA" text block in the sidebar with `<img src="/assets/brand/logo-horizontal-light.png" alt="Nebulaa" className="h-8 w-auto" />` (keep the mobile close `X` button).
  - Render `<AppSwitcher />` directly under the brand block, above the account chip, with the same horizontal padding (`px-4`) and spacing as the chip.
  - Delete the theme toggle `<button>` and the now-unused `Sun`/`Moon` imports and `toggleTheme`/`isDarkMode` destructuring if they become unused (do not leave unused imports).
  - Mobile header: replace the dot plus "GRAVITY" text with the same logo image (`h-7`).
  - The account-chip avatar uses dark-era literals (`from-[#3a2410] to-[#1a0f04]`, `text-[#F5A623]`): replace with token classes (`bg-[var(--gv-accent-fill)] text-[var(--gv-accent-text)] border-[var(--gv-border-default)]`).
- [ ] **Step 7: Run** `node --test tests/*.test.mjs` (all pass), `npx tsc --noEmit` (4 pre-existing errors only), `npm run build` (restore `backend/public`).
- [ ] **Step 8: Commit** `feat: Nebulaa logo in the shell and an app switcher (Content active, others coming soon)`.

---

### Task 3: Customer-visible "Gravity" strings in the frontend

**Files:**
- Create: `frontend/scripts/brand-audit.mjs`, `frontend/tests/brand-allowlist.json`, `frontend/tests/brand-names.test.mjs`
- Modify: the visible occurrences across `frontend/**` (about 335 matches in 34 files; biggest: `pages/ReelGenerator.tsx` 50, `pages/HeroVideo.tsx` 37, `components/gravity/index.tsx` 19, `pages/BrandAssets.tsx` 14, `pages/GravityCreate.tsx` 12, `index.html` 12, `pages/Dashboard.tsx` 11, `pages/ConnectSocials.tsx` 10, `pages/Campaigns.tsx` 10, `pages/AIMemory.tsx` 10, `App.tsx` 10), plus Pulsar/Orbit in `pages/TermsAndConditions.tsx`.

**Interfaces:**
- Produces: `findBrandViolations(rootDir) -> { file, line, text }[]` exported from `frontend/scripts/brand-audit.mjs`: scans `.ts`, `.tsx`, `.html` under `rootDir` (excluding `node_modules`, `tests`, `scripts`, `public`), and reports any line that contains the standalone word `Gravity`, `GRAVITY`, `Pulsar` or `Orbit` (case-sensitive `\b` word match, so identifiers such as `GravityCreate` and `gravity-shell` do not match) **outside comments** (lines starting `//`, `*`, `/*`, or text inside `{/* ... */}` and trailing `// ...` are ignored) and not listed in the allowlist. The allowlist is `tests/brand-allowlist.json`: `[{ "file": "relative/path", "contains": "exact substring", "reason": "why it stays" }]`.
- Consumes: Task 2 left the shell clean.

- [ ] **Step 1: Write `brand-audit.mjs` and the failing test** `brand-names.test.mjs`: the test calls `findBrandViolations(new URL('..', import.meta.url).pathname)` and asserts the list is empty, printing violations on failure. Also test the scanner itself against a temp directory fixture (create with `fs.mkdtempSync`): a JSX line `<h1>Welcome to Gravity</h1>` is a violation; `import GravityHome from './GravityHome'`, `className="gravity-shell"`, `// Gravity redesign` and `{/* Gravity */}` are not; an allowlisted line is not.
- [ ] **Step 2: Run** `node --test tests/brand-names.test.mjs`. Expected: scanner tests pass, the repo test FAILS listing the visible occurrences.
- [ ] **Step 3: Classify and change.** For each reported line decide **visible** (shown to a customer: JSX text, button/heading/label strings, `<title>`, `alt`/`aria-label`, placeholders, toast/confirm/error messages, empty states, copy inside generated PDFs, strings sent to the user) or **internal** (identifier-like text that slipped through, log messages, developer-only strings, text sent to an AI model as instructions). Change visible ones: "Gravity by Nebulaa" -> "Nebulaa", "Gravity" -> "Nebulaa", "the Gravity app" -> "Nebulaa", "Gravity Home/Create/Approve" page titles -> the job name they already use in the nav (Dashboard, Create, Approve, Calendar, Insights). Keep sentences grammatical. In `index.html` change `<title>` and meta description/OG text to Nebulaa. In `TermsAndConditions.tsx` replace Pulsar/Orbit/Gravity agent names with Nebulaa (product name only; do not rewrite legal substance). Anything internal that the scanner still reports goes into the allowlist with a one-line reason; keep the allowlist short and justified.
- [ ] **Step 4: Run** the test: PASS. Then `npx tsc --noEmit` (4 pre-existing errors only), `npm run build` (restore `backend/public`), and `git diff --stat` to confirm no route paths, import paths, class names or API URLs changed (only string literals and JSX text).
- [ ] **Step 5: Commit** `feat: Nebulaa name replaces Gravity in customer-visible text`. Put the classification summary (counts visible/internal/allowlisted, and the list of Terms/Privacy lines changed for Dinesh's legal review) in the report file.

---

### Task 4: Customer-visible "Gravity" strings in the backend

**Files:**
- Modify: display strings only in the backend files that mention Gravity: `backend/services/emailService.js`, `sesEmailService.js`, `otpService.js`, `supportEmail.js`, `routes/auth.js`, `routes/payment.js`, `services/zohoBooks.js`, `services/migrationService.js`, `middleware/trialGuard.js`, `routes/googleCalendar.js`, `server-main.js`, `config/apiCosts.js`, `services/socialInboxService.js`, `services/contentCalendarService.js`, `services/socialMediaAPI.js`, `services/scraper.js`, `services/brandMemory.js`, `services/performanceTracker.js`, `routes/heroVideo.js`, `services/promptRegistry.js` (only if a Gravity string is shown to customers; check each)
- Test: add or extend a backend test only where a changed string is covered by an existing test; otherwise no new test file.

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing for later tasks.

- [ ] **Step 1: List** every backend line containing `Gravity` or `GRAVITY` (`grep -rn "Gravity" backend --include='*.js' --exclude-dir=node_modules --exclude-dir=tests --exclude-dir=public`) and write the list to the report.
- [ ] **Step 2: Classify** each as **visible** (text in an email subject/body/HTML, OTP or support message, invoice/receipt/Zoho text, an API `message`/`error` string the frontend shows, a Calendar event title, a social/inbox message template, brand text a customer reads) or **internal** (log lines, comments, variable names, DB values, route paths, feature flags, prompts whose output is not shown as the product name). For `promptRegistry.js` and other prompts: change only if the model would print "Gravity" to the customer; otherwise leave and list as internal.
- [ ] **Step 3: Change visible strings** to "Nebulaa". **Never** change a URL (`https://gravity.nebulaa.ai` stays), a sender or support address, a route, a DB field or a key. If a test asserts an old visible string, update the test with the new string.
- [ ] **Step 4: Run** `cd backend && node --test tests/*.test.js` (180 pass, 0 fail, exits by itself) and a final grep showing the remaining mentions are all internal.
- [ ] **Step 5: Commit** `feat: Nebulaa name replaces Gravity in customer-facing backend text`. Report the visible/internal classification with counts.

---

### Task 5: Visual verification and polish of the shell

**Files:**
- Modify: only files from Tasks 1-2 if the check finds shell defects (spacing, overflow, contrast, focus rings). No page restyling.
- Create: `docs/superpowers/specs/assets/nebulaa-foundation-check.md` (checklist results and the list of pages that still look dark-era, for the part 2 spec).

**Interfaces:**
- Consumes: Tasks 1-4.

- [ ] **Step 1: Start the frontend dev server only** (`cd frontend && npm run dev`, or the Browser pane's `preview_start` if a launch config exists; create `.claude/launch.json` entries only if the pane requires them and do not commit them). Do NOT start the backend, touch a database or copy `.env`. Stub API responses in the page (the Hero Studio session did this with `javascript_tool` and a small offline mock server bound to 127.0.0.1; reuse that approach: a throwaway mock under the scratchpad, never committed) so the shell, dashboard and a few pages render with plausible data.
- [ ] **Step 2: Check at desktop (1280 wide) and phone (375 wide):** the logo renders crisp and not squashed; the switcher shows Content active and the two disabled items with "Coming soon"; open/close with mouse and keyboard (Enter, arrows, Escape, Tab); clicking a disabled item does nothing; no horizontal page scroll; the mobile drawer shows logo and switcher; no theme toggle anywhere; no dark flash on load (also with `localStorage['nebulaa-theme']='dark'` pre-set and with the system in dark mode: still light); text on cream is readable; focus rings visible.
- [ ] **Step 3: Spot-check pages** already on tokens (Home `/dashboard`, Create `/campaigns`, Approve `/drafts`, Calendar `/content-calendar`, AI Memory `/ai-memory`, Hero Studio `/reels/hero`) for the new look, and record which other pages (the `isDarkMode` ones) look mixed or broken, with a screenshot reference for each, in the checklist file. Do not fix those here.
- [ ] **Step 4: Fix shell defects** found (Tasks 1-2 files only), re-run `node --test tests/*.test.mjs`, `npx tsc --noEmit`, `npm run build` (restore `backend/public`).
- [ ] **Step 5: Commit** `fix: Nebulaa shell polish from visual check` (only if changes were made) and commit the checklist file `docs: Nebulaa foundation visual check`. Stop the dev server and delete the mock.
