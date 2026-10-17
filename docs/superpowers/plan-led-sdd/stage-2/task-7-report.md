# Task 7 report
Status: done. Added utils/week.ts, utils/setup.ts (TDD, tests week/setup), ThisWeekCard, SetupCard, api methods, types, GravityHome integration (old notice removed). Files added to voice-scope.json.
Tests: 329 pass, tsc clean except Influencers.tsx, brand and voice audits 0.
Notes: expired proposals render nothing; 'no_plan' reason with eligible false maps to no_plan state; carousel/video fallback routes (/campaigns, /reels) are used only if the page was reloaded after approve (prefills are not in GET /api/week). Not visually checked.

## Polish round
Compact one-line rows with small Change/Skip text buttons (44 px tap on phones, wrap under title below 380 px); list collapses to 4 rows with a 'Show all N items' toggle (aria-expanded) above 5 items; 'pool' became 'balance'; prefill rebuilt from the item (buildPrefill, language from businessProfile.contentLanguage else English) when no server prefill; polling is a self-rescheduling timeout cleared on unmount, stops when nothing is approved/making, and survives a failed poll. 332 tests pass, audits 0.

## Final-review fixes
I2: markWeekItemMade api; prefill keeps weekItemId/weekId; GravityCreate reports once on the carousel 'plan' event (draftId), CreateVideo once after create returns the video id (best effort, ids cleared); buildPrefill includes ids (weekId = weekStart date). 'done' state for reason nothing_left. Item error wording/actions (gave_up, no_pool, refund_failed) via itemLine/itemAction. Slow notice after 3 min, polling 15 s afterwards. Focus: after Skip to next row (or status line); Change focuses the input; Escape returns to Change. 336 tests pass, audits 0, tsc clean except Influencers.
