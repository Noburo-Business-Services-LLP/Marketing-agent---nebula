# Key security backlog (owner request, 2026-10-22: "note it down, we will build this later once the other work is complete")

## Why this exists
On 2026-10-22 the owner's fal.ai credits went negative and fal's Recent History showed requests Nebulaa never makes (a burst of `flux/schnell` "a tiny blue dot" about 14 hours earlier, then Kling, MiniMax recast, OpenRouter and a refused Seedance 2.5 reference-to-video). A search of the git history found a hard-coded fal credential in `backend/test-fal.js` (added 2026-06-29 by Abinesh S, commit `8d9ab3a`, deleted 2026-10-20 in `266c08c`, still in history). The key ID in the owner's fal dashboard begins `4ddf2f8e-d` and matches the key ID in that file. Abinesh worked for a partner development company that no longer works with Nebulaa. Decisions log: D132.

## Result of the full-history secret scan (2026-10-22, patterns, names only)
- Real leaks: (1) fal key in `backend/test-fal.js`; (2) an Ayrshare PROFILE key in `test-ayrshare-jwt.js` (commits `51b2ecd`, `f5e2928`, `39619a7`; the master API key and the secure-link private key were read from environment variables, not written in the file). Both added June 2026 by Abinesh S.
- Not found in history: OpenAI-style (sk-), Google (AIza), AWS (AKIA), Razorpay (rzp_), GitHub, Slack, database URLs with passwords, Cloudinary URLs, Apify tokens, private key blocks, committed `.env` files.
- Harmless matches: internal lock key names, browser storage key names, a fake secret in `docs/security/attack-tests.js`.
- The scan cannot see: keys shared in chat, email or messages, keys on the partner company's laptops or task definitions, keys outside the repository.

## DONE or in progress by the owner
- [ ] fal: create a narrow new key (Requests READ+SUBMIT(+CANCEL), Assets READ+WRITE only), set `FAL_KEY` in production with `bash docs/superpowers/ops/set-secret-value.sh`, redeploy, delete the old "Untitled key" (ID `4ddf2f8e-d...ad7bfb3e`), set a spending limit and turn auto-recharge off, update the local `.env`.
- [ ] Ayrshare: rotate the profile key from `test-ayrshare-jwt.js` (check with Ayrshare how it affects the client profile before resetting; handover 29 says the production profile key ending `0543` must not be reset casually).
- [ ] GitHub: confirm the repository is PRIVATE and review Collaborators and teams (remove anyone from the partner company).

## KEY ROTATION CHECKLIST (the partner company may have had all of these; rotate in this order)
1. fal (above). 2. OpenAI and Gemini (content generation; abuse costs money). 3. Ayrshare (profile key, and the master API key and private key if they ever had them). 4. Apify, Serper, ElevenLabs. 5. Razorpay live keys and the webhook secret. 6. Cloudinary, the MongoDB password, `JWT_SECRET` (signs every user out: quiet hour), `HASH_PEPPER` (do NOT rotate casually: it changes stored hashes; ask first). 7. AWS access keys for any developer who had them. 8. Resend, Turnstile, Google OAuth client secrets. Record the date of each rotation in this file.

## TO BUILD LATER (owner approved the idea, build after the other work)
1. **Spend-mismatch alert**: a daily (or hourly) job compares each provider's own usage/bill with what Nebulaa recorded itself (the daily spend log `AiSpendDay` and `services/spendGuard.js`, shown on the staff AI spend card). If a provider's spend is clearly higher than Nebulaa's recorded calls, it means someone else is using the key: email the owner at once (the existing ops alert helper `services/opsAlerts.js` and `ALERT_EMAILS`). Start with fal, then OpenAI and Gemini, then Apify and Serper. Needs a separate READ-ONLY monitoring key per provider (fal: Metrics READ + Requests READ) and one real read-only call per provider to confirm what its usage API returns (needs the owner's OK; reading usage costs nothing). Build with fakes, a real-database check script, then an independent review.
2. **Push-time secret scanner**: a CI step (gitleaks or an equivalent regex check) that fails any push containing a key-like value, plus GitHub secret scanning and push protection if the plan includes them. Add the patterns used in the 2026-10-22 scan.
3. **A separate key per purpose** (prod, dev, tester) with names, so each provider's usage page shows which one spent money.
4. **Provider-side limits and alerts** (owner, no code): spending limit and low-balance alert at fal, OpenAI, Google, Apify, Ayrshare; auto-recharge off where not needed.
5. **Rotation reminders**: a recurring reminder every 90 days; this file records when each key was last rotated.
6. **Optional**: rewriting git history is NOT needed once the keys are rotated (and does not remove copies already downloaded).
