# Impact map: the business-profile questionnaire (sign-up and Settings)

Written 2026-10-20 on branch `nebulaa-redesign`, BEFORE building. Ledger item covered (BRAND area, owner audit of 2026-10-07, details in `HANDOVER-nebulaa-redesign-4.md` section 5):

- "Redo the business-profile questionnaire: geographic reach only has hyperlocal, local city, regional (add State, All India, International, several allowed); target gender is a poor fit (optional, hidden for B2B); no B2B branch; content-language type out of date; brand voice and goals differ between onboarding and Settings; industry list retail-heavy."

Other BRAND and SIGN-UP items: all DONE except team seats (a DECISION for the owner, not buildable now). The sign-up question "one business or several brands" (`accountKind`) stays exactly as it is; it is listed below because it shares step 1.

## 0. The short version

1. A first half of this was built on 2026-10-08 (`0879012`) for **Settings only**: `reachAreas` (several areas), `b2b` (company size, decision maker, sales cycle), optional gender hidden for B2B, voice and goals as chips, a wider industry list. **Sign-up was never changed**: it still offers four gender tiles (default "Everyone" stored as `both_equally`), stores `geographicReach: 'local_city'` for everyone without asking, defaults "who you sell to" to `Both` without asking, offers 12 languages and 11 mixes, and has its own industry, voice and goal lists. The two forms drifted; the readers also each kept their own copy of the reach words (four copies; `regional` reads "the region" in one and "the state" in another).
2. Now: ONE question definition. Values, options, the branch rule and the old-value maps live in `backend/config/businessQuestions.js`. The frontend mirror `frontend/constants/businessQuestions.ts` holds the same values plus the words in English, Tamil and Hindi; a frontend test loads the backend file and fails if any list differs. Sign-up and Settings render the questions with the SAME components (`frontend/components/questionnaire/`), so they cannot drift.
3. New question "Who do you sell to?" (people, businesses, or both) with three picture tiles. People (or both): optional age groups and an optional "mostly men, women or families" (Everyone by default, stored as empty). Businesses (or both): which kinds of businesses, their size, who decides to buy, how long a sale takes. "Businesses" alone hides age and gender, and the readers ignore an old gender answer.
4. "Where are your customers?" is five picture tiles (My area, My city, My state, All of India, Other countries), several allowed. Old single answers keep reading as the matching area; nothing in the database is rewritten.
5. Industry: 33 kinds of business in seven groups (shops, food and stays, health and beauty, services, business and technology, property and industry, learning and community) plus "Other" with a free-text box. Every value saved before is still in the list (or maps to its new spelling).
6. Post language: the six languages the writers really support (English, Hindi, Tamil, Telugu, Kannada, Malayalam) as tiles, each regional one with a "mix in everyday English words" switch. An account that already uses another language (for example Marathi) keeps it and sees it as a seventh tile.
7. The server cleans every saved profile with one function (`services/businessProfile.js`, `cleanBusinessProfile`): unknown choice values are dropped instead of failing the save, old values are mapped, lists are de-duplicated and capped, free text is trimmed. All prompt readers read the answers through the same module, in plain sentences, and say nothing for an empty answer.

## 1. Every field: what it is, who writes it, who reads it

Stored on `User.businessProfile` (`backend/models/User.js`). No new collection. "New" fields are optional with empty defaults.

