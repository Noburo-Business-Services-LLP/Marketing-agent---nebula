# Landing page rework (public page at `/`)

## Second rework (2026-10-20): proof first, Higgsfield and Pollo grammar in the brand palette
Impact map with every section, its copy and its visual: `docs/superpowers/impact-maps/landing.md`.

### Files
- `frontend/pages/LandingPage.tsx`: composes the sections, reads the plans, sets the page title and description while shown.
- `frontend/components/landing/`: `LandingNav` (sticky glass bar, phone menu sheet), `LandingHero` and `PhoneMock` (CSS phone with a Review and approve screen drawn from tile art, marked Example), `ExamplesSection` (eight showcase posts, each marked Example), `MakeSection` (six app cover tiles with the `create-*` photo slots), `ApprovalAndSteps` (gold "How approval works" band, seven steps plus a start card), `AudienceAndBlueprint` (four Built for cards, the free Blueprint), `PlansAndFaq` (three plan cards, eight questions), `ClosingAndFooter` (closing band, footer with `LegalLinks` and the giant gold wordmark), `LandingBits` (section heading, gold button, in-page links), `landing.css` (all styles, scoped under `.nb-land`).
- `frontend/constants/landingCopy.ts`: every customer-facing word, in page order (the website copy comes from here).
- `frontend/utils/landingPlans.ts`: plan figures from `GET /api/payment/plans`, a snapshot shown until it answers (checked against `backend/config/apiCosts.js` and `backend/config/plans.js` by the tests), "Best value" from the lowest price per Quark.

### Honesty rules built in
- Inbox: only "drafted for you to approve"; never "automatic". Three entries, each marked `// CONFIRM AFTER INBOX TEST` in the copy file; `INBOX_LINES_VISIBLE = false` hides all of them (the approval point, step 6 and the FAQ sentence); the step grid closes its rows either way.
- Photoshoot tile says "Coming soon" (the studio is off until the owner's real proof).
- Languages: English and Tamil (alone or mixed), matching what is offered today.
- No testimonials, logos, ratings, results or "most popular"; the only number claim is the owner-confirmed "2,000+ MSMEs" line.
- Removed: "ready in minutes", "Set up in 3 minutes", "3 minutes away" (not measured).

### Results
- `node --test tests/*.test.mjs`: 887 passed, 0 failed (landing test rewritten: 14 checks).
- `npx tsc --noEmit` 0 errors; `npm run lint` 0 errors; brand and voice audits 0; art budget OK (no new art files).
- Contrast audit (repo runner) on the landing: 173 texts at 1280, 166 at 375, 0 failures, 0 unknown.
- Looked at 1280, 800 and 375: no sideways scroll; every tile row full and of equal height (measured).
- `vite build`: landing chunk 28.7 KB (9.0 KB gzip) JS plus 23.8 KB (5.7 KB gzip) CSS; before: 28.1 KB (8.2 KB gzip) JS. No raster above the fold (the old hero loaded three 120 to 200 KB posts).

### Open
- Open Graph tags need `frontend/index.html` (link previews do not run scripts): ready-to-paste tags in the impact map.
- The eight showcase posts are about 120 KB each (lazy); smaller copies would make the page lighter.
- Confirm the showcase posts were made with Nebulaa (the page calls them examples in Nebulaa's styles).

## First rework (2026-10-18, handover 13)
Seven-step workflow, drafted-for-approval Inbox wording, Who it is for, For agencies, three plan cards, add-on line, Quarks and credits wording removed. Superseded by the second rework above.
