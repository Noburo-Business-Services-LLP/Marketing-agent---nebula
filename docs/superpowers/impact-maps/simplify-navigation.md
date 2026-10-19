# Impact map and build plan: SIMPLIFY NAVIGATION and ONE SET OF POST ACTIONS

Written 2026-10-19 on branch `nebulaa-redesign`, before any code. Ledger item: Cross-cutting, "SIMPLIFY the whole application" (`OWNER-REQUESTS-LEDGER.md` line 110). Read-only analysis. Nothing here is built yet.

## 0. Plain-English summary (for the owner)

- **The menu gets shorter: 6 entries plus a folded Setup group** (it has 11 to 12 entries plus a 4-entry group today). Each entry is a category, and its pages are tabs inside it:
  **Home · Plan · Create · Library · Inbox · Insights · Setup**.
- **Growth Blueprint moves into Plan** as a tab next to My plan and Calendar. It stops being its own menu entry.
- **Create becomes one entry.** The Create page already has the six tiles (Video, Photoshoot, Single post, Campaign, Carousel, LinkedIn). Videos and Photoshoot stop being separate menu entries. Their pages stay where they are and show "Create" as the active menu entry.
- **Review and approve moves into Library** as its first view, "Needs approval", with the count shown on the Library entry. The one-by-one review screen stays as it is, only its place in the menu changes.
- **Every post gets the same buttons, in the same order, wherever you see it**: Approve, Schedule, Post now, Download, Edit, Make again, Archive. This covers Library, the Create, Video and Photoshoot results, Calendar, Home and Review. A button you cannot use stays visible with a short reason (for example "Needs the Publish add-on"), so the screens do not change shape.
- **Your direct question, answered from the code: yes, an approved post leaves "Review and approve", but today "Approve" means "post it now".** Nothing waits as "approved". If posting succeeds, the post becomes Posted and leaves the list. If posting fails (no connected account, no Publish add-on, a platform error), the post stays in the list with the error. See section 2.
- Old links, bookmarks and tour steps keep working through redirects.
- 5 small phases, each shippable on its own. About 7 to 9 working days in total. You need to make 8 decisions (section 7). Each one has a recommended default.

## 1. What exists today (from the code)

### 1.1 Menu (`frontend/components/Layout.tsx` lines 182-223; `utils/navMenu.ts`)

| Order | Entry | Route | Shown when |
|---|---|---|---|
| 0 | Staff area | `/staff/home` | staff (`staffMenuEntry`, primary or in the group) |
| 0 | My clients | `/clients` | CSM without a return pass |
| 0 | Clients | `/agency/clients` | agency owner or lapsed agency |
| 1 | Dashboard | `/dashboard` | always |
| 2 | My plan | `/plan` | `showsMyPlan` (customers, agency owners, inside a client; not staff or lapsed agency) |
| 3 | Create content | `/campaigns` (PageTabs: Create with Nebulaa, Upload and schedule) | always |
| 4 | Videos | `/reels` (`VideosEntry`: `CreateVideo`, or `ReelGenerator` with `?jobId`) | always |
| 5 | Photoshoot | `/photoshoot` | always |
| 6 | Review and approve | `/drafts` (`GravityApprove`) | always; has `badge: 'drafts'`, but **the badge is never drawn** (comment at line 295: no count is loaded) |
| 7 | Library | `/library` | always |
| 8 | Calendar | `/content-calendar` (PageTabs: Calendar, Content ideas; Calendar = `CalendarHome` with its own Plan and Schedule toggle) | always |
| 9 | Inbox | `/inbox` (parts: messages, `?tab=reviews`, `?tab=auto-reply`) | always |
| 10 | Performance | `/analytics` (`GravityInsights`) | always |
| 11 | Competitors | `/competitors` | `showsCompetitorsEntry` (paid, or inside a client; never free or staff-only) |
| Group "Setup and tools" (folded, remembered in `nebulaa_sidebar_more`, open on its own pages through `groupHasPath`) | Growth Blueprint `/blueprint`, Brand assets `/brand-assets`, Connected accounts `/connect-socials`, Brand memory `/ai-memory` | |

