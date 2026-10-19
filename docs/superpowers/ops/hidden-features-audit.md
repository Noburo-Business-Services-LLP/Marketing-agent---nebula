# Hidden features audit (2026-10-19)

Owner rule: whatever is not in the product (discarded, hidden, kept aside) must not be shown on the working product. Routes stay for old bookmarks; only customer-facing links and banners go. Guard: `frontend/tests/noLegacyLinks.test.mjs`.

| Path | Text | Decision | Reason |
|---|---|---|---|
| `pages/CreateVideo.tsx` | "Looking for the old step-by-step maker? Open it here" (link to `/reels/studio`) | Removed | Old maker is not in the menu; users do not know it. Route kept. |
| `pages/ReelGenerator.tsx` (route `/reels/studio`) | "Create a Hero video" banner, "step-by-step" wording | Keep (flag) | Page is reachable only by old bookmarks or a resumed job (`App.tsx` VideosEntry); no menu link points to it. |
| `pages/HeroVideo.tsx` | Eyebrow "Hero Studio"; "use the step-by-step video in Videos" | Keep, FLAG | Hero is not a menu entry (menu has Videos only). It is reached from Library "Hero videos" for existing clips. The sentence points to a "step-by-step video in Videos" that Videos no longer offers by that name. Owner to decide: hide Hero or give it a menu entry. |
| `pages/Library.tsx` | Filter "Step-by-step videos", source chip "Step-by-step video", Hero videos | Keep, FLAG | Describes existing saved items, not a link. Owner may want these renamed to "Videos". |
| `components/AppSwitcher.tsx` | "Coming soon" pill on an unavailable area (Lead generation) | Keep, FLAG | Planned Outreach/Leads toggle; a placeholder leading nowhere. Owner to confirm whether to hide until built. |
| `components/DraftPreviewModal.tsx`, `pages/UploadAndSchedule.tsx`, `utils/platforms.ts` | "Coming soon" on a platform not yet selectable | Keep, FLAG | Disabled platform with tooltip; owner to decide whether to hide unselectable platforms. |
| `App.tsx` | `/dashboard-classic`, `/content-calendar-classic`, `/campaigns-classic`, `/analytics-classic` | Keep route | Nothing in `pages/` or `components/` links to them (checked by the guard test). |
| `pages/PromptStudio` label "Carousels (legacy copy)" (`components/PromptStudio.tsx`) | "legacy copy" | Keep, FLAG | Likely staff/internal prompt tool; confirm it is not customer-facing. |
| `pages/staff/*` | "older step-by-step video maker" | Keep | Staff-only screen, not customer-facing. |
| Code comments mentioning legacy/classic | n/a | Keep | Not visible to users. |
