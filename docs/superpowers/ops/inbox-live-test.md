# Inbox live test (for the owner, after the release)

Plain steps, no coding. Use only your own accounts: Instagram nebulaa.os and one Facebook page you own. Never use a customer's account.

## Read this first (what the code review found)
- The Inbox has **never been tested with real accounts**. Expect something to fail. That is what this test is for.
- The Ayrshare Messaging add-on (needed for direct messages and comment-to-message) was **inactive** at last check (see ACCESS-REQUESTS-inbox.md). Direct messages probably will not work until it is bought. Comments may.
- The automatic-reply path has **never run for real**.
- **Warning about sending replies:** in the code, an approved reply is sent through the same call that creates a new post (backend/services/socialInboxProviderService.js and socialMediaAPI.js). The "reply to this comment" id is passed in but is not used by that call. So an approved reply may appear as a **new public post on your page**, not as a reply under the comment. This is why the sending tests below run only on the test account, and why you must be ready to delete a stray post.

## How new messages arrive (sync timing, from backend/services/socialInboxService.js)
- New comments and messages arrive **only when Ayrshare sends a webhook** to our server. That should take seconds to a couple of minutes. If it never arrives, nothing else will fetch it.
- The code has a "polling every 30 seconds" job, but its body is empty (it loops over users and does nothing). So there is **no fallback**. The Sync button only stamps a "last synced" time; it fetches nothing.
- The app's "next sync in 15 minutes" figure is a made-up number, not a real schedule.
- The webhook is registered when you connect an account (the app calls it after connecting). If a connection existed before, disconnect and connect again.