Other parts of the page frame:
- **Mobile menu**: the same `<aside>` slides in. On a phone the AppSwitcher and ClientSwitcher sit at its top. The tour opens it through `onNeedsMenu`.
- **Top bar**: AppSwitcher ("Content"; Outreach and Lead generation are listed but not available, `utils/appSwitcher.ts`), ClientSwitcher, the title and crumb from `resolveTopBarMeta`, a **Search button with no onClick (dead)**, HelpMenu (replay tour, setup steps, support), NotificationBell, the Quark pill (hidden for agencies through `showsPostsNotQuarks`), and AccountMenu (Business profile, Settings).
- **Tour** (`utils/tour.ts` `TOUR_STEPS`): 6 steps on `/dashboard`. Anchors `this-week`, `nav-create` (`/campaigns`), `nav-review` (`/drafts`), `nav-calendar` (`/content-calendar`), `nav-plan` (`/plan`), `help`. The `NAV_TOUR` map is in Layout line 270.
- **Blueprint banner**: when `needsPlan` is set, a banner links to `/blueprint` and `/trial-expired`.

### 1.2 Growth Blueprint
- **Routes**: `/blueprint/*` (`pages/BlueprintRoutes.tsx`), which holds the list (index), `new` (`BlueprintStart`) and `:id` (`BlueprintView`). These routes sit **outside the onboarding gate and the paywall on purpose**: a new sign-up lands on `/blueprint/new` before onboarding, and before onboarding the pages are drawn without the app frame. The list page is a title, rows and one button. That is the "nearly empty tab" the owner sees.
- **Backend** (`backend/routes/blueprint.js`): `POST /api/blueprint` (free tier: one free Blueprint per business, no Quark check; paid tiers: `requireCredits('blueprint')`, now 23 Quarks, derived from cost in `config/apiCosts.js`), `GET /`, `GET /:id`, `POST /:id/designed` (the designed PDF, `blueprint_pdf`, its own price), `POST /:id/continue`.
- **Overlap with My plan**: My plan is built by the **same planner** (`services/plan/planService.js` calls `blueprint/service`). For a free account, My plan already shows a "Your free Growth Blueprint" card linking to `/blueprint` or `/blueprint/:id` (`pages/MyPlan.tsx` 156-167). Calendar's Plan view also has a "Brand Growth Blueprint" promo card linking to `/blueprint/new` (`pages/CalendarHome.tsx`). So the Blueprint is already shown in Plan and Calendar. The separate menu entry repeats it.

### 1.3 Post status model
- **Draft model** (`backend/models/Draft.js`), status enum: `draft, scheduled, published, archived, processing, completed, failed`. **There is no `approved` value.**
- **One meaning** (`backend/services/draftStatus.js`, copied in `frontend/utils/draftStatus.ts`, checked by `tests/draftStatus.test.mjs`): waiting = pending, draft, ready, processing, completed; approved = approved, scheduled; published = published, posted; failed; closed = rejected, archived.
- **The Approve queue** (`isAwaitingReview`, `awaitingFilter`) holds waiting plus failed posts, **posts only**. Reels and videos are excluded.
- **Library words** (`utils/library.ts`): processing becomes Creating, completed becomes Ready, scheduled becomes Scheduled, published becomes Posted, archived becomes Archived, failed becomes "Did not finish", everything else becomes Draft.
- **Three different "Approve" buttons exist, and they mean three different things**:
  1. Home, This week (`ThisWeekCard`, `POST /week/approve`): approves the week's topics, then Nebulaa makes those posts.
  2. Calendar, approve month or day (`ContentCalendar` `approveItem`, `updateSettings({approved})`): approves the plan, not a post.
  3. Review, Create results (`publishDraft`, `POST /drafts/:id/publish`): **posts now**.

### 1.4 Actions on every post screen today

