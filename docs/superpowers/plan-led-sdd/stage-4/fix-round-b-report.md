# Stage 4 fix round B (UI and one backend ruling): report

Backend `node --test tests/*.test.js`: 1542 pass, 0 fail. Frontend `node --test tests/*.test.mjs`: 368 pass, 0 fail (was 360). `npx tsc --noEmit`: the 1 old error (`pages/Influencers.tsx`). `brand-audit` 0, `voice-audit` 0, `gen-layer-lists` run. No scraper, AI call or database was used.

## R1 (backend)
`readGuard.allow({ userId, at, source })`: the `ENABLE_COMPETITOR_TRACKER` check applies unless `source === 'customer'`. `guardedRead` (default source `customer`) and `/scrape-by-type` pass it. Customer reads still obey the staff "Competitor checks" switch (spend guard), the daily ceiling and the per-account cap. RED first (3 tests failed), then GREEN. Tracker and staff check are unchanged (they check `guard.enabled()` first). The launch checklist line now says only the weekly tracker needs the switch. Tests changed: `competitorCustomerGuard` (3 new R1 tests, the switch-off tests now use the spend guard), `competitorReadControls` (guardedRead test).

## UI
| Item | What changed |
|---|---|
| R2 / I10 | `Competitors.tsx`: no add-on shows a calm inline note "Tracking competitors is an add-on. See plans to add it." with a "See plans" link to `/trial-expired` (the only plans page in `App.tsx`; the file header says the route name is kept on purpose). No prompt on page load. The existing inline `UpgradePrompt` (not a modal) appears only after Add or Find is refused; `UpgradePrompt` got optional `message` and `actionLabel` props (defaults unchanged for other features) and the page passes `competitorsUpgradeCopy(reason)`, which never says Quarks. The note hides while the prompt is showing. |
| R3 / I9 | New `components/HandleEditor.tsx` (uses new `apiService.setCompetitorHandle`, `PUT /competitors/:id/handle`). `unconfirmed`: "Confirm handle"; `no_handle`, `paused`, `failed`: "Edit handle"; input prefilled, client rule same as the server, errors shown plainly, success note "Saved. We will check @handle in the next weekly check." and the row moves to waiting. Used in the card and in the Competitors page list (list: suggested handle = Confirm, else Edit). `linkLabel` knows `unconfirmed` ("Open Competitors to confirm handles"). |
| R4 / I6 | `lastCheckedLine`, `weekOverWeekOk`, `consecutiveTrend` (pure, tested). A competitor whose newest numbers are not from this week shows "Last checked on 9 September". The trend list only joins weeks that follow each other. `highlightsFor` drops highlights about a not-current competitor and week-over-week sentences when `previousWeekOf` is null (defence in depth; the server already does this). Old responses without the flags keep the old text. |
| R5 | `StaffAiSpend.tsx` card text now says the switch covers all competitor checks. `check_competitors` label added to `ACTION_LABEL` in `StaffClientPage.tsx` ("Checked their competitors now"). |
| R6 | `mock-session.js`: `?compstate=all|locked|empty|error|puterr|put403|put429`, six competitors (one per state), insights, `PUT handle` (updates the in-memory row), add-manual/auto-discover 403 when locked, `/competitors/posts` list with `handleStatus`, a finished `/plan` so My plan shows the card. The request body now reaches mock handlers. `routes.json` note on the `competitors` route. |

M5 ("tracking since" moving from week 5) is also fixed in the card text: four or more weeks reads "Tracked for at least 4 weeks". The 429 message and a partial-run `notice` from `/scrape-by-type` are now shown on the Competitors page.

## Visual check (sample-data server on 3101, started and stopped by me)
Screenshots: `/private/tmp/claude-501/-Users-dineshkannaa-Documents-0-CONTENT-Claude-Agents/09560377-72af-47d7-b772-e6de37dcc6da/scratchpad/stage4-shots-b/` (1280 and 375: entitled card and list with every handle state, confirm form open, locked note, locked after Add, My plan card). Defects found and fixed: the edit field was too narrow beside two buttons at 375 (now full width, buttons below); long competitor names were cut off in the list (now wrap). No horizontal scroll at 375. Error and success paths of the form were exercised at 1280 (invalid handle shows the message, a valid one shows the saved note).

## Not covered
Dark mode, tablet width, the staff screen (no browser run of `StaffAiSpend` or the history label), the `put403` / `put429` / `puterr` / `error` / `empty` states (mocked, not screenshotted).
