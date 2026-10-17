# Task 5 report
Status: done. Added backend/routes/week.js (createWeekRouter, createSetupRouter, setupRouter), mounted /api/week and /api/setup, plan opening stamp in routes/plan.js (conditional update, skipped for CSM/agency/staff), `setup` in toPublicJSON, tests/weekRoutes.test.js (13 tests).
Tests: weekRoutes 13/13; creditAccessGuard+dataRegistry 9/9; full backend suite 1403 pass, 0 fail.
Notes: connectedCount reuses staff/clientStatus connectedCount (larger of connectedSocials and ayrshare.activeSocialAccounts). firstWeekApprovedAt is stamped by the service's approve (markFirstApproval), not the route. Gate uses blockedAccountIds (not the fail-open Safe variant): a read failure is a generic 500 on approve, and skips the background run on GET.
