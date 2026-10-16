# Task 11 report (finished by the controller after the WIP commit ea4ff7f)

Visual check done on the dev servers with throwaway users (deleted afterwards): plans page as an Agency account (clients and pool card, extra-client line, Agency card with "Your plan"), as a Starter account at 375 px (Agency card readable, no sideways scroll), the extra-client dialog (price Rs 1,499 plus GST, Rs 1,768.82 with GST, limit 6 to 7), and the dashboard usage view (pool in posts and videos, month picker, CSV button, no Quark numbers). The Task 1 minor (generic lines above the agency lines) was already solved: the card shows agency-specific lines only.
Found and fixed: the "updated Terms" prompt used a nearly transparent card, unreadable over the dark plans page (dark text on dark). Now a solid cream card (`components/TermsPrompt.tsx`).
Tests: frontend 296 pass, brand and voice audits 0, layer lists regenerated, tsc only the old Influencers error.
Not done here: the slot checkout through Razorpay (the preview refuses payment; test with Razorpay TEST keys, on the launch checklist).
