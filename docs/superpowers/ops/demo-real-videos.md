# Real videos for the demo account (Zaya Naturals)

The drawn demo videos were not good enough, so the six videos shown in the demo are made for real in the dev app, as the demo user, with Gemini Omni (about USD 1 per 10-second clip). Nothing here is run by an agent: the owner clicks Create video six times. After that `node scripts/demo-real-videos.js adopt` makes the demo keep them.

## Preflight (traced 2026-10-22, decision D126)

Can the demo account run Create video? Yes, with one fix (done) and the dev setup below.

| Check | Finding |
|---|---|
| Demo guards (`services/demoProfile.js`) | They only intercept requests that carry a `demo-` social profile key (nothing is sent to the social networks) and keep background jobs off the demo account. Create video is not a social call and runs in the request itself (`setImmediate` in `routes/studioVideos.js`), so nothing blocks or fakes it. |
| Reference photos (REAL BLOCKER, fixed) | The Videos flow downloads reference photos over public https only. The demo's product, people and place photos are `http://localhost:5000/demo-assets/...`, so they were silently dropped and the clip would have been made without the product photo. Fixed: `readDemoReference` reads those exact demo pictures (products, people, places, brand folders, jpg or png, up to 6 MB) straight from `backend/demo-assets/zaya` and never in production (tests: `tests/demoReference.test.js`). |
| Logo on the video | The brand logo is a local link too, and the finishing pass fetches logos over https only, so the logo is skipped quietly. In the video form leave Logo off (or accept that none appears). Subtitles and the closing line still work. |
| `ENABLE_STUDIO_VIDEO_CONSUMER` | Must be unset or OFF. With it ON the video is only queued and nothing runs it in a single dev server. |
| `RUN_BACKGROUND=0` | Correct for this (the stale-video sweep does not run, which is fine for six clips). Start the backend exactly as in "Start the dev app". |
| Two at once | At most 2 videos in progress per account ("Two videos are already being made"); start two, wait, start two more. Limit 30 creates per hour is not a problem. |
| Quarks | A 1-clip video costs 161 Quarks, so six cost 966 of the 1,355 in the wallet. Enough. |
| Spend guard | `AI_KILLED` must not contain `google_video`; `AI_DAILY_SPEND_CAP_USD` must not be reached (default 150); no staff switch for Google video turned off on the dev database. If you see "busy", check these. |
| Keys needed in the dev environment (not read by the agent) | `GEMINI_API_KEY` (Omni), a text model key for the free "Plan the video" step, and Cloudinary settings (finished clips are stored with `uploadVideoFile`). Without Cloudinary the video fails and the Quarks are returned. |
| Database disk | The Atlas cluster once hit its write-blocking disk limit (see memory). If Create video says it could not start, check the Atlas disk first. |
| Failed videos | Quarks are returned automatically; no money is lost besides what Google already billed. |

## The six entries (paste as written)

Common settings: shape Vertical (9:16), length 1 clip (10 seconds), platforms Instagram and YouTube, Logo off, Subtitles on if offered. The style names below are the tiles in the Videos page (keys from `backend/services/studioVideo.js` in brackets). The spoken line is said once (say-it-once rule): paste it into the spoken line box after planning, replacing what the plan suggests, and keep it to about 15 to 20 words so it fits 10 seconds. Voice is chosen per entry. Reference photos are in `backend/demo-assets/zaya/`.

### 1. Kumkumadi serum, the product reveal
- Style tile: Product Showcase (`product-showcase`). Language: English. Voice: Female.
- Reference photo: `products/kumkumadi-glow-serum-1.jpg` (and `products/kumkumadi-glow-serum-2.jpg`).
- Idea to paste: `A slow, calm reveal of the Kumkumadi Glow Serum, 30 ml, Rs 1,299. The amber bottle sits on a warm, softly lit shelf with a few saffron strands and sandalwood. The camera moves in slowly, a hand lifts the bottle and a single golden drop falls from the dropper. Warm, honest, a little poetic.`
- Spoken line: "Saffron, manjistha and sandalwood. Three drops every night. Kumkumadi Glow Serum, from Zaya Naturals."
- Expect: the bottle matching the photo, warm golden light, a drop from the dropper, a calm female voice. Check: the bottle shape and label colour look like the photo, no extra text or wrong brand name, the line is said once, the end is not cut mid-word.

### 2. Saffron and Sandal clay mask, the ritual
- Style tile: Get Ready With Me (`get-ready-with-me`). Language: English. Voice: Female.
- Reference photo: `products/saffron-sandal-face-mask-1.jpg` and the person `people/model-aarthi.jpg`.
- Idea to paste: `A Sunday glow ritual: Aarthi, relaxed at her bathroom mirror, mixes the Saffron and Sandal Face Mask (100 g, Rs 749) with rose water, spreads it on her face, smiles while it rests, then rinses and touches her glowing cheek. First person, natural morning light, calm and unhurried.`
- Spoken line: "Mix with rose water, ten minutes of rest, then rinse. My Sunday glow, with the Saffron and Sandal mask."
- Expect: a relaxed routine in steps, the pot matching the photo. Check: the face and hands look natural, the mask colour is a warm sand tone (not green), the product name is not misspelled on screen, one clean line of speech.

