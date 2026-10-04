# Voice pass 1 report

Counts of changed strings per file (full before/after table: docs/superpowers/specs/assets/nebulaa-voice-pass-1.md): Layout 22, GravityHome 13, GravityCreate 55, GravityApprove 26, GravityInsights 12, IdeaInbox 29, UploadAndSchedule 19, AIMemory 6, HeroVideo 10, ConnectSocials 47, Settings 27, BrandAssets 27 (293 entries). components/gravity/index.tsx, CalendarHome and GravityCalendar were already plain and are unchanged.

## Decisions
- Create-flow action verbs moved from "Draft/Build" to "Create" (Create campaign, Create carousel, Create post, Creating...) so they match the nav name "Create content".
- Rhetorical-question headings became statements ("Describe your campaign", "Upload your own photo or video", "Connect your social accounts").
- "Creative Director" (internal agent name) removed from customer text; replaced by "Nebulaa". Vendor name "Ayrshare" removed from a customer message.
- "Regenerating costs credits" changed to "Quarks" (one term per concept).
- Insights hero: "Keep the cadence Nebulaa set for you" became "Keep publishing on the schedule Nebulaa set for you"; the 7-day comparison label now says "previous 7 days", which is what the code computes.
- BrandAssets "fallback mode" notice reworded to say general defaults are used until brand assets or past posts exist.
- Settings tab "Business Profile" is a state value compared in code; only its displayed label changed (mapped at render).

## Left alone on purpose
- Create TONES list ("Warm, unhurried", "Playful, kinetic", ...) is sent to the backend as a value; not changed.
- Field labels in Settings/BrandAssets are Title Case in source but rendered uppercase by CSS; left as is.
- Backend-streamed progress messages (data.message) and backend prompts: out of scope.
- "Bengaluru" hard-coded in the Home eyebrow, and the hard-coded "+12%" / "+3%" deltas on Insights stat cards, are not voice issues but look like invented facts; flagging for the owner, not changed.
- constants/quarks.ts ACTION_LABELS carries emoji icons that render in Settings > Billing; out of scope file, flagged.
- Scanner limit: a phrase split across JSX nodes (the old "ready for <em>your eye</em>") is not caught; per-line scanning only.

## Layout risks to check by eye
- Home setup banner: removed `truncate` (now wraps) because the new sentence is longer.
- Nav label "Review and approve" (240px sidebar), top bar titles, Settings tab pills, ConnectSocials tab "Automatic replies", Create "Save as draft" button on result cards (flex-wrap), Home hero headline ("No posts / are waiting for your review.").