| Field | Stored values | Asked in | Read by |
|---|---|---|---|
| `businessType` (Who do you sell to) | `B2C`, `B2B`, `Both`, `''` | Sign-up step 2 (required, one tap), Settings | `brandMemory.describeAudience` (Create, campaigns, carousels, monthly calendar, background drafts through `buildBrandMemoryBlock`), `brandMemory/fromCustomers.js` (What Nebulaa learned + plan runs), `plan/profileInput.js` then `blueprint/discovery.js` (plan and Blueprint facts), `geminiAI.js` (several older prompts, "Business Type: B2C" default), `aiDashboard.js`, `dashboard.js`, website analysis (`routes/brand.js` fills it), competitor discovery (new line) |
| `reachAreas` (Where are your customers, several) | any of `neighbourhood`, `city`, `state`, `india`, `international` | Sign-up step 2 (optional), Settings | the same readers as above via `reachWordsOf()`; competitor discovery (new line); Blueprint input check (`blueprint/input.js REACH_AREAS`) |
| `geographicReach` (old single answer) | `hyperlocal`, `local_city`, `regional`, `state`, `national`, `international`, `''` | no longer asked | read only when `reachAreas` is empty, mapped: hyperlocal to neighbourhood, local_city to city, regional and state to state, national to india, international to international. Never rewritten or cleared. |
| `ageGroups` (NEW, people only) | any of `under_18`, `18_24`, `25_34`, `35_44`, `45_54`, `55_plus` | Sign-up step 2 (optional, people or both), Settings | `describeAudience` ("Customers are mostly aged 25 to 34 and 35 to 44"), `fromCustomers` market line |
| `targetGender` (optional, people only) | `mostly_men`, `mostly_women`, `families`, `''`; the old `both_equally` stays accepted and reads as empty (Everyone) | Sign-up step 2 (optional, default Everyone = empty), Settings; hidden for B2B | `describeAudience` only when the business does not sell to businesses only; never guessed |
| `b2b.customerIndustries` (NEW) | any of the seven group ids `shops`, `food`, `health`, `services`, `technology`, `industry`, `community`, plus `government` | Sign-up step 2 (optional, businesses or both), Settings | `describeAudience`, `fromCustomers`, competitor discovery |
| `b2b.companySize` | `solo`, `small`, `medium`, `large`, `''` | same | `describeAudience`, `fromCustomers` |
| `b2b.decisionMaker` | free text (at most 120); tiles fill one of eight English role names; "Someone else" opens the text box | same | `describeAudience`, `fromCustomers`, OnboardingContext roles |
| `b2b.salesCycle` | `days`, `weeks`, `months`, `''` | same | `describeAudience` |
| `industry` | one of the 33 values, or the owner's own words when "Other" is chosen (at most 80) | Sign-up step 1 (required), Settings | every prompt that names the industry (memory block, calendar, plan facts, competitor discovery, Blueprint style, best-posts lookup in `routes/competitorBestPosts.js`), staff client lists (`routes/csm.js`) |
| `brandVoice` | list of the six voices; older free-text voices kept and shown as extra tiles | Sign-up step 3 (optional), Settings | `resolveBrandIdentity` (Tone line), OnboardingContext |
| `marketingGoals` | list of the five goals; older values kept and shown | Sign-up step 3 (required, one or more), Settings | `plan/profileInput.js goalOf`, OnboardingContext `primaryGoal` (FIXED: it read a non-existent `goals` field, so every account was "leads") |
| `contentLanguage` | offered: the six bases and five `_english_mix`; accepted: the full old list of 23 | Sign-up step 3 (required), Settings | `normalizeLanguage` in the calendar, Home drafts, Create; Blueprint facts |
| `additionalLanguages` | base codes, at most three, never the primary | Sign-up step 3 (optional), Settings | localize drafts. The picker now OFFERS the six writer languages (a saved seventh stays visible and removable); the server still accepts the 12 base codes. |
| `accountKind` | `one`, `several`, `''` | Sign-up step 1 only (optional), unchanged | `afterOnboardingHash` (agency landing), `cleanAccountKind` |

Unchanged and only re-laid out in Settings: name, website, GST, location, years, brand stage, description, speciality, problem solved, who buys (text), ideal customer, new or returning, price level, hero product, what makes you different, story, never say, first-month ideas, cadence.

## 2. Backward compatibility (no migration)

