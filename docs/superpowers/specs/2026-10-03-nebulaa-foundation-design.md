# Nebulaa app foundation — name, logo, website look, light only, app switcher

Status: approved in chat 2026-10-03. Branch: `nebulaa-redesign` (from `dev-dk` @ 11e0954, after Hero Studio).
This is **part 1 of 3** of the Nebulaa redesign. Part 2 (page-by-page sweep) and part 3 (landing, sign-in, deploy check) get their own specs and plans.

## Goal

The Gravity app becomes **Nebulaa**: one product, one name, the same warm light look as the Nebulaa website, with a switcher in the shell that will later move customers between Content, Outreach and Lead generation. Customers never see the agent names Gravity, Pulsar or Orbit.

## Decisions (made by Dinesh, 2026-10-03)

1. Customer-facing name is **Nebulaa** (two a's), matching the logo, website and domains (`gravity.nebulaa.ai` today, `app.nebulaa.ai` later).
2. **Light only.** The dark toggle is removed. Dark tokens stay in the code, unused, so dark can return later.
3. The app switcher shows **Content** (active) plus **Outreach** and **Lead generation** as visible, disabled, marked "Coming soon". The other apps are not connected in this work.
4. Order of work: part 1, then part 3 (landing/deploy check), then part 2 (page sweep).

## Scope of part 1

### 1. Name and logo
- Every customer-visible "Gravity" string becomes "Nebulaa" (page titles, `<title>`, sidebar and mobile header wordmark, headings, empty states, toasts, emails the frontend or backend sends, onboarding, Terms/Privacy wording where it names the product). About 335 occurrences in 34 files under `frontend/`, plus backend email templates; each is classified **visible** (change) or **internal** (leave).
- Internal identifiers stay: CSS classes (`gravity-shell`, `gravity-label`), `Gravity*.tsx` file names, component names, route paths, API paths, DB fields, `localStorage` keys. Renaming them is churn with no customer value.
- Pulsar and Orbit are not shown to customers. Today they appear only in `TermsAndConditions.tsx`; reword there to Nebulaa's capabilities without agent names (legal wording is flagged for Dinesh's review, not silently rewritten beyond the product name).
- Logo assets are copied from `nebulaa-ai-website/public/images/brand/` into `frontend/public/assets/brand/`: `logo-nebulaa.png` (784x360, transparent navy wordmark with the warm sun; this is the new logo the website navbar uses) for the sidebar, mobile header, sign-in and landing. The older horizontal "Founder OS" logo is not used. A favicon and `apple-touch-icon` are derived from the same artwork only if a suitable source exists; otherwise left as is and reported.
- The sidebar and mobile header replace the dot plus "GRAVITY" text with the logo image (with accessible alt text "Nebulaa").

### 2. Look: tokens remapped to the website palette
Source of truth: `nebulaa-ai-website/app/globals.css` (light block). The `--gv-*` tokens in `frontend/index.html` (`:root`) are remapped:

| Token | Now | New |
|---|---|---|
| `--gv-bg` | `#FAF9F6` | `#FBF5EA` (website `--ground`) |
| `--gv-panel` | `#FFFFFF` | `#FFFDF8` (`--surface`) |
| `--gv-panel-2` | `#F2F0EA` | `#F3E8D4` (`--surface-2`) |
| `--gv-ink-rgb` | `23 23 26` | `20 32 58` (navy `#14203A`) |
| `--gv-text-primary` | `#17171A` | `#14203A` |
| `--gv-text-secondary` | `#44433F` | `#33405C` |
| `--gv-text-tertiary` | `#78756D` | `#6D6250` (`--muted`) |
| `--gv-text-muted` | `#9C998F` | `#8F836E` (`--faint`) |
| borders | ink alpha | derive from `--rule` `#E5D8BF` / `--rule-2` `#D4C4A4` (keep the three-step scale) |
| `--gv-accent` | `#F5A623` | unchanged (brand gold fill) |
| `--gv-accent-text` | `#96650A` | `#9A5B00` (website `--gold-text`, AA on cream) |
| `--gv-accent-display` | `#B0770F` | `#D07A00` (large display only) |

New tokens added for highlights and friendly empty states: `--gv-coral`, `--gv-coral-text` (`#EE6330`, `#C4471A`), and the pastels `--gv-peach #FFE3D0`, `--gv-mint #DDF2E6`, `--gv-sky #DCEBFA`, `--gv-lav #ECE6FB`. Card shadow follows the website (`0 1px 2px rgba(20,32,58,.05), 0 12px 32px rgba(20,32,58,.07)`).
- Font: **Plus Jakarta Sans** replaces Inter as the app's sans (loaded from Google Fonts in `index.html`, Inter kept as fallback). Playfair Display stays for the existing serif display usages.
- Every page already on `--gv-*` tokens (the `Gravity*` pages, `components/gravity`, the shell, `AIMemory`, Hero Studio) changes automatically. Pages still on `isDarkMode` ternaries or literal colours are **not** touched here (part 2); a list of them, with line counts, is written into the part 2 spec.
- Contrast: every token pair used for text must meet WCAG AA on its background (4.5:1 body, 3:1 large). The implementer computes and records the ratios for primary, secondary, tertiary, muted and accent text on bg, panel and panel-2; any failure is fixed by darkening that token, not by waiving.

