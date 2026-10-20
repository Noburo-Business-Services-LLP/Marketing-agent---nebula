# Demo account for the Nebulaa demo video: "Nilaa Botanics" (plan, 2026-10-20)

Owner's request: a FAKE account with complete data, as if a D2C company had used Nebulaa for a few months, so a demo video can show every workflow: profile, products, connected social accounts, learning, plan, calendar, posts in every state, performance, competitors, inbox, photoshoot, videos, billing. Built ONLY on the development database (`nebulaa_dev`) through a seed script that refuses any other database, in the style of `backend/scripts/seed-demo-agency.js` (create / remove, idempotent, `@example.test` email, password written only to a scratchpad file, never printed, no payment/AI/image/network call). The demo is recorded from the dev app (`http://localhost:3200`, backend on 5000), never from production.

## The brand (the assistant's call, easy to rename: one constant)
- **Nilaa Botanics**, Chennai, a direct-to-consumer ayurveda-inspired skincare and haircare brand ("clean, not clinical"). Founded 2022. Sells through its own website and marketplaces. Tagline: "Skin care that remembers where it came from."
- Voice: warm, knowledgeable, honest, a little poetic; English with light Tamil touches; customers: women 22 to 38 in metro India, some men (a small unisex line).
- Palette: plum #3B1F3A, rose gold #C98B7B, cream #FBF3EA, sage #8AA17D. Fonts: a serif display with a clean sans.
- **Products (8):** Kumkumadi Glow Serum 30 ml (Rs 1,299), Saffron and Sandal Face Mask 100 g (Rs 749), Rose Petal Toner 150 ml (Rs 549), Neem and Turmeric Cleanser 120 ml (Rs 449), Bakuchi Night Repair Cream 50 g (Rs 1,099), Tinted Mineral SPF 40 50 ml (Rs 699), Coconut and Hibiscus Hair Oil 200 ml (Rs 599), Lip Balm Trio (Rs 399). Each with description, key ingredients, benefits, 2 to 3 pictures.
- Competitors (all FICTIONAL, no real brands): Kaya Veda, Pure Petal Co, Ritu Organics, Glow Ghar, Amla and Ash.

## Timeline: the account is about 5 months old
Created in May 2026; Growth plan renewed monthly (top-up bought once); Publish, Competitors and Inbox add-ons held; Quarks balance healthy but not full; four monthly calendars (June to September done, October in progress).

## Data inventory (every screen needs real-looking data)
1. **Account and profile:** verified user, onboarding complete, `plan.tier = professional` (Growth) + add-ons, payment history (5 renewals + 1 top-up), consent versions current, tour completed, new questionnaire shape (sell to consumers; reach: State, All India; industry beauty and personal care; goals; voice; languages English + Tamil mix), accountKind one business.
2. **Brand assets:** logo (generated locally), colours, fonts, people (founder + two models as characters), places (studio, shelf), products linked.
3. **Social accounts connected (fake):** Instagram @nilaa.botanics (about 34k followers), Facebook page, YouTube channel, LinkedIn company page; shown as Connected with plausible follower counts, WITHOUT any call to the real Ayrshare API (guard: the demo profile key is fake; find every read that would call the provider and make the demo user use stored data only).
4. **Plan and strategy (My plan funnel):** business, products, customers (ICP with 3 segments), positioning, marketing mix, channels (online + offline: pop-ups, salon partnerships, influencer gifting, WhatsApp, referrals), content pillars (ritual and ingredients, skin education, founder story, customer glow stories, offers), 90-day roadmap, numbers to watch. Plus a finished Brand Growth Blueprint.
5. **Brand memory (What Nebulaa learned):** learned items from all six sources with evidence counts (plan, Blueprint, customers, products, results, competitors) so the learning page is full.
6. **Calendar:** monthly plans with theme, cover (locally generated), items; posts planned and linked.
7. **Posts (Library, Review and approve):** about 90 drafts in every state: needs approval (8, mixed manual and automation), approved, scheduled (10 over the next 2 weeks), posted (about 60 across 4 months), archived, bin (3). Each with an image (locally generated product posters with headline text, in brand colours), caption, hashtags, platforms, plausible dates.
8. **Performance:** per-post metrics (reach, likes, comments, saves, shares) for the posted ones with a believable growth curve, daily snapshots for followers and reach over 90 days per platform, best post of the month, format and best-time patterns so "What works" has findings with evidence counts.
9. **Competitors:** 5 tracked, avatars (initial fallback acceptable or local images), 12 weekly snapshots each, best posts with pictures, "what worked" lines.
10. **Inbox:** 25 conversations (comments and DMs from Instagram and Facebook): product questions, price questions, a complaint, praise, an order status ask, a collaboration offer; some answered, 3 waiting for approval with drafted replies, a few auto-replied; the settings in "approval before sending" mode.
11. **Photoshoot:** 3 finished jobs (product photoshoot, festival pack, flat lay) with generated photos; Library shows them.
12. **Videos:** 4 finished studio videos (short product clips made locally from the product pictures with slow zoom and title text using ffmpeg-static, 9:16 and one 16:9) plus a 20 s one with finishing.
13. **Home:** numbers strip real, "Do this next" rows (approve 8 posts, reply to 3 messages), this week, competitor tiles, trending ideas, create tiles.
14. **Billing:** Settings > Billing shows the plan, add-ons, payments, top-up, Quark balance and "What things cost".
15. **Reviews (Google):** 6 reviews if the reviews panel reads stored data; otherwise skip and say so.

## Hard rules
No paid or provider call; dev database only; no real social API; no `.env` reads; fake email `demo-nilaa@example.test`; every image and video generated locally (node-canvas/sharp/ffmpeg-static) and stored where the dev app can serve it WITHOUT shipping into the production frontend image (for example a git-ignored folder served by the dev backend only when not in production, or an uploads folder the app already serves; decide in the impact map); never touch other accounts; the `remove` mode deletes exactly what `create` made; the data must pass the app's own read paths (open every screen with it).

## Build stages
- Stage 1 (skeleton): constants, safety, `create`/`remove`, account + profile + plan + payments + assets + products + connected socials + image generator + docs; proves login and the first screens.
- Stage 2 (content): calendar, drafts, campaigns, performance, brand memory, plan and Blueprint.
- Stage 3 (conversations and media): competitors, inbox, photoshoot, studio videos, reviews.
- Stage 4: walk through every screen in the browser with the demo login, fix anything empty or wrong, write the demo script (the order of screens and what to say) at `docs/superpowers/ops/demo-script.md`.
