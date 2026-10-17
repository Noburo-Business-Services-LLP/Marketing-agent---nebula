# Stage 3 (guided tour): final review

Reviewer: final single review, read-only. Commits 954cb91..ee535d3 on `nebulaa-redesign`.
Unit tests run: `frontend node --test tests/tour*.test.mjs` 16/16 pass; `backend node --test tests/tourRoutes.test.js` 8/8 pass.

## Verdict

Ship after fixing two Important defects. Both are small fixes. The backend is sound: the once-only stamps are atomic, staff, CSM and agency passes get 403, unknown step ids are refused, the endpoint is rate limited, and the public JSON only gains `completedAt` and `skippedAt`. The gating rules (staff, CSM pass, agency client, onboarding, Terms prompt, home route) are correct. Logging out and logging in as someone else is safe. The two Important defects are both in the frontend: "Replay the tour" does nothing from any page except the home screen, and the tour's keyboard handler is active, with nothing on screen, while the tour waits for targets.

No Critical findings.

## Important

### I-1. "Replay the tour" from any page other than /dashboard never opens the tour
`frontend/components/Layout.tsx:101-112` (confidence: high)

The `onReplay` handler calls `navigate('/dashboard')` and then sets `replayTimer.current = setTimeout(() => setTourOpen(true), 800)`. The effect lists `location.pathname` (and `navigate`) as dependencies. So the navigation re-renders Layout, the effect re-runs, and its cleanup (`if (replayTimer.current) clearTimeout(replayTimer.current)`) cancels the pending timer before it fires. The user ends up on the home screen with no tour. `HelpMenu.replay()` has already sent `saveTour('replay')`, so the replay counter also goes up for a replay that never happened.

Scenario: on /campaigns or /plan, open "?" and choose "Replay the tour". You land on the dashboard and nothing happens. The controller's browser check most likely started the replay from /dashboard, where the handler opens the tour straight away and the bug does not show.

