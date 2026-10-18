# Razorpay TEST check for the Agency plan and the extra client place

A guided check you run yourself, in Terminal, with your own Razorpay **TEST** keys. You pay with Razorpay's fake test card (no real money moves). It takes about 10 to 15 minutes, almost all of it your two payments.

It closes step 2 of `agency-launch-checklist.md` ("Test the two checkouts with Razorpay TEST keys"), which the release checklist lists as never done for real.

## What you need

1. **Razorpay dashboard in TEST mode.** Log in at dashboard.razorpay.com and switch the **Test mode** toggle on (top of the page). The page turns a different colour and says "Test Mode".
2. **Your TEST Key Id and Key Secret.** In Test mode go to **Settings, then API Keys, then Generate Test Key** (if a test key already exists you can only see the Key Id; generate a new one to see its secret, which is shown once). The Key Id starts with `rzp_test_`. If it starts with `rzp_live_` you are in Live mode: stop and switch the toggle.
3. **Subscriptions switched on in Test mode.** If the check stops at "create subscription" with a Razorpay message about subscriptions not being enabled, switch them on in the dashboard (Test mode, Subscriptions) and run again.
4. You do **not** need a webhook secret. The check makes its own random one, keeps it only inside the running program, and never shows it.
5. `backend/.env` must already point at the **development** database (`nebulaa_dev`), as for the other check scripts. If it points anywhere else the check refuses before it does anything.

The check uses your Razorpay keys only from what you type into the hidden prompts below. It ignores any Razorpay key or plan id written in a file.

## The command

Copy all of this into Terminal and press Enter. Terminal will ask for the Key Id and the Key Secret; what you type is hidden (nothing shows, that is normal).

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd "/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign/backend" && read -rs "RZP_KEY?Razorpay TEST key id (hidden): " && echo && read -rs "RZP_SECRET?Razorpay TEST key secret (hidden): " && echo && RAZORPAY_KEY_ID="$RZP_KEY" RAZORPAY_KEY_SECRET="$RZP_SECRET" I_APPROVED_RAZORPAY_TEST=yes node scripts/razorpay-test-check.js; unset RZP_KEY RZP_SECRET
```

`I_APPROVED_RAZORPAY_TEST=yes` is your approval to talk to Razorpay TEST mode and write to the development database. Without it the check refuses.

## What you will see and do

1. A banner that says **TEST MODE** and "Razorpay TEST key accepted. Database: nebulaa_dev". If you see "REFUSED" instead, read the reason, fix it and run again (nothing was contacted).
2. A few quick checks run on their own (they print `PASS`).
3. **The first pause: the Agency plan.** The check prints a long box:
   - the amount the Razorpay page must show: **Rs 8,258.82** (Rs 6,999 plus 18% GST), worked out from the app's price list;
   - a **link** (it looks like `https://rzp.io/...`).

   Do this:
   1. Open the link in your browser.
   2. Check the amount on the page is the one printed.
   3. Pay with the TEST card: number `4111 1111 1111 1111`, any future expiry (for example 12/34), any 3-digit CVV (for example 123), any name. If a bank page asks for an OTP, choose **Success** or type any OTP.
   4. Wait until the page says the payment worked.
   5. Go back to Terminal and press **Enter**.

   These card details come from Razorpay's published test-mode documentation. If the Razorpay page asks for something different, check Razorpay's docs ("Test cards" for your payment method) and use what they say.
4. The check waits (up to 10 minutes) until Razorpay reports the plan as **active**, reads the real payment, and then runs a long list of checks on its own, each printed as `PASS` or `FAIL`.
5. It makes two fake client brands, then pauses a **second time** for the **extra client place**: amount **Rs 1,768.82** (Rs 1,499 plus GST). Same steps: open the link, pay with the same test card, press Enter.
6. **An optional question:** "pay a SECOND time (another extra client place)?" Type `y` to pay once more for Rs 1,768.82, or just press Enter to skip. The second payment lets one check run with a real place ("cancelling the plan also stops its extra places"). Skipping is fine: that one check is shown as `SKIP`, not as a failure.
7. The cancel checks run on their own. They make real "cancel at the end of the month" requests to Razorpay TEST.
8. **Cleanup, always:** it cancels every Razorpay TEST subscription it made, deletes the fake accounts, client brands, payment rows, Quark ledger rows and its temp file, and prints how many rows are left (should be 0).
9. A **results table** with `PASS`, `FAIL` or `SKIP` for each check, then `OVERALL: PASS` or `OVERALL: FAIL`.

## What a good result looks like

