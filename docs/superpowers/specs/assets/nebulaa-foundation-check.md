# Nebulaa foundation: visual check (part 1, Task 5)

Date: 2026-10-03. Branch `nebulaa-redesign`. Shell fixes from this check are in commits `5a54ad7` (`fix: Nebulaa shell polish from visual check`) and the round 2 commit (`fix: Nebulaa shell polish round 2 - dark modal labels, light loader, no fake Approve badge`).
Screenshots are in `nebulaa-foundation-check/` next to this file (prefix numbers are used below). Screenshots 20-40 were taken after the logo fix and before the top-bar title fix.

## How it was checked

- Frontend dev server only: `vite --port 3100 --strictPort --host 127.0.0.1`, with `VITE_BACKEND_URL=http://127.0.0.1:5199` (the dev proxy target) and `VITE_API_BASE_URL=/api` (so `ChatBot` does not fall back to `localhost:5000`).
- Throwaway offline mock API on 127.0.0.1:5199 (scratchpad, deleted afterwards): a fake signed-in user ("Sunrise Bakery", fake token in `localStorage`), 4200 Quarks, every list empty. No backend, no database, no `.env`, nothing on ports 3000/5000 used.
- The page was opened as `127.0.0.1`, not `localhost`, so `services/api.ts` and `Campaigns.tsx` use relative `/api` (their `localhost:5000` branch only applies when the host is literally `localhost`).
- Network evidence: zero requests to `:5000` or `localhost` (`read_network_requests` filters and the page's resource timing). The mock logged 194 requests, all `GET /api/...`. Other hosts the page itself loads: Google Fonts, `cdn.tailwindcss.com` (the app's CSS), `images.unsplash.com` (Home example cards) and Razorpay's `checkout.js` from `index.html`, which also pings `api.razorpay.com`/`lumberjack.razorpay.com` on load. None carry user data; they are part of the app as built, not API calls.
- Browser pane at 1280x800 and 375x812, with the colour scheme emulated **dark** throughout and `localStorage['nebulaa-theme']='dark'` set before each load.

## Checklist

