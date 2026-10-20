# Hardening sprint (tester's master prompt) mapped to this repo, 2026-10-20

Source: `/Users/dineshkannaa/Downloads/NEBULAA HARDE.txt` (written for a Windows rig and a new branch; we keep working on `nebulaa-redesign`, owner pushes/releases). Scores asked: functionality, performance, security each at least 80.

| Item | Status | Where |
|---|---|---|
| A1 global sanitiser removed, escape on output | done (emails: in the running security job) | commit `696b65a` |
| A2 trust proxy hops | done | `TRUST_PROXY_HOPS`, ecs doc |
| A3 CORS returns 403 | done | `middleware/corsPolicy.js`, D49 |
| A4 central error mapping, no `error.message` leaks, ObjectId param validation | done except `routes/auth.js` (other change: its codemod and id check are listed in security-hardening.md section 9) | `utils/httpError.js`, `validateObjectId.js`, `queryGuard.js`, D47, D48 |
| A5 `/api/ready` | done | `3b2dbf0` |
| A6 crash policy / graceful shutdown | SIGTERM drain done; unhandledRejection policy TODO | |
| A7 pino logging, A8 compression and cache headers | TODO (nginx gzip and immutable assets already set) | |
| A9 CSP report-only, A10 body limits and timeouts | RUNNING (security backend job) | |
| B1 native bcrypt through a semaphore | done | `02dcf4f`, D25 |
| B2 auth limiter scoped | done | `da7ab96` |
| B3 enumeration, B4 lockout, B5 `tokenVersion`, B6 strict bearer, B7 demo bypass and boot fail-fast, B10 password policy | TODO | |
| B8 fast protect | done in a smaller safe form (`protectCached` on 6 GETs) | D26 |
| B9 cookie sessions behind a flag | TODO (big) | |
| C1 limits.js, C2 route table, C3 internal triggers | RUNNING | |
| C4 `safeFetch` SSRF | TODO | |
| C5 per-user job caps | partly (image jobs done, rest in the running job) | |
| D1 to D4 lists, calendar GET, parallel queries | done | week-1 doc |
| D5 duplicate index warning | done | `BrandIntelligenceProfile.userId`, `schemaIndexes.test.js` |
| E1 RUN_BACKGROUND | done | `7d5d115` |
| E2 lease lock around every scheduler tick | TODO (single-runner leases exist per job) | |
| E3 OAuth state in Mongo, E4 image jobs persisted | done | |
| E5 Redis adapter | optional loader done | |
| E6 container hardening, E7 ECS docs | E7 done, E6 TODO | |
| F1 safeHref, F2 DOMPurify, F4 code splitting | done | |
| F3 build-time Tailwind | TODO (risky) | frontend-performance doc |
| F5/F6 UI, G1 zero failing tests | green on Linux/Mac now | |
| G2 supertest HTTP suite, G3 CI, G4 ESLint, G8 advisories | TODO | |
| G6 hygiene (stray scripts, hard-coded Ayrshare key: HUMAN rotation), G7 secret fallbacks | TODO | |
| H1 fake providers, H2 load tools, H3 targets, H4 reports | TODO | |
