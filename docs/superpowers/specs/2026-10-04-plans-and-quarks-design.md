# Plans, Quarks and add-ons — Free, Starter, Professional (keep it small and safe)

Status: draft for the owner's approval. Branch: `nebulaa-redesign`. Nothing is pushed or deployed. Rule from the owner: **change as little existing code as possible; do not break what works.**

## Decisions (owner, 2026-10-04)

1. **Free tier stays**: every new account keeps its **100 Quarks** (what the app grants today). Only the **7-day trial timer is removed**: the 100 Quarks do not expire with time. No card is needed to explore.
2. **Free accounts can only create content** (posters, images, captions). They **cannot connect Instagram or any other social account, cannot schedule or auto-post, and cannot use any outside-service feature** (competitor data, inbox, replies). 100 Quarks is too little for a video or reel (a Hero video costs 729), so no video is possible.
3. Wherever an action needs more Quarks than the account has, or a feature that is not included, the app shows a plain **"Please upgrade your plan, or buy an add-on pack or Quarks"** message with a button, instead of an error.
4. Paid plans (GST-exclusive prices; 18 percent GST is added at checkout): **Starter ₹999**, **Professional ₹1,999**. Only these two appear in the app (no managed plans shown).
5. Starter: **30 image posts and 1 Hero video a month**. Professional: **30 image posts, 2 Hero videos and extra captions**. Both are creation only: no posting, scheduling, replies or competitor features (those are add-ons). Starter may lose money at first (accepted).
6. **"Quarks" is final**: rename every customer-facing "credits".
7. **Add-on packs** (starting prices, the owner decides): Publish and schedule ₹1,000, Competitor insights ₹500, Inbox and automatic replies ₹500 (needs Publish and schedule), all three ₹1,800. SEO is out (not built). Extra Quarks can be bought as top-up packs.
8. Invoice names stay simple: "Nebulaa subscription", "Nebulaa add-on", "Nebulaa Quarks", with GST as its own 18 percent line.
9. No customers are on the old plans (the ₹7,500 pack, Pro, Growth, Scale); all current customers are managed, and their accounts stay fully enabled.
10. A first-month discount (50 or 80 percent) is wanted later; it is a **second phase**, not in the first build.

## Sizing (same method as `apiCosts.js` `PLANS`)

Allowance = committed deliverables x Quark price x retry factor, plus 15 percent safety, rounded to 100. Retry factors: images 1.2, video 1.5; the Hero video has no measured retry rate, so I assume one re-roll on average. Quark prices today: image post 20, caption 1, Hero video 729.

| Plan | Price / month (ex-GST) | Commitments | Expected burn | Allowance |
|---|---|---|---|---|
| **Starter** | ₹999 | 30 image posts, 1 Hero video | 1,814 | **2,100 Quarks** |
| **Professional** | ₹1,999 | 30 image posts, 2 Hero videos, about 150 extra captions | 3,057 | **3,500 Quarks** |

- Unused Quarks carry over: plan allowance Quarks and top-up Quarks go into one balance that does not expire. (Owner ruling after the final review.)
- Net revenue per month after the gateway fee (about 2 percent of the GST-inclusive charge): Starter about ₹975, Professional about ₹1,950. Vendor cost: Starter about ₹1,165 at expected use and ₹1,350 at the full allowance; Professional about ₹1,860 and ₹2,130. So Starter loses about ₹190 to ₹375 a month (accepted); Professional is about +₹90 to −₹175. The Hero video is the cost driver (about ₹400 per clip plus re-rolls).
- The free 100 Quarks costs at most about ₹60 per sign-up.
- **Top-up packs** at **₹2.00 per Quark** (ex-GST; machine cost is about ₹0.55 to ₹0.70 per Quark, about 65 percent margin): ₹999 = 500, ₹1,999 = 1,000, ₹4,999 = 2,500 (with GST: ₹1,178.82, ₹2,358.82, ₹5,898.82). Replaces the current "any amount, fixed 1,000 credits" purchase.

## What each tier can use (one place, `backend/config/entitlements.js`)

