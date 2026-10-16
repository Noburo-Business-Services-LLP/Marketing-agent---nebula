# Task 2 fix report
- isAgency now false for a workspace (ownerId set), so clientLimitOf(workspace) = 0. Real agency owners unchanged.
- extraSlots: only finite positive numbers count, floored; negative, NaN, +/-Infinity, strings, null, objects -> 0. Max 25 kept.
- Tests: 4 new (boundaries, invalid slots, workspace-as-owner, no mutation). RED seen (2 failing), then GREEN: agencyRules 9/9, full suite 1023/1023.
- Plan consumers: createWorkspace (isAgency/clientLimitOf on owner) and routes use the owner, so no conflict; Task 8 stepsFor `isAgency(user)` now correctly skips the clients step for a workspace being purged. No plan change needed.
- walletBalance: brief is silent on an agency without an active plan; left unchanged. Task 5 (resolvePayer) should cover it.
