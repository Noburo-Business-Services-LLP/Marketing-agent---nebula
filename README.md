# Nebulaa

Nebulaa is an AI marketing workspace for small businesses: brand profile and plan, post and campaign
generation (text, images, reels and short videos), a content calendar, scheduling and publishing to social
accounts (through Ayrshare), an inbox, competitor tracking, analytics, Quark credits and paid plans (Razorpay),
plus staff, agency and CSM tools.

## Architecture

| Part | What it is |
|---|---|
| `frontend/` | React 19 + TypeScript + Vite single-page app. `vite build` writes to `backend/public`. |
| `backend/` | Node 20 + Express API (`server.js` -> `server-main.js`), MongoDB through Mongoose, Socket.IO / SSE for live updates, ffmpeg, canvas and sharp for media. |
| AI and media providers | Gemini / Vertex, OpenAI, fal.ai, ElevenLabs, Cloudinary (storage). Fixed provider endpoints only; any other link is downloaded through `backend/services/safeFetch.js`. |
| Production | AWS ECS (ap-south-1) behind an application load balancer: the backend image (`Dockerfile.backend`) and the frontend nginx image (`Dockerfile.frontend`). Optional web/worker split with `RUN_BACKGROUND` (`docs/superpowers/ops/ecs-web-worker.md`). |

## Run locally

Requirements: Node 20 (the images use 20.20.2), npm, MongoDB (Atlas or local), ffmpeg on the PATH, Python 3
(`backend/requirements.txt`).

```bash
npm run install:all                      # backend + frontend packages and the Python requirements
cp backend/.env.example backend/.env     # then fill in MONGODB_URI and JWT_SECRET at least
npm run dev:backend                      # API on http://localhost:5000
npm run dev:frontend                     # app on http://localhost:3000
```

On macOS, port 5000 is taken by the AirPlay Receiver: turn it off (System Settings > General > AirDrop & Handoff)
because the frontend calls `localhost:5000`. A single-machine container run with a local MongoDB is in
`docker-compose.yml` (API bound to 127.0.0.1 only).

## Environment

`backend/.env.example` lists every variable with a comment and a safe placeholder. The ones you need to start:

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | session token signing key, at least 32 random characters (start-up refuses without it) |
| `HASH_PEPPER` | key for kept one-way hashes; required in production |
| `FRONTEND_URL` | where links in emails and OAuth redirects point |
| `GEMINI_API_KEY`, `OPENAI_API_KEY`, `FAL_KEY` | AI generation (features that need a missing key fail with a clear message) |
| `CLOUDINARY_*`, `AYRSHARE_*`, `RAZORPAY_*` | storage, social posting, payments |

Scaling and security switches (`RUN_BACKGROUND`, `RATE_LIMIT_STORE`, `TRUST_PROXY_HOPS`, `LIMIT_*`, timeouts,
pool sizes, `NODE_HEAP_MB`, ...) all have safe defaults and are described at the end of `.env.example`.

## Tests

```bash
cd backend  && node --test tests/*.test.js          # backend (no network, no real provider calls)
cd frontend && node --test tests/*.test.mjs && npx tsc --noEmit
node scripts/verify-dockerfile.js                   # static check of the images
```

## Deploy

Production releases are run by the owner with `docs/superpowers/ops/release-prod.sh` (builds both images for
linux/amd64, smoke-tests the backend image with no network, pushes to ECR and updates the ECS services through
`deploy-ecs-release.sh`, printing the rollback command). Security notes and owner steps:
`docs/superpowers/ops/security-hardening.md`.
