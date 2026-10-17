# Task 4 report: scheduler hook (off by default), staff switch text, no-fallback model pin

Files: `backend/services/listening/scorer.js` (`startListeningScorer`, `noFallback: true` on the scoring call), `backend/services/openAI.js` (`noFallback` option), `backend/server-main.js` (hook in try/catch after the competitor tracker), `frontend/pages/staff/StaffAiSpend.tsx` (switch text), `docs/superpowers/ops/plan-launch-checklist.md` (Comment scoring note, verbatim wording), tests `backend/tests/listeningScheduler.test.js` (9), `backend/tests/textLLMNoFallback.test.js` (3).

- `startListeningScorer({ env, intervalMs = 6 h, firstDelayMs = 25 min, logger, deps, run, timers })`: null and silent unless `ENABLE_LISTENING === 'on'` exactly and `NODE_ENV !== 'test'`. One log line when on. Timers unref'd. A tick never throws (logs only the error name, never the message), and a second tick in the same process while one runs is a no-op; the lease handles other servers. Weekly rhythm comes from the scorer's own 7-day per-account check, the tick is 6-hourly.
- `callTextLLM` gets `noFallback` (default false): on failure it rethrows and never calls Gemini. Tests prove one provider call, no Gemini call, and that without the option the Gemini fallback still happens. The scorer passes `noFallback: true` with `model: LISTENING_MODEL`; a failed batch is one call and one ledger row (test).
- Staff text: plain description of "Comment scoring" in the WHAT map, says it also needs `ENABLE_LISTENING=on` and a `LISTENING_MODEL`. The switch itself already existed from Task 1 (`PROVIDERS`).
- Spend guard tests: switch off and `AI_KILLED=listening_score` both refuse.

Results: backend 1670 pass / 0 fail (all files exit on their own, routeOrder green); frontend 368 pass, voice-audit 0, brand-audit 0 violations (it lists old unrelated "needs a fix" colours as before), layer lists regenerated with no change to tracked files, tsc 1 error (the old one).

Concerns: `callOpenAI` itself still resends once without `reasoning_effort` on a 400 that mentions it (same model, rejected request, not billed). Nothing real was run; the hook, `defaultDeps` and `callTextLLM` are only verified with fakes (Task 8).
