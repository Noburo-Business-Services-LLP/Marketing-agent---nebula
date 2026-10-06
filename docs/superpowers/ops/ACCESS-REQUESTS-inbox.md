# Access requests for the Inbox features (Meta and Google)

Written 2026-10-06. These are requests only the account owner can submit. Platform rules change often, so check each item against the current Meta and Google documentation before submitting; where this page is unsure, it says so.

## Before either request: things reviewers always look for

1. **Public privacy policy** that names what data is read (comments, messages, reviews), why, how long it is kept, and how a user deletes it. The app has `/privacy-policy`; read it and make sure it covers social messages and reviews and gives a contact for deletion.
2. **Terms page** (`/terms` exists).
3. **A data-deletion instruction or callback** that Meta can open (a page that says how to delete data, or an endpoint). Check whether the current privacy page already says this; if not, add a short section.
4. **A working demo** the reviewer can use: a test account, a screen recording of the full flow with no cuts, narrated or captioned.
5. **A verified business** on Meta Business Suite (business verification with legal documents) and on Google (a verified business profile you can show).
6. **Honest use description.** Say plainly: Nebulaa lets a business reply to comments, messages and reviews on its own accounts, with human approval by default and automatic replies only when the owner switches them on.

## A. Meta (Instagram and Facebook): comments and messages

The app already reads `META_APP_ID`, `META_APP_SECRET`, `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET`, so a Meta app exists. First find out which app it is and whether it is in Development or Live mode (developers.facebook.com, App settings). Use that same app.

Permissions to request (names as I know them; confirm the exact current names in the App Review screen):
- Instagram: read and reply to **comments**; read and send **messages** (including private replies to a comment); read basic profile and media.
- Facebook Pages: read **comments and engagement** on page posts; send and receive **page messages**.

For each permission the form asks for:
- **Use case, one paragraph.** Suggested wording: "A small business connects its own Instagram or Facebook account to Nebulaa. Nebulaa shows incoming comments and messages in one inbox. The business owner reviews an AI-drafted reply and approves it, or turns on automatic replies for common questions. Messages are only sent in reply to a person who contacted the business, within Meta's allowed messaging window."
- **Step-by-step instructions** for the reviewer: log in with the test user, connect the test account, open Inbox, open a comment, approve a reply.
- **Screen recording** of exactly that, showing the permission dialogs.

Rules that shape what you may promise customers (check current Meta policy):
- Comment-to-message ("comment GUIDE and get the link") works through Meta's **private reply** to a comment: one private reply per comment, within a limited number of days after the comment.
- Free-form follow-up messages are allowed only within **24 hours of the person's last message**. After that only approved message tags or templates apply.
- Do not promise "follow us first to receive it" as an automatic check until it is confirmed that the platform lets an app verify a follower. The safe flow asks the person to confirm in the message.
- Expect the review to take days or weeks and to be sent back at least once. Keep the test account working throughout.

## B. Google Business Profile: posts and reviews

Google gates its Business Profile APIs behind an access request. As I understand it:
1. Use the Google Cloud project you want this in. The existing OAuth client in the app (`GOOGLE_CLIENT_ID`) is for sign-in and YouTube; decide whether to reuse that project or create a clean one, and **do not** use the Atomss project that is still sorting out billing.
2. Submit Google's Business Profile API access request form with: your business details and website, the project number, the use case, and the contact email. Mention the exact scope you need (managing posts and reviews for profiles the user owns) and that the user signs in with their own Google account.
3. Once approved, enable the Business Profile APIs on the project and add the Business Profile scope to the OAuth consent screen. The consent screen for a sensitive scope also needs its own review, with a short demo video and the privacy-policy link.
4. Every customer then connects their own profile through a normal Google sign-in; nothing is shared between customers.

Alternative that avoids both reviews: if Ayrshare supports Google Business Profile posts and reviews on the plan you end up on, Ayrshare holds the approvals and Nebulaa only calls Ayrshare. Ask them in the same email as the plan question. That is probably the fastest route for posting; reviews support is the thing to confirm.

## C. Questions to put to Ayrshare (one email)

1. Which plan is needed for client profiles (the managed-service model with many client accounts under one company)?
2. Which of these does that plan include: Google Business Profile posting; reading and replying to Google reviews; reading comments; replying to comments; direct messages on Instagram and Facebook; LinkedIn first-comment?
3. Any limits on the number of profiles, API calls, or auto-replies?
4. Why does the renewed account still show the basic plan, and when will it update?

## D. What the owner needs to prepare (checklist)

- [ ] Find which Meta app the product uses; note its mode (Development or Live)
- [ ] Meta Business verification complete
- [ ] Privacy policy covers social messages, comments and reviews, retention and deletion; data-deletion page or callback exists
- [ ] Test Instagram professional account and test Facebook page connected to a test user
- [ ] Screen recordings: connect an account, see a comment and a message in the Inbox, send an approved reply
- [ ] Google: choose the project; submit the Business Profile API access request
- [ ] Send the Ayrshare email in section C
