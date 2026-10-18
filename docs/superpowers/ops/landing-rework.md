# Landing page rework (frontend/pages/LandingPage.tsx)

## What changed
- The 3-step "How it works" is now a numbered list of seven steps: tell us about your business, get your plan, weekly posts and videos, review and approve, publish and schedule (add-on), reply from one inbox (add-on), competitors and audience comments (add-ons). Steps 5 to 7 carry an "Add-on" tag.
- Inbox wording: replies are drafted for you to read, change and approve. Automatic sending is mentioned only as something you switch on yourself. Nothing promises automatic replies.
- New "Who it is for" strip (small business owners, shops, clinics, hotels, restaurants, coaches) and a short "For agencies" block.
- Pricing: three cards in the order Starter, Growth, Agency (three columns from tablet width, one on a phone). Agency card: 6,999 a month plus GST, up to 545 posts or 37 short videos from one shared pool, 5 client brands included, extra client brand 1,499 a month plus GST, publishing, inbox and competitor insights included, usage report per client. The figures are taken from backend/config/apiCosts.js (PLANS, outputsFor, AGENCY). An add-on price line was added (Publish 1,000, Competitors 500, Inbox 500, all three 1,800).
- Removed every use of Quark(s), credit, trial, "7 days". The two Quark FAQs became: replies need your approval; running low (top-ups valid 60 days, prices without GST, 18% GST at checkout); several clients on Agency. The WhatsApp/email/SMS mention was removed from the replies card, because the Inbox covers connected social accounts only.
- Tests: quarks-wording test now also checks the Agency card figures, price, included clients and extra-client price from config. New frontend/tests/landing.test.mjs checks forbidden words, the seven steps, the drafted-for-approval Inbox wording, and plan order.

## Results
- `node --test tests/*.test.mjs`: 420 passed, 0 failed.
- `npx tsc --noEmit`: exactly one error, the old one in pages/Influencers.tsx.
- brand-audit: 0 violations. voice-audit: 0 violations. gen-layer-lists ran (no tracked file changed).
- Looked at the dev page at 375, 800 and 1280 wide: no sideways scrolling.

## Uncertain
- Step 6 and the Inbox FAQ describe what the Inbox is meant to do. It has never been tested with real accounts, and the code has gaps (see docs/superpowers/ops/inbox-live-test.md). Consider hiding step 6 until the live test passes.
- The existing hero line "Built on real experience with 2,000+ MSMEs and startups" was left as it was; it is a claim only the owner can confirm.
- "This week" and "My plan" are named as in the app menu; "This week" was not re-checked in the menu code.
- At 768 to 900 px wide the three plan cards are narrow but readable.
