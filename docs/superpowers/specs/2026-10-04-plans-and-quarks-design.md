# Plans and Quarks — Starter and Professional

Status: draft for the owner's approval. Branch: `nebulaa-redesign`. Decisions by the owner (2026-10-04): the landing page prices are correct (Starter ₹999, Professional ₹1,999); "Quarks" is the final name (rename every customer-facing "credits"); the in-app plans are ONLY Starter and Professional (no managed plans in the app); Starter may lose money at first but must let a new customer make one post a day for 30 days and one Hero video; Professional gets somewhat more plus more features; add-ons come later (competitor analysis, scheduling and posting, SEO, LinkedIn). The sizing, feature split and add-on structure below are my calls, to be confirmed.

## Sizing (same method as `apiCosts.js` `PLANS`)

The existing plan model sizes an allowance as: committed deliverables x Quark price x retry factor, plus 15% safety, rounded. Retry factors in the model: images 1.2, video scenes 1.5. Hero video has no measured retry rate; I assume one re-roll on average (1.5), the same as video scenes. Quark prices today: image post 20, caption or reply 1, 5-scene reel 525, Hero video 729.

| Plan | Price / month | Commitments (month) | Expected burn with retries | Allowance (Quarks) |
|---|---|---|---|---|
| **Starter** | ₹999 | 30 image posts (one a day), 1 Hero video, about 60 captions or replies | 1,874 | **2,200** |
| **Professional** | ₹1,999 | 30 image posts, 2 Hero videos, about 150 captions or replies | 3,057 | **3,500** |

- Allowances do not roll over (a month's Quarks end with the billing month). This caps cost and is what makes a loss-leading Starter safe.
- Worst-case vendor cost if the whole allowance were used: Starter about ₹1,375, Professional about ₹2,125. At an expected burn: Starter about ₹1,170, Professional about ₹1,860. Net revenue per month, if the price includes 18 percent GST and about 2 percent gateway fee: Starter about ₹830, Professional about ₹1,660 (if the price is GST-exclusive: ₹999 and ₹1,999). So Starter loses up to about ₹340-550 a month at full use (the owner accepted a loss to hook customers); Professional is near break-even to slightly negative at full use and positive at typical use. The Hero video is the cost driver (about ₹400 vendor cost per clip plus re-rolls).
- Trial: unchanged (100 Quarks, 7 days).
- Extra Quarks (top-up packs) at the managed-plan rate of ₹2.00 per Quark: ₹999 = 500, ₹1,999 = 1,000, ₹4,999 = 2,500. These replace the current "any amount, fixed 1,000 credits" one-off purchase.

## What each plan includes

- **Starter**: posts, captions and images in your language, a monthly plan on a calendar, replies to customer enquiries, approve and post to your connected accounts, 1 Hero video a month, 1 team member.
- **Professional**: everything in Starter, plus 2 Hero videos a month, competitor insights, the calendar scheduling queue, voice calls to your best leads (as the landing page promises), up to 5 team members, and more Quarks.
- **Add-ons (structure only, prices to be set by the owner)**: SEO, LinkedIn long-form posts, extra connected accounts, Quark top-up packs (priced above). Scheduling is a Professional feature; basic "approve and post" stays in Starter because the landing page promises it. Add-ons appear in the app as "Add-ons: ask us" until prices are set (no invented prices).

## Where this changes

1. **`backend/config/apiCosts.js`**: add `starter` and `professional` to `PLANS` with `inr`, `commits` and the derived allowance check (the existing guard must assert the chosen allowance is at least the expected burn); keep `managed_10k` as the internal sales-led cost model, not shown in the app. Per-plan Quark grant lives here and is the single source for billing and the landing copy.
2. **Billing (`backend/routes/payment.js`, `config/plans.js`)**: replace the ₹7,500 "Starter Pack" subscription (1,000 credits) and Pro/Growth/Scale (₹10,000-25,000, monthly/quarterly/annual) with the two monthly plans; Razorpay plans are created by amount via the existing `getOrCreatePlan` pattern (plan ids cached per plan in env); on `subscription.charged` the webhook grants the plan's Quarks (not a fixed 1,000) and records the plan tier on the user; invoice item names "Nebulaa - Starter Pack" / "Nebulaa - Professional Pack" and "N Quarks". Existing subscriptions on the old plans keep their current behaviour until the owner decides how to move them (legacy `findPlan` path stays untouched).
3. **Hero quota**: the monthly Hero limit becomes plan-aware (Starter 1, Professional 2; trial 1, practically capped by the 729-Quark price; env override stays).
4. **Frontend**: the in-app plans page (`/pricing` and the paywall) shows only Starter and Professional with the Quark amounts and features above; the landing page plan cards and the FAQ "What are credits?" become Quarks with the real amounts and an honest description of what a month of Quarks makes; the Starter claim "a full month of posts, planned and ready" is reworded to what the allowance supports (one image post a day for 30 days, plus one Hero video).
5. **Rename "credits" to "Quarks"** in every customer-facing string (frontend pages and components, backend messages, emails, invoice text). Not renamed: API fields, database fields, route names, code identifiers (`credits.balance`, `/credits`, `creditGuard`).

## Open questions (do not block the spec; needed before billing code ships)

1. Are ₹999 and ₹1,999 GST-inclusive or exclusive? (The sizing above shows both.)
2. Are there customers on the old plans (₹7,500 pack, Pro/Growth/Scale) who must be moved or left as they are?
3. Who creates the two Razorpay plans and sets `RAZORPAY_PLAN_ID_STARTER` / `_PROFESSIONAL` (the code can create them on first use with the live keys, but that is a production action for the owner)?
4. Add-on prices (SEO, LinkedIn, extra accounts) and whether top-up packs ship now.
5. Finance: confirm invoice item names ("Nebulaa - Starter Pack", "N Quarks").

## Testing

Unit tests: plan allowance derivation (the guard fails when the allowance is below the expected burn), webhook grants per plan, legacy plans unchanged, plan-aware Hero limit, top-up pack Quark amounts, plans endpoint returns only the two plans, no remaining customer-facing "credits" (scanner test in `frontend/tests`). No real Razorpay or payment calls; fakes only.
