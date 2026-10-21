# Demo script: Zaya Naturals on Nebulaa (about 11 minutes)

Written 2026-10-21 after walking every screen of the demo account in the built-in browser at desktop width and at phone width (375 px). Everything below is what was actually on screen that evening. Numbers move a little each time you run `create` (dates are counted back from today), so say "about" and read them off the screen.

## The story in one line
Zaya Naturals is a small Chennai skincare brand, five months into Nebulaa on the Growth plan. Nebulaa has already made its plan, its posts, its videos and its photos, watches the competitors, drafts the replies, and learns from the results. The owner's morning is: look, approve, reply.

## Before you press record (5 minutes)
1. Start the backend on port 5000 and the app on port 3200 (the old app on port 3000 is not this one). To show the Photoshoot page without the line "Photoshoots are not switched on for your account yet", start the backend with `ENABLE_PHOTOSHOOT=on` (this only opens the page; nothing is made unless you press Create photos).
2. Refresh the demo so the dates are today's (the bell only shows the last 24 hours, so do this on the recording day):

       cd backend
       source ~/.nvm/nvm.sh && nvm use 20
       node scripts/seed-demo-brand.js create --password-file /absolute/path/outside/the/repo/demo-zaya-login.txt

   It takes about 30 seconds, makes no payment, AI or social call, and keeps the account and password. The first run for a new account needs the `--password-file` (the password is written only there).
3. Full reset from scratch (new account, new password file, everything redrawn): `node scripts/seed-demo-brand.js remove` and then the `create` command above. After a `remove` and `create` the old browser login is dead, so sign in again.
4. In the browser: sign in at http://localhost:3200 with `demo-zaya@example.test` (password in the password file), then hard refresh once (Cmd+Shift+R) so the browser does not show pictures from an earlier run. Use a 1280 px wide window.
5. Check Home shows 8 posts waiting, 7 unread messages, and the bell has a number on it.

## Never click these (they spend Quarks, post, send or approve)
- Library: **Approve**, **Schedule**, **Change time**, **Post now**, **Make again**, **Restore**, **Delete**, and **Review one by one** (opening is safe, but one wrong click approves).
- Inbox: **Approve and send**, **Send**, **Use this** (then Send), **Discard**, the automatic replies switch, **Save settings**.
- Create: **Create post**, **Create photos**, **Next** on the video page, anything with a Quark price on the button.
- Plan: **Refresh my plan**, **Turn into a post**, **Create a Blueprint**, **Download the designed PDF** (499 Quarks), **Use this plan in my calendar**.
- Insights: **Refresh now**, and every **Open post** / **Open the post on Instagram** link (the pictures and links are made up, those pages do not exist on Instagram).
- Setup: **Disconnect**, **Cancel plan**, **Delete my account**, **Save changes**, **Refresh my brand details**.
- Settings > Billing: the Invoice column shows a dash for every payment (no invoice files exist), so do not scroll to it slowly.
- Google reviews says "Needs setup". It is not part of the demo data. Skip it or say "this connects to a Google Business profile".

## The walk (about 11 minutes)

### 1. Home (1 min 30)
Say: "This is Zaya Naturals on a Wednesday evening. One screen tells the owner what needs her."
- Top right: the Quark pill, about 1,355 Quarks, "enough for about 123 posts or 8 videos".
- The numbers strip: Reach about 93,000, Engagement 4.6%, Followers 52,550 across four accounts, Posts this week 4, Needs approval 8, Unread messages 7.
- "Do this next": Approve 8 posts and Reply to 7 messages. Do not click Review or Reply yet.
- "This week" (a carousel suggestion from the plan) and the Today's plan row.
- Scroll: "Your competitors" (five tiles with pictures), "What's working for your competitors", "Trending for you". Say: "Nebulaa watches five competitors every week and turns what works for them into ideas."

