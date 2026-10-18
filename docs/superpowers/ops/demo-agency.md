# Demo agency (development only)

A ready-made Agency account with two client brands, so you can click through the Agency experience without paying or building anything.

## What it is
- One agency account with the Agency plan active, the full monthly shared pool, and onboarding finished.
- Two clients: Demo Bakery (with four sample posts waiting for approval) and Demo Salon.
- It lives only in the development database (`nebulaa_dev`). The script refuses any other database.

## Log in
- Email: `demo-agency@example.test`. The password was printed once when the demo was created (and saved to the file your assistant named). If you lost it, remove the demo and create it again for a new one.
- Website: http://localhost:3000, local server on port 5000. If they are not running, start them from the Claude desktop app preview.

## What to click
1. Sign in with the email and password.
2. Open Clients in the menu. You see Demo Bakery and Demo Salon.
3. Open a client. Notice the orange bar "Back to my clients".
4. Try Review and approve (Demo Bakery has sample posts).
5. Click Back to my clients, open the Plans page and look at the Agency card.
6. Open Usage per client.

## Remove it
From the `backend` folder:

    node scripts/seed-demo-agency.js remove

It deletes the demo agency, its two clients and everything they hold, then prints `Left: 0`. To make it again: `node scripts/seed-demo-agency.js create` (running create twice never makes a second copy).

## What the demo does not show
- No real payment: the plan is a local record shaped like a purchase. Cancel, renew and extra-client buttons will not work against Razorpay.
- No pictures: the sample posts are text only, and nothing here calls the AI or publishing services.
- Usage per client starts empty, because nothing has been generated yet.
- No connected social accounts, no inbox messages, no competitor data.
