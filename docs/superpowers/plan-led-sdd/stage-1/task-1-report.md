# Task 1 report
Status: DONE. Commit: a483aa5
Changes: config/blueprint.js (PLAN_NEBULAA_CAN, PLAN_REFRESH_DAYS; ORGANIC_PAID not added, brief's Produces list does not need it); planner.js (icp + effort in normalisePlan, nebulaaCan in buildPlanVars, ctxOf exported; normalisePlan was already exported); promptRegistry.blueprint.js (rules 9-10, icp/effort in schema, new nebulaaCan variable); tests/planNormalise.test.js (new).
Edited existing test: tests/blueprintPrompt.test.js pins the exact variable list of blueprint.plan; added 'nebulaaCan'. No other wording pins changed.
Test base data adjusted: icp pains in the first test were "Pain 0..6"; the no-digits claim scanner dropped them, so I used word-only pains.
Runs: new test failed first (3 fail), then 3/3 pass; blueprint*.test.js 213 pass 0 fail; full suite 1251 pass 0 fail.
Concerns: none. Prompt example shows organicPct 80 / paidPct 20 as field values only; rule 10 forbids digits in sentences.
