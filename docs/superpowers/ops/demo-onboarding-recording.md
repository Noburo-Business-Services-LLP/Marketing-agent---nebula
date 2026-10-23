# Recording the onboarding as Zaya Naturals (development only)

A screen video of the whole onboarding questionnaire, filled in by a script as the demo brand. Nothing paid can run: the backend used for it has dummy provider keys AND a block that refuses every outside web request (`backend/scripts/demo-brand/block-egress.js`). Finishing onboarding normally starts the first plan, the brand memory and the calendar; with the block those calls fail harmlessly.

## One-time: make the throwaway account (new, not yet onboarded)

    cd backend
    node scripts/seed-onboarding-recording.js create --password-file "$HOME/nebulaa-demo-secrets/onboarding-recording.txt"

To record again, run `remove`, then `create` again (the questionnaire only shows for an account that has not finished onboarding).

## Start the safe pair (leave your normal servers on 3200 and 5000 alone)

Backend on port 5100 (all keys dummy, schedulers off, outside requests blocked):

    cd backend
    env PORT=5100 RUN_SCHEDULERS=false RUN_JOB_CONSUMERS=false ENABLE_STUDIO_VIDEO_CONSUMER=false \
      APIFY_API_KEY=x AYRSHARE_API_KEY=x AYRSHARE_PRIVATE_KEY=x CLAUDE_API_KEY=x ELEVENLABS_API_KEY=x FAL_KEY=x GEMINI_API_KEY=x \
      GOOGLE_ADS_API_KEY=x GROK_API_KEY=x GROQ_API_KEY=x OPENAI_API_KEY=x RAZORPAY_KEY_ID=x RAZORPAY_KEY_SECRET=x RESEND_API_KEY=x \
      SCRAPINGDOG_API_KEY=x SERPER_API_KEY=x SES_AWS_ACCESS_KEY_ID=x SES_AWS_SECRET_ACCESS_KEY=x VERTEX_PRIVATE_KEY=x \
      CLOUDINARY_API_KEY=x CLOUDINARY_API_SECRET=x \
      NODE_OPTIONS="--require \"$PWD/scripts/demo-brand/block-egress.js\"" node server.js

Frontend on port 3300 (must be opened as 127.0.0.1, not localhost, so it uses the proxy to port 5100):

    cd frontend
    VITE_BACKEND_URL=http://127.0.0.1:5100 npx vite --port 3300 --strictPort --host 127.0.0.1

## Record

For the agency (Brightwave Media) make its throwaway account first (`node scripts/seed-onboarding-recording.js create --agency --password-file "$HOME/nebulaa-demo-secrets/onboarding-recording-agency.txt"`) and add `--brand agency` to the commands below.

    python3 -I backend/scripts/demo-brand/record-onboarding.py            # English
    python3 -I backend/scripts/demo-brand/record-onboarding.py --lang ta  # Tamil
    python3 -I backend/scripts/demo-brand/record-onboarding.py --lang hi  # Hindi

The video lands in `~/nebulaa-demo-recordings/` (webm). Make an mp4 with the ffmpeg that ships in `backend/node_modules/ffmpeg-static/ffmpeg`:
`ffmpeg -i in.webm -c:v libx264 -pix_fmt yuv420p -crf 18 -movflags +faststart out.mp4`.

## What it does and does not show
- Shows: sign-in is skipped; the form is filled with typing at human speed and a visible cursor; four steps; Finish Setup; the first Home screen with the welcome tour.
- The "business already exists" check is answered locally by the script, because the real demo account already holds the name Zaya Naturals. Nothing on the server is changed by that.
- Home shows a new free account (0 Quarks, no plan). The finished demo look is the seeded Zaya account (`seed-demo-brand.js`).
- Stop the pair when done (Ctrl+C in their terminals). Never run it against production.
