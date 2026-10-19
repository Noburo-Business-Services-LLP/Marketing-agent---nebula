# Hidden features audit (2026-10-19)

Owner rule: whatever is not in the product (discarded, hidden, kept aside) must not be shown on the working product. Routes stay for old bookmarks; only customer-facing links and banners go. Guard: `frontend/tests/noLegacyLinks.test.mjs`.

| Path | Text | Decision (owner, 2026-10-19) | Reason |
|---|---|---|---|
| `pages/CreateVideo.tsx` | "Looking for the old step-by-step maker? Open it here" | Removed | Route `/reels/studio` kept for bookmarks. |
| `pages/ReelGenerator.tsx` | "Create a Hero video" banner | Removed | Hero stays hidden; no customer link to `/reels/hero`. |
| `pages/HeroVideo.tsx` | "use the step-by-step video in Videos" sentence | Removed (sentence). Page and route kept | Hero stays hidden; page reachable only by old bookmarks. |
| `pages/Library.tsx` | "Hero videos" filter, "Step-by-step videos" filter | Hero filter removed; "Step-by-step videos" renamed "Videos" | Existing saved Hero clips still appear as normal "Video" items and open in the Library panel (download, edit finish, share) without linking to the Hero page; "Make a new version from the prompt" link removed. |
| Left menu (`components/Layout.tsx`) | "Videos" | Renamed "Create video" | "Create content" kept: it also covers carousels, campaigns and LinkedIn posts, so "Create image post" would be too narrow. |
| `components/AppSwitcher.tsx` | "Coming soon" pill on Lead generation (and Outreach) | Entries hidden; switcher hidden while only Content exists | Led nowhere. Data in `utils/appSwitcher.ts` untouched. |
| `utils/platforms.ts`, `DraftPreviewModal.tsx`, `UploadAndSchedule.tsx` | "Coming soon" platforms | Left out of every picker (`choicesFor`) | Data model untouched; no platform is flagged today. |
| `components/PromptStudio.tsx` | "Carousels (legacy copy)", "Hero videos (prompt and style rules)" | Renamed "Carousels (captions)"; Hero group no longer listed | Customer-visible on Create. |
| `App.tsx` | `/dashboard-classic`, `/content-calendar-classic`, `/campaigns-classic`, `/analytics-classic`, `/reels/hero`, `/reels/studio` | Keep routes | Nothing in `pages/` or `components/` links to them (guard test). |
| `pages/staff/*` | "older step-by-step video maker" | Keep | Staff-only. |
| Code comments mentioning legacy/classic | n/a | Keep | Not visible. |

Open: the video platform picker in `ReelGenerator.tsx` still shows "(soon)" beside Google Business (it cannot take video; not a coming-soon platform in the data).