| Screen | File | Actions offered | Calls |
|---|---|---|---|
| Review and approve | `pages/GravityApprove.tsx` | Approve (= post now), Regenerate image (confirm, Quark price `image_generated`; 0 for campaign posts), Edit image by instruction, edit prompt, language versions, grid quick Approve and Redo; link "See drafts, scheduled and posted in the Library" | `publishDraft`, `retryImageGeneration`, `editImage`, `localizeDraft` |
| Post sheet (opened from Library and from the Create gallery) | `components/DraftPreviewModal.tsx` (still dark-era styling) | Save changes, Schedule, Publish now (confirm), Download image or all slides, Regenerate image (confirm, price), Edit image; calendar posts: Regenerate whole post, Reject; other posts: Archive (confirm) | `updateDraft`, `scheduleDraft`, `publishDraft`, `retryImageGeneration`, `editImage`, `regenerateDraft`, `rejectDraft`, `deleteDraft` (soft archive) |
| Library tiles | `pages/Library.tsx`, `libraryTileActions` | Open; Edit (draft or failed only; for posts, **Edit sends you to `/drafts`**); Download (not for posts); Delete only for Hero and video drafts | Hero, video and photoshoot panels: Download, Edit, Delete, `HeroShare` (post or schedule), `HeroEdit`, "Make a new version from the prompt" |
| Create results | `pages/GravityCreate.tsx` 1560-1790 | Write caption, Edit caption, View prompt, Regenerate, Edit image, Delete; then Save as draft, **Approve (= post now)**, Schedule. Footer: "Generate N more", **"Send all to approval", which actually posts every card now**. No Download. | `publishDraft`, `scheduleDraft`, `deleteDraft`, `retryImageGeneration`, `editImage` |
| Create gallery | `components/CreateGenerations.tsx` | Open (opens the post sheet) | as the post sheet |
| Videos results (Omni studio) | `pages/CreateVideo.tsx` | Download, Make another video, Delete in history. **No post or schedule. These videos are not loaded by the Library** (`StudioVideo` model; `Library.tsx` never calls `studioVideosAPI.list`). | `studioVideosAPI.*` |
| Hero video | `HeroShare`, `HeroEdit` | Post now or schedule, edit the finish, new version | `POST /hero-video/jobs/:jobId/publish` (**no `requireFeature('publish')`**) |
| Old reels | `ReelGenerator` | Schedule or post | `POST /video-generation/schedulePost` (**no `requireFeature('publish')`**) |
| Photoshoot results | `pages/Photoshoot.tsx` 330-360 | Use in Create, Download, Save to or remove from Library, Make again (`redoLabel`, per-photo price) | `photoshootAPI.redo`, `setInLibrary` |
| Calendar, Schedule view | `pages/GravityCalendar.tsx` 233 | Clicking any post goes to `/drafts`. That is wrong for scheduled and posted posts, which are not in that queue. | none |
| Calendar, Plan view | `pages/ContentCalendar.tsx` | approve or reject plan days, generate the week | content-calendar routes |
| Home | `GravityHome`, `HomeBlocks`, `ThisWeekCard`, `DraftSheet` | week Approve, Change, Skip; "Drafts waiting" tile links to `/drafts` (`utils/homeLayout.ts:26`); Do-this-next "Review N posts" links to `/drafts` (`backend/services/homeActions.js:79`); DraftSheet: Copy, Use in Create | `/week/*`, home summary |

## 2. Direct answer: does an approved post leave "Review and approve"?

Yes. The queue only lists waiting and failed posts, and Approve posts the post immediately. Here is exactly what happens to each status (`backend/routes/drafts.js`):

| Status | In Review and approve? | Library shows | How it gets there or leaves |
|---|---|---|---|
| `processing` | Yes, as "being made" | Creating | Set by generation; becomes `completed`, or `failed`. |
| `draft`, `pending`, `ready`, `completed` | Yes | Draft or Ready | **Approve** = `POST /drafts/:id/publish`. On success the status becomes `published`, the post **leaves** the queue, and the Library shows Posted. On failure the status is unchanged, the post **stays**, and the error is shown. |
| `failed` | Yes, so it can be retried | Did not finish | Regenerate (`retry-image`) moves it back to processing. |
| `scheduled` | **No** | Scheduled | Reached through Schedule (`POST /drafts/:id/schedule`, needs the Publish add-on). The background scheduler posts it later through its Campaign. |
| `published` | No | Posted | |
| `archived` (Archive, Delete or Reject) | No | Archived | `DELETE /drafts/:id` and `POST /drafts/:id/reject` both set `archived` (a soft delete; Reject also marks the calendar day rejected). |

