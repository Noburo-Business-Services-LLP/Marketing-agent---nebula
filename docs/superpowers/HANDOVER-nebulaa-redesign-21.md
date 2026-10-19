# Handover 21: 2026-10-19 (night): Navigation Phases 3 to 6 built (menu, Plan and Insights hubs, Review inside the Library, one width and one background)

Read handover 5, 9 to 20 (19 is the main state document), then this file, then `docs/superpowers/OWNER-REQUESTS-LEDGER.md` and `docs/superpowers/impact-maps/simplify-navigation.md` (owner's FINAL decisions, then "Phases 3 to 6 built"). Standing rules unchanged: owner (Dinesh) non-technical, plain language, exact commands in separate code blocks, honest reporting; he runs releases himself; never read or print `.env`; no paid or real provider call without his OK; real-DB work only on `nebulaa_dev` via scripts that refuse other DBs; stage by explicit path; push only to the existing `nebulaa-redesign`; at 95% of a usage window stop, commit, write the next handover.

## State
Branch `nebulaa-redesign`, everything committed, nothing pushed by this session. Production is still only up to `bc514a9`.

**RELEASE WARNING (unchanged): release the Phase 1 backend ONLY together with the Phase 2 to 6 frontend.** The old Review page approved by publishing and gets 409 for automation posts on the new backend. This session also changed two backend files (`routes/tour.js` takes the five new tour step ids and still accepts the old ones; `services/homeActions.js` links the competitors row to `/analytics?tab=competitors`), so release backend and frontend together.

Tests at the end: backend 2461 pass, frontend 798 pass, `npx tsc --noEmit` only the old `pages/Influencers.tsx` error, brand and voice audits 0, art budget OK, `gen-layer-lists.mjs` run (its block unchanged).

## Done this session (commits `6286073`, `7da6251`, `838245d`, then docs and `index.html`)
1. **Phase 3, menu.** Home, Plan, Create, Library (gold count of posts waiting for approval, from `/drafts/counts`), Inbox, Insights, then the folded Setup group (Brand assets, Connected accounts, Settings, Help). Role entries (Staff area, My clients, Clients) stay first. The open category shows its parts indented (Plan: My plan, Calendar, Content ideas, Blueprint; Create: Create content, Create video, Photoshoot; Inbox: Messages and comments, Reviews, Automatic replies; Insights: Performance, Competitors on paid plans, What Nebulaa learned), with an arrow button to open or close (keyboard and screen reader friendly), in the phone drawer too. The dead top-bar Search button is gone. The top bar shows "Category / part". Model and tests: `frontend/utils/navMenu.ts`, `tests/navMenu.test.mjs`.
2. **Phase 3, redirects** (old links keep working, query kept, replace): `/drafts`, `/content-calendar` (and `?tab=ideas`), `/idea-inbox`, `/blueprint` (list, after onboarding only), `/competitors`, `/ai-memory`. `/blueprint/new` and `/blueprint/:id` unchanged.
3. **Phase 3, tour**: five steps (welcome, Create, Library, Plan and calendar, Help).
4. **Phase 4, Plan hub** (`/plan`): tabs My plan (funnel kept), Calendar (Month plan and Schedule, `&view=schedule`), Content ideas, Blueprint (one line on what it is, Create a Blueprint, four status tiles with the Blueprint price and the designed PDF price from the cost map in Quarks, the list). One header per tab; tabs live in the address and the back button works.
5. **Phase 3, Insights hub** (`/analytics`): Performance, Competitors, What Nebulaa learned ("Brand memory" renamed everywhere on screen).
6. **Phase 5, Review inside the Library**: `/library?view=approve&mode=one` draws Review one by one (shared post actions, all approval rules unchanged, Back to the grid); arrows only in that view and never while typing. The calendar's "N awaiting approval" now uses the same count as the Library.
7. **Phase 6 (owner request of 2026-10-19), one width and one background**: one page frame in `Layout.tsx` (full content area up to 1600 px), every per-page narrow column removed; the body glow, the Home greeting glow, the page glows and the hero-block glows removed; the same plain cream everywhere. Guard `tests/pageFrame.test.mjs`; rule in `docs/superpowers/ops/tile-system.md`, "Page width and background".

### Width and background, measured (sample-data preview, 1280 wide unless noted)
Before (at 1680 wide, where the caps show; area = the content area):

| Page | Area | Page column | Glow behind the page |
|---|---|---|---|
| Home | 1368 | 1180 | body glow, greeting glow |
| My plan | 1368 | 1120 | body glow, page glow |
| Create content / Upload | 1368 | 960 / 900 | body glow |
| Create video | 1368 | 820 | body glow |
| Photoshoot | 1368 | 1132 | body glow, page glow |
| Library | 1376 | 1052 | body glow |
| Inbox | 1368 | 1120 | body glow, page glow |
| Performance / What Nebulaa learned | 1368 | 1180 / 1120 | body glow, page glow, hero glow |
| Brand assets | 1368 | 1280 | body glow |
| Connected accounts | 1376 | 1024 (5xl) | body glow |
| Settings | 1368 | 896 | body glow |
| Plans | 1368 | 1152 | body glow |
| Blueprint form / document | 1368 | 720 / 858 | body glow |

After (1280 wide: every page frame 964 to 972, the difference is the scroll bar; body `rgb(251, 245, 234)`, no glow layer):

| Page | Frame | Content | Glow behind the page |
|---|---|---|---|
| Home, My plan, Calendar, Content ideas, Blueprint tab | 964 to 972 | full | none |
| Create content, Upload, Create video, Photoshoot | 964 to 972 | full | none (the idea box halo on Create video is a card) |
| Library, Review one by one | 964 to 972 | full | none |
| Inbox, Performance, Competitors, What Nebulaa learned | 964 | full | none (the listening card keeps its own tint) |
| Brand assets, Connected accounts, Settings, Plans, Clients | 964 to 972 | full | none |
| Blueprint form (in the app) | 964 | full | none |
| Blueprint document | 964 | 858 (reading exception) | none |

At 375 (measured in a 375 px frame): every page above has a 331 to 339 px frame, no sideways scroll, the same plain body colour.

## Known gaps
- Reel and video drafts in the Library still use their own footer (Open, Edit, Download, Make again), not PostActions.
- The Library's Needs approval band and the menu badge use `/drafts/counts`; Home's "Needs approval" tile uses the home summary (same backend rule). In the preview mock they differ (4 and 2): mock data only.
- The Calendar tab has an inner Month plan / Schedule toggle under the Plan tab bar (two pill rows). Readable, but the owner may prefer one row.
- The Blueprint form inside the app is now full width; its fields are in two columns where they were, single fields stretch across (acceptable, could be split into sections later).
- The first of the two navigation commits (`6286073`) alone has one type error (`Library user` prop) that the next commit (`7da6251`) resolves; release them together.
- Older items from handover 20 stay: Make again on a video does not restore its photos; calendar entries made before posts were linked; the scheduler's partial-success rule.

## Owner steps
1. Look at the new menu in the sample preview (`cd frontend && AUDIT_PORT=3140 npx vite --config scripts/visual-audit/vite.audit.config.mjs`, then `http://127.0.0.1:3140/?audit=normal#/dashboard`) and say if the names (Home, Plan, Create, Library, Inbox, Insights, Setup; "What Nebulaa learned") are right.
2. Release backend and frontend together (warning above).

## DO NEXT
1. Library video drafts on PostActions; a one-row Calendar toggle if the owner wants it.
2. Leftover items of handover 19 and 20 (video platform picker, campaigns and calendar `ContentDraft` delete paths into the Bin).
3. Remaining areas and owner steps as in handover 19.
