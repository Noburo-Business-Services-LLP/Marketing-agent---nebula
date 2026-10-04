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
9. **SEO is out of scope** (not fully built). Add-ons are: **publish and schedule to their social pages** (Ayrshare), **competitor insights** (Apify) and **unified inbox with automatic replies**. The idea is a cheap first purchase (the content), then add-on packs, like items in a game.
10. **No free trial and no free Quarks for anyone** (for now). A new customer must pay to enter the app, with a card or UPI autopay mandate collected at sign-up and monthly auto-renewal. Discounts are allowed instead of free access: a first-month discount (50 or 80 percent, the owner will try) to get people to commit. If this does not convert, a trial can be added later.
11. Invoice item names stay simple. GST is 18 percent (the standard rate for software and for marketing services).

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
- **No trial.** New accounts start with 0 Quarks and tier `none` (locked) until the first payment succeeds.

## Entitlements (what each account may use)

A new, single place defines what each account tier can use: tiers `none` (signed up, not yet paid: locked), `starter`, `professional`, `managed`.

| Feature | none | starter | professional | managed |
|---|---|---|---|---|
| Image posts, captions, monthly calendar plan, Hero video, reels | locked | yes | yes | yes |
| Hero videos per month | 0 | 1 | 2 | 2 |
| Posting to social accounts, scheduling (add-on: Publish and schedule) | locked | add-on | add-on | yes |
| Inbox and automatic replies (add-on; needs Publish and schedule) | locked | add-on | add-on | yes |
| Competitor insights (add-on) | locked | add-on | add-on | yes |
| LinkedIn long-form writing (1 Quark each) | locked | yes | yes | yes |
| Team members | 0 | 1 | 5 | per current |

- Server routes for the costly features check the entitlement; locked features return a plain message ("This is an add-on. Ask us to turn it on.") and the page shows a locked state instead of failing.
- `managed` accounts are exempt from every gate (the Nebulaa team operates them). Accounts that exist today are treated as `managed` unless they have a paid Starter or Professional subscription (so nothing breaks for current customers).
- An add-on is a per-account flag set when purchased (or switched on by the Nebulaa team from the admin panel).

## Add-ons and top-ups (all priced inside the Quark economics)

**Vendor costs checked (2026-10-04):** Ayrshare Business plan is $599 a month and includes 30 customer profiles; profiles 31-100 cost $8.99 each a month (about ₹790), 101-500 cost $3.49 (about ₹307), 500+ cost $2.49 (about ₹219); comment and DM moderation (what the inbox needs) is included in the plan (source: ayrshare.com/pricing). The repo's cost map puts Apify at about $0.03 per Instagram profile scrape. Rate used: ₹88 per US dollar.

| Add-on | Price / month (ex-GST) | What it includes | Why this price |
|---|---|---|---|
| **Publish and schedule** | **₹1,000** | Post and schedule to their connected Instagram, Facebook, LinkedIn and other pages; basic post analytics | Each customer needs one Ayrshare profile. Beyond the 30 included profiles it costs about ₹790, so ₹1,000 leaves about ₹185 after the gateway fee (about ₹670 once profiles pass 100). ₹500 would lose about ₹315 per profile past 30. |
| **Competitor insights** | **₹500** | Up to 5 competitors, refreshed weekly (about 20 refreshes a month), with a plain summary of what they post | Apify plus the AI summary cost roughly ₹110 a month at that use, so about ₹365 margin. |
| **Inbox and automatic replies** | **₹500** | One inbox for comments and messages, with AI reply drafts (each draft uses 1 Quark from the plan) | Requires Publish and schedule (it uses the same connected accounts and profile); no extra Ayrshare fee. |
| **All three** (bundle) | **₹1,800** | The three above | 10 percent off the ₹2,000 total. |

All prices are editable in one config. GST of 18 percent is added at checkout. The owner decides the final prices; these are my starting numbers.

- **Quark top-up packs** at **₹2.00 per Quark** (ex-GST; the same rate as the managed plan, against a machine cost of roughly ₹0.55 to ₹0.70 per Quark, about 65 percent gross margin): ₹999 = 500 Quarks, ₹1,999 = 1,000, ₹4,999 = 2,500 (with GST: ₹1,178.82, ₹2,358.82, ₹5,898.82). Replaces today's "any amount, fixed 1,000 credits" purchase. Top-up Quarks do not expire with the billing month.
- Add-ons are per-account flags set when purchased (monthly subscription through Razorpay, same mechanism as the plan) or switched on by the Nebulaa team from the admin panel.
- Create an Ayrshare profile only when an account is entitled to publishing and connects its accounts (never at sign-up). With no trial, no unpaid account can use a profile slot.

## Pay-to-enter flow and first-month discount