Two consequences the owner should know about:
- **An account without the Publish add-on (every free account, and paid accounts without it) cannot approve at all.** Publish returns 403 "upgrade" or "add-on", so those posts sit in the queue for ever. The only ways out are Archive or Download.
- **Videos never appear in Review and approve.** Studio (Omni) videos are not in the Library either.

## 3. The new menu (recommended)

| # | Entry (sidebar) | Route | Tabs on the page (same `PageTabs` style, `?tab=`) | Who sees it |
|---|---|---|---|---|
| 0 | Staff area, My clients, Clients | unchanged | unchanged | same rules as today |
| 1 | **Home** | `/dashboard` | none | all |
| 2 | **Plan** | `/plan` | My plan · Calendar · Content ideas · Blueprint | My plan tab: `showsMyPlan`; others: all (staff without a client: Calendar only) |
| 3 | **Create** | `/campaigns` | Create with Nebulaa (six tiles) · Upload and schedule | all; `/reels`, `/reels/*` and `/photoshoot` light up "Create" and show the crumb "Create / Video" or "Create / Photoshoot" with a "Back to Create" link |
| 4 | **Library** (count badge) | `/library` | views: **Needs approval (N)** · Scheduled · Posted · All · Archived; "Review one by one" opens the current `GravityApprove` view | all |
| 5 | **Inbox** | `/inbox` | Messages and comments · Reviews · Automatic replies (already exist as parts) | all (the page shows its add-on note) |
| 6 | **Insights** | `/analytics` | Performance · Competitors · What Nebulaa learned | Competitors tab: `showsCompetitorsEntry`; others: all |
| 7 | **Setup** (folded group, as today) | | Brand assets · Connected accounts · Settings · Help | all |

**Sidebar shape.** Each entry is a category. When you are inside a category, its tabs also show as indented sub-items under the entry (one category open at a time), so the customer learns the structure. Other categories stay closed. This is 6 visible lines plus "Setup", against 12 to 13 today.

**Alternatives considered:**
- **A. Calendar stays its own entry** (7 entries). It is easier to find, but it splits "what we plan" from "the plan". The owner asked for fewer entries. Rejected, but this is decision D2.
- **B. Calendar inside Library** (posts by date). The Schedule grid is about posts, but the month plan view is about planning. It would split one page across two places. Rejected for now. Phase 6 could add a "Month" layout toggle to Library's Scheduled view later.
- **C. Keep Review and approve as its own entry next to Library.** It is the most-used action, but the owner asked for one place for posts. The badge on Library and "Needs approval" as Library's default view (when N > 0) keep it one click away. Rejected.
- **D. Separate section headings** ("Make", "Posts", "Results"). With single entries under each heading, the headings are noise. Rejected in favour of the expanding categories above.

**Why this one:** it follows how the work flows (plan, create, approve and track, talk to customers, learn). It holds 6 to 7 lines. Every page you can reach today is still reachable in at most 2 clicks.

### 3.1 Routes that move, and the redirects (all `<Navigate replace>` in `App.tsx`; keep them for good)

