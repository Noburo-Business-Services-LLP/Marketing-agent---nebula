# Task 2 review (37e657b..2cbcd31)
Evidence: agencyRules 5/5 pass; full backend suite 1019 pass, 0 fail. Probed clientLimitOf by hand.

## Verdicts
1. SPEC COMPLIANCE: PASS. Code, schema block and test are verbatim from the brief; nothing missing, nothing extra (idOf export is in the brief). The brief lists no atomic client-limit function, so none is expected here.
2. CODE QUALITY: PASS WITH NOTES (0 Critical, 2 Important, 3 Minor). Pure, no input mutation, Mongo only via injected User.

## Important
1. agency.js:12-13,19,26 - a workspace mirrors plan.tier 'agency' (workspacePlanFields), so isAgency(workspace) is true and clientLimitOf(workspace) returns 5 (probed: {plan:{tier:'agency'},agency:{ownerId:'x',extraSlots:5}} -> 10). A client account is not rejected as an owner by these rules. Scenario: Task 3 create-client checks clientLimitOf(req.user) while acting inside a workspace and nests workspaces. Fix: isAgency should also require !isWorkspace (or clientLimitOf return 0 for workspaces); add a test. Brief is verbatim, so this is a brief gap, not an implementer deviation.
2. agency.js:19 - fractional extraSlots is not floored: extraSlots 2.7 -> limit 7.7 (probed). A fractional limit can be compared against integer clientCount and misbehave in the atomic update. Fix: Math.floor(Math.max(0, num(...))).

## Minor
1. agency.js:19 - Infinity/NaN/strings handled safely (-> 5, '3' -> 8); fine, but untested.
2. agency.js:36-38 walletBalance: a workspace's balance is returned even if the agency no longer has an active plan; spec says such a workspace cannot spend. Presumably Task 5 (resolvePayer); confirm it is covered there.
3. Tests do not cover boundaries (clientCount 0/5/6/25/26, negative or non-integer slots, missing agency block, workspace-as-owner), nor input non-mutation. The 5 tests would not fail for issues 1 and 2 above. Existing accounts without an agency block behave as before (isWorkspace false, payer = self; schema defaults only add fields).
