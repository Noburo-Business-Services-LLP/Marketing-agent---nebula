# Task 3 report: tracker and scheduler

Status: done. Files: backend/services/competitors/tracker.js, backend/tests/competitorTracker.test.js, backend/models/Competitor.js (tracking.lastHandle), backend/server-main.js (start beside the plan scheduler).
Tests: 15 tracker tests (a)-(j) plus extras; full backend suite 1468 pass, 0 fail.

Cap design: stop when max(stored readsToday + reads this pass, fresh readsToday) >= READS_PER_DAY_MAX, checked before every read; a row (ok or failed) saved per read; spendGuard.check before, record after; refusal ends the pass; module-level re-entrancy guard.
Behaviour notes:
- A failed week is not retried until next week (so "3 failures" means 3 weeks, as in the spec), plus 12 h cooldown; a changed handle bypasses the week skip.
- `limit` = most accounts read per pass (accounts with nothing due do not count).
- competitor_scrape exists in ACTION_USD but has no provider in spendGuard PROVIDER_OF, so check() always passes and record() is a no-op: the daily AI spend ceiling and provider switches do not apply to scraper reads. Only our own caps do.
- Failure text stored is generic ("Could not read this profile" / "This account is private"), no vendor error.
- Cached scraper reads count as reads (conservative).

## Fix: scraper reads count toward the daily ceiling and have an off switch
- spendGuard: PROVIDER_OF.competitor_scrape = 'apify_scrape', LABELS.apify_scrape = 'Competitor checks' (so PROVIDERS, the staff switch card, AI_KILLED and record() all cover it).
- apiCosts: new PROVIDER_RATES.apify_profile_read = 0.0023; ACTION_USD.competitor_scrape now uses it (was the Serper rate 0.001, too low). Quark price stays 0.
- StaffAiSpend.tsx: description line for apify_scrape (list is label-driven from the API, only the WHAT text map needed an entry).
- Tests: spendGuard.test.js updated (providerOf) and a new test (switch, AI_KILLED, daily total, staff status). Backend 1469 pass; frontend 355 pass; brand-audit and voice-audit 0 violations.

## Fix: a failed save is logged and not retried until the next cooldown
- trackOne logs `[competitors] could not save a check:` with the message only; the failure still counts toward the pause rule and tracking state is still saved.
- isDue now also honours `tracking.lastCheckedAt`: skip within COOLDOWN_HOURS, and skip while it falls in the current week (failed save or failed read retries next week). A changed handle clears lastCheckedAt (and failures/pause) so it reads again; `runTrackerOnce({ force: true })` bypasses the due check (caps still apply).
- Test (k): a save that always throws gives one read across four passes, logs, reads again next week and on a new handle. Backend 1487 pass, 0 fail.
