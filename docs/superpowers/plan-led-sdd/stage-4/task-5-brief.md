### Task 5: The card on My plan and Competitors

**Files:** Create `frontend/utils/competitorInsights.ts`, `frontend/components/CompetitorInsights.tsx`, `frontend/tests/competitorInsights.test.mjs`; Modify `frontend/services/api.ts` (`getCompetitorInsights`), `frontend/types.ts`, `frontend/pages/MyPlan.tsx` (below the 90 days), `frontend/pages/Competitors.tsx` (top), `frontend/tests/voice-scope.json`.

**Interfaces (pure, tested):** `cardState(res): 'locked'|'none'|'started'|'ready'|'error'` (`locked` when 403 or no entitlement, `none` no competitors, `started` competitors exist but no highlights yet, `ready` highlights exist, `error` request failed); `statusText(competitor): string` ('Tracking since Monday 12 October' / 'Add their Instagram handle to track them' / 'We could not read this account. Check the handle.' / 'Paused after repeated problems. Update the handle to resume.' / 'First results next week'); `trendLabel(trend): string` (e.g. 'Posts a week: 2, 5, 3, 4'); `highlightsFor(res): string[]`.
Behaviour: card titled 'What your competitors did', up to three highlight sentences, a compact list of competitors with status and trend, a link to the Competitors page to fix handles; `locked` state shows nothing on My plan and the existing add-on prompt on the Competitors page (do not duplicate it); posts wording only, no vendor names; mobile first, no sideways scroll at 375 px; follows the card style of `components/ThisWeekCard.tsx`.

- [ ] Steps: write the helper tests first (cardState for each response shape, statusText for each competitor state, trendLabel with 0/1/4 weeks, highlightsFor limit 3); implement helpers, component, api method, placements; run `cd frontend && node --test tests/*.test.mjs`, `npx tsc --noEmit` (only the old Influencers.tsx error), `node scripts/visual-audit/gen-layer-lists.mjs` then the tests again, `node scripts/brand-audit.mjs`, `node scripts/voice-audit.mjs`; do NOT use the browser (the controller checks); commit `git commit -m "Competitors: What your competitors did card on My plan and the Competitors page"`.

---

