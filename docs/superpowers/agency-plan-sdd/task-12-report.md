# Task 12 report (Steps 1 and 4: wording and launch checklist)

## Changed
- frontend/pages/TermsAndConditions.tsx: new section "21. Agency accounts and client brands" (21.1 to 21.6: client permission, agency responsible, paid from agency plan and shared pool, removal erases at once and cannot be undone, ending the plan pauses all clients and nothing is deleted until removal or account deletion, clients above the limit paused not deleted). Placed before Contact, which became 22. No renumbering of earlier sections, so the in-text references (Section 17, Section 6, the survival list) stay correct. Existing draft banner untouched.
- frontend/pages/PrivacyPolicy.tsx: new 5.6 "Agency Accounts and Client Brands" under Data Sharing; no renumbering, so Section 9, 10, 12 references are unchanged.
- backend/config/legalVersions.js: NOT changed. Both already 2026-10-16 (today); that text has not been released, no test pins a value (consent.test.js reads the constants), so a bump is not needed. Bump to a later date only if the previous 10-16 text was already shown to customers.
- docs/superpowers/ops/agency-launch-checklist.md created. set-secret-value.sh ALLOWED and check-secret-keys.sh OPTIONAL already include RAZORPAY_PLAN_ID_AGENCY and RAZORPAY_PLAN_ID_SLOT: no edit needed.

## Commands
- frontend tests: 296 pass, 0 fail (before and after gen-layer-lists)
- brand-audit: 0 violations; voice-audit: 0 violations; gen-layer-lists ran (its "needs a fix" list is its normal report of existing colours).
- backend tests: 1188 pass, 0 fail.
- No test edits.

## Concerns
- Terms survival clause (17.x list) does not include section 21; lawyer may want it.
- Untracked backend/scripts/_tmp-e2e.js (controller's) was left out of the commit.
