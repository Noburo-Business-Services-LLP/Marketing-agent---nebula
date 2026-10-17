# Agency plan: owner steps before opening it

Do these in order. Nothing here is done by the app on its own. "You" is the owner unless a name is given.

## 1. Razorpay plans

The Agency plan and the extra client slot are two monthly Razorpay plans.

- Either let the app create them the first time they are needed, or create them in the Razorpay dashboard and save their ids.
- To save an id, run `bash docs/superpowers/ops/set-secret-value.sh` on your Mac (Docker running, `~/.aws` set up). Type the name `RAZORPAY_PLAN_ID_AGENCY`, then the id; repeat for `RAZORPAY_PLAN_ID_SLOT`. The script hides the value and keeps the old version.
- Both names are already in the script's allowed list and in the optional list of `check-secret-keys.sh` (no edit was needed). Run `bash docs/superpowers/ops/check-secret-keys.sh` afterwards to see that they are set. It never prints values.
- Agency price Rs 6,999 and Rs 1,499 per extra client are config values in `backend/config/apiCosts.js`.

## 2. Test the two checkouts with Razorpay TEST keys

The preview refuses payment, so neither checkout has ever been run for real.

- Use Razorpay test keys on a dev or staging copy. Buy the Agency plan, then add an extra client slot.
- Check: the plan becomes Agency, the slot count goes up, the clients stay open, the invoice looks right, and cancelling the plan pauses all clients (nothing deleted).
- Check that a refused payment shows in staff Money failures. Those need a manual Razorpay refund; they are not retried.
- Also check the webhook still verifies (`RAZORPAY_WEBHOOK_SECRET`).

## 3. Subashni (accountant)

- GST rate and SAC code to print on Agency and extra-slot invoices.
- How long to keep payment records, and what is kept when an agency deletes its account (a retained payment record stays for the agency only).
- The new Terms clause 21 (Agency accounts and client brands) as it affects billing.

## 4. Lawyer review

Send the new text for review: Terms section 21 and Privacy section 5.6 (the new text is a draft until the lawyer has reviewed it; the pages carry no "draft" banner, so do not describe them as final or send the "We have updated our Terms" notice before the review is done). Points to ask about: the agency's confirmation of client permission, the agency as contact for client data requests, and immediate erasure when a client is removed.

## 5. Re-measure the real cost per Quark

The plan assumes about Rs 0.70 per Quark. Measure it from a week of real usage (images, videos, text) before the Agency price is final. The Agency price depends on it.

## 6. Ask Ayrshare

Each client brand uses one Ayrshare profile. Ask Ayrshare whether a profile created and removed within one month is billed in full. The Business plan numbers we use are in `backend/config/vendorPlans.js` (about USD 599 flat for 30 profiles, then about USD 8.99 each).

## 7. Repricing rule

- The app alerts you at 25 Ayrshare profiles.
- The plan is: when the platform nears 30 profiles, move new Agency sign-ups to Rs 9,999.
- The automatic switch is NOT built. You (or a follow-up task) must change the price by hand when the alert comes.

## 8. Owner decisions still open (handover 6)

- A button or route to cancel a single extra slot. Today slots end only with the plan or through Razorpay.
- An upgrade path from Starter or Growth to Agency. Today it is blocked, like Starter to Growth.
- Whether client workspaces keep auto-generating content calendars and snapshots from the agency's pool.
- Whether account export should include the agency's clients, and whether the usage report should stay open after the plan ends.
- Whether client workspaces need their own consent record (the "updated Terms" prompt is hidden inside a client today).

## 9. Fix before release (existing issues)

- A personal email is hard-coded in `services/notificationScheduler`, so every campaign reminder goes to it. Replace it with the configured alert address.
- The CSM pass path check (`isBlockedWhileActing`) does not lower-case or decode the path, so a path like `/API/PAYMENT` might get past it. The agency pass already handles this (`isBlockedInsideClient`); give the CSM one the same treatment.

- Campaign reminder emails (30 and 15 minutes before a scheduled post) are OFF by default. The in-app reminders still work. To turn the emails on, set the environment variable `CAMPAIGN_REMINDER_EMAILS=on` (case does not matter; anything else or unset means off) and restart the backend. They then go to the post owner only. The start-up log says whether they are on or off.

## 10. Last

- Take the verification run result (real run on `nebulaa_dev`) from the controller report.
- Release everything since `b6f374b` the usual way (`release-prod.sh`).
