# The business-profile questionnaire: how it works, how to add a question

Built 2026-10-20 on branch `nebulaa-redesign` (impact map: `docs/superpowers/impact-maps/questionnaire.md`). Not released.

## One definition, three places

| Piece | File | What it holds |
|---|---|---|
| The definition (values only) | `backend/config/businessQuestions.js` | Who you sell to, industries in seven groups plus Other, reach areas and the old-answer map, age groups, genders and the old-gender map, business-buyer kinds, company sizes, decision-maker roles, sales cycles, voices, goals, the six writer languages, which answer opens which branch, text caps, the question list |
| The frontend mirror plus the words | `frontend/constants/businessQuestions.ts` | The same values (a test fails if any list differs) and every word in English, Tamil and Hindi; small pure rules (branch, old answers, industry Other, language and mix) |
| Saving and reading | `backend/services/businessProfile.js` | `cleanBusinessProfile` (every save), `audienceFacts` (plain clauses for prompts), `reachAreasOf`, `genderOf`, `industryOf`, `listWords` |
| The screens | `frontend/components/questionnaire/Questions.tsx` and `questionnaire.css` | `IndustryQuestion`, `SellsToQuestion`, `ReachQuestion`, `CustomerBranchQuestions`, `GoalsQuestion`, `VoiceQuestion`, `LanguageQuestion`, plus `QuestionBlock` and `ChoiceTiles` |
| Small drawings | `frontend/components/art/questions/` | Area, city, state, India, world; people, business, both (inside the art budget) |

Sign-up (`frontend/pages/Onboarding.tsx`, steps 1 to 3) and Settings > Business profile (`frontend/components/BusinessProfileFields.tsx`) render the SAME components; sign-up passes the chosen page language, Settings passes `lang="en"` and its own field classes (`inputClassName`, `titleClassName`). A test (`frontend/tests/businessProfileForm.test.mjs`) fails if either page stops using them or types its own copy of a list.

## The branch

"Who do you sell to?" stores `businessType`: `B2C` (People), `B2B` (Businesses) or `Both`. People and Both show the optional age groups and "Mostly men, women or families?" (Everyone by default, stored empty). Businesses and Both show which kinds of businesses buy, how big they are, who decides (eight roles or "Someone else" with a text box) and how long a sale takes. Nothing chosen yet shows neither. The prompt readers apply the same rule, so an old gender answer on a B2B account is never sent.

## Saving

Both save routes (`PUT /api/auth/update-profile` from Settings, `PUT /api/auth/complete-onboarding` from sign-up) pass the profile through `cleanBusinessProfile`: unknown choice values are dropped (a save never fails on them), `both_equally` becomes empty, an old reach answer fills `reachAreas` when none is chosen (the old field stays), older industry spellings are mapped, lists are de-duplicated, free text is cut (industry 80, decision maker 120). Only fields that were sent are touched. Old stored values are never rewritten by anything else.

## Reading (prompts)

`audienceFacts(bp)` gives short clauses such as "sells to other businesses", "customers are in the city and the state", "business customers are usually small companies". They reach:
- the Brand memory block for Create, campaigns, carousels, the monthly calendar and background drafts (`services/brandMemory.js describeAudience`, written as sentences);
- What Nebulaa learned (`services/brandMemory/fromCustomers.js`: "Your market" and "Your business customers"; the gender answer is never shown there);
- plan runs and the Blueprint facts (`services/plan/profileInput.js` sends `audience`; `services/blueprint/discovery.js` lists them as "Customers" typed facts);
- competitor discovery (`routes/competitors.js`).
An empty answer writes nothing. "Other" as industry without words counts as not set.

## How to add a question

1. Add the values to `backend/config/businessQuestions.js` (and to `QUESTIONS` with its field, step and branch).
2. Add a schema field in `backend/models/User.js` (`businessProfile`), optional with an empty default; keep every old enum value.
3. Clean it in `cleanBusinessProfile` and, if prompts should read it, add a clause in `audienceFacts`.
4. Copy the same values into `frontend/constants/businessQuestions.ts` and add the words in `en`, `ta` and `hi` (Tamil and Hindi need a native-speaker read).
5. Render it in `Questions.tsx` (use `QuestionBlock` and `ChoiceTiles`, pick a `basis` so rows fill evenly at 480 px and 375 px), then place it in sign-up and in `BusinessProfileFields.tsx`.
6. Run `cd backend && node --test tests/businessQuestions.test.js`, `cd frontend && node --test tests/businessQuestions.test.mjs tests/onboarding-i18n.test.mjs tests/businessProfileForm.test.mjs`, then the real-database check below.

## Checks

- Tests: `backend/tests/businessQuestions.test.js`, `audienceLines.test.js`, `onboardingContract.test.js` (nine required sign-up answers); `frontend/tests/businessQuestions.test.mjs` (mirror equals the backend, words in three languages), `onboarding-i18n.test.mjs`, `businessProfileForm.test.mjs`.
- Real database: `cd backend && node scripts/questionnaire-check.js` (nebulaa_dev only; `zz.qchk-` users created and deleted; the routes' background starters are muted, so no model call). Result 2026-10-20: 7 PASS, nothing left over.
- Screens: sample-data preview, sign-up at `#/__onboarding-preview` (set step and answers in `sessionStorage` key `nebulaa_onboarding_state`) and `#/settings?tab=business`, at 1280 and 375; every tile row measured equal in height and flush with both edges.