### 3. Light only
- `ThemeContext` keeps its API (`isDarkMode`, `theme`, `toggleTheme`, `colors`) because 36 files import it, but `isDarkMode` is always `false`, `toggleTheme` is a no-op, the `dark` class is never added (and is removed if present), the stored `nebulaa-theme` value and the system dark preference are ignored.
- The sidebar theme toggle button is removed.
- The `.dark` token block in `index.html` stays, unused, with a comment explaining why.
- Part 2 removes the `isDarkMode` ternaries page by page; until then, forcing `false` selects the light branch everywhere, which is the safe default.

### 4. App shell
- Sidebar (desktop) and drawer (mobile): logo at the top, then the **app switcher**, then the existing nav.
- The existing nav is already named by job (Dashboard, Create, Videos, Approve, Calendar, Idea Inbox, Upload & Schedule, Insights; Setup: Brand Assets, Connect Socials, AI Memory; footer: Settings, Help, Logout). Labels and routes are unchanged in part 1. The shell only adds the switcher and the logo; the wording of nav items is reviewed in part 2 with Dinesh.
- **App switcher** component (`frontend/components/AppSwitcher.tsx`), one purpose: show which Nebulaa area the customer is in and list the others.
  - Items: `Content` (active, links to `/dashboard`), `Outreach` and `Lead generation` (disabled, `aria-disabled`, a small "Coming soon" pill, not focusable as links, no navigation).
  - Collapsed state shows the current area name with a chevron; opens a small menu. Keyboard accessible (Enter/Space opens, arrows move, Escape closes), closes on outside click, works at phone width.
  - Data lives in one array in the component (`id`, `label`, `path`, `available`) so wiring the other apps later is flipping `available` and setting a path. No network calls, no new backend.
- Mobile top bar: hamburger plus logo (replaces the dot and "GRAVITY" text).

### 5. Verification
- `cd frontend && npx tsc --noEmit` shows only the 4 pre-existing errors (AdminDashboard, AdminLogin, Influencers, LandingPage); `npm run build` succeeds; anything it writes under `backend/public` is restored and never committed.
- Visual check in the Browser pane against the frontend dev server with **stubbed API responses** (no backend, no database, no `.env`): shell and a few token-based pages (Home, Create, Approve, Calendar, AI Memory, Hero Studio) at desktop and phone width; switcher open/closed and keyboard use; screenshot evidence in the report. Pages not yet migrated (part 2) are expected to look mixed and are listed, not fixed.
- A grep proves no customer-visible "Gravity", "Pulsar" or "Orbit" remains in the classified-visible set.
- Unit tests where logic exists: `AppSwitcher` data/behaviour (disabled items cannot navigate), and `ThemeContext` always light (ignores stored dark, ignores system dark, `toggleTheme` does nothing). Use the frontend's existing test setup if there is one; if not, a small test of the pure data/logic module and manual keyboard verification are accepted.

## Out of scope (later parts)
- Part 2: migrating `Campaigns`, `Dashboard` (classic), `ReelGenerator`, `Analytics`, `Inventory`, `Competitors`, `AdCampaigns`, `BrandAssets`, `ConnectSocials`, `Settings` and the other `isDarkMode` pages to tokens; rewording nav items.
- Part 3: landing page and sign-in/onboarding in the website look (existing work on branches `rebrand-nebulaa-landing` / `rebrand-on-prod`, which carries earlier copies of the Hero commits and needs a careful merge), domain and redirect checks, `APP_URL`, deploy conflicts.
- The move to `app.nebulaa.ai`; connecting Outreach and Lead generation; any data sharing between apps; renaming internal identifiers.

## Risks
- Remapping tokens will make not-yet-migrated pages look inconsistent (dark-era hard-coded colours on a cream background) until part 2; part 1 is not a customer release on its own.
- Legal pages: renaming the product in Terms/Privacy is text the company is bound by; changes there are flagged for Dinesh.
- Emails and any backend text that embed the Gravity name live in the backend; changes are limited to display strings, never to URLs or sender addresses.
- The website's palette is warmer than the app's current one, so some app screenshots (showcase images, video-style covers) may clash slightly; noted for part 2.
