# Pre-release checklist (test site first, then production)

Date: 2026-10-08. Run on the TEST site with a brand-new account and a second account. Tick each line. If a line fails, send me the screen and what you saw.

Everything here was changed or built in the last stretch and checked in code only, not by eye, unless noted.

## A. Security changes
- [ ] **Signup.** Create a new account with a normal email: works, code arrives by email, sign-in works.
- [ ] **Signup refusals.** Try `x@mailinator.com` (should say temporary emails are not accepted). Try the same Gmail with dots or `+tag` after an account exists (should say it already exists).
- [ ] **Signup limit.** Six signups from one connection in a day: the sixth is refused with a plain message.
- [ ] **Invitation mode (only if you turn it on).** Set `SIGNUP_MODE=invite` and a code on the test site: the signup page shows "Invitation code"; a wrong code is refused, a right code works.
- [ ] **Bot check (only if you add Turnstile keys).** The check shows on signup; signup fails without completing it.
- [ ] **Password reset.** Request a code, enter five wrong codes, then the right one: refused ("request a new code"). A fresh code then works. New password needs a letter and a number.
- [ ] **Sign-in email codes arrive** (this was only tested with a fake mail sender after the nodemailer upgrade).
- [ ] **Support form** (if it is reachable anywhere): sends once; the sixth message in an hour is refused.
- [ ] **Chat** is not offered to logged-out visitors (it is switched off in the app today).
- [ ] **Video hold-back.** On the new account (onboarding not finished) open Videos and try to create one: you see "Videos unlock once you have finished setting up your business…". Finish onboarding: video opens. An old account is not affected.

## B. Uploads and sizes (limits changed from 150 MB to 1 MB / 40 MB)
- [ ] Upload a **logo** (Brand assets).
- [ ] Upload a **reference picture** on Create (post design).
- [ ] Upload a **header** and a **footer** frame.
- [ ] Upload a **video file** to a draft.
- [ ] Start a **carousel** and a **campaign** with the design options.
- [ ] Anything that fails with "too large": note which screen.

## C. Spreadsheets (xlsx replaced)
- [ ] **Idea Inbox**: upload a .xlsx and a .csv; ideas appear. An old .xls file gives a clear message.
- [ ] **Strategy plan**: click the Excel download; the file opens with all sections.
- [ ] **Products**: bulk-import a .xlsx and a .csv; an old .xls gives the clear message.

## D. Pictures (sharp upgraded)
- [ ] Make one post with a **header and footer**; the bands look right and the logo is placed.
- [ ] One of each post style (plain, offer, celebration…) renders.

## E. Features built earlier and still unseen
- [ ] **Post design section** (full width, four numbered parts) on Create.
- [ ] **Hero video** style cards show cover pictures; "Bring my idea to life" and "Show me three ideas" both work.
- [ ] **Business profile** in Settings: five groups, where-your-customers-are with several choices, B2B questions show for B2B, saves and reloads correctly.
- [ ] **Blueprint**: the Designed PDF panel appears on a finished Blueprint (do not start it unless you accept the 499 Quarks; the real test run is already done).
- [ ] **Library**, **Review and approve**, new sidebar: open each once.

## F. AWS and accounts (owner tasks)
- [ ] Root access keys deleted, MFA on, working through an IAM admin user.
- [ ] Spend caps set in OpenAI, fal, Google (and any other paid provider).
- [ ] Alarms on 5xx, CPU and billing; CloudTrail and GuardDuty on.
- [ ] 2 or more backend containers, autoscaling on.
- [ ] WAF attached to the production load balancer.
- [ ] Port 80 redirects to HTTPS on production; test site has HTTPS.
- [ ] SSH closed to the internet on the old server.
- [ ] MongoDB Atlas network access list is not 0.0.0.0/0; database users have least rights; backups on and a restore tried once.
- [ ] Production settings present: `NODE_ENV=production`, `JWT_SECRET`, `ADMIN_EMAIL`/`ADMIN_PASSWORD` (or removed once the Owner exists), `RAZORPAY_WEBHOOK_SECRET`, `ALERT_EMAILS`, `FRONTEND_URL`. Optional: `SIGNUPS_PER_DAY` (default 300), `SIGNUP_MODE`, `SIGNUP_INVITE_CODES`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`.

## G. Right after release (first 48 hours)
- [ ] Watch the provider dashboards (OpenAI, fal, Google) twice a day.
- [ ] Watch new signups per hour; if strange, switch on invitation-only mode (settings change and restart).
- [ ] Check CloudWatch for 5xx and for "rate limit" bursts.
- [ ] Re-run `docs/security/attack-tests.js` against a throwaway copy if any security code changes again.