### 2. Plan (2 min)
Click Plan.
- **My plan**: "The plan Nebulaa made from the business details." Point at "Skin care that remembers where it came from", 7 channels, 5 content themes, 9 of 9 parts ready. Open one or two parts (Customers, Channels and who does what): it says what Nebulaa does and what the owner does.
- **Calendar**: October, "Navratri to Diwali: gifting begins", 18 planned, 18 approved. Click **Schedule**: posts on the days, platform dots, "19 posts this month, 8 awaiting approval".
- **Content ideas**: seven saved ideas. Do not press Turn into a post.
- **Blueprint**: one ready Blueprint. Open it (free to read): nine tiles, then back.

### 3. Create (1 min 30)
Click Create.
- **Create content**: six formats with their prices (single post 11 Quarks, video 161). Say: "The price is always shown before anything is made." Do not press Create post.
- **Create video**: "Your videos": five finished videos. Say: "Describe it once, Nebulaa writes the script and makes every scene."
- **Photoshoot**: six packs with prices, then scroll to the festival pack (4 photos, saved to Library) and "Earlier photoshoots" (3 in all).

### 4. Library (2 min)
Click Library.
- The tabs: Needs approval 8, Approved 4, Scheduled 10, Posted 55, Archived 6, Bin 3. Say: "Nebulaa never posts by itself; approving only schedules."
- Needs approval: click a picture to open the sheet (caption, hashtags, platforms). Close it with the X.
- **Posted**: scroll; press Load more once if you want more.
- Click **Videos**, click a video tile, press Play (11 seconds). Close.
- Say: "Every post, video and photo in one place."

### 5. Inbox (1 min 30)
Click Inbox.
- "Waiting for your approval 3": a shade question, an angry customer with a leaked serum, and a Hinglish bulk-order query, each with a drafted reply. Say: "Nebulaa drafts, the owner approves. Nothing goes out without a yes." Do not press Approve and send.
- Scroll to the list (25 conversations, 7 unread, Tamil and Hindi mixes). Click one comment (for example Kavitha Ramesh) to open the thread; wait a second for the suggested reply to load.
- **Automatic replies**: "Each reply waits for your approval."

### 6. Insights (2 min)
Click Insights.
- **Performance**: switch **This week / This month / Last 90 days** (watch New followers and Posts published change; Reach and Engagement are the accounts' own 30 day figures, so they stay the same). Scroll to By platform (Instagram 34,280, Facebook 12,940, YouTube 3,870, LinkedIn 1,460; X not connected), Top posts, What works (reels do best, Friday is the best day), What to try next. Click the Instagram tile to filter.
- **Competitors**: five cards, their best posts with pictures, "Reels got about 2.4 times the likes".
- **What Nebulaa learned**: 25 things from 6 sources, each with what backs it. Say: "This is why the posts sound like her brand."

### 7. Setup (1 min)
- **Brand assets**: 6 of 6 set up: logo, colours, Playfair Display, three people, two places, 8 products.
- **Connected accounts**: Instagram, Facebook, LinkedIn and YouTube connected; X and Google Business not.
- **Settings > Business profile** (filled in), **Billing**: Growth plan active, 1,355 Quarks remaining, "What things cost", the 12 payments.
- Click the bell (two new notifications) and Help, then end on Home. Say: "That is Nebulaa from the owner's side: look, approve, reply, and the rest is done for her."

## Phone view (optional 30 seconds)
Open the browser at 375 px: Home, Library and Inbox stack cleanly with no sideways scrolling. On the phone the two status badges on Library pictures cover part of the headline; avoid close-ups there.

## If something looks wrong
- Numbers or pictures from an older run: hard refresh, or run `create` again and wait one minute (Home is cached for 60 seconds).
- Signed out after a `remove` and `create`: sign in again with the new password file.
- The bell is empty: run `create` again (notifications are only listed for 24 hours).
- The Photoshoot page says "not switched on for your account yet": restart the backend with `ENABLE_PHOTOSHOOT=on` (see the checklist above).