| # | Item | Desktop 1280 | Phone 375 | Evidence / notes |
|---|---|---|---|---|
| 1 | Logo is the new Nebulaa logo, crisp, not squashed | PASS (after fix) | PASS (after fix) | Was the old "NEBULAA FOUNDER OS" logo (01). Now `/assets/brand/logo-nebulaa.png` (784x360): sidebar 87x40 CSS px (h-10), mobile header 70x32 (h-8); aspect kept (`w-auto`, width/height attributes). At DPR 2 it is drawn from a 784px source at 174 device px, so it is sharp. The sun is not clipped and has room above (02, 10, 11). |
| 2 | Switcher: Content active, Outreach and Lead generation disabled with "Coming soon" | PASS (after fix) | PASS | `aria-current` on Content with a check mark; the other two `aria-disabled`, muted text, "Coming soon" pill. Before the fix "Lead generation" was cut to "Lead ge..." (03); the pill now sits under the label (05, 12). |
| 3 | Open/close with the mouse | PASS | PASS | Click opens, click on the button again closes, outside click closes. |
| 4 | Keyboard: Tab to the trigger, Enter / Space / ArrowDown open, arrows move, Escape closes, Tab leaves | PASS | n/a | Enter, Space and ArrowDown open with focus on Content; Up/Down stay on Content (only enabled item; disabled ones are skipped); Escape closes and returns focus to the trigger; Tab closes and moves on to the account chip; Enter on Content navigates to `/dashboard`. Space was dropped from the button's keydown handler (native click handles it) so it cannot open-then-close. |
| 5 | Clicking a disabled item does nothing | PASS | PASS | Outreach and Lead generation clicks: route unchanged, menu stays open. |
| 6 | Choosing Content closes the mobile drawer | PASS (after fix) | PASS (after fix) | New optional `onNavigate` prop; drawer moved from x=0 to x=-240 after tapping Content. |
| 7 | No horizontal page scroll | PASS | PASS | `scrollWidth == clientWidth` (1280 and 375). A decorative blurred circle on Home pokes 15px past the edge but is clipped by `overflow-hidden` (no scroll). |
| 8 | Mobile drawer shows logo and switcher | PASS | PASS | 11, 12. |
| 9 | No theme toggle anywhere | PASS | PASS | No toggle in the sidebar, drawer or top bar. |
| 10 | Light with stored `nebulaa-theme='dark'` and with the system in dark | PASS | PASS | `html.dark` never present; the stored value is removed on load; `prefers-color-scheme: dark` was true and the app stayed light. |
| 11 | No dark flash on load | PASS (after round 2 fix) | PASS | Was FAIL: while `/auth/me` is pending, `App.tsx` (l.164-169) rendered a full-screen loader on `bg-[#070A12]` with a `#ffcc29` spinner, before `Layout` adds `gravity-shell` (00). Now `bg-[var(--gv-bg)]` and `text-[var(--gv-accent)]`. Verified by holding `/auth/me` for 2.5s in the mock: the loader computed `rgb(251,245,234)` (cream), spinner `rgb(245,166,35)`, no `dark` class (50). Before the app boots, the plain `body` is `#ededed` (light grey, not dark, but not cream). |
| 12 | Text on cream readable | PASS (after fix) in the shell | PASS | `.gravity-label` was `rgba(255,255,255,.45)`, so the sidebar "Setup" heading (and every `gravity-label` without its own colour across 15 files) was invisible on cream (01). Now `var(--gv-text-tertiary)`: 5.88:1 on panel. Other measured pairs: "Coming soon" pill (accent-text on accent-fill over panel) 5.03:1; disabled item text (muted) 3.66:1 on panel. |
| 13 | Focus rings visible | PASS (after fix) | PASS | Trigger: 2px `--gv-accent-text` ring with a panel-coloured offset (5.38:1 against panel) (04); menu items: inset ring when focused by keyboard (05). Account chip and nav links show the browser default focus outline. |
| 14 | Global `.gravity-label` colour does not break labels on remaining dark surfaces | PASS (after round 2 fix) | n/a | Found in review: changing `.gravity-label` to tertiary (`#6D6250`) left the labels inside `DraftPreviewModal` (a literal dark panel, gradient `#131316` to `#0b0b0e`, on Approve, Drafts and Campaigns) at 3.10:1 / 3.29:1. Those 7 labels (source type, Prompt, Title, Caption, Hashtags, Call to action, Posting to) now carry `text-[rgba(245,244,241,0.55)]`, the old dark-era look: 5.72:1 on `#131316`, 5.79:1 on `#0b0b0e` (computed; the old white 45% was 4.53:1). The two labels that already set gold are unchanged. The two `ContentCalendar` labels (Auto Generation, Limit) sit on `bg-white/[0.02]` over cream, not on a dark card, so tertiary is right there: 5.52:1 (measured live, 53). The modal is otherwise untouched (part 2) (52). |

Other shell fixes in the same commit: the top bar said "Dashboard" on `/idea-inbox` and `/upload`; it now says "Idea Inbox" and "Upload & Schedule" (the existing nav labels). The trial dot uses `var(--gv-accent)` instead of the literal hex. The icon-only drawer open/close buttons got `aria-label`s. The focus `requestAnimationFrame` is cancelled on re-open and unmount.

Shell observations not fixed (needs a decision, or out of scope):
- (Fixed in round 2) The Approve nav badge showed a hard-coded **5** for every user, a pre-existing fake count. No real drafts count is loaded in `Layout`, so the badge element is removed; the `badge` field stays on the nav data so a real count can be wired later (51).
- At 800px tall the sidebar nav scrolls (AI Memory sits under the footer) with the scrollbar hidden, so it is easy to miss. The switcher adds 48px. Worth a look in part 2's nav review.
- The mobile header logo is between the hamburger and the right group (`justify-between`), so it sits slightly left of centre (10).

## Pages already on tokens (spot check)

