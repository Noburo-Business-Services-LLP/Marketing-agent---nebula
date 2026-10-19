# Planner additions: products in, offline activity and numbers to watch out

Task 4 of `docs/superpowers/impact-maps/home-and-plan.md`. Built 2026-10-19, not released. The plan is the base of all the marketing, so the planner now sees what the business actually sells and where it is, and the plan says what to do offline and which numbers to watch.

## What goes in (plan runs)

`services/plan/profileInput.js` builds the input from the account; `services/blueprint/input.js` checks and caps it; `services/blueprint/discovery.js` turns it into typed facts the planner may cite by id.

| Fact | From | Cap |
|---|---|---|
| Product (name, product or service, price as stored, short description) | the account's own products (Brand assets), oldest first | 6 products; name 80, description 160, price 24 characters |
| City | Business profile location; a postcode or any run of 5+ digits is cut | 60 |
| Industry, Sells to (other businesses / individual customers / both), Where customers are, Price level, What makes it different | Business profile | fixed answers; 160 for the free text |
| Content language | Business profile | fixed list |

- The price is exactly as stored: the price note, or the number in rupees. Nothing is rounded or guessed.
- Products count as typed offers for the "not enough to go on" rule (at most three count), which is what the stop message already asks the customer to add.
- An offer in the plan may now cite a product fact.
- If the products cannot be read, the plan is built without them (never a failure).
- The free and paid Blueprint forms send none of this, so they are unchanged.

## What comes out (stored in `result.plan`)

**`offline[]`**: at most 3 rows, ids from a FIXED list (`OFFLINE_CHANNELS`, `config/blueprint.js`):

| id | Shown as | Costs money |
|---|---|---|
| `referrals` | Referrals and word of mouth | no |
| `local_events` | Local events and stalls | yes (stall fees) |
| `print` | Printed material and hoardings | yes (printing) |
| `counter` | In-store and at-counter prompts | no |
| `partnerships` | Partnerships with nearby businesses | no |
| `personal_followup` | Phone and personal WhatsApp follow-up | no |

Why these six: they are what small Indian shops and service businesses really do offline, they need no outside service, and none overlaps an online channel. WhatsApp as a channel (posts, broadcast) stays online; the offline row is the owner's own calls and one-to-one messages. Each row: `{ id, channel, mode: 'offline', spend, reason, youDo[<=2], nebulaaDoes: [] }`. Every line is tagged Suggested. Nebulaa does nothing offline: a line that says Nebulaa does offline work is removed.

**`metrics[]`**: 3 to 5 rows, ids from a FIXED list (`PLAN_METRICS`). Name, meaning, where it is seen and who counts it come from the list, never from the model.

| id | Seen where | Needs |
|---|---|---|
| reach, engagement, followers (New followers), posts_published | Performance | |
| messages (Messages and comments) | Inbox (add-on) | |
| enquiries | You count this | |
| reviews (New reviews) | You count this | Google Business Profile in the plan |
| website_visits | You count this | Website in the plan |
| referral_customers | You count this | the referrals offline row |
| event_contacts | You count this | the local events offline row |

Each row: `{ id, name, meaning, where, count: 'nebulaa'|'you', why, start }`. `start` is an optional "suggested starting point" without digits; there are no targets. A block that came back with one or two valid rows is filled to three from a fixed list for the goal (marked `auto`); a block that is missing stays empty.

**`mix`**: worked out in code from `channels`, `effort` and `offline`: per channel online or offline and organic or paid. Offline rows are fully organic or fully paid by their kind. Paid is only ever a suggestion (`paidTag: 'proposed'`) that the owner runs and pays for (`paidBy: 'you'`): Nebulaa does not run paid ads. `effort[]` rows also carry `mode: 'online'`.

## Checks

- Unknown ids, repeats and extra rows are removed; lengths are capped (200 characters a line).
- Every line goes through the existing claim scanner (no digits beyond the facts, no rankings, guarantees, contacts, quotes, exclamation marks, em dashes) and two new checks for the whole plan: no vendor names (the AI and media services behind Nebulaa, and the product's internal names) and English sentences only. A word that is in the business's own facts is allowed (a Tamil product name, a bakery called Orbit).
- Drops from the new blocks are counted apart, so they never push a paid Blueprint over its removed-items limit.
- The extras scan in `pipeline.js` walks the offline and metrics lines again before storing.

## Token cap, cut answers and cost

- Answer budget 6,500 to **9,000** tokens (`PLAN_MAX_TOKENS`). The fixture answer with every block measures about 4,900 output tokens (15.6 KB of JSON). A reasoning model gets three times the budget for thinking and answer (`openAI.js`).
- A cut answer is repaired to its last complete value (`services/blueprint/planJson.js`; it never adds content). The new blocks are last in the JSON, so a late cut loses only them: such a plan is used at once with a QA note `plan_answer_cut`. A cut that lost more is asked for once more; if that also fails, the best repaired plan is used instead of failing the run. A cut inside the calendar fails as before (at most two calls).
- Spend is recorded **before every model call** for plan runs (a second try is a second ledger line). The daily ceiling, the provider switch and the 100 plan runs a day cap are unchanged. Plan runs are never charged to the customer.
- Estimate: 5,600 tokens in and 5,300 out = **USD 0.187 a call** (about Rs 16), from `TOKENS.blueprint_plan` in `config/apiCosts.js`. At most two calls a run. The paid Blueprint uses the same planner, so its derived price moved from 20 to **23 Quarks**.

## Old plans

Stored runs are never edited. A plan without these blocks shows "Offline: None yet", the "does not include offline activity yet" line and the roadmap measures under Numbers to watch. New blocks arrive at the monthly pass or the customer's own refresh; no bulk regeneration.

## Tests and checks

- `backend/tests/planAdditions.test.js` (19), `planAdditionsRealProof.test.js` (3); frontend `strategyLevels.test.mjs`, `planVisuals.test.mjs`.
- Real database: `cd backend && node scripts/plan-additions-check.js` (nebulaa_dev only, fake model, 9 checks, cleans up; `cleanup` mode for leftovers).
- Preview: `/plan?planstate=ready` (new blocks), `premix` (a plan from before), `old`.
- One real run with the owner's OK: `docs/superpowers/ops/plan-additions-real-proof.md`.
