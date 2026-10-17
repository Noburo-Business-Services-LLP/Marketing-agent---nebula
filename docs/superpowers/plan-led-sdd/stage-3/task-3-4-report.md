# Tasks 3 and 4 report

Commit A 48fc448 (GuidedTour, saveTour, User.tour type). Commit B (see git log: "Tour: targets on the real interface...").
Tests: 347 pass, tsc only the old Influencers error, brand and voice audits 0, layer lists regenerated.

Design notes
- Tour is mounted in Layout (it owns the mobile menu state); App passes onTourSaved to update user.tour locally. A useRef flag stops reopening in a session.
- Phone: nav steps call onNeedsMenu(true) (Layout opens the drawer, waits for it to slide in), non-nav steps call onNeedsMenu(false). Steps are not skipped on phones.
- Two help buttons exist (phone and computer header); the tour picks the one with a size on screen.
- Browser back/leaving the home route closes the tour ('closed': nothing saved, not reopened this session). Replay: no save of completion/skip; from another page it navigates to /dashboard and opens after 800 ms. Replay item hidden for staff, CSM pass, agency client.
- Auto start waits for the Terms prompt to be answered. No edits to TOUR_STEPS.

## Fix: card always fits
Bottom sheet anchored by CSS (left/right 8px, bottom 8px + safe area), max-height 100dvh-16px with scroll on both layouts; card size re-measured with ResizeObserver and on resize; placeCard test for taller measured cards.

## Fix: wait for the page
waitForTargets in utils/tour.ts polls every 100 ms up to 2.5 s; GuidedTour picks the step list after it. 4 new tests.

## Final review fixes
I-1 pending-replay state consumed on /dashboard; I-2 keyAction() ignores all keys with no step shown; M-1 help button focused before replay; M-2 saveTour(step) once per step; M-5 setup item only while the Setup card shows (getSetup + cardModel); step 1 wording now says Approve it.
