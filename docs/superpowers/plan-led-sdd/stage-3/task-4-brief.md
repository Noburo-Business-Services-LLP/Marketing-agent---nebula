### Task 4: Targets, help button, start rule

**Files:**
- Modify: `frontend/components/Layout.tsx` (add `data-tour="nav-create"`, `nav-review`, `nav-calendar`, `nav-plan`, `help` to the real elements; add the help button with `HelpMenu`), `frontend/components/ThisWeekCard.tsx` (`data-tour="this-week"` on the card root), `frontend/components/SetupCard.tsx` (`data-tour="setup"`), `frontend/App.tsx` (mount `<GuidedTour>` inside the router for the authenticated layout; start with `shouldAutoStart`; Skip/Done call `saveTour`; the replay event opens it without changing saved completion), `frontend/components/HelpMenu.tsx` (create)
- Test: the Task 3 wording test now passes.

**Interfaces:**
- `HelpMenu`: a "?" button (`aria-label="Help"`, `data-tour="help"`) opening a small menu: "Replay the tour" (dispatches `window.dispatchEvent(new CustomEvent('nebulaa-tour-replay'))` and calls `saveTour('replay')`), "Your setup steps" (navigates to the home screen and scrolls to the Setup card), "Contact support" (mailto from `constants/legal.ts` `SUPPORT_EMAIL`). Keyboard operable; closes on Escape and outside click.
- App start rule: when `shouldAutoStart({ user, path, hasCsmPass })` becomes true and the page has finished loading, wait 800 ms (so cards render), open the tour; never reopen after skip/complete in the same session even if the user object is stale (keep a `useRef` flag); on mobile the sidebar is collapsed, so nav targets are missing and those steps are skipped unless the menu is opened: the tour opens the mobile menu for nav steps through a small `onNeedsMenu` callback prop on `GuidedTour` (Layout provides it), or skips them if that is not possible; state which in the report.

- [ ] **Step 1: Run the wording/targets test** — it fails now (targets missing). **Step 2: Implement** the attributes, the help menu and the mount. **Step 3: Run** `cd frontend && node --test tests/*.test.mjs`, `npx tsc --noEmit`, `node scripts/visual-audit/gen-layer-lists.mjs`, tests again, `node scripts/brand-audit.mjs`, `node scripts/voice-audit.mjs` (0). **Step 4: Real check in the browser** with throwaway users (dev servers 3000/5000), desktop and 375 px: a new account sees the tour once after reaching the home screen; Skip, Escape, Back/Next, Done all behave; resizing during the tour keeps the spotlight; the target missing case (collapse the sidebar or a mobile width) skips steps cleanly; a second login does not show it again; the help button replays it; a staff account, a CSM pass and an agency client workspace never see it; logging out mid-tour leaves a clean login page; delete the throwaway users. **Step 5: Commit** — `git add frontend && git commit -m "Tour: targets on the real interface, help button, once-only start and replay"`

---