| Old | New | Notes |
|---|---|---|
| `/drafts` | `/library?view=approve` | `GravityApprove` is drawn inside Library for that view. Keep `?view=approve&mode=one` for one-by-one review. |
| `/blueprint` (the list, index only) | `/plan?tab=blueprint` | **`/blueprint/new` and `/blueprint/:id` do not move.** They must stay outside the onboarding gate for new sign-ups (`BLUEPRINT_SIGNUP_PATH`). Inside the app frame they light up "Plan". |
| `/content-calendar` | `/plan?tab=calendar` | Keep the inner Plan and Schedule toggle as `&view=schedule`. |
| `/content-calendar?tab=ideas`, `/idea-inbox` | `/plan?tab=ideas` | `/idea-inbox` already redirects; repoint it. |
| `/competitors` | `/analytics?tab=competitors` | The page component is unchanged. |
| `/ai-memory` | `/analytics?tab=learned` | `/ai-history` and `/ai-performance` stay and light up Insights. |
| `/reels`, `/reels/hero`, `/reels/studio`, `/photoshoot`, `/campaigns`, `/library`, `/inbox`, `/analytics`, `/plan` | unchanged | Only the menu's active state changes. |
| `/content-calendar-grid`, `-classic`, `/dashboard-classic`, `/analytics-classic` | unchanged | Not in the menu. Leave them. |

**Active state**: replace `isActive` and `groupHasPath` with one pure `navSectionOf(pathname, search)` in `utils/navMenu.ts` that maps every route to home, plan, create, library, inbox, insights, setup or staff (tested).

### 3.2 Everything else the move touches

- **Links to repoint** (the redirects cover them, but direct links are cleaner):
  - `backend/services/homeActions.js:79` (`/drafts`)
  - `utils/homeLayout.ts:25-26` (`/content-calendar`, `/drafts`)
  - `Library.tsx` `goEdit` (`/drafts`; should open the post sheet instead)
  - `GravityCalendar.tsx:233` (should open the post sheet, not `/drafts`)
  - `GravityCreate.tsx:997` fallback
  - `GravityApprove.tsx` Library link (this becomes a view switch)
  - `Layout.tsx` needsPlan banner (`/blueprint`)
  - `MyPlan.tsx:164` (`/blueprint`)
  - `CalendarHome.tsx` Blueprint card (`/blueprint/new`; drop the card once the Blueprint tab exists)
  - `pages/Dashboard.tsx` (classic, 17 links)
  - `utils/strategyLevels.ts`, `utils/competitorsHome.ts`, `components/CompetitorTiles.tsx`, `CompetitorInsights.tsx` (`/competitors`)
  - `NotificationBell.tsx` (`/campaigns?selected=`, unchanged)
- **Top bar title and crumb** (`resolveTopBarMeta`): Plan / Calendar, Plan / Blueprint, Create / Video, Create / Photoshoot, Library / Needs approval, Insights / Competitors.
- **Guided tour** (`utils/tour.ts`, `Layout NAV_TOUR`). Go from 6 steps to 5:
  1. welcome (unchanged)
  2. `nav-create` "Make something yourself" (unchanged)
  3. `nav-library` "Approve, schedule and download" (replaces `nav-review`)
  4. `nav-plan` "Your plan and calendar" (merges the calendar and plan steps)
  5. help

  `visibleSteps` already drops a step whose anchor is missing, so an old anchor never breaks the tour. Update `tests/tour.test.mjs` and `tourWording.test.mjs`.
- **Badge**: draw the Library count (section 4.5). Draw nothing when the count is 0 or unknown.
- **Search**: the top-bar Search button does nothing. Remove it (default) or wire it to Library search (decision D7).
- **Header "Content" selector** (AppSwitcher): no change. Its target `/dashboard` stays.
- **Mobile**: same component. Sub-items under the active category; the tour's `onNeedsMenu` is unchanged. Check the tour anchors in the mobile drawer.
- **Staff, CSM and agency**: the role entries stay first. A CSM inside a client and an agency client see the same 6 entries. Staff without a client: Home, the staff entry, Setup.
- **Tests**: `tests/navMenu.test.mjs` (`groupHasPath` fixture lists `/blueprint`; add `navSectionOf` and a redirect table test), `tests/tour*.test.mjs`, `tests/homeLayout.test.mjs` (tile `to`), `tests/library.test.mjs` (views), `tests/appSwitcher.test.mjs` (unchanged).
- **Audits**:
  - `frontend/scripts/visual-audit/routes.json`: add `/library?view=approve`, `/plan?tab=calendar`, `/plan?tab=blueprint`, `/plan?tab=ideas`, `/analytics?tab=competitors`, `/analytics?tab=learned`; keep the old routes so the redirects are checked.
  - `mock-session.js:493` (`to: '/drafts'`).
  - `tests/voice-scope.json` (add new files: `components/post/PostActions.tsx`, `utils/postActions.ts`, and Plan and Insights tab shells).
  - brand-names and voice-names allowlists: the new labels contain no agent names.