### 3. Diwali Glow Gift Box, the festive offer
- Style tile: Festive Campaign (`festive-campaign`). Language: English. Voice: Female.
- Reference photo: `products/lip-balm-trio-1.jpg` and `products/kumkumadi-glow-serum-2.jpg`.
- Idea to paste: `Warm Diwali atmosphere with diyas and fairy lights. A hand ties a sage-green ribbon around a hand-wrapped cotton gift box holding the Kumkumadi serum, the Saffron and Sandal mask, the Rose Petal Toner and a lip balm. The box is Rs 1,999 with free shipping across India. Cosy, family warmth, golden light.`
- Spoken line: "The Diwali Glow Gift Box. Four of our favourites, wrapped by hand, one thousand nine hundred ninety-nine rupees, free shipping across India."
- Expect: diyas, golden light, a wrapped box. Check: the price is spoken correctly, the box contents are plausible (the exact four products will not match exactly, that is acceptable for the demo), no festival symbol is misused.

### 4. Neem and turmeric, the ingredient story
- Style tile: Behind the Scenes (`behind-the-scenes`). Language: English. Voice: Female.
- Reference photo: `products/neem-turmeric-cleanser-1.jpg` (and `products/neem-turmeric-cleanser-2.jpg`).
- Idea to paste: `The story of the Neem and Turmeric Cleanser (120 ml, Rs 449): close shots of fresh neem leaves, a stone bowl of turmeric powder and tulsi leaves, hands mixing, then the cleanser bottle on a wooden tray. Natural daylight, authentic, quietly proud of where it comes from.`
- Spoken line: "Neem, turmeric and tulsi, the way paati used them. Now in a gentle daily cleanser. Skin care that remembers where it came from."
- Expect: macro shots of leaves and powder, then the bottle. Check: ingredients are the three named, the bottle matches the photo, the tagline is said once at the end.

### 5. Bakuchi Night Repair Cream, testimonial style
- Style tile: Testimonial (`testimonial`). Language: English. Voice: Female.
- Reference photo: person `people/model-aarthi.jpg` and product `products/bakuchi-night-repair-cream-1.jpg`.
- Idea to paste: `Aarthi, a customer in her kitchen at Chennai in soft evening light, holds the Bakuchi Night Repair Cream (50 g, Rs 1,099) and speaks to the camera in one relaxed shot, honest and warm, no hard selling.`
- Spoken line: "I was unsure about night creams. After three weeks of Bakuchi, my skin feels calm and soft in the morning."
- Expect: a single steady shot of a woman speaking naturally, jar visible. Check: lips match the line, the line is said once, no claim beyond "feels calm and soft" appears, the jar matches the photo.

### 6. Gift hamper, the unboxing
- Style tile: UGC Unboxing (`unboxing`). Language: English. Voice: Female.
- Reference photo: `products/lip-balm-trio-1.jpg`, `products/rose-petal-toner-1.jpg` and `places/product-shelf.jpg`.
- Idea to paste: `A phone-filmed unboxing of the Zaya Diwali Glow Gift Box: hands open a cotton-wrapped box tied with a sage ribbon, lift out the serum, the Rose Petal Toner and the Lip Balm Trio, and smile at the packaging. Natural window light, casual, authentic.`
- Spoken line: "Okay, the packaging is beautiful. Serum, toner, and the lip balm trio. This is such a thoughtful gift."
- Expect: hands opening a box, handheld feel. Check: products resemble the photos, the box is not branded with a wrong name, the line is said once.

Not every attempt will be perfect: the plan step is free to retry, and a failed video returns its Quarks. If a result is wrong in one detail, use the video's own change request ("make it evening", "slower") rather than a new create.

## Start the dev app

1. Backend: `cd backend && nvm use 20 && RUN_BACKGROUND=0 PORT=5000 npm run dev` (do not set `ENABLE_STUDIO_VIDEO_CONSUMER`).
2. Frontend: `cd frontend && nvm use 24 && npx vite --port 3200 --strictPort`.
3. Open http://localhost:3200 and log in as `demo-zaya@example.test` (the password is in the password file from the last `create`; hard refresh after any rebuild).
4. Videos page, Create video. For each entry below: pick the style tile, set language, voice and shape, attach the reference photo(s) (use the product picker or Brand assets), paste the idea, click Plan the video, check the plan, Create video. Length 1 clip = 10 seconds. Leave Logo off.

Cost: 6 clips x about USD 1 = about USD 6 to 7 (including a retry or two).

After the six are made (and you are happy with them), run:

    cd backend && nvm use 20 && node scripts/demo-real-videos.js adopt                       # dry run, shows the plan
    CONFIRM_ADOPT=yes node scripts/demo-real-videos.js adopt                                  # does it

Rule: after the six are made run `node scripts/demo-real-videos.js adopt`. Until then a rebuild (`seed-demo-brand.js create`) still wipes real videos; adopt makes the seed keep them.
