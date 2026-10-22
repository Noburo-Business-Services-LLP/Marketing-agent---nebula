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