- Every line `PASS` (the optional ones may be `SKIP`).
- The cleanup lines end with `left over: accounts 0, ledger rows 0, OpsState rows 0, rows in other collections 0` and `NOT cancelled 0`.
- `OVERALL: PASS`, and Terminal returns to its prompt. A failed run ends with `OVERALL: FAIL` (and a non-zero exit); still read the cleanup lines.

Some checks are labelled **SIMULATED**: they use made-up payment ids with the right amount (a renewal, the Agency plan bought again after cancelling). No real money or Razorpay payment is behind them; they test our rules, not Razorpay.

## If it is interrupted

Press **Ctrl+C** once: the check stops and runs the cleanup by itself. If the Terminal window was closed, the computer slept or it crashed, run the same command with `cleanup` at the end:

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd "/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign/backend" && read -rs "RZP_KEY?Razorpay TEST key id (hidden): " && echo && read -rs "RZP_SECRET?Razorpay TEST key secret (hidden): " && echo && RAZORPAY_KEY_ID="$RZP_KEY" RAZORPAY_KEY_SECRET="$RZP_SECRET" I_APPROVED_RAZORPAY_TEST=yes node scripts/razorpay-test-check.js cleanup; unset RZP_KEY RZP_SECRET
```

(That is `node scripts/razorpay-test-check.js cleanup` with your keys supplied as above.) It reads a small note the run left in the computer's temp folder, cancels the Razorpay TEST subscriptions listed there, and deletes every account whose email starts with `rzpcheck-`. If it cannot cancel one, it prints the subscription id: cancel it by hand in the Razorpay dashboard (Test mode, Subscriptions). Test-mode subscriptions cost nothing even if one is left.

Razorpay **plans** the check creates (named "Nebulaa Agency subscription" and the extra-client one) stay in your Test dashboard: Razorpay does not let anyone delete plans. That is harmless; each run adds two.

## What this check proves

- The real create-subscription code creates a real Razorpay TEST subscription for the Agency plan and for the extra client place, at **price plus 18% GST**, and the amount Razorpay actually charges equals our price list.
- After a real TEST payment, our webhook handler, given the real subscription and payment ids and amount from Razorpay, makes the account Agency, grants the shared Quarks **once**, ignores a replay, ignores a wrong-amount event (recording a needs-refund row), and ignores an event for an unknown plan.
- The real verify-subscription code, including the amount it fetches from Razorpay, grants the extra place and its 500 Quarks once.
- The extra client cap (25), the refusal without an Agency plan, cancelling a place at the end of its month (the limit only drops when the cancelled event arrives, once, no clients deleted), cancelling the plan (all clients paused, none deleted), and buying again (clients open again).
- The staff Money failures list shows the needs-refund rows.
- The welcome email and the Zoho invoice calls are made once each (both are fakes: **no email is sent and nothing is written to Zoho**).

## What it does NOT prove

- **Razorpay's real webhook delivery to our server.** The check posts the events itself, signed with its own random secret. Whether Razorpay can reach the production URL, signs with the secret saved in production, and sends the events we expect is untested.
- **The browser checkout window's own callback.** The check computes the payment signature itself from your key secret using Razorpay's documented formula. What the website's real checkout window sends back after payment is not exercised.
- **Live mode.** TEST mode can differ from Live in cards, banks, UPI and timing.
- **The production webhook URL and secret.** After the release, do this separate step: in the Razorpay dashboard add the webhook (Settings, Webhooks) pointing at the production address `/api/payment/webhook` with the same secret that is saved as `RAZORPAY_WEBHOOK_SECRET` in production, tick the subscription events (charged, cancelled, halted, completed), and use **Send test event** from the dashboard to see it arrive. A test event will not match a real subscription, so the server simply ignores it, but the delivery and the 200 answer prove the link works.
- The real renewal a month later, a card that fails, and refunds (the needs-refund payments are refunded by hand in Razorpay).
- Anything about invoices: Zoho is a fake in this check.

## Safety, in one list

- Refuses unless `RAZORPAY_KEY_ID` starts with `rzp_test_` (a live key is refused; a secret that looks like a key id, or has spaces or quotes, is refused too).
- Refuses unless the database is exactly `nebulaa_dev`, and unless `I_APPROVED_RAZORPAY_TEST=yes`.
- Never prints a key, a secret or the webhook secret.
- Everything it creates is named `rzpcheck-...`; real customers are never touched.
- If the development database is full (the shared cluster once hit its disk limit), writes can fail; the check then stops and cleans up what it can.

## When you are done

**Close the Terminal window.** Your key secret was typed into it (the hidden prompts keep it out of the screen, but the window may still hold it in memory). If you want to be thorough, in the Razorpay dashboard (Test mode, Settings, API Keys) you can regenerate the test key; test keys cannot touch real money.