| Feature | free (100 Quarks) | starter | professional | managed |
|---|---|---|---|---|
| Image posts, captions, posters, monthly calendar plan, LinkedIn writing | yes (limited by Quarks) | yes | yes | yes |
| Hero video and reels | blocked by the Quark price | yes | yes | yes |
| Hero videos per month | 1 (Quark-gated) | 1 | 2 | 2 |
| Connect Instagram and other social accounts, publish, schedule | **no** | add-on | add-on | yes |
| Inbox and automatic replies | **no** | add-on | add-on | yes |
| Competitor insights | **no** | add-on | add-on | yes |

- Accounts that exist today resolve to `managed` unless they have a paid Starter or Professional subscription, so nothing changes for current customers. New sign-ups are set to `free` at registration.
- Locked server routes return the plain "This needs an add-on or an upgrade" message; pages show a locked state with the upgrade button instead of failing. The onboarding "connect your social accounts" step is skipped for `free` accounts, with a note that connecting comes with the Publish and schedule add-on.
- An Ayrshare profile is created only when an entitled account connects its accounts (never at sign-up), so free accounts cost nothing there. (Ayrshare Business is $599 a month with 30 profiles; extra profiles cost $8.99, then $3.49, then $2.49 each; comment and DM moderation is included. Source: ayrshare.com/pricing, checked 2026-10-04.)

## Add-on pricing logic (inside the Quark economics)

| Add-on | Price / month (ex-GST) | Cost behind it |
|---|---|---|
| Publish and schedule | ₹1,000 | One Ayrshare profile per customer: ₹790 each past the 30 included, about ₹185 margin (about ₹670 past 100 profiles). ₹500 would lose about ₹315 per profile past 30. |
| Competitor insights | ₹500 | Apify at about $0.03 per profile scrape plus the AI summary, roughly ₹110 a month at weekly refresh of 5 competitors. |
| Inbox and automatic replies | ₹500 | No extra Ayrshare fee; each AI reply draft uses 1 Quark. Needs Publish and schedule. |
| All three | ₹1,800 | 10 percent off the ₹2,000 total |

All prices live in one config. Add-ons are per-account flags, bought as a monthly Razorpay subscription or switched on by the Nebulaa team in the admin panel.

## Where this changes (smallest possible footprint)

1. `backend/config/apiCosts.js`: add `starter` and `professional` to `PLANS` with the derived allowance guard; add the top-up pack and add-on tables; keep `managed_10k` as the internal cost model.
2. `backend/middleware/creditGuard.js`: keep the 100-Quark grant; remove only the 7-day expiry (`TRIAL_DAYS`) so nothing is locked by time. New sign-ups get tier `free`.
3. New `backend/config/entitlements.js` and a small `requireFeature(feature)` middleware on the routes that call outside services (social connect/publish/schedule, inbox and auto-reply, competitor scrapes). Managed accounts always pass.
4. Billing (`routes/payment.js`, `config/plans.js`): the two monthly plans (price plus 18 percent GST in paise), created on first use via the existing `getOrCreatePlan` pattern; the webhook grants the plan's Quarks and records the tier; one-off purchases use the top-up table; add-on subscriptions. Old plan paths removed (no customers on them).
5. Hero quota becomes tier-aware (Starter 1, Professional 2, free 1 but Quark-gated, managed 2; the env override stays).
6. Frontend: the in-app plans page shows Starter and Professional; "upgrade" prompts replace the trial-expired screen and "Insufficient Quarks" errors; locked states for the three add-on features; top-up packs in the Quarks area; onboarding skips the social-connect step for free accounts; landing page: remove "7 days free" and "no card needed" ("start with 100 free Quarks to explore" instead), plan cards show the real Quarks and what is included, and the feature grid re-labels replies and competitor views as add-ons.
7. Rename "credits" to "Quarks" in customer-facing strings (frontend, backend messages, emails, invoices). Not renamed: API fields, DB fields, routes, code identifiers.

## Not in the first build

The first-month discount (50 or 80 percent) and UPI autopay specifics. Phase 2 spec to follow when the owner wants the offer.

## Testing

Unit tests only (no real Razorpay or Ayrshare calls): allowance guard; GST maths (₹999 -> ₹1,178.82 exactly, in paise); webhook grants per plan; top-up packs; entitlement matrix (free blocked from connect/schedule/competitor/inbox, managed never blocked, existing users resolve to managed, new sign-ups free); locked routes return the plain message; tier-aware Hero limit; plans endpoint returns only the two plans; scanner test for customer-facing "credits" and "7 days".
