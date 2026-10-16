# Task 1 report: Agency plan config and entitlements
Status: DONE. Commit 8577221 (amended once to include the test edits).

Changed: apiCosts.js (PLANS.agency, AGENCY export), plans.js (PLAN_PRESENTATION.agency), entitlements.js (TIERS, addonsOf), billingPlans.js (canBuyAddon guard, planCatalogue.agency, AGENCY import), new tests/agencyConfig.test.js. All verbatim from the brief.

Commands: new test failed first (0 pass / 4 fail), then 4/4 pass. Full suite: 1013 pass, 0 fail.

Existing tests edited (enumerated plan ids/tiers exactly): billing.test.js (catalogue and GET /plans ids now include 'agency', one test title), plansConfig.test.js (TIERS list includes 'agency').

Concerns: none. Note: agency is now in PLAN_IDS, so any code iterating plans (e.g. Razorpay plan creation) expects env var RAZORPAY_PLAN_ID_AGENCY.

## Fix round 1
- models/Blueprint.js: tierAtStart enum now uses TIERS from config/entitlements (no other model enumerates tiers; other 'professional' hits are tone defaults).
- billingPlans.canBuyAddon: one `tier` variable.
- Added test: Blueprint validateSync accepts tierAtStart 'agency' (agencyConfig.test.js).
- Ran agencyConfig+billing+plansConfig, then full suite `node --test tests/*.test.js`: see handback (all pass).
