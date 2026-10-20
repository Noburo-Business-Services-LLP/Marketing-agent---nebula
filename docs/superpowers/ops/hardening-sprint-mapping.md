# Hardening sprint (tester's master prompt) mapped to this repo, 2026-10-20

Source: `/Users/dineshkannaa/Downloads/NEBULAA HARDE.txt` (written for a Windows rig and a new branch; we keep working on `nebulaa-redesign`, owner pushes/releases). Scores asked: functionality, performance, security each at least 80.

| Item | Status | Where |
|---|---|---|
| A1 global sanitiser removed, escape on output | done (emails: in the running security job) | commit `696b65a` |
| A2 trust proxy hops | done | `TRUST_PROXY_HOPS`, ecs doc |
| A3 CORS returns 403 | done | `middleware/corsPolicy.js`, D49 |
| A4 central error mapping, no `error.message` leaks, ObjectId param validation | done, `routes/auth.js` included (off every skip list) | `utils/httpError.js`, `validateObjectId.js`, `queryGuard.js`, D47, D48 |
| A5 `/api/ready` | done | `3b2dbf0` |
| A6 crash policy / graceful shutdown | done (crash policy; SIGTERM drain kept) | `utils/crashPolicy.js`, D55 |
| A7 pino logging, A8 compression and cache headers | done (pino + pino-http, compression, immutable assets; ~1,700 other console calls left on purpose) | `utils/logger.js`, `middleware/requestLogger.js`, `compression.js`, `staticCache.js`, D57, security-hardening.md section 11 |
| A9 CSP report-only, A10 body limits and timeouts | RUNNING (security backend job) | |
| B1 native bcrypt through a semaphore | done | `02dcf4f`, D25 |
| B2 auth limiter scoped | done | `da7ab96` |
| B3 enumeration | done (sign-up duplicate message kept on purpose) | D50, security-hardening.md section 10 |
| B4 lockout per email + address, owner email at the ceiling | done (`LOGIN_CHALLENGE` hook off, no screen) | `services/loginGuard.js`, D51 |
| B5 `tokenVersion` | done earlier (logout-all and jti denylist not built) | D46 |
| B6 strict bearer | done | `utils/bearer.js`, D53 |
| B7 demo bypass and boot fail-fast | done | `utils/bootEnv.js`, D53 |
| B10 password policy and admin bootstrap | done (curated 268-entry list, not 10k; staff MFA not built) | `utils/passwordPolicy.js`, D54 |
| B8 fast protect | done in a smaller safe form (`protectCached` on 6 GETs) | D26 |
| B9 cookie sessions behind a flag | TODO (big) | |
| C1 limits.js, C2 route table, C3 internal triggers | RUNNING | |
| C4 `safeFetch` SSRF | done (20 call sites, older guards share the rules, guard test) | `services/safeFetch.js`, D59, security-hardening.md section 12 |
| C5 per-user job caps | partly (image jobs done, rest in the running job) | |
| D1 to D4 lists, calendar GET, parallel queries | done | week-1 doc |
| D5 duplicate index warning | done | `BrandIntelligenceProfile.userId`, `schemaIndexes.test.js` |
| E1 RUN_BACKGROUND | done | `7d5d115` |
| E2 lease lock around every scheduler tick | done (14 ticks wrapped, existing leases kept, 3 queue consumers allowlisted) | `services/leaseLock.js`, `models/JobLease.js`, D56 |
| E3 OAuth state in Mongo, E4 image jobs persisted | done | |
| E5 Redis adapter | optional loader done | |
| E6 container hardening, E7 ECS docs | done (nginx image stays root: owner decision) | `Dockerfile.backend`, `backend/docker-entrypoint.sh`, `scripts/verify-dockerfile.js`, D60 |
| F1 safeHref, F2 DOMPurify, F4 code splitting | done | |
| F3 build-time Tailwind | done: Tailwind 3.4.17 (the CDN's version) built by PostCSS in `vite build`, CDN script, inline config and esm.sh import map removed; about 100 KB gzip less on every first load; 21 screens pixel-identical at 1280 and 375 (dev and production builds), contrast audit unchanged (147 / 70); CSP report-only drops the two hosts | `frontend/tailwind.config.js`, `tests/tailwindBuild.test.mjs`, frontend-performance.md, D67 |
| F5/F6 UI, G1 zero failing tests | green on Linux/Mac now (backend 2,959 and frontend 870 pass; `tsc --noEmit` has 0 errors) | |
| G2 HTTP suite | done in a smaller form: no supertest or mongodb-memory-server (not installed); the whole app is loaded in process and called over real HTTP with in-memory stand-ins. Probe pack P1 to P20 (18 tests) plus the metrics route | `backend/tests/http/`, `regression-probes.md`, D63, D64 |
| G3 CI | done, not yet run on GitHub (Node 20 backend, Node 24 frontend tests, gitleaks binary scanning the change) | `.github/workflows/ci.yml`, `.gitleaks.toml`, D65 |
| G4 ESLint | done: 0 errors both sides; warnings are the baseline (backend 1,934, frontend 1,744, mostly `no-console` and `no-explicit-any`); 34 empty catches log at debug; 8 real bugs fixed | `eslint.config.js` in each package, `regression-probes.md` (Lint baseline), D65 |
| G8 advisories | done (uuid override, audit 0 in both, Node 20.20.2 pinned); CI now fails on high or critical (`npm audit --omit=dev --audit-level=high`) | D62, D65 |
| G6 hygiene (stray scripts, hard-coded Ayrshare key: HUMAN rotation) | done (16 files deleted, README, .env.example; key rotation is the owner's) | D61, security-hardening.md section 12 |
| G7 secret fallbacks | done (`HASH_PEPPER`, old tombstones still match) | `utils/hashPepper.js`, D52 |
| H1 fake providers | TODO (not needed by the local tools: nothing calls a provider; `FAKE_PROVIDERS` not built) | |
| H2 load tools | done as `backend/scripts/loadtest/` (dependency-free runner, mixed-flow runner, in-process server with stand-ins, staff-only `GET /api/metrics/event-loop`); not `qa-reports/tools/` (that folder is not in this repo) | `loadtest.md`, D66 |
| H3 targets | the table is in `loadtest.md`; a 5 s smoke meets every row `mixed.js` covers (app layer only, no database); soak, 50 req/s column, upload, write flows and the two-process run are not run | `loadtest.md` |
| H4 reports | TODO | |
