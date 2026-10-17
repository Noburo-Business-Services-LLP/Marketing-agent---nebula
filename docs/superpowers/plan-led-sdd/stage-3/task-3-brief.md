### Task 3: The tour component

**Files:**
- Create: `frontend/components/GuidedTour.tsx`
- Modify: `frontend/services/api.ts` (`saveTour(action, step?)` best effort, returns void, swallows errors), `frontend/types.ts` (`tour?: { completedAt?: string; skippedAt?: string } | null` on `User`)

**Interfaces:**
- `<GuidedTour open onClose(reason: 'finished'|'skipped'|'closed') steps />` — uses `visibleSteps` with `document.querySelector`, `placeCard`, `spotlightRect`. Behaviour: renders a full-screen backdrop with a cut-out around the target (CSS box-shadow technique, no canvas), the card with title, body, step counter ("2 of 6"), Back, Next (Done on the last), Skip tour; scrolls the target into view (`scrollIntoView({ block: 'center' })`, instant when `prefers-reduced-motion`); recomputes on `resize`, `scroll` and when the route changes; if a step's `route` differs from the current route it navigates there first (HashRouter: `window.location.hash`), waits for the target up to 1.5 s, then skips the step if still missing; focus moves to the card heading on each step, Tab is trapped inside the card, Escape skips, ArrowRight/ArrowLeft move, focus returns to the previously focused element on close; body scroll is not locked (the page stays scrollable), the backdrop does not trap pointer events outside the card except to prevent accidental clicks on the highlighted control (clicks on the backdrop do nothing); `role="dialog"`, `aria-modal="true"`, `aria-labelledby` the heading; no animation when reduced motion is requested.
- All cleanup (listeners, overlay) runs on unmount so a route change, logout or back button leaves a clean page.

- [ ] **Step 1: Write the failing test.** The component itself has no node-runnable test; the logic lives in Task 1. Add `frontend/tests/tourWording.test.mjs` that imports `TOUR_STEPS` and asserts every `target` string matches the `data-tour` names the sources use: read `components/Layout.tsx`, `components/ThisWeekCard.tsx`, `components/SetupCard.tsx` as text (`fs.readFileSync`) and assert each `data-tour="<name>"` from the steps appears in some source file (this fails until Task 4 adds them, which is the guard that a renamed element cannot silently break the tour). Mark the test as expected to fail only until Task 4 by writing it now and running it after Task 4 (state this in the commit message).
- [ ] **Step 2–3: Implement** the component (follow existing dialog patterns: `AgencyDialog.tsx` for focus handling; use the app's `--gv-*` tokens; card background solid cream like `TermsPrompt.tsx` (`#fffdf8`) so it is readable over any page, including the dark plans page).
- [ ] **Step 4:** `cd frontend && npx tsc --noEmit` (only the old Influencers error) and `node --test tests/*.test.mjs` (the wording test may still fail until Task 4: leave it for Task 4).
- [ ] **Step 5: Commit** — `git add frontend && git commit -m "Tour: the guided tour component with spotlight, focus handling and phone layout"`

---