Fix: move the replay timer into its own ref-only cleanup that runs on unmount only (or keep `replayTimer` out of this effect's cleanup). Simpler: set a `pendingReplay` ref and open the tour from an effect when `location.pathname === '/dashboard' && pendingReplay.current`.

### I-2. The keyboard handler is active while nothing is on screen, so a stray ArrowRight or Escape silently completes or skips the tour, and Tab is blocked
`frontend/components/GuidedTour.tsx:200-220`, with the hidden window coming from `:93-99` and `:222` (confidence: high)

`TourRun` mounts and adds its document keydown handler (capture phase) at once. Rendering returns `null` until `chosen` is set (up to 2.5 s through `waitForTargets`) and also until each step's target is found (up to 1.5 s per step; about 300 ms while the phone menu slides in). During that time:
- **ArrowRight** calls `goNext()`. With `count === 0`, `i + 1 >= count` is true, so it calls `finish('finished')`. Layout then saves `complete` and stamps `completedAt` locally. The customer has seen nothing, and the tour is gone for good.
- **Escape** calls `finish('skipped')` and saves `skippedAt`. It also calls `stopPropagation()` in the capture phase, so the Escape the person meant for something else on the home screen (a dropdown or a dialog) never reaches it.
- **Tab** reaches `if (!card) { e.preventDefault(); return; }`, so keyboard users cannot move focus at all during the wait.

The full 2.5 s wait happens whenever a target is missing. That is the case for every account whose This week card is not shown (`ThisWeekCard` returns `null` for `not_eligible` / `no_plan`, for example a new account whose plan is not ready yet, or a free-tier account). So the window is not rare: it runs 0.8 s after landing on the home screen, exactly when someone may be using the keyboard.

Fix: return early from `onKey` while `!step || !target`, or attach the handler only once a target is shown. At the least, ignore Escape and arrows and let Tab through until the card exists.

## Minor

M-1. **Focus does not return to the Help button after a replay.** `GuidedTour.tsx:105-111` with `HelpMenu.tsx:47-51`. `opener` is read from `document.activeElement` when `TourRun` mounts. On a replay, the menu item that had focus has just been removed (`setOpen(false)`), so `opener` is `<body>` and focus goes back to the body on close. The plan asks for focus to return to where it was. Fix: pass a return-focus element (the help button) in the replay event, or focus `[data-tour="help"]` visible match on close of a replay.

M-2. **Progress per step is never saved.** The spec says "its progress and completion are saved". The backend accepts `action: 'step'` (`backend/routes/tour.js:33,41`), but nothing in the frontend calls `saveTour('step', id)`. Either call it on step change (best effort) or drop the action. Low impact.

M-3. **The spotlight is shown on a phone.** The spec says "a bottom card without spotlight on a phone". The implementation uses the bottom sheet and also the dimmed spotlight (`GuidedTour.tsx:241-245`). This is arguably better (the controller checked it at 375 px), but it is a deviation from the spec. Confirm with the owner or note it in the spec.

M-4. **The Welcome step is often dropped for new accounts.** `ThisWeekCard.tsx:125-126` returns `null` until the week is loaded, and for `not_eligible`. A new customer whose plan has not been generated yet (`no_plan`), or a free-tier account, never has `[data-tour="this-week"]`. Their tour starts at "Make something yourself, 1 of 5", so the most important step is lost. This follows the "missing target is skipped" rule, but consider letting the Welcome step fall back to a different target (for example the page heading or SetupCard) so first-time customers still get the orientation.

M-5. **"Your setup steps" does nothing where SetupCard is hidden.** `HelpMenu.tsx:52-63`. SetupCard is not rendered for staff accounts, a CSM pass or an agency client workspace (`GravityHome.tsx:200-201`), yet the menu item is always offered. It navigates to the dashboard and then stops looking after 1.5 s without saying anything. Hide the item where `showSetup` would be false (the same rule as `tourEligible` without the tour field, plus the staff check).

M-6. **Deploy order.** If the new frontend goes live before the backend, `/auth/me` has no `tour` field and `PUT /api/tour` returns 404 (silent). The tour would then start on every page load (once per session, because of `tourDone`) until the backend ships. Deploy the backend first.

M-7. **The sync test reads across packages.** `backend/tests/tourRoutes.test.js:52-58` reads `../../frontend/utils/tour.ts`. If backend tests ever run in a backend-only checkout or container, this test fails with ENOENT. The regex part fails loudly (not silently) if the format changes, which is the safe direction. It also hard-codes the list a second time, which is fine. Acceptable as is; just be aware of it in CI.

M-8. **A route change that makes the tour close with reason 'closed' saves nothing (by design).** If Layout ever remounts in the same session, the tour can start again. Today Layout only remounts on logout/login and on the deletion-pending branch, so this does not happen in practice. Noted only.

## Checked and found sound

- **Gating** (`utils/tour.ts:47-53`, `Layout.tsx:92-99`): staff (`staffRole` / `isCsm`), CSM or agency pass (`csmReturnToken`, which is also set when an agency owner enters a client, `api.ts:1532`), `actingAgency` (merged in by `getCurrentUser` → `mergeActing`), `onboardingCompleted`, home route only (Layout is never mounted on landing, auth, onboarding or /trial-expired: `App.tsx:215-283`), and the Terms prompt (`needsTermsPrompt` re-checked when `user.consent` changes). The replay item is hidden for the same ineligible users (`canReplay={tourEligible}`).
- **Stale or replaced user**: every server user payload goes through `toPublicJSON`, which now carries `tour`. `onTourSaved` stamps it locally, and the `tourDone` ref stops a later `setUser` (Settings, Terms accept) from restarting the tour in the same session, even if the save failed.
- **Logout, then a different login**: Layout is under `user ? … : <Navigate>` (`App.tsx:281`), so logout unmounts it (and GuidedTour, removing every listener, the click blocker and the menu state). The next login mounts a fresh Layout with `tourDone = false`. Logout clears the `csm*` keys (`api.ts:25`, `:609`). Nothing leaks between accounts, and the second user is not denied their tour.
- **Cleanup**: every listener (keydown, resize, orientationchange, capture-phase scroll, ResizeObserver, rAF, timers) is removed on unmount. The tour adds no scroll lock (the `overflow: hidden` on html/body belongs to Layout and is restored when Layout unmounts). `handleTourClose` and the unmount cleanup both close the phone menu. Browser back or a link closes the tour through the pathname effect (`:144-151`).
- **Two `data-tour="help"` buttons**: the one in the hidden header is `display: none` (`md:hidden` / `hidden md:flex`), so `sized()` filters it out and `findTarget` reliably picks the visible one. The nav targets exist once (in the shared `aside`), and the phone case waits for the drawer to slide in (`r.left >= -1`). `this-week` and `setup` each exist once.
- **Placement and robustness**: the card is clamped inside the viewport with an 8 px margin. Its measured height follows `maxHeight: calc(100dvh - 16px)` and `overflowY: auto`, so Skip can always be reached even in an 800x400 window. Resize, rotation and scroll keep the spotlight in place (rAF-throttled). Missing targets are passed over in the direction of travel. The click blocker covers the page, but the card (with Skip) always sits above it, and the mouse wheel is forwarded to `<main>`. Nobody can get stuck. On touch, the page behind cannot be scrolled while the tour is open, which is acceptable because every target is scrolled into view.
- **Accessibility**: the card has `role="dialog"`, `aria-modal`, `aria-labelledby` and `aria-describedby`. The heading gets focus at each step, Tab wraps inside the card, arrows move between steps (not while typing), and `aria-live` announces the step count. Reduced motion turns off the transitions and makes scrolling instant. Text contrast on `#fffdf8`: `#1d1a14` is about 16:1, `#3d3829` about 11:1, `#5b5547` about 7:1, all passing AA. HelpMenu handles Escape (focus goes back to the button), outside mousedown, Tab, arrows, Home and End.
- **Backend** (`routes/tour.js`): runs behind `protect` and is rate limited per user (60 per 15 min). Staff, `req.actingCsm` and `req.actingAgency` get 403. Unknown actions and unknown step ids get 400. `complete` and `skip` are conditional `updateOne` calls filtered on `$exists: false`, so they are atomic and once-only (the schema has no defaults, so `$exists` behaves as expected). The response and `toPublicJSON` expose only `completedAt` and `skippedAt` (`step` and `replays` stay on the server). Errors return a generic 500.
- **Wording**: none of the six steps uses Quark, credit, trial, "7 days", agent or vendor words. They are plain and friendly. One small optional change: step 1 says "Say yes" while the button on the card reads "Approve" (`ThisWeekCard.tsx:211`). "Approve them and the posts are made for you" would match the button.