1. **Flow**: sign up (email and OTP, as today) -> choose Starter or Professional -> pay with card or UPI (a Razorpay subscription with a card or UPI autopay mandate, monthly auto-renewal) -> onboarding -> the app. Until the first payment succeeds the account is tier `none`: the app shows only the plan page, account and billing. Existing accounts (managed customers) are unchanged.
2. **No free Quarks**: the 100-Quark trial grant and the 7-day trial timer are removed; every "free trial", "7 days free" and "no card needed" message is removed from the landing page, sign-in and app (the landing call to action changes from "Start free" to a neutral "Get started"; the FAQ "What happens after the 7 days?" is replaced). The separate marketing website project has its own copy to update (outside this repo).
3. **First-month discount**: a configurable discount on the first month only (`FIRST_MONTH_DISCOUNT_PERCENT`, default off; 50 or 80 when the owner runs the offer), shown at checkout as "Introductory price". The renewal then bills the full price. Mechanism (chosen in the plan after reading Razorpay's subscription docs): collect the discounted first payment as the subscription's upfront charge and start the recurring charge one month later, or a Razorpay subscription offer. The existing coupon model can carry a code for targeted offers. GST is charged on the discounted amount.
4. **Discount economics (ex-GST, first month, Starter / Professional)**: at 50 percent off the first month brings in about ₹475 / ₹975 net against vendor cost of about ₹1,165 / ₹1,860 at expected use (loss about ₹690 / ₹885); at 80 percent off about ₹175 / ₹375 net (loss about ₹990 / ₹1,485). The owner accepted early losses; to cap them, the discounted month could grant a smaller allowance (not in this build unless the owner asks).
5. **UPI autopay**: Razorpay's subscription checkout offers card and UPI autopay; later debits can need the customer's approval depending on the UPI app. A failed renewal marks the account `none` after a short grace (3 days) and locks it again.

## Where this changes

1. `backend/config/apiCosts.js`: add `starter` and `professional` (commitments, derived allowance, a guard that fails if the allowance is below the expected burn); keep `managed_10k` as the internal cost model. Add the top-up pack table and the add-on config (prices `null` for now).
2. Remove the trial: `creditGuard.js` stops granting `TRIAL_CREDITS`; new signups get tier `none`; the `checkTrial` guard becomes `requireActivePlan` (managed and paid tiers pass); the trial-expired paywall becomes the plan page. New `backend/config/entitlements.js` (tiers, features, Hero limits) and a small middleware `requireFeature(feature)` used on the costly routes (posting/publish, scheduling, social inbox and auto-reply, competitor routes, SEO, LinkedIn). Existing users resolve to `managed` by default.
3. Billing (`backend/routes/payment.js`, `config/plans.js`): replace the old subscription and one-off flows with the two monthly plans; the amount charged is the price plus 18 percent GST in paise; Razorpay plans are created on first use by amount (the existing `getOrCreatePlan` pattern; ids cached in env per plan); `subscription.charged` grants the plan's Quarks and records the tier; one-off purchases use the top-up pack table; GST is shown on the checkout and invoices. Old plan code paths are removed (no customers on them).
4. Hero quota is entitlement-aware (Starter 1, Professional 2, none 0, managed 2; the env override stays).
5. Frontend: the in-app plans page and paywall show only Starter and Professional (price plus GST, Quarks, what is included); locked features show "Add-on" states; top-up packs on the Quarks screen; the landing page plan cards and FAQ say Quarks with the real amounts and promise only what the plans include (the landing feature grid mentions replies and competitor views: re-label those as add-ons or remove them, owner to choose).
6. Rename "credits" to "Quarks" in every customer-facing string (frontend, backend messages, emails, invoice text). Not renamed: API fields, database fields, route names, code identifiers.

## Invoices (Zoho Books)

Simple names: a plan is "Nebulaa subscription", an add-on is "Nebulaa add-on", a top-up is "Nebulaa Quarks", with GST as its own 18 percent line. Customer-facing text says Quarks, never credits.

## Razorpay

The app creates its own Razorpay plans on first use with the live keys on the server; I do not use payment credentials myself. Nothing is created or charged during the build; tests use fakes.

## Open items

1. The owner confirms the add-on prices (starting numbers: ₹1,000, ₹500, ₹500, bundle ₹1,800).
2. Landing feature grid wording (replies, competitor views): re-label as add-ons, or remove.
3. How many Ayrshare profile slots are already used by managed customers (decides whether the first 30 are free for self-serve customers).

## Testing

Unit tests: allowance derivation (the guard fails when the allowance is below the expected burn); GST maths (₹999 -> ₹1,178.82 in paise exactly, no float drift); webhook grants per plan; top-up packs; entitlement matrix, including existing users resolving to managed and managed never blocked; locked routes return the plain message; plan-aware Hero limit; plans endpoint returns only the two plans; scanner test for customer-facing "credits". No real Razorpay or payment calls.