## 4. ONE shared PostActions model

### 4.1 Pieces
- `frontend/utils/postActions.ts` (pure, tested): `actionsFor(item, ctx)` returns an ordered list of `{ key, label, place: 'primary'|'row'|'more', confirm?, price?, lockedReason?, run }`.
  - Input `item` is the existing `LibraryItem` (`utils/library.ts` already normalises posts, video drafts, Hero jobs and photoshoot photos). Add `fromStudioVideo`.
  - `ctx` = `{ canPublish, canSchedule, postsOnly, staffView, costs, hasPlannedDate }`.
- `frontend/components/post/PostActions.tsx`: one component, two layouts. `variant="card"` gives a primary button plus icon row plus "More" menu. `variant="sheet"` gives a full button row in the post sheet. The same order and words everywhere.
- `frontend/utils/postActionRun.ts`: the calls (section 4.4). After every success it dispatches `nebulaa-posts-changed`.

### 4.2 Fixed order and place
**Approve · Schedule · Post now · Download · Edit · Make again · Archive** (Delete and Restore sit in "More"). The primary button is the first action that is available for the item's status. The rest keep their slot even when locked.

| Status (Library word) | Primary | Row | More |
|---|---|---|---|
| Creating | none (timer) | none | none |
| Needs approval (Draft, Ready) | **Approve** | Schedule, Post now, Download, Edit, Make again | Archive |
| Did not finish | **Make again** | Edit | Archive |
| Approved (new, see D1) | **Schedule** | Post now, Download, Edit, Make again | Archive, Back to Needs approval |
| Scheduled | **Change time** | Post now, Download, Edit | Unschedule, Archive |
| Posted | **Download** | Make again ("Make a new version") | Archive (hides from Library) |
| Archived | **Restore** | Download | Delete for good (D6) |
| Photoshoot photo | **Use in Create** | Download, Make again | Remove from Library |

### 4.3 Confirmations and prices
- **No confirm**: Approve, Download, Edit, Archive. Archive shows an "Undo" notice for 6 seconds instead of a dialog.
- **Confirm**: Post now (names the platforms), Make again (states the price), Delete for good (danger), Unschedule.
- **Prices shown on the button and in the dialog**, always from `costs` (`apiCosts.js` through `/credits`), never typed into the page:
  - Make again, post image: `image_generated` (today it is 0 for campaign posts, as in `regenerateCostFor`)
  - Make again, whole calendar post: the `/regenerate` price
  - Edit image: its charge
  - Photoshoot redo: per-photo price (`redoLabel`)
  - Hero new version: the Hero price
  - Studio video change: the change price
- Agencies and their clients see "1 post" or "1 video" instead of Quarks (`showsPostsNotQuarks`).

### 4.4 Permissions and what each action calls

| Action | Posts (`Draft`) today | Videos and photos today | Gap to build |
|---|---|---|---|
| Approve | `POST /drafts/:id/publish` (posts now; `requireFeature('publish')`) | none (videos are not in the queue) | new `POST /drafts/:id/approve`: sets `approved` (add to the enum); if `hasPlannedDate` and the account can publish, schedules the post on its planned date (D1); free for all tiers |
| Schedule | `POST /drafts/:id/schedule` (`requireFeature('schedule')`) | Hero `POST /hero-video/jobs/:id/publish` with `scheduledAt`; reels `POST /video-generation/schedulePost` | add `requireFeature('schedule')` to both video routes; studio videos have no route (new, reuse `services/videoPublish`) |
| Post now | `POST /drafts/:id/publish` | same two video routes with `publishNow` | same gating; studio videos (new) |
| Download | direct `imageUrl`, all slides in the sheet | `/content/download-video` proxy, photo URL | one `downloadItem()` helper; carousel as a zip later |
| Edit | `PUT /drafts/:id`, `edit-image` | `HeroEdit`, studio `change`, reel `?jobId` | none |
| Make again | `retry-image` (image) or `/regenerate` (calendar slot) | photoshoot `redo`, Hero new version | none |
| Archive | `DELETE /drafts/:id` (soft) or `/reject` (calendar) | Hero `remove`, video `deleteDraft`, `studioVideosAPI.remove` (these are real deletes) | name these "Delete" with a confirm, as Library does today |
| Unschedule, Restore | none | none | new `POST /drafts/:id/unschedule` (status back to `draft`, Campaign set to draft) and `POST /drafts/:id/restore` |