## Before you start
1. Release is live. Your user has the Publish and the Inbox add-ons (or the Agency plan).
2. Have a second Instagram account and a second Facebook profile (a friend's or a spare) to write comments from.
3. Keep this sheet open and note the time of each step.

## Test 1: connect
1. Open Connected accounts, connect Instagram nebulaa.os and your Facebook page.
2. Expected: both show as connected; the Inbox menu item opens (not the empty "Connect an account" screen).
3. If it fails, tell the assistant: "Connect step failed on [Instagram/Facebook], the message on screen was ..." Search logs for: `Ayrshare set webhook response`, `Webhook registration failed`, `Webhook registration error`.

## Test 2: a comment arrives
1. Publish one ordinary post on nebulaa.os (or use an existing one).
2. From the second account, comment: "Hi, what is the price?"
3. Wait up to 5 minutes. Open Inbox, Messages and comments, press Refresh.
4. Expected: a conversation from the second account with your comment, a sentiment and priority tag, and a few suggested replies on the right ("AI Assist").
5. If nothing shows after 5 minutes, tell the assistant: "Comment test: nothing arrived after 5 minutes at [time]". Search logs for: `RAW WEBHOOK`, `[Webhook] Received incoming webhook`, `Invalid webhook secret`, `Webhook signature verification failed`, `Webhook userId is required`.
   - Known risk: the webhook check looks for a signature that Ayrshare may not send in that form, so real events may be rejected with "Invalid webhook secret". If you see that phrase, that is the cause.

## Test 3: approve a drafted reply (comment)
1. In the conversation, pick one suggested reply (or type your own) and send it.
2. Expected in the app: the reply appears in the thread and the conversation shows "replied".
3. Check on the platform, within 2 minutes: is it a **reply under the comment**, or a **new post on the page**?
4. If it is a new post: delete it from Instagram or Facebook straight away and tell the assistant: "The reply came out as a new post, not under the comment." Search logs for: `[Ayrshare] postToSocialMedia payload`, `[Ayrshare] publish error`.
5. If nothing appears on the platform but the app says replied: tell the assistant "app says replied, platform shows nothing". (The app saves the reply even when sending fails.)

## Test 4: a direct message (separate)
1. From the second account, send a direct message to nebulaa.os: "Do you have this in stock?"
2. Wait up to 5 minutes, then open Inbox.
3. Expected: a message conversation. If the Ayrshare Messaging add-on is inactive, expect **nothing** to arrive. That is a known gap, not a bug in your steps.
4. Replying to a direct message goes through the same post call as above, so do **not** reply to a real person; only reply to your own second account, and check whether it appears as a message or as a public post.
5. Tell the assistant what you saw. Search logs for: `RAW WEBHOOK`, `[Webhook] Processing event`.

## Test 5: automatic replies (test account only)
1. Open Inbox, Automatic replies. Confirm the mode is "Suggested replies only" and automation is off. Nothing should be sent for you at this point.
2. Only if Tests 2 and 3 worked: use the second account on **nebulaa.os only**. Turn on the Instagram comments toggle (the robot button in the conversation header, or the Automatic replies tab).
3. Warning: the header toggle sets the mode to "Fully automatic" for the whole account in one click. Turn it back off straight after the test.
4. From the second account, comment "Is this available?" on a test post.
5. Expected: within 2 minutes one automatic reply goes out and the thread shows it as sent by the app. A comment with words like "refund" or "angry" must NOT get an automatic reply (it needs approval); a spam-like comment must be skipped; no more than 3 automatic replies per conversation per day.
6. Turn automatic replies off again and confirm the toggle shows off after a page refresh.
7. Search logs for: `Social inbox AI reply fallback` (the AI was unavailable, a generic reply was used), `Fully automatic mode`, `Daily auto-reply limit reached`, `Negative sentiment requires approval`.

## What to tell the assistant, per failure
- Always include: the test number, the time, what you expected, what you saw, a screenshot, and the platform.
- Nothing arrives: say "comment/message did not arrive" (it will check the webhook logs).
- Arrives twice or in the wrong thread: say which.
- Reply shows in the app but not on the platform, or shows as a new post: say which.
- An automatic reply went out when it should not have: switch automation off first, then report.

## Promises the screens make that the code does not keep (gap list)
1. **Replies may become new public posts.** Sending a reply calls the posting function; the comment id is ignored (socialInboxProviderService.js, socialMediaAPI.js). Nothing replies under a comment or sends a real direct message.
2. **"Reply across the original social platform"** (the reply box text) is therefore not true for direct messages. The app also stores the reply as "sent" and marks the conversation "replied" even when sending failed.
3. **No approval queue.** Settings offer "Approval before sending", and the code marks messages "pending approval", but no screen lists messages waiting for approval, and nothing sends them after approval. Approval only exists in the sense that you press Send on a suggestion yourself.
4. **Sync is not real.** Polling is an empty stub, the Sync button only updates a timestamp, and "next sync" is a fixed 15-minute guess. The only delivery path is the Ayrshare webhook.
5. **Webhook security check likely rejects real events.** It demands a signed token in a header or a secret in the URL, but the registered URL carries only the user id (socialInboxController.js, verifyWebhookRequest).
6. **One click turns on fully automatic.** The header robot toggle sets "Fully automatic" for the whole account, not just the one conversation or platform.
7. **Settings that do nothing or are wider than shown.** The "signature" guardrail is saved but never added to replies. "Luxury" and "Playful" tones are offered but the backend only knows its own reply styles. Rule "Regex" is available to customers. The "Assigned user ID" box asks a customer to type an internal id.
8. **Platforms listed that were never set up:** LinkedIn, X and YouTube are shown in filters, toggles and the connected count, but no one has tested receiving or replying on them.
9. **A "Simulate" button** in the inbox list creates a fake "Demo Lead" conversation in a real customer's inbox. It should be hidden before launch (frontend/pages/UnifiedInbox.tsx).
10. **Google reviews tab** is read-only: it lists reviews and drafts replies, but there is no way to post the reply back.
11. **Screens use dark-theme styling and strings** like "Unified Inbox", "AI Assist", "Notification Center" and "real inbox messages", which do not match the light look or plain wording of the rest of the app.
12. **Landing page claim:** step 6 on the landing page and the website copy promise a reply inbox. Hold those lines until Tests 2 and 3 pass.
