# Plans, Quarks and add-ons — Starter and Professional

Status: draft for the owner's approval (decisions below are the owner's, 2026-10-04). Branch: `nebulaa-redesign`. Nothing is pushed or deployed.

## Decisions (owner)

1. Two plans only in the app, **Starter** and **Professional**. Managed-service customers are not shown plans; their accounts (formerly Gravity, now Nebulaa) are managed by the Nebulaa team and keep full access.
2. **Prices are GST-exclusive**: Starter ₹999 and Professional ₹1,999, plus 18 percent GST charged on top (₹1,178.82 and ₹2,358.82).
3. **Starter is creation only: 30 image posts and 1 Hero video a month.** No posting to social accounts, no scheduling, no replies, no competitor features, no SEO or LinkedIn: each of those costs us money outside the Quark economics (social-posting service, hosting, third-party data), so they become add-ons.
4. **Professional**: 30 image posts, 2 Hero videos, and more captions. It makes no promise of replies, posting, scheduling or competitor features (add-ons).
5. "Quarks" is final: rename every customer-facing "credits".
6. No customers exist on the old plans (the ₹7,500 pack, Pro, Growth, Scale); all current customers are managed.
7. Add-ons and top-ups: people can pay for extra Quarks and for individual features; everything must work inside the Quark economics.
8. Starter may lose money at first; it must let a new customer make one post a day for 30 days and one Hero video.

## Sizing (the same method as `apiCosts.js` `PLANS`)

Allowance = committed deliverables x Quark price x retry factor, plus 15 percent safety, rounded to the nearest 100. Retry factors in the model: images 1.2, video scenes 1.5; the Hero video has no measured retry rate, so I assume one re-roll on average (1.5). Quark prices today: image post 20, caption 1, Hero video 729.

| Plan | Price / month (ex-GST) | Commitments | Expected burn with retries | Allowance |
|---|---|---|---|---|
| **Starter** | ₹999 | 30 image posts, 1 Hero video | 1,814 | **2,100 Quarks** |
| **Professional** | ₹1,999 | 30 image posts, 2 Hero videos, about 150 extra captions | 3,057 | **3,500 Quarks** |

- Allowances end with the billing month (no rollover), which caps cost.
- Net revenue per month = price minus the payment gateway fee (about 2 percent of the GST-inclusive charge): Starter about ₹975, Professional about ₹1,950.
- Vendor cost: Starter about ₹1,165 at expected burn and about ₹1,350 if the whole allowance is used; Professional about ₹1,860 expected and about ₹2,130 at the full allowance. So Starter loses about ₹190 (expected) to ₹375 (worst case) a month (accepted); Professional is about +₹90 at expected burn and −₹175 at the full allowance.
- The Hero video is the cost driver: about ₹400 of vendor cost per clip, plus re-rolls.
- Trial: unchanged (100 Quarks, 7 days, everything available, so a new customer sees the whole product).

## Entitlements (what each account may use)

A new, single place defines what each account tier can use: tiers `trial`, `starter`, `professional`, `managed`.

| Feature | trial | starter | professional | managed |
|---|---|---|---|---|
| Image posts, captions, monthly calendar plan, Hero video, reels | yes | yes | yes | yes |
| Hero videos per month | 1 | 1 | 2 | 2 |
| Posting to social accounts, scheduling | yes | add-on | add-on | yes |
| Replies, inbox, auto-reply | yes | add-on | add-on | yes |
| Competitor insights | yes | add-on | add-on | yes |
| SEO, LinkedIn long-form | yes | add-on | add-on | yes |
| Team members | per current app behaviour | 1 | 5 | per current |

- Server routes for the costly features check the entitlement; locked features return a plain message ("This is an add-on. Ask us to turn it on.") and the page shows a locked state instead of failing.
- `managed` accounts are exempt from every gate (the Nebulaa team operates them). Accounts that exist today are treated as `managed` unless they have a paid Starter or Professional subscription (so nothing breaks for current customers).
- An add-on is a per-account flag set when purchased (or switched on by the Nebulaa team from the admin panel).