**Who can do what:**
- **Free tier**: Approve, Download, Edit and Make again are allowed. Schedule and Post now are shown locked with "Needs a paid plan" and open `UpgradePrompt`.
- **Paid tier without the Publish add-on**: the same, with "Needs the Publish add-on".
- **Managed**: everything.
- **Agency client, or a CSM inside a client**: same as the client's plan, no Quark numbers.
- **Staff without a client open**: read only (`staffView`: Download only).
- **The server stays the judge**: a 403 with `upgradeRequired` shows the same prompt (`upgradeInfoOf`).

### 4.5 One "needs approval" count everywhere
- **Backend**: new `GET /api/drafts/awaiting-count` that does `Draft.countDocuments(awaitingFilter(userId))`. It uses the existing `{userId, status}` index. Videos join the count once D3 is decided. The home summary cache is already cleared after writes (`invalidateOnWrite` in `routes/home.js`); confirm it is mounted on the `/drafts` write routes.
- **Frontend**: `utils/approvalCount.ts` is a small store. It loads on start, reloads every 60 seconds and on `nebulaa-posts-changed`, which PostActions dispatches after each action (the same pattern as `credits-updated`).
- **Readers**: the Library badge in the sidebar, the "Needs approval (N)" chip, the Home "Drafts waiting" tile and the Do-this-next row.

### 4.6 Fixes that come with it
- "Send all to approval" (`GravityCreate.tsx` 1778) posts everything now. Rename it "Approve all" and use the new approve route.
- The "Approve" button in Create results is labelled "Publish now" in its title. Replace the whole row with PostActions.
- `DraftPreviewModal.tsx` is still dark-era styling. It is restyled when PostActions goes in, since its footer is replaced.

## 5. Phased build plan (each phase ships on its own)