- Nothing is rewritten in the database. Old values are mapped when READ (`reachAreasOf`, `genderOf`, `industryValueFor`) and when an owner saves again (`cleanBusinessProfile`).
- `both_equally` stays in the schema enum, so old documents still pass `runValidators`; it reads as "not specific" and a new save stores empty instead.
- `geographicReach` stays in the schema and is never cleared; a save with no areas picked but an old answer stores the mapped area in `reachAreas` (same meaning, nothing lost).
- `industry` spellings `Technology/SaaS` and `Finance/Fintech` (older Settings) map to `Technology / SaaS` and `Finance / Fintech`. Any other old text shows as "Other" with the text in the box, and prompts read it as it was.
- Old free-text voices and goals stay as extra tiles in Settings and are never dropped by a save.
- A language outside the six stays selected and visible as an extra tile; the server still accepts all 23.
- The save no longer fails on an unknown choice value (`update-profile` runs validators): `cleanBusinessProfile` drops it first. Before this change, one bad value made the whole save fail with "Unable to update profile".

## 3. Entitlements and money

None. No question costs Quarks, none calls a model, no plan gate changes. The questions are the same for free, Starter, Growth, Agency and managed accounts. The answers make prompts a few lines longer (at most about 60 tokens: five short lines), well inside every prompt's budget; no price changes.

## 4. Who sees it

- **Agency client workspaces**: the agency fills the client's profile in Settings while inside the client (`insideClient`); the same form, the same rules. `accountKind` is never asked there (only at the agency's own sign-up), unchanged.
- **Staff acting inside an account**: Settings, same form; what they save is cleaned the same way. Staff lists read only `name` and `industry`; an "Other" industry shows the owner's words.
- **Demo agency and the sample-data preview** (`demoUserStore.js`, visual-audit mock): empty `businessType`, so both branches are hidden until chosen.

## 5. Edge cases

| Case | Behaviour |
|---|---|
| Sells only to businesses | Age and gender are hidden; an old saved gender is never sent to prompts; business questions show. |
| Sells to both | Both sets show, all optional. |
| Nothing chosen yet (old account) | Settings shows the question with nothing selected and both branches hidden; prompts say nothing about it. |
| Several reach areas | Prompts read "Customers are in the city, the state and all of India". |
| Only an old reach answer | Read as the matching area; Settings shows that tile selected. |
| "Other" industry with no text | Saved as `Other`; prompts treat it as not set (no "Industry: Other" line). |
| Website analysis fills an unknown voice or goal | Kept only when it matches a known choice (case and spacing ignored); unknown ones are dropped in sign-up so a tile the owner cannot see is never saved. |
| Language switch in sign-up (EN, TA, HI) | Every new word in all three; values stay English. |
| Phone (375 px) | Tiles two or three a row, every row filled, equal heights; no sideways scroll. |
| Over-long text or arrays sent by a script | Cut to the caps (decision maker 120, industry 80, lists de-duplicated, at most the number of options). |

## 6. Tests

- Backend `tests/businessQuestions.test.js`: the config is self-consistent (every old onboarding and Settings industry value is in the list or mapped; Other last; reach map covers every old value; the six languages are in the schema enum); `cleanBusinessProfile` maps and drops; readers (`describeAudience`, `fromCustomers`, plan facts) for consumer, B2B, both, multi-reach, old-shape and empty profiles; no "undefined" or empty lines.
- Backend `tests/onboardingContract.test.js`: updated to nine required sign-up answers (the new "who do you sell to"), new payload shape valid for the schema.
- Frontend `tests/businessQuestions.test.mjs`: the mirror equals the backend config; every option has a label in EN, TA and HI (TA and HI really translated); branch rule; reach and gender old-value mapping; industry Other; language tiles.
- Frontend `tests/onboarding-i18n.test.mjs`, `businessProfileForm.test.mjs`: updated to the shared definition.
- Real database: `backend/scripts/questionnaire-check.js` on `nebulaa_dev` only, `zz.` users created and deleted: saves old-shape and new-shape, B2B and consumer profiles through the same cleaning and the model, reads them back, runs the prompt readers.
- Screens: sign-up steps 1 to 3 and Settings > Business profile in the sample-data preview on port 3131 at 1280 and 375, equal tile heights measured.