## Add-ons and top-ups (all priced inside the Quark economics)

- **Quark top-up packs** at **₹2.00 per Quark** (ex-GST; the same rate as the managed plan, against a machine cost of roughly ₹0.55 to ₹0.70 per Quark, about 65 percent gross margin): ₹999 = 500 Quarks, ₹1,999 = 1,000, ₹4,999 = 2,500 (charged with 18 percent GST on top: ₹1,178.82, ₹2,358.82, ₹5,898.82). Replaces today's "any amount, fixed 1,000 credits" purchase. Top-up Quarks do not expire with the billing month.
- **Feature add-ons** use one of two models, set per feature in one config, with no invented prices:
  - `monthly` for features with a fixed per-account cost (social posting and scheduling, replies and inbox): a flat monthly price.
  - `quarks_per_use` for features with a per-use cost (competitor scans, SEO reports, LinkedIn posts): a Quark price per use, derived from the vendor rate like every other price in `apiCosts.js`.
- Until the owner supplies the vendor costs, add-on prices stay `null` and the add-ons show as "Ask us"; the mechanism, gates and admin switch work now.

## Where this changes

1. `backend/config/apiCosts.js`: add `starter` and `professional` (commitments, derived allowance, a guard that fails if the allowance is below the expected burn); keep `managed_10k` as the internal cost model. Add the top-up pack table and the add-on config (prices `null` for now).
2. New `backend/config/entitlements.js` (tiers, features, Hero limits) and a small middleware `requireFeature(feature)` used on the costly routes (posting/publish, scheduling, social inbox and auto-reply, competitor routes, SEO, LinkedIn). Existing users resolve to `managed` by default.
3. Billing (`backend/routes/payment.js`, `config/plans.js`): replace the old subscription and one-off flows with the two monthly plans; the amount charged is the price plus 18 percent GST in paise; Razorpay plans are created on first use by amount (the existing `getOrCreatePlan` pattern; ids cached in env per plan); `subscription.charged` grants the plan's Quarks and records the tier; one-off purchases use the top-up pack table; GST is shown on the checkout and invoices. Old plan code paths are removed (no customers on them).
4. Hero quota is entitlement-aware (Starter 1, Professional 2, trial 1, managed 2; the env override stays).
5. Frontend: the in-app plans page and paywall show only Starter and Professional (price plus GST, Quarks, what is included); locked features show "Add-on" states; top-up packs on the Quarks screen; the landing page plan cards and FAQ say Quarks with the real amounts and promise only what the plans include (the landing feature grid mentions replies and competitor views: re-label those as add-ons or remove them, owner to choose).
6. Rename "credits" to "Quarks" in every customer-facing string (frontend, backend messages, emails, invoice text). Not renamed: API fields, database fields, route names, code identifiers.

## Invoices and the accounting tool (Zoho Books)

When a customer pays, the app creates an invoice in Zoho Books with a line-item name and the tax. The current text says "Nebulaa - N Credits"; it would become "Nebulaa - Starter Pack" for a plan and "Nebulaa - N Quarks" for a top-up, with GST as a separate 18 percent line. The only question for the accountant is whether they rely on the exact item names or tax codes (HSN/SAC) in Zoho; if not, nothing to decide.

## Razorpay

The app creates its own Razorpay plans on first use with the live keys on the server; I do not use payment credentials myself. Nothing is created or charged during the build; tests use fakes.

## Open items

1. Add-on prices and vendor costs (social-posting service, hosting share, competitor data, SEO data) so each add-on can be priced inside the Quark economics.
2. Landing feature grid wording (re-label replies and competitor views as add-ons, or remove).
3. Accountant check on invoice item names and GST tax codes.

## Testing

Unit tests: allowance derivation (the guard fails when the allowance is below the expected burn); GST maths (₹999 -> ₹1,178.82 in paise exactly, no float drift); webhook grants per plan; top-up packs; entitlement matrix, including existing users resolving to managed and managed never blocked; locked routes return the plain message; plan-aware Hero limit; plans endpoint returns only the two plans; scanner test for customer-facing "credits". No real Razorpay or payment calls.