| Phase | What | Files | Effort | Tests | Risk |
|---|---|---|---|---|---|
| 1 | `utils/postActions.ts` plus `PostActions.tsx`; adopt them in **Library** tiles and the post sheet (`DraftPreviewModal` footer); `/approve`, `/unschedule`, `/restore` routes plus `approved` in the Draft enum and both `draftStatus` copies; the count endpoint and store; Library badge | `utils/postActions.ts`, `components/post/*`, `Library.tsx`, `utils/library.ts`, `DraftPreviewModal.tsx`, `backend/routes/drafts.js`, `models/Draft.js`, `services/draftStatus.js`, `utils/draftStatus.ts` | 2 to 2.5 days | action matrix per status and tier; `draftStatus.test.mjs` (lists equal); route tests with a fake model | the enum change: the scheduler only reads Campaign status, so `approved` is ignored there (check `notificationScheduler.js` and the publisher) |
| 2 | Adopt in the **Create, Videos and Photoshoot results**, Review (`GravityApprove` single and grid), Calendar Schedule view (open the sheet instead of `/drafts`), Home; studio videos in the Library (`fromStudioVideo`) and a studio publish route; `requireFeature` on the Hero and reel publish routes | `GravityCreate.tsx`, `CreateGenerations.tsx`, `CreateVideo.tsx`, `Photoshoot.tsx`, `GravityApprove.tsx`, `GravityCalendar.tsx`, `HeroShare.tsx`, `backend/routes/heroVideo.js`, `videoGeneration.js`, `studioVideos.js` | 2 days | snapshot of labels per screen (same order); gating tests | the new gating blocks video posting for paid accounts without the add-on (today it slips through); tell affected accounts (D8) |
| 3 | **Menu regrouping**: `navSectionOf`, 6 categories plus Setup, sub-items, redirects for `/competitors` and `/ai-memory` (Insights tabs), tour 5 steps, top-bar crumbs, remove the dead Search button | `Layout.tsx`, `utils/navMenu.ts`, `App.tsx`, `utils/tour.ts`, `GravityInsights` tab shell | 1 to 1.5 days | `navMenu.test.mjs`, redirect table, `tour*.test.mjs`; visual audit desktop and 375 px | tour anchors in the mobile drawer; other agents are editing `App.tsx` (merge carefully) |
| 4 | **Fold Blueprint and Calendar into Plan**: `/plan` with PageTabs (My plan, Calendar, Content ideas, Blueprint list); redirects `/blueprint` index and `/content-calendar`; drop the Calendar promo card; repoint the banner and MyPlan links | `App.tsx`, `MyPlan.tsx`, `CalendarHome.tsx`, `BlueprintRoutes.tsx` (index only), `Layout.tsx` | 1 day | redirect tests; the `/blueprint/new` sign-up path still works before onboarding (no Layout) | **the pre-onboarding Blueprint path must not break**; My plan's own header plus tabs (`pageHeader.test.mjs`) |
| 5 | **Review and approve as a Library view**: `/library?view=approve` draws the `GravityApprove` review (one by one or grid); "Needs approval" is the default view when N > 0; `/drafts` redirect; repoint `homeActions.js`, `homeLayout.ts` and the audit mock | `Library.tsx`, `GravityApprove.tsx` (header becomes a view), `App.tsx`, `backend/services/homeActions.js`, `utils/homeLayout.ts`, `scripts/visual-audit/*` | 1 day | `library.test.mjs` views; `homeLayout.test.mjs` links | keyboard arrows in `GravityApprove` must not fire while the grid view has focus |

Total: about 7 to 9 working days. Phases 1 and 2 give the uniform buttons. Phases 3 to 5 give the shorter menu. Phases 3 to 5 can run before 1 and 2 if the owner wants the menu first. They are independent apart from the badge, which needs phase 1.

## 6. What stays out of scope
- The Outreach and Lead generation areas in the header selector.
- The classic pages (`*-classic`), Ad Campaigns, Influencer Portal and SEO (routes intact, not in the menu).
- Carousel zip download (later).
- A Month layout inside Library (possible phase 6).

## 7. Decisions the owner must make (recommended default in bold)

1. **D1, what "Approve" means.** **Approve = "this is good". If the post has a planned date and the account can post, it is scheduled for that date. Otherwise it waits as "Approved", where the card offers Schedule, Post now and Download.** The alternative is to keep Approve as "post now", which is what it does today and is not reversible.
2. **D2, where Calendar lives.** **Inside Plan, as a tab.** The alternative is to keep it as its own menu entry.
3. **D3, should videos also need approval?** **Yes for finished videos that are not yet posted (Hero, studio, reels). No for photoshoot photos**, which are ingredients you use in Create.
4. **D4, sidebar sub-items.** **Show the open category's tabs as sub-items in the sidebar.** The alternative is tabs on the page only.
5. **D5, menu names.** **Home, Plan, Create, Library, Inbox, Insights, Setup.** The alternatives keep "Dashboard" and "Create content". Brand memory becomes "What Nebulaa learned" under Insights.
6. **D6, permanent delete.** **Not offered. Archive only; archived items stay restorable.** The alternative adds "Delete for good" with a confirmation.
7. **D7, the top-bar Search button, which does nothing today.** **Remove it now.** The alternative is to wire it to Library search.
8. **D8, posting videos without the Publish add-on**, which currently slips through on the Hero and reel routes. **Gate it like posts. Accounts that used it in the last 30 days get a note.** The alternative leaves it open as a goodwill exception.
