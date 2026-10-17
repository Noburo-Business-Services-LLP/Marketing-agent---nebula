### Task 4: Scheduler hook (off by default) and the staff switch

**Files:** Modify `backend/services/listening/scorer.js` (add `startListeningScorer`), `backend/server-main.js` (start next to `startCompetitorTracker`, near line 848), `backend/services/spendGuard.js` (already has the provider from Task 1; confirm `status()` lists it), `frontend/pages/staff/StaffAiSpend.tsx` (description for provider `listening_score`: "Comment scoring: the weekly reading of customers' own comments and messages for the What people say about you card"); Test `backend/tests/listeningScheduler.test.js`.

**Interfaces:** `startListeningScorer({ env = process.env, intervalMs = 6 * 3600000, firstDelayMs = 25 * 60000, logger = console, deps } = {}): { stop } | null` — returns null (starts nothing, logs nothing) unless `env.ENABLE_LISTENING === 'on'` and `env.NODE_ENV !== 'test'`; one log line when on; a tick runs `runScorerOnce` and catches every error; timers are `unref`ed.

- [ ] **Step 1: Write the failing tests:** returns null when unset, `off`, `ON`, `true`, `1`, and under `NODE_ENV=test` even with `on`; returns a handle with `stop` when `on` (use short fake timers or injected `setTimeout`/`setInterval` seams, and stop it); a tick that throws is logged and does not escape; with the spend guard switch for provider `listening_score` set off (use `createSpendGuard` with fake `Switch`) `check('listening_score')` refuses, and `AI_KILLED=listening_score` refuses.
- [ ] **Step 2–4:** run to fail, implement, full backend suite. Frontend: `cd frontend && node --test tests/*.test.mjs` and `npx tsc --noEmit` (only the old Influencers.tsx error allowed). **Step 5: Commit** — `git add backend/services/listening/scorer.js backend/server-main.js backend/tests/listeningScheduler.test.js frontend/pages/staff/StaffAiSpend.tsx && git commit -m "Listening: scheduler off by default (ENABLE_LISTENING=on) and staff switch text"`.

---