| Page | Route | Result | Shot |
|---|---|---|---|
| Home | `/dashboard` | New look, clean. | 02, 10 |
| Create | `/campaigns` | New look, clean. | 20 |
| Approve | `/drafts` | New look, clean (empty state). | 21 |
| Calendar | `/content-calendar` | **Mixed (part 2 item)**: the "No plans found" empty-state card is near black (`bg-slate-900` mapped to `#0A0A0A` by the `index.html` override layer); the toggle pill top-left is near invisible (light on cream); a plan card has a black cover band and white month/theme/language text that is invisible on cream (only the Auto Generation/Limit labels and the switch read). `ContentCalendar.tsx` still has 15 `isDarkMode` uses. | 22, 53 |
| AI Memory | `/ai-memory` | New look, clean. | 23 |
| Hero Studio | `/reels/hero` | New look, clean (no-story state). | 24 |
| Insights | `/analytics` | New look, clean. | 33 |

## Pages that look mixed or dark-era (for the part 2 spec)

`isDarkMode` counts are from `grep -c isDarkMode`. The common causes: `text-white`, `bg-white/5`-style classes that were written for dark mode (white text and faint white fills disappear on cream), the `index.html` "override layer" that turns legacy dark classes into near black, and cool grey/blue panels that clash with cream.

| Page | Route | isDarkMode | What is wrong | Shot |
|---|---|---|---|---|
| Videos (ReelGenerator) | `/reels` | 41 | Main panel is a cool blue-grey that clashes with cream; tab labels and the top-right preferences button are white-on-light and near invisible. | 30 |
| Idea Inbox | `/idea-inbox` | 0 (18 `text-white`/`bg-white/` uses) | Input card, field, date picker and list header near invisible (white text and faint white fills); only "Add idea" is visible. | 31 |
| Upload & Schedule | `/upload` | 0 (9 `text-white`/`bg-white/` uses) | The drop zone and its text are near invisible. | 32 |
| Brand Assets | `/brand-assets` | 58 | Tab pills, card titles ("Logos", profile heading) and the Font Type field are near invisible; logo drop zone is a cool grey. | 34 |
| Brand Assets > Products (Inventory) | `/inventory` -> `/brand-assets?tab=products` | 63 | Tabs, stat values and the search bar are near invisible; a white card with a black circle sits below. | 37 |
| Connect Socials | `/connect-socials` | 28 | "Social Inbox" title, a status pill (top right) and the tab pill are near invisible; the disabled "Open Unified Social Inbox" button is low contrast. | 35 |
| Settings | `/settings` | 28 | Nearly the whole form is invisible: tabs, labels, inputs and values are white on cream. Worst page. | 36 |
| Competitors (hidden from nav) | `/competitors` | 56 | Section titles ("Competitor Activity Feed", "Competitors") and a pill are near invisible. | 38 |
| Ad Campaigns (hidden from nav) | `/ad-campaigns` | 46 | Looks plain light (white card, cool tones), not the cream look; readable. | 39 |
| AI History | `/ai-history` | 4 | Search field near invisible; otherwise readable. | 40 |

Not opened in this check (listed by `isDarkMode` count only): `Dashboard.tsx` (classic, 206; the route uses the new Home), `Campaigns.tsx` (292; parts of Create flows past the first screen), `Analytics.tsx` (59), `Collaborations` (27), `SEOAssistant` (22), `Influencers` (21), `InfluencerList` (15), `UnifiedInbox` (11), `InfluencerPortal` (10), `AutoReplySettingsPage` (7), `SubmissionReview` (5), `InfluencerAnalytics` (5), `AIPerformance` (5), `InfluencerProfile` (4); components `BoostPostModal` (30), `PlatformPreview` (15), `LogoSelector` (11), `ChatBot` (10), `ReelToneAudioPreview` (9), `NotificationBell` (9), `StrategyDocumentView` (7), `InfluencerPortalTabs` (3), `CampaignReminderPopup` (2).

## Not verified

- Old Firefox Space behaviour (only Chromium in the Browser pane); the fix removes the cause.
- Real network timing of the loader (now light either way).
- Pages past their first screen, most modals, and states with real data (lists were empty, except one fake draft and one fake plan in round 2).
- Sign-in, onboarding and landing (part 3).
- Safari / iOS rendering; only the Chromium-based pane with mobile emulation.

## Commands after the fixes

- `node --test tests/*.test.mjs`: 13 pass, 0 fail.
- `npx tsc --noEmit`: exactly the 4 pre-existing errors (AdminDashboard, AdminLogin, Influencers, LandingPage).
- `npm run build`: built; `backend/public` restored afterwards (`git checkout` + `git clean`), nothing committed there.
