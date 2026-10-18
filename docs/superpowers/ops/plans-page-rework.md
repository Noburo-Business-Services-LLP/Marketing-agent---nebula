# Plans page rework (branch nebulaa-redesign)

## What changed
- `frontend/pages/TrialExpired.tsx` rewritten in the cream light theme (`--gv-*` tokens only). The starfield, dark glass cards and old gold logo are gone. The page now renders inside the app shell (Layout), which carries the new logo; the `/trial-expired` route moved from outside Layout to inside it (route name kept). The Layout "choose a plan" strip and the NeedPlan modal are hidden on this page so they do not sit on top of it. The top bar says "Plans".
- Order: heading "Plans", the agreed sentence, a current plan line (plan, about N posts or M short videos left, renewal date), Starter / Growth / Agency cards, Add-ons, Add more posts and videos, GSTIN link, Settings link for changing or cancelling a plan, Razorpay line, legal links.
- Card order is fixed by `orderedPlans()`. The Agency card keeps "Suggested for you" for `?for=agency`; the page scrolls to and focuses that card (reduced motion: no smooth scroll). Nothing about managing several brands sits above the cards.
- No Quarks shown: balance and top-up packs use posts and short videos (`leftText`, `topupLine` in `frontend/utils/plans.ts`, costs from the existing `/credits` costs). Server messages naming Quarks are replaced by a plain line (`plainMessage`), and the payment-window text for top-ups no longer says Quarks.
- Add-on sentences (`addonBlurb`); the Inbox one says replies are drafted for approval and sent automatically only when switched on.
- Behaviour kept: all three checkouts, Agency card states, extra client and cancel dialogs, usage line, GSTIN form, managed state, lapsed pool notice (now driven by an empty pool), client-workspace refusal.
- Tests: `frontend/tests/plansPage.test.mjs` (new helpers), `frontend/tests/quarks-wording.test.mjs` (plans page and its dialogs have no Quark/credit/trial/7 days; no dark classes; route is inside Layout).
- Preview mock: real prices (999 / 1,999 / 6,999; add-ons 1,000 / 500 / 500 / 1,800), real top-up packs and costs, billing tier follows `?tier=`, renewal date. `routes.json`: plans routes are now group `shell`; added plans-for-agency, plans-starter, plans-growth.

## States looked at (preview 127.0.0.1:3101, 1280 and 375)
Free with `?for=agency`, free, Starter, Growth (375, plus line checks), Agency with extra slots, Agency at the 25-client cap (Add an extra client disabled with the cap message), managed, inside a client. Cards read Starter, Growth, Agency left to right and top to bottom. No horizontal scroll at 375 (document width 375). Contrast audit: 0 failures on the page in every state; the one 1280 failure is the Layout account initial "S" (4.50 against 4.5, not this page).

## Not verified
- No real Razorpay checkout (stand-in only); no live backend; no screenshots saved as files (the browser pane only returns images to the session).
- Keyboard focus ring and reduced motion checked by code, not by tabbing through.
- Still showing Quarks outside this page: the Layout top bar balance chip ("4200 Quarks"), `upgradeMessage` in `utils/plans.ts` (shared with UpgradePrompt), NeedPlanModal, and server messages/descriptions in `backend/routes/payment.js` and `billingPlans.js`.
- The wording test does not scan `utils/plans.ts` for Quark because of the shared upgrade messages above.
