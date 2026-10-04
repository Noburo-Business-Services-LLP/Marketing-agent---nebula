# Brand Growth Blueprint Implementation Plan

> **For agentic workers:** Execute task by task (one implementer subagent per task; one final review at the end, as the owner asked for cost reasons). Steps use checkbox syntax. Read the spec and the owner's skill first; this plan names every file, function and value.

**Goal:** A free, printable Brand Growth Blueprint (cover, nine pages, closing page) made from a short form plus what can be verified on the public web, offered two ways: as a lead magnet (ad, landing section, free sign-up with 100 Quarks, email verification, one Blueprint per verified email and per business, fully automatic) and inside the app (guided mode with two checkpoints, hand-off to the monthly calendar). Every claim in it is tagged `[Verified]`, `[Inference]`, `[Proposed]` or `[Unverified]`, and nothing is invented.

**Architecture:** A `Blueprint` Mongo document holds the form input, the Brand Source Sheet (verified facts), the result page-JSON and a charge record. `POST /api/blueprint` validates, enforces the limits, claims the free slot atomically (partial unique indexes), charges the `blueprint` action once, and returns 202; an in-process runner (no timers) discovers and verifies, asks the planner for a strategy as JSON, assembles the pages deterministically, runs the QA gate, and refunds exactly once on any failure. The client polls `GET /api/blueprint/:id` (the same "poll moves it forward" pattern as Hero jobs: a poll also fails and refunds a job whose process died). The facts are produced by code, never by the model; the model can only produce Inference (citing fact ids) and Proposed. The frontend renders the page-JSON as one styled document that prints to A4 PDF.

**Tech Stack:** Node 24 / Express / Mongoose, `sanitize-html` (already a dependency, used for page text), `express-rate-limit`, `node --test`, React + TypeScript (HashRouter), Nebulaa light tokens (`--gv-*`), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-04-brand-growth-blueprint-design.md` (approved). Method source: the owner's skill `Nebulaa_Brand_Growth_Blueprint_Skill.md`. Depends on the Plans and Quarks work already on this branch (`docs/superpowers/plans/2026-10-04-plans-and-quarks.md`: `entitlements.js`, `requireFeature`, `trialGuard`).

## Decisions made in this plan (read before the tasks)

| Question | Decision |
|---|---|
| Model names | No new model name. All text generation goes through the existing wrapper `callTextLLM` (`backend/services/openAI.js`): OpenAI model from env `OPENAI_MODEL` (default `gpt-4o`), falling back to the Gemini model configured in `geminiAI.js` on error; JSON is parsed with `parseGeminiJSON` (`geminiAI.js`), both lazy-required exactly as `routes/heroVideo.js` does (`lazyPlanDeps`). The cost is modelled on `gpt4o(TOKENS...)` in `apiCosts.js`. |
| Background generation and polling | Follow the Hero pattern: a separate collection (`blueprints`), a job document with `status`/`step`/`progress`, an atomic claim `queued -> processing`, a refund guard flag claimed atomically (`charge.state charged -> refunded`), and polling `GET /:id` that also reconciles a stuck job (no heartbeat for 8 minutes: fail and refund). The runner is a tiny in-process queue with a concurrency cap (2) and no timers, so tests exit by themselves. A crash between "charge pending" and "charged" is a known gap documented like Hero's (at worst a free action is lost). |
| Fetching pages | New `services/blueprint/safeFetch.js`, built on the rules and primitives Hero already has: `isPublicHttpsUrl` and `isPublicIp` (`services/heroVideoService.js`) and the DNS-pinned `_pinnedFetch` (`services/heroVideoFinish.js`, the same mechanism `fetchLogoBuffer` uses: every hop resolved, refused unless every address is public, connected to at the checked address, redirects followed by hand). `services/scraper.js` is NOT used: it has no private-address protection. |
| Where the prompt lives | `services/promptRegistry.blueprint.js` merged into `PROMPTS` in `promptRegistry.js` (the same split `promptRegistry.video.js` uses), marked `locked: true`: not listed by `listPrompts()` (so the Prompt Studio and `GET /api/prompts` never show it), ignored by `resolveTemplate` (a customer override can never weaken the no-invention rules), and refused by `PUT/DELETE /api/prompts/:id`. |
| Cost | New action `blueprint` in `apiCosts.js` (`ACTION_USD.blueprint = gpt4o(TOKENS.blueprint_plan)`, tokens in 5,000 / out 4,500, default 2.5x margin, so about 7 Quarks, derived, never typed anywhere else). The guided directions call (about $0.02) is absorbed. Fetches cost nothing metered. No image model in free mode. |
| Entitlement | `blueprint` added to `FEATURES`; allowed on every tier (free, starter, professional, managed). Free accounts still cannot reach any outside-service feature. |
| One free Blueprint | Only for tier `free`. `Blueprint.freeSlot` is `true` while a free-tier Blueprint is queued, processing, awaiting approval or completed, and is set `false` when it fails or stops (so a refunded failure does not use up the allowance). Two partial unique indexes (`emailKey`, `businessKeys`, both `partialFilterExpression: { freeSlot: true }`) make the rule atomic even under concurrent requests. `emailKey` normalises case, `+tag` and Gmail dots; `businessKeys` holds `host:<website host without www>` and `ig:<handle>`. A duplicate returns 409 with the existing id so the page can open it. |
| Email verification | The existing flow is signup -> OTP (`POST /api/auth/signup`, `/verify-otp`); no token is issued before verification. So a token already implies a verified email; the route additionally requires `user.isVerified === true` for free accounts (belt and braces). The lead-magnet link is `/#/login?mode=signup&intent=blueprint`; after OTP the app goes to `/blueprint/new`, outside the onboarding gate. |
| Limits | Per IP per 24 hours counted in the database (survives restarts): free 3, paid 10 (hashed IP, SHA-256 with a salt from `JWT_SECRET`); paid accounts also 5 per account per 24 hours; plus `express-rate-limit` bursts on the routes. Failed validation never creates a document, so it never counts. |
| Blueprint model fields | See Task 1 (`blueprintId`, `userId`, `emailKey`, `tierAtStart`, `mode`, `status`, `step`, `progress`, `checkpoint`, `heartbeatAt`, `input`, `businessKeys`, `freeSlot`, `ipHash`, `sheet`, `sources`, `directions`, `approvals`, `result`, `qaFlags`, `stop`, `error`, `charge`). |
| Guided mode | Two checkpoints from the skill (Checkpoint 0 discovery approval; Checkpoint 1 strategic direction, choose one of 2 to 4). Checkpoints 2 to 4 (campaign idea, visual system, page by page) are NOT in the first version (the spec's first version is one styled page). Guided mode is available to non-free accounts only; a free account is always automatic. |
| In-app calendar hand-off | No backend change: the Blueprint page button calls the existing `POST /api/content-calendar/regenerate` with the existing `focus` argument (`generateMonthlyCalendar(..., { focus })`), the text built by a pure helper from the Blueprint's pillars. |
| Image engine (Module E) | Not built in the first version (spec: no image generation). Tiles are typographic and use only the visitor's own logo and colours, unchanged. |

## The skill, encoded

**Golden rule.** The system feels creative and behaves like a careful strategist. Creative freedom: concepts, ideas, hooks, layouts. Never: facts, logos, products, pricing, contacts, claims, identity, existing assets. Encoded three ways: (1) facts are made only by code (`discovery.js`) and carried as ids; (2) the planner prompt may cite them but cannot mint `verified`; (3) the QA scanner (`qa.js`) rejects invented numbers, prices, contacts, quotations, awards, rankings, testimonials, guarantees and follower claims, and the assembler removes any offending item.

**Tagging.** `[Verified]` = seen on a fetched page, or typed by the visitor (carries `factId`; its text equals the sheet text exactly). `[Inference]` = our reasoning from verified facts (must cite at least one existing `factId`). `[Proposed]` = our recommendation (a creative idea; may not state a fact). `[Unverified]` = something we could not confirm (carries a `reason`). The phrase "Based on limited information" appears on the cover when evidence is thin.

**Stop conditions (skill section 16) and what this build does:**

| Skill stop condition | Behaviour here |
|---|---|
| Website cannot be accessed | `unreachable`: a website or Instagram page was given, nothing could be read, and no offers were typed. The job ends `stopped`, Quarks refunded, plain page with the form to fix it. If at least one typed offer exists the run continues in limited mode instead. |
| Customer identity ambiguous | `identity_mismatch`: the website was read but no meaningful word of the business name appears in its title, site name, headings or address, and the Instagram page does not corroborate. Stops with a plain message. |
| Critical product information conflicts | Never stated: prices come only from the visitor's typed offers, so a conflict cannot enter. Page text that disagrees is simply not turned into a fact. |
| Contact details missing | Not applicable: the closing page carries Nebulaa's own contact (`NEBULAA` in `config/blueprint.js`: only `support@nebulaa.ai`, the one address already on the website), never an invented customer contact. |
| Logo cannot be verified | Not a stop in this build: the cover shows the business name as plain typography with the note "Logo not provided" (a logo is used unchanged when the visitor uploads one, or when the page itself declares one). Flagged in the open questions. |
| Generated visual assets fail brand accuracy | No generated visuals in this build; the QA gate checks name, logo URL, contact and every claim instead. |
| Thin input (the spec's own rule) | `thin`: evidence score below 3 (page and Instagram facts count 1 each, a typed offer counts 3). Stops and refunds. Below 8, or when no page was read, the Blueprint is generated with the cover note. |

**Page architecture (cover + 9 pages + closing, from the approved spec) and the skill pages they serve:**

| n | id | Title | Serves (skill) |
|---|---|---|---|
| cover | cover | Cover and snapshot | Cover |
| 1 | `where-today` | Where you are today | Page 1 Brand DNA (verified facts only) |
| 2 | `audience-positioning` | Audience and positioning | Pages 2 and 3 (journey, the territory and its one line) |
| 3 | `competitor-read` | Competitor read | Observed section of discovery (only competitors the visitor named with an address) |
| 4 | `content-pillars` | Content pillars | Page 5 (executions: the system behind them) |
| 5 | `calendar-preview` | Your first 30 days | Page 5 (individual executions as designed tiles) |
| 6 | `offers-hooks` | Offers and hooks | Page 9 commercial angle (only the visitor's own typed offers) |
| 7 | `channel-plan` | Channel plan | Page 7 Communication ecosystem |
| 8 | `roadmap-90` | The next 90 days | Page 8 Roadmap (Foundation, Storytelling and engagement, Growth) |
| 9 | `first-steps` | What to do first | Page 9 Strategic recommendations (what to measure uses the skill's measurement list, never promised outcomes) |
| closing | closing | Turn this plan into posts in Nebulaa | Closing page |

The skill's cinematic campaign concept (page 4) and identity or packaging pages (page 6) are not in the approved spec's list and are not built; see the open questions.

**Modules A to H, reused as building blocks (file per module):**

| Module | File | Input -> output |
|---|---|---|
| A Web research | `services/blueprint/discovery.js` (+ `safeFetch.js`, `pageFacts.js`) | typed input + public pages -> Brand Source Sheet |
| B Asset extraction | `discovery.js` `extractAssets` | page + input -> logo URL (unchanged), colours |
| C Strategy engine | `planner.js` (`runDirections`, `runPlan`) | Source Sheet -> strategy object |
| D Creative engine | `planner.js` `normalisePlan` + `assemble.js` | strategy -> page specification (page-JSON) |
| E Image engine | not built (later) | |
| F Layout engine | frontend `BlueprintDocument.tsx` + print stylesheet | page-JSON -> composed pages |
| G QA engine | `qa.js` | page-JSON + sheet -> flags and pass/fail |
| H Document assembler | `assemble.js` (JSON) and the browser's print to PDF | pages -> one document |

**QA gate (skill section 14) as checks in `qa.js`:** brand accuracy (exact business name, logo URL unchanged, Nebulaa contact exact, no invented contact, price or product), strategy (one territory, 3 to 5 pillars, calendar uses only the named pillars, channels from the allowed list, no promised outcomes), document (cover, all nine pages in order, closing page, every page non-empty, no untagged claim, no duplicate pages, no more than 6 removed items).

## Global Constraints

- Do not touch the Kling files (`backend/services/videoService.js`, `routes/videoGeneration.js`, `videoGenerationQueue.js`, `models/VideoJob.js`) and do not change the Hero money path (`heroVideoFlow.js` deduct/create/recheck/submit/refund). Hero modules are only imported for `isPublicHttpsUrl`, `isPublicIp` and `_pinnedFetch`.
- No real OpenAI, Gemini, Ayrshare, Apify, fal, Razorpay, Cloudinary, email or website calls anywhere: tests use fakes (fake fetcher, fake planner, fake model, fake deduct/refund, fake uploader). No `.env`, keys, `backend/public` build output or `node_modules` symlinks in commits. Never start servers, never use localhost:5000 or :3000 (a real backend and frontend may be listening); no browser unless a task says to use the audit tooling on 127.0.0.1:3100.
- Blueprint code must not import any outside-service module: `socialMediaAPI`, `campaignPublisher`, `ayrshareGuard`, `scraper`, `serperLookup`, `zohoBooks`, `emailService`. A test scans `services/blueprint/*` and `routes/blueprint.js` for these names.
- Facts come only from code. The model cannot produce `verified`. A sentence the model writes contains no digits, prices, percentages, counts, awards, rankings, certifications, testimonials, quotations, contact details, web addresses or product names that are not in the sheet. Prices and offers are shown exactly as the visitor typed them.
- Visitor logo and photos are used unchanged: never redrawn, re-lettered or recoloured. No logo is generated.
- Discovery reads only the pages the visitor pointed to: their website (the home page plus up to four same-site pages linked from it whose address contains about, story, product, service, shop, collection, menu, offer, pricing, plan, contact, work or portfolio), their public Instagram page, and the home page of each competitor they gave an address for (only if `robots.txt` allows it). At most 9 fetches, 8 seconds each, 400 KB each, public https only, no private ranges, no ports, no credentials in URLs. No follower counts, contact details or personal data are read into the sheet.
- Money: the `blueprint` price comes only from `QUARK_COSTS.blueprint`. Charged once per Blueprint; refunded at most once (atomic claim) on every failure, stop, QA failure and stale job. A free-slot failure releases the slot.
- The worktree currently holds uncommitted edits from another session in `backend/routes/auth.js`, `frontend/components/NotificationBell.tsx`, `frontend/index.html`, `frontend/pages/Auth.tsx`, `frontend/pages/LandingPage.tsx`, `frontend/pages/Onboarding.tsx` and an untracked `backend/tests/onboardingContract.test.js`. Never revert them and never commit them as part of a Blueprint task. Tasks 1 to 4 do not touch those files. Task 5 edits `Auth.tsx` and `LandingPage.tsx`: before starting it, run `git diff -- frontend/pages/Auth.tsx frontend/pages/LandingPage.tsx`; if there are pending edits that are not yours, stop and ask the owner to commit or discard them first (see the open questions).
- Keep green: `cd backend && node --test tests/*.test.js` (251 at start; every file must exit by itself), `cd frontend && node --test tests/*.test.mjs` (56 at start), `cd frontend && npx tsc --noEmit` (exactly 3 pre-existing errors: AdminDashboard, AdminLogin, Influencers). Use nvm for Node (`export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"`).
- Voice: every customer-facing sentence (messages, stop messages, form labels, progress text, page headings, static document text, closing page, emails if any) follows `docs/superpowers/specs/2026-10-03-nebulaa-app-voice-design.md`: complete, plain, professional sentences; sentence case; no exclamation marks, no emoji, no slang, no dash used as a pause, no rhetorical questions, no personifying the product, "Quarks" never "credits", never "trial" or "7 days", "Nebulaa" is the only product name used (no agent names).
- Do not rename routes, API fields or code identifiers that already exist. Commit per task; commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; work only in the worktree for branch `nebulaa-redesign`; stage files by explicit path (never `git add -A`).

## Review Focus (for the one final review)

- Nothing the model writes can reach the document as Verified; every Verified claim equals a sheet fact exactly; no digit, price, contact, quotation or ranking can appear unless typed by the visitor or read from a page.
- A page that is not public https (http, localhost, private, link-local, a name resolving to a private address, a redirect into one) is never fetched; no more than 9 fetches per run; the sheet holds no follower counts or contact details.
- One free Blueprint per verified email (including Gmail alias forms) and per business (website host with or without `www`, or Instagram handle), under concurrency (the partial unique indexes), and a failed or stopped one releases the slot; three attempts per IP per day (free), counted in the database.
- The `blueprint` charge happens once; every failure path refunds exactly once (planner error, QA failure, thin stop, unreachable stop, stale poll, replayed refund); an insufficient balance creates no charge and leaves no held slot.
- A free account can create a Blueprint and still cannot reach publish, schedule, connect, inbox, auto reply or competitors; existing accounts (tier `managed`) are unaffected.
- A customer cannot read another customer's Blueprint (404); internals (`ipHash`, `emailKey`, charge record, raw sheet outside Checkpoint 0) are never returned.
- The locked prompt cannot be listed, overridden or edited from the Prompt Studio.
- The printed page: A4, one section per page, readable in black and white, tags always spelled out (not colour only), no cut-off tiles at 375 px.
- Wording: no "credits", "trial", "7 days", exclamation marks, emoji or slang in any customer-facing string.

## File map

Create: `backend/config/blueprint.js`, `backend/models/Blueprint.js`, `backend/services/blueprint/{input,safeFetch,pageFacts,discovery,planner,assemble,qa,pipeline,runner,service}.js`, `backend/services/promptRegistry.blueprint.js`, `backend/routes/blueprint.js`, tests `backend/tests/blueprint*.test.js` and `backend/tests/fixtures/blueprint*.json`, `backend/tests/blueprintFakes.js`; frontend `utils/blueprint.ts`, `constants/blueprintCopy.ts`, `services` additions in `api.ts`, `pages/BlueprintRoutes.tsx`, `pages/BlueprintStart.tsx`, `pages/BlueprintView.tsx`, `components/blueprint/BlueprintDocument.tsx`, `tests/blueprint.test.mjs`; docs `docs/superpowers/specs/assets/brand-growth-blueprint-copy-options.md`.
Modify: `backend/config/apiCosts.js`, `backend/config/entitlements.js`, `backend/tests/entitlementGates.test.js` (one line), `backend/services/promptRegistry.js`, `backend/routes/prompts.js`, `backend/server-main.js`; frontend `App.tsx`, `pages/Auth.tsx`, `pages/LandingPage.tsx`, `components/Layout.tsx`, `pages/CalendarHome.tsx`, `tests/voice-scope.json`, `scripts/visual-audit/routes.json`, `scripts/visual-audit/mock-session.js`.

---

### Task 1: Config, model, cost action, entitlement, input validation (pure)

**Files:** Modify `backend/config/apiCosts.js`, `backend/config/entitlements.js`, `backend/tests/entitlementGates.test.js`; Create `backend/config/blueprint.js`, `backend/models/Blueprint.js`, `backend/services/blueprint/input.js`; Test `backend/tests/blueprintConfig.test.js`, `backend/tests/blueprintInput.test.js`.

**Interfaces (produce exactly these):**

- `apiCosts.js`: in `TOKENS` add `blueprint_plan: { in: 5000, out: 4500 }`; in `ACTION_USD` add `blueprint: gpt4o(TOKENS.blueprint_plan)` with a comment that the guided directions call is absorbed; in `ACTION_UNITS` add `blueprint: 'per blueprint'`. Nothing else changes (no margin override: the default 2.5x applies). `QUARK_COSTS.blueprint` is then derived (7 today).
- `entitlements.js`: add `'blueprint'` to `FEATURES`; in `canUse` change the early allowance to `if (feature === 'create' || feature === 'video' || feature === 'blueprint')` (so free, starter and professional are allowed; managed already is).
- `backend/tests/entitlementGates.test.js` line 25: `const OUTSIDE = FEATURES.filter((f) => f !== 'create' && f !== 'video' && f !== 'blueprint');` and in the test "free user may still use create and video" iterate `['create', 'video', 'blueprint']`. (`plansConfig.test.js` already uses its own explicit lists and needs no change.)
- `config/blueprint.js` (no side effects on import), exactly:

```js
'use strict';
// Brand Growth Blueprint constants. Pure config: no database, no network.
const TAGS = ['verified', 'inference', 'proposed', 'unverified'];
const TAG_LABEL = { verified: '[Verified]', inference: '[Inference]', proposed: '[Proposed]', unverified: '[Unverified]' };
const GOALS = ['enquiries', 'sales', 'followers', 'launch'];
const FORMATS = ['image post', 'carousel', 'reel', 'story'];
const CHANNELS = ['Instagram', 'Facebook', 'LinkedIn', 'WhatsApp', 'YouTube', 'Google Business Profile', 'Website'];
const MODES = ['auto', 'guided'];
const STATUS = ['queued', 'processing', 'awaiting_approval', 'completed', 'stopped', 'failed'];

// The nine pages after the cover, in order (approved spec). `n` is the page number shown.
const PAGES = [
  { n: 1, id: 'where-today', title: 'Where you are today', purpose: 'What can be confirmed about your business today.' },
  { n: 2, id: 'audience-positioning', title: 'Audience and positioning', purpose: 'Who you speak to and the territory you can own.' },
  { n: 3, id: 'competitor-read', title: 'Competitor read', purpose: 'What the competitors you named say about themselves.' },
  { n: 4, id: 'content-pillars', title: 'Content pillars', purpose: 'The themes your content returns to.' },
  { n: 5, id: 'calendar-preview', title: 'Your first 30 days', purpose: 'A month of posts, one tile for each day.' },
  { n: 6, id: 'offers-hooks', title: 'Offers and hooks', purpose: 'How your own offers become reasons to act.' },
  { n: 7, id: 'channel-plan', title: 'Channel plan', purpose: 'Where to be present and what each channel is for.' },
  { n: 8, id: 'roadmap-90', title: 'The next 90 days', purpose: 'Three phases, each with actions and what to measure.' },
  { n: 9, id: 'first-steps', title: 'What to do first', purpose: 'The first steps to take this week.' }
];
const PHASES = [
  { id: 'foundation', label: 'Days 1 to 30', title: 'Foundation' },
  { id: 'storytelling', label: 'Days 31 to 60', title: 'Storytelling and engagement' },
  { id: 'growth', label: 'Days 61 to 90', title: 'Growth' }
];

const LIMITS = {
  FREE_PER_IP_PER_DAY: 3, PAID_PER_IP_PER_DAY: 10, PAID_PER_ACCOUNT_PER_DAY: 5,
  MAX_PAGES_FETCHED: 5, MAX_COMPETITORS: 3, MAX_OFFERS: 3, MAX_COLOURS: 3,
  PAGE_BYTES: 400 * 1024, FETCH_TIMEOUT_MS: 8000, TOTAL_BUDGET_MS: 40000,
  STALE_MS: 8 * 60 * 1000, MIN_EVIDENCE: 3, FULL_EVIDENCE: 8, MAX_DROPPED: 6,
  MIN_CALENDAR_DAYS: 20, MAX_CONCURRENT_RUNS: 2, LOGO_DATA_BYTES: 2 * 1024 * 1024
};

// Nebulaa's own details for the closing page. Only the address already published on the website.
// Phone and social handles are left out until the owner confirms them (open question).
const NEBULAA = { email: 'support@nebulaa.ai', website: 'https://nebulaa.ai' };

const STOP_MESSAGES = {
  unreachable: 'We could not read your website or Instagram page, so there was not enough to build a reliable Blueprint. Check the address, or add one of your real offers, then try again.',
  thin: 'We could not find enough about your business to build a reliable Blueprint. Add your website address, your Instagram page or one of your real offers, then try again.',
  identity_mismatch: 'The website you entered does not appear to belong to this business name. Check the name and the address, then try again.'
};
const LIMITED_NOTE = 'Based on limited information';

module.exports = { TAGS, TAG_LABEL, GOALS, FORMATS, CHANNELS, MODES, STATUS, PAGES, PHASES, LIMITS, NEBULAA, STOP_MESSAGES, LIMITED_NOTE };
```

- `models/Blueprint.js`: Mongoose model `Blueprint`, collection `blueprints`, `timestamps: true`. Fields: `blueprintId` (String, required, unique, index; a UUID, the public id), `userId` (ObjectId ref User, required, index), `emailKey` (String, required), `tierAtStart` (enum free|starter|professional|managed, required), `mode` (enum auto|guided, default auto), `status` (enum STATUS, default queued, index), `step` (String, default `queued`), `progress` (Number 0 to 100), `checkpoint` (Number, default null), `heartbeatAt` (Date, default now), `startedAt`, `completedAt` (Date), `input` (Mixed), `businessKeys` ([String]), `freeSlot` (Boolean, default false), `ipHash` (String), `sheet` (Mixed), `sources` ([Mixed]), `directions` (Mixed), `approvals` ([Mixed]), `result` (Mixed), `qaFlags` ([Mixed]), `stop` (`{ reason: String, message: String }`), `error` (`{ message: String }`), `charge` (`{ state: enum none|pending|charged|refunded default none, quarks: Number }`). Indexes: `{ userId: 1, createdAt: -1 }`, `{ ipHash: 1, createdAt: -1 }`, and the two atomic rules:

```js
blueprintSchema.index({ emailKey: 1 }, { unique: true, partialFilterExpression: { freeSlot: true }, name: 'one_free_per_email' });
blueprintSchema.index({ businessKeys: 1 }, { unique: true, partialFilterExpression: { freeSlot: true }, name: 'one_free_per_business' });
```
  Export `mongoose.models.Blueprint || mongoose.model('Blueprint', blueprintSchema)`. The collection is new and empty, so building these indexes costs almost no disk (the Atlas disk ceiling note applies to large collections; confirm `autoIndex` behaviour before deploy, see open questions).
- `services/blueprint/input.js` exports `normaliseInput(raw, { allowGuided })`, `normaliseWebsite`, `normaliseInstagram`, `emailKey`, `businessKeysOf`. Shape of a successful result: `{ ok: true, input, logoDataUrl, mode }` with `input = { businessName, websiteUrl, websiteHost, instagramHandle, instagramUrl, whatYouSell, whoItsFor, goal, city, competitors: [{ name, url, host }], offers: [{ name, price }], colours: ['#rrggbb'], logoUrl }`; a failure is `{ ok: false, errors: { field: 'plain sentence' } }`. Code:

```js
'use strict';
const { isPublicHttpsUrl } = require('../heroVideoService');
const { GOALS, LIMITS } = require('../../config/blueprint');

const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const IG_RESERVED = new Set(['p', 'reel', 'reels', 'explore', 'accounts', 'stories', 'tv', 'direct']);
const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/i;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

function normaliseWebsite(v) {
  const s = clean(v, 300);
  if (!s) return { empty: true };
  if (/\s/.test(s)) return { error: true };
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`); } catch (_) { return { error: true }; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.port) return { error: true };
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!HOST_RE.test(host) || !isPublicHttpsUrl(`https://${host}/`)) return { error: true };
  const path = u.pathname === '/' ? '/' : u.pathname.replace(/\/+$/, '');
  return { url: `https://${host}${path}`, host: host.replace(/^www\./, '') };
}

function normaliseInstagram(v) {
  let s = clean(v, 200).toLowerCase();
  if (!s) return { empty: true };
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#\s]+)/);
  if (m) s = m[1];
  s = s.replace(/^@/, '');
  if (!/^[a-z0-9._]{1,30}$/.test(s) || IG_RESERVED.has(s)) return { error: true };
  return { handle: s, url: `https://www.instagram.com/${s}/` };
}

// One person, one key: case, "+tag" and Gmail dots do not make a new email.
function emailKey(email) {
  const e = clean(String(email || ''), 254).toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return e;
  let local = e.slice(0, at).split('+')[0];
  let domain = e.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

function businessKeysOf(input) {
  const keys = [];
  if (input.websiteHost) keys.push(`host:${input.websiteHost}`);
  if (input.instagramHandle) keys.push(`ig:${input.instagramHandle}`);
  return keys;
}

function hex(v) {
  const m = typeof v === 'string' && v.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return '';
  const h = m[1].toLowerCase();
  return `#${h.length === 3 ? h.split('').map((c) => c + c).join('') : h}`;
}

function logoDataBytes(d) {
  const m = typeof d === 'string' ? d.match(DATA_URL_RE) : null;
  if (!m) return null;
  const b64 = m[2].replace(/\s/g, '');
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor(b64.length * 3 / 4) - pad;
}

function normaliseInput(raw, { allowGuided = false } = {}) {
  const r = isObj(raw) ? raw : {};
  const errors = {};
  const businessName = clean(r.businessName, 80);
  if (businessName.length < 2) errors.businessName = 'Enter your business name.';

  const w = normaliseWebsite(r.website);
  const ig = normaliseInstagram(r.instagram);
  if (w.error) errors.website = 'Enter your website as example.com or as a full address that starts with https://.';
  if (ig.error) errors.instagram = 'Enter your Instagram page as @name or as its web address.';
  if (w.empty && ig.empty) errors.website = 'Enter your website address or your Instagram page, or both.';

  const whatYouSell = clean(r.whatYouSell, 200);
  if (whatYouSell.length < 10) errors.whatYouSell = 'Describe what you sell in one sentence of at least ten characters.';
  const whoItsFor = clean(r.whoItsFor, 200);
  if (whoItsFor.length < 5) errors.whoItsFor = 'Describe who it is for in a few words.';
  const goal = GOALS.includes(r.goal) ? r.goal : '';
  if (!goal) errors.goal = 'Choose your main goal.';

  const competitors = [];
  for (const c of (Array.isArray(r.competitors) ? r.competitors : []).slice(0, LIMITS.MAX_COMPETITORS)) {
    if (!isObj(c)) continue;
    const name = clean(c.name, 80);
    const cw = normaliseWebsite(c.url);
    if (cw.error) { errors.competitors = 'One competitor address could not be read. Check it or remove it.'; continue; }
    if (!name && cw.empty) continue;
    competitors.push({ name: name || cw.host, url: cw.url || '', host: cw.host || '' });
  }

  const offers = [];
  for (const o of (Array.isArray(r.offers) ? r.offers : []).slice(0, LIMITS.MAX_OFFERS)) {
    if (!isObj(o)) continue;
    const name = clean(o.name, 80);
    const price = clean(o.price, 24);
    if (!name && !price) continue;
    if (!name) { errors.offers = 'Give each offer a name, or leave its price empty.'; continue; }
    offers.push({ name, price });
  }

  const colours = (Array.isArray(r.colours) ? r.colours : []).map(hex).filter(Boolean).slice(0, LIMITS.MAX_COLOURS);

  let logoUrl = '';
  let logoDataUrl = null;
  if (clean(r.logoUrl, 2048)) {
    if (!isPublicHttpsUrl(r.logoUrl) || /\.(svg|gif|avif|heic|heif|bmp|tiff?)$/i.test(new URL(r.logoUrl).pathname)) errors.logo = 'Use a JPG, PNG or WebP logo at a public https address, or upload the file.';
    else logoUrl = r.logoUrl.trim();
  } else if (r.logoDataUrl) {
    const bytes = logoDataBytes(r.logoDataUrl);
    if (bytes === null) errors.logo = 'Upload your logo as a PNG, JPG or WebP file.';
    else if (bytes > LIMITS.LOGO_DATA_BYTES) errors.logo = 'The logo file is larger than 2 MB. Upload a smaller file.';
    else logoDataUrl = r.logoDataUrl;
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    mode: allowGuided && r.mode === 'guided' ? 'guided' : 'auto',
    logoDataUrl,
    input: {
      businessName, websiteUrl: w.url || '', websiteHost: w.host || '', instagramHandle: ig.handle || '', instagramUrl: ig.url || '',
      whatYouSell, whoItsFor, goal, city: clean(r.city, 60), competitors, offers, colours, logoUrl
    }
  };
}

module.exports = { normaliseInput, normaliseWebsite, normaliseInstagram, emailKey, businessKeysOf };
```

- [ ] **Step 1: Write failing tests.**
  `blueprintConfig.test.js`: (a) `QUARK_COSTS.blueprint === Math.max(1, Math.round((ACTION_USD.blueprint * 2.5) / USD_PER_QUARK))` and `>= 1 && <= 10`, `ACTION_UNITS.blueprint === 'per blueprint'`, and `require('../middleware/trialGuard').CREDIT_COSTS.blueprint === QUARK_COSTS.blueprint`; (b) `canUse` for `blueprint`: free, starter (no add-ons), professional and managed all `allowed: true, reason: 'ok'`, while a free user is still blocked from `publish` (reason `upgrade`); an account with no `plan` is allowed; (c) `FEATURES` includes `blueprint`; (d) `config/blueprint.js` invariants: `PAGES.map(p => p.id)` equals the nine ids in the table above in order, `PAGES.length === 9`, `PHASES.length === 3`, every `STOP_MESSAGES` value ends with a full stop and contains none of `!`, `credit`, `trial`; (e) the model: `Blueprint.schema.indexes()` contains an index on `{ emailKey: 1 }` and one on `{ businessKeys: 1 }`, each with `unique: true` and `partialFilterExpression: { freeSlot: true }`; `Blueprint.schema.path('charge.state').enumValues` is `['none','pending','charged','refunded']`; requiring the model opens no connection (the test file must exit).
  `blueprintInput.test.js` (all with real values): valid minimal form (`businessName: 'Sweet Co'`, `website: 'sweetco.in'`, `whatYouSell: 'Custom cakes baked to order.'`, `whoItsFor: 'Families in Chennai'`, `goal: 'enquiries'`) -> `ok`, `websiteUrl === 'https://sweetco.in/'`, `websiteHost === 'sweetco.in'`, `mode === 'auto'`; `normaliseWebsite('Example.com/Shop/')` -> `https://example.com/Shop`; `'https://www.Foo.in'` -> host `foo.in`; rejected: `'http://localhost'`, `'10.0.0.1'`, `'exa mple.com'`, `'https://user:pw@example.com'`, `'https://example.com:8080'`, `'javascript:alert(1)'`; Instagram: `'@Foo.Bar'` and `'https://www.instagram.com/foo.bar/?hl=en'` -> handle `foo.bar`, rejected `'instagram.com/p/abc'` and `'a b'`; neither website nor Instagram -> `errors.website === 'Enter your website address or your Instagram page, or both.'`; only Instagram is valid; `whatYouSell` of 9 characters rejected; unknown `goal` rejected; competitors capped at 3, a bad competitor address sets `errors.competitors`, a name-only competitor keeps `url: ''`; offers capped at 3, price kept verbatim (`'₹499 per month'`), a price without a name sets `errors.offers`; colours `'#ABC'` -> `'#aabbcc'`, `'red'` dropped, capped at 3; logo: an `https` URL ending `.svg` rejected, a `data:image/png;base64,` string accepted into `logoDataUrl` (not into `input`), `data:image/gif` rejected, a decoded size over 2 MB rejected; `mode: 'guided'` becomes `'guided'` only with `allowGuided: true`; `emailKey('Dinesh.K+blue@Gmail.com') === 'dineshk@gmail.com'`, `emailKey('x@googlemail.com') === 'x@gmail.com'`, `emailKey('A.B+c@Corp.in') === 'a.b@corp.in'`; `businessKeysOf` returns `['host:sweetco.in', 'ig:sweetco']` when both are given; the normalised input never contains a field the form did not define (assert `Object.keys(input).sort()` equals the list above).
- [ ] **Step 2:** `cd backend && node --test tests/blueprintConfig.test.js tests/blueprintInput.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** exactly the interfaces above. Do not change any existing export or price.
- [ ] **Step 4:** run the two new files and the full backend suite. Expected: PASS (251 + new; the `entitlementGates` and `plansConfig` tests still pass).
- [ ] **Step 5: Commit** `feat: Blueprint config, cost action, entitlement, model and input validation`.

---

### Task 2: Discovery and verification with tagging (Modules A and B), safe fetcher, stop conditions

**Files:** Create `backend/services/blueprint/safeFetch.js`, `pageFacts.js`, `discovery.js`; Test `backend/tests/blueprintSafeFetch.test.js`, `backend/tests/blueprintDiscovery.test.js`.

**Interfaces:**

- `safeFetch.js`: `fetchPublicPage(url, opts) -> Promise<{ ok: true, status, finalUrl, text } | { ok: false, reason, status? }>`; never throws. `reason` is one of `blocked` (not public https, or any resolved address not public), `other_site` (a redirect left `opts.sameSiteOf`), `status`, `type`, `size`, `redirects`, `timeout`, `error`. Options: `fetchImpl(url, init) -> Response` (test seam; with it no pinning, production never passes one), `lookup(host) -> [{ address }]` (test seam), `timeoutMs` (default 8000, capped at `LIMITS.FETCH_TIMEOUT_MS`), `maxBytes` (default `LIMITS.PAGE_BYTES`), `okTypes` (RegExp, default HTML), `sameSiteOf` (host; `www.` ignored). Behaviour mirrors `fetchLogoBuffer` in `heroVideoFinish.js`: validate with `isPublicHttpsUrl`; each hop (first URL and each of at most 3 redirects, followed by hand with `redirect: 'manual'`) is re-validated, resolved with `dns.promises.lookup(host, { all: true, verbatim: true })`, refused unless EVERY address passes `isPublicIp`, then fetched through `require('../heroVideoFinish')._pinnedFetch(current, init, address)` (lazy require). Request headers `accept: text/html,application/xhtml+xml` and `user-agent: NebulaaBlueprint/1.0 (+https://nebulaa.ai)`. Body read with a byte cap while streaming (cancel the reader when over), decoded as UTF-8. `robotsAllows(pageUrl, opts) -> Promise<boolean>`: fetches `https://<host>/robots.txt` with `okTypes: /^text\/plain/`; a missing, unreadable or non-200 file allows; otherwise `parseRobots(text)` returns the `Disallow` prefixes of the `User-agent: *` group and the page is allowed unless its path starts with one (an empty `Disallow:` allows everything).
- `pageFacts.js`: `extractPage(html, pageUrl) -> { title, description, siteName, headings: string[] (<= 12, 3 to 120 chars, de-duplicated, h1 and h2), ld: { name, description, sameAs[], locality, logo } | null, logoCandidates: string[], themeColor, links: string[], text }`. Helpers `toText(html)` (insert a space between tags, strip with `sanitize-html` using `allowedTags: []` and `nonTextTags: ['style','script','textarea','option','noscript','svg']`, decode entities, collapse spaces), `meta(html, key)`, `headings(html)`, `jsonLd(html)` (reads `application/ld+json`, walks `@graph`, takes the first node whose `@type` matches `Organization|Business|Store|Shop|Restaurant|Clinic|Hotel|Brand`), `sameSiteLinks(html, pageUrl, hostNoWww)` (absolute https links on the same host, query and fragment removed, whose path matches `/(about|story|products?|services?|shop|collections?|menu|offers?|pricing|plans?|contact|work|portfolio)/i`, de-duplicated, in page order). `logoCandidates` are public https URLs from `<link rel="apple-touch-icon">` and the JSON-LD `logo`, resolved against the page URL (never `og:image`, which is often a banner).
- `discovery.js`: `discover({ input, fetchPage = fetchPublicPage, robots = robotsAllows, now }) -> Promise<{ sheet, sources }>` and pure `verifyFacts(facts, pageTexts, input)`, `evaluateStop(sheet, input)`, `nameTokens(name)`. The Brand Source Sheet:

```js
{
  version: 1,
  client: { name, website, instagram, city },
  facts: [ { id: 'F1', tag: 'verified', kind: 'typed'|'page'|'instagram'|'competitor_page', field, subject: null|'Competitor name', text, quote, source: { type, url?, field } } ],
  unverified: [ { id: 'U1', text, reason } ],
  assets: { logo: { url, source: 'typed'|'page' } | null, colours: [ { hex, source: 'typed'|'page' } ] },
  missing: [ 'logo', 'website', 'offers', 'competitors' ],   // plain labels of what was not available
  evidence: Number, basis: 'full'|'limited', stop: null | { reason, message }
}
```
  `sources` is `[ { id: 'S1', url, kind: 'website'|'instagram'|'competitor'|'robots', ok, reason? } ]` (every fetch attempted, for the internal record and the footnote on page 1). Fact rules: typed facts are made from the visitor's own input only (name, what they sell, who it is for, goal, city, each offer as `Offer: <name>, <price as typed>`, the Instagram handle, the website address, brand colours); page facts are: `Page title`, `Page description`, `Site name`, up to 6 headings per page and 14 in total, the JSON-LD description, locality and `sameAs` handles; Instagram facts only the bio text left after removing the leading counts segment (`/^[\d.,KMkm]+\s+Followers.*?Posts\s*-\s*/i`), never a count; competitor facts are title, description and the first heading of the competitor's own home page, with `subject` set. A competitor given without an address, an Instagram page that could not be read, a website that could not be read and a logo that was not found each add an `unverified` entry (`reason` in plain words) and a `missing` label. Every fact stores the exact `quote` it came from. No price, phone, email, address or follower count is ever extracted. Fetching: home page first; then up to `MAX_PAGES_FETCHED - 1` more same-site pages from `sameSiteLinks` (sequential), then the Instagram page, then each competitor home page (after `robots`); stop starting new fetches once `TOTAL_BUDGET_MS` has passed. Each fetch passes `sameSiteOf` for the website and competitors.
  `verifyFacts` drops any fact whose `quote` is not found (whitespace and case ignored) in its source text (`pageTexts` is a `Map` of page URL to `toText(html)`; typed facts are checked against the original input values) and returns `{ facts, removed }`. `evaluateStop`: `evidence = (page + instagram facts) + 3 * offers`; below `MIN_EVIDENCE` -> `unreachable` if a website or Instagram page was given but nothing was read, else `thin`; then identity: if a website page was read, `nameTokens(name)` (lower case, letters and digits, length >= 3, minus the stop words the, and, co, company, pvt, ltd, llp, private, limited, inc, shop, store, studio, by) is not empty, none of the tokens appears in the lower-cased title, site name, headings or host, and the Instagram page did not corroborate, then `identity_mismatch`. `basis` is `'limited'` when `evidence < FULL_EVIDENCE` or no website page was read, else `'full'`.

- [ ] **Step 1: Write failing tests.**
  `blueprintSafeFetch.test.js` (fake `fetchImpl` returning `new Response(body, { status, headers })`, fake `lookup`): refuses without calling the fetcher `http://example.com/`, `https://localhost/`, `https://10.0.0.5/`, `https://169.254.169.254/latest`, `https://[::1]/` (reason `blocked`, calls === 0); a host resolving to `10.1.2.3` is refused; a mixed answer `[93.184.216.34, 192.168.0.1]` is refused; a 302 to a host whose lookup is `10.0.0.9` is refused (reason `blocked`) and the second hop never fetched; a redirect to another site with `sameSiteOf: 'example.com'` gives `other_site`, `www.example.com` -> `example.com` is allowed; four redirects give `redirects`; `content-type: image/png` gives `type`; `content-length: 999999` gives `size`; a streamed body of 500 bytes with `maxBytes: 100` and no length gives `size`; a fetcher that never settles with `timeoutMs: 20` gives `timeout` and the test exits (timer cleared); a good page returns `{ ok: true, text }` and the fetcher received `redirect: 'manual'`. `parseRobots`: `User-agent: *` with `Disallow: /private` blocks `/private/x` and allows `/shop`; a group for another agent is ignored; empty `Disallow:` allows everything; `robotsAllows` allows when robots is a 404.
  `blueprintDiscovery.test.js`: a fixture HOME page (`<title>Sweet Co | Custom cakes</title>`, description `Custom cakes baked to order in Chennai.`, `<link rel="apple-touch-icon" href="/icon.png">`, `<h1>Cakes for every day</h1>`, links `/about`, `/shop/cakes`, `https://other.com/x`, `/privacy`) with a fake `fetchPage` map. Assertions: the calls are exactly home, `/about`, `/shop/cakes` (no other.com, no /privacy); `sheet.facts` contains a `page` fact for the title with `source.url` set and `quote` equal to the title; typed facts have ids and `kind: 'typed'`; `sheet.assets.logo` is `{ url: 'https://sweetco.in/icon.png', source: 'page' }` unless `input.logoUrl` is set, in which case that URL is used with `source: 'typed'`; every fact has `tag === 'verified'`; no fact text matches `/@|\bFollowers\b|\d{5,}|tel:|mailto:/`; page text containing `Call 98765 43210 or email hello@sweetco.in` produces no fact containing those strings; an Instagram fetch returning `<meta property="og:description" content="1,234 Followers, 56 Following, 78 Posts - Custom cakes (@sweetco)">` gives a fact with text containing `Custom cakes` and not `1,234`; a failed Instagram fetch adds an `unverified` entry and the `missing` label; a competitor without an address becomes an `unverified` entry `Named by you; not researched`; a competitor home page disallowed by robots is not fetched and is `unverified`; a fake `fetchPage` that throws is treated as a failed fetch (never throws out of `discover`); `verifyFacts` drops a tampered fact (`quote` not on the page) and counts it in `removed`, and keeps a typed fact; `evaluateStop`: all fetches failed and no offers -> `{ reason: 'unreachable' }` with the matching `STOP_MESSAGES` text; no website, Instagram unreadable, no offers -> `thin`; all fetches failed but one typed offer -> `stop: null`, `basis: 'limited'`; business name `Zenith Interiors` on a site whose title and headings never mention it and whose host is `acme.com` -> `identity_mismatch`; the same name on `zenithinteriors.in` -> no stop; a site with 8 or more page facts -> `basis: 'full'`; `nameTokens('The Sweet Co Pvt Ltd')` is `['sweet']`. Also assert `discover` makes at most 9 fetch calls with 5 pages, an Instagram page and 3 competitors given.
- [ ] **Step 2:** run the two files. Expected: FAIL.
- [ ] **Step 3: Implement.** Reuse `isPublicHttpsUrl`/`isPublicIp` from `../heroVideoService` and `_pinnedFetch` from `../heroVideoFinish`; do not copy their range tables. No new dependency.
- [ ] **Step 4:** run the new files and the full backend suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Blueprint discovery with safe public fetch, tagged facts and stop conditions`.

---

### Task 3: Planner prompt, assembly into page-JSON, QA gate scanner (Modules C, D, G, H)

**Files:** Create `backend/services/promptRegistry.blueprint.js`, `backend/services/blueprint/planner.js`, `assemble.js`, `qa.js`, `pipeline.js`, `backend/tests/fixtures/blueprintSheet.json`, `blueprintPlanGood.json`, `blueprintPlanBad.json`; Modify `backend/services/promptRegistry.js`, `backend/routes/prompts.js`; Test `backend/tests/blueprintPrompt.test.js`, `backend/tests/blueprintPlanner.test.js`, `backend/tests/blueprintQa.test.js`.

**Interfaces:**

- `promptRegistry.blueprint.js` exports `{ 'blueprint.plan': {...}, 'blueprint.directions': {...} }`, each with `label`, `summary`, `stage: 'blueprint'`, `locked: true`, `variables` and `template`. `promptRegistry.js` spreads it into `PROMPTS` (after `VIDEO_PROMPTS_2`), `listPrompts()` skips entries with `locked: true`, and `resolveTemplate()` returns `prompt.template` immediately for a locked prompt (before the user lookup). `routes/prompts.js`: in `PUT /:id` and `DELETE /:id` change `if (!prompt)` to `if (!prompt || prompt.locked)` (same 404 text). `blueprint.plan` variables: `facts`, `unverified`, `goal`, `basis`, `territory`, `competitors`, `formats`, `channels`. `blueprint.directions` variables: `facts`, `unverified`, `goal`. Template for `blueprint.plan` (verbatim; the implementer adds no other rules):

```
You are the strategist for a Brand Growth Blueprint. You are creative about ideas and strict about facts.

THE GOLDEN RULE
Creative freedom applies to concepts, content ideas, hooks and layouts. It never applies to facts. You may only state a fact about the business if it appears in the FACTS list below, and you must cite it by its id. If something is not in the list, you do not know it.

FACTS (each line: id, source, text):
{{facts}}

THINGS WE COULD NOT CONFIRM:
{{unverified}}

MAIN GOAL: {{goal}}
INFORMATION BASIS: {{basis}}
STRATEGIC TERRITORY: {{territory}}
COMPETITOR FACTS (only what the competitors' own pages say):
{{competitors}}

RULES
1. Every item you write has a tag. Use "inference" for a conclusion drawn from the facts, and list the ids it rests on in factIds. Use "proposed" for a recommendation or an idea. You cannot mark anything as verified.
2. Never write prices, discounts, numbers, percentages, follower or customer counts, results, rankings, awards, certifications, testimonials, quotations from customers, contact details, addresses, web addresses, founder names, or product names and variants that are not in the facts. Write no digits in any sentence. A calendar day is a number only in its own field.
3. Do not promise outcomes. Describe what to do and what to measure, never what will happen.
4. Do not create, redraw or rename a logo, a business name or a tagline.
5. Write complete, plain, professional sentences. No exclamation marks, no emoji, no dashes used as pauses, no slang, no questions.
6. The territory must work for the whole business, not one product, one festival, one season or one city.
7. Allowed formats: {{formats}}. Allowed channels: {{channels}}. Use between three and five pillars. Every calendar item names one of your pillars.
8. If the information basis is limited, say less, not more.

Return ONLY JSON in exactly this shape:
{
  "promise": "one sentence for the cover, a proposal",
  "positioning": {
    "audience": [{ "text": "", "tag": "inference", "factIds": ["F1"] }],
    "territory": { "name": "", "rationale": { "text": "", "tag": "proposed" }, "risk": { "text": "", "tag": "proposed" } },
    "line": { "text": "", "tag": "proposed" }
  },
  "whereToday": [{ "text": "", "tag": "inference", "factIds": ["F1"] }],
  "competitors": [{ "name": "", "observations": [{ "text": "", "tag": "inference", "factIds": ["F2"] }] }],
  "pillars": [{ "name": "", "why": { "text": "", "tag": "inference", "factIds": ["F1"] }, "example": { "text": "", "tag": "proposed" } }],
  "calendar": [{ "day": 1, "pillar": "", "format": "image post", "hook": { "text": "", "tag": "proposed" } }],
  "offers": [{ "factId": "F5", "hook": { "text": "", "tag": "proposed" }, "cta": { "text": "", "tag": "proposed" } }],
  "channels": [{ "channel": "Instagram", "priority": 1, "role": { "text": "", "tag": "proposed" } }],
  "roadmap": [{ "phase": "foundation", "focus": { "text": "", "tag": "proposed" }, "actions": [{ "text": "", "tag": "proposed" }], "measure": [{ "text": "", "tag": "proposed" }] }],
  "firstSteps": [{ "text": "", "tag": "proposed" }]
}
```
  The `blueprint.directions` template uses the same golden rule, facts and rules 1 to 5 and returns `{ "directions": [{ "name": "", "rationale": { "text": "", "tag": "proposed" }, "risk": { "text": "", "tag": "proposed" } }] }` with two to four directions, each tested against the skill's criteria in prose (fits the brand, relevant to the customer, different from the others, works across products and months, can be shown visually).
- `qa.js`: `scanClaimText(text, { allowedNumbers }) -> [{ rule, match? }]` (rules: `testimonial`, `award`, `ranking`, `guarantee`, `metric`, `follower_claim`, `number_word`, `invented_number`, `invented_contact`, `exclamation`, `emoji`, `em_dash`, `invented_quote`), `numbersIn(text)`, `allowedNumbersOf(sheet)` (every number in a verified fact's text), `claimsOf(section) -> Claim[]`, `runQa({ blueprint, sheet, input, dropped }) -> { passed, flags: [{ level: 'block'|'note', rule, where, detail }] }`. The scanner (verified to behave as shown below on the sample strings; this is the reference implementation):

```js
'use strict';
const { TAGS, PAGES, NEBULAA, LIMITS } = require('../../config/blueprint');

const FORBIDDEN = [
  ['testimonial', /\btestimonials?\b|\bcustomers? (love|say|rave)\b|\bfive[- ]star\b|\b5[- ]star\b/i],
  ['award', /\bawards?\b|\baward[- ]winning\b|\bcertified\b|\baccredited\b|\bfeatured in\b/i],
  ['ranking', /\bnumber one\b|#\s?1\b|\bbest[- ]selling\b|\bmarket leader\b|\bleading (brand|provider|company)\b|\bmost trusted\b|\btrusted by\b/i],
  ['guarantee', /\bguarantee[sd]?\b|\bwill (increase|double|triple|boost|grow)\b|\bproven (results|to)\b/i],
  ['metric', /\b(roi|roas|ctr|cpm|cpc)\b/i],
  ['follower_claim', /\bfollowers?\b.*\b(have|has|with|of)\b\s*\d|\d[\d,.]*\s*(k|m)?\s+followers?\b/i],
  ['number_word', /\b(hundreds?|thousands?|lakhs?|crores?|millions?|dozens?)\b/i]
];
const DIGITS = /\d[\d,.]*/g;
const CONTACT = /[\w.+-]+@[\w-]+\.[\w.-]+|https?:\/\/\S+|\bwww\.\S+|(?:\+?\d[\d\s-]{8,}\d)/i;
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}]/u;
const QUOTE = /["“”][^"“”]{12,}["“”]/;

const numbersIn = (text) => (String(text).match(DIGITS) || []).map((n) => n.replace(/[,.]+$/, '').replace(/,/g, ''));

function scanClaimText(text, ctx = {}) {
  const t = String(text || '');
  const allowed = new Set((ctx.allowedNumbers || []).map(String));
  const v = [];
  for (const [rule, re] of FORBIDDEN) if (re.test(t)) v.push({ rule });
  for (const n of numbersIn(t)) if (!allowed.has(n)) v.push({ rule: 'invented_number', match: n });
  if (CONTACT.test(t)) v.push({ rule: 'invented_contact' });
  if (/!/.test(t)) v.push({ rule: 'exclamation' });
  if (EMOJI.test(t)) v.push({ rule: 'emoji' });
  if (/—/.test(t)) v.push({ rule: 'em_dash' });
  if (QUOTE.test(t)) v.push({ rule: 'invented_quote' });
  return v;
}
```
  `runQa` implements the checks listed under "QA gate" above using these exact rules: page ids equal `PAGES` ids in order; `cover` and `closing` exist; every claim has a tag in `TAGS`; `verified` needs `factId` present in the sheet and `text` equal to that fact's text; `inference` needs a non-empty `factIds` all present in the sheet; `unverified` needs `reason`; every `inference` or `proposed` claim (and every pillar `name`, channel, calendar pillar) passes `scanClaimText` with `allowedNumbers = allowedNumbersOf(sheet)`; calendar has at least `MIN_CALENDAR_DAYS` distinct days within 1 to 30 and each names an existing pillar; pillars 3 to 5; roadmap 3 phases in `PHASES` order; `cover.businessName === input.businessName`; `cover.logo.url` equals `input.logoUrl` or `sheet.assets.logo.url` or is null; `closing.contact` equals `NEBULAA` exactly; every offer `price` string equals one of the visitor's typed offers; `dropped > MAX_DROPPED` blocks. `passed` is true only when no flag has `level: 'block'`.
- `planner.js`: `buildPlanVars(sheet, input, direction)`, `buildDirectionVars(sheet, input)`, `normalisePlan(parsed, sheet) -> { plan, dropped: [...] } | null`, `normaliseDirections(parsed, sheet)`, `runPlan({ sheet, input, direction, callLLM, parseJSON })`, `runDirections(...)`. Facts block lines are `F3 [typed: offer] Offer: Birthday cake, ₹499` (competitor facts go only into the `competitors` variable). The prompt is rendered with `renderTemplate(getPrompt(id).template, vars)` (never `buildPrompt`, so no override can apply). LLM call: `callLLM(prompt, { jsonMode: true, temperature: 0.4, maxTokens: 6500, skipCache: true })`, default `callLLM = (...a) => require('../openAI').callTextLLM(...a)` and `parseJSON = (...a) => require('../geminiAI').parseGeminiJSON(...a)`. The turning of a model item into a Claim is exactly:

```js
const str = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// The model can never produce Verified. An inference with no real fact behind it becomes a proposal.
function toClaim(raw, ctx, forceProposed = false) {
  const o = isObj(raw) ? raw : { text: raw };
  const text = str(o.text, 320);
  if (!text) return null;
  const ids = arr(o.factIds, 6).map((x) => str(x, 12)).filter((id) => ctx.factIds.has(id));
  let tag = o.tag === 'proposed' || forceProposed ? 'proposed' : 'inference';
  if (tag === 'inference' && !ids.length) tag = 'proposed';
  const bad = scanClaimText(text, { allowedNumbers: ctx.allowedNumbers });
  if (bad.length) { ctx.dropped.push({ text, rules: bad.map((b) => b.rule) }); return null; }
  return tag === 'inference' ? { text, tag, factIds: ids } : { text, tag };
}
```
  `normalisePlan` applies `toClaim` to every claim in the planner output, scans short labels (`pillar.name` <= 40 chars, `territory.name`, competitor `name`) with the same scanner, keeps formats in `FORMATS` and channels in `CHANNELS`, drops calendar items whose pillar is not one of the kept pillars, de-duplicates calendar days, clamps arrays (pillars 5, calendar 30, offers 3, channels 5, actions 4 and measure 3 per phase, firstSteps 5, observations 4 per competitor), maps an `offers[].factId` only if it is a typed offer fact in the sheet, and returns `null` when fewer than 3 pillars or fewer than `MIN_CALENDAR_DAYS` calendar items survive.
- `assemble.js`: `assembleBlueprint({ input, sheet, plan, direction, mode, now }) -> page-JSON`. Document shape (also the contract the frontend renders in Task 6):

```js
{
  version: 1, mode, basis: sheet.basis, generatedAt: now.toISOString(),
  cover: { businessName, logo: { url, source } | null, logoNote: 'Logo not provided' | null,
           colours: [{ hex, source }], promise: Claim | null, limitedNote: 'Based on limited information' | null },
  pages: [ { n, id, title, purpose, sections: [ Section ] } ],          // exactly the nine, in order
  sources: [ { url, kind, ok } ],
  closing: { heading: 'Turn this plan into posts in Nebulaa', body: 'Nebulaa turns each tile of this plan into a finished post for you to review and approve.',
             cta: { label: 'Open Nebulaa', href: '#/dashboard' }, contact: { email: NEBULAA.email, website: NEBULAA.website } }
}
// Claim: { text, tag, factId?, factIds?, reason? }.  Section: { heading, kind, items } where kind is one of
//   'claims'      items: Claim[]
//   'pillars'     items: [{ name, why: Claim, example: Claim }]
//   'calendar'    items: [{ day, pillar, format, hook: Claim }]            (days 1 to 30, gaps allowed)
//   'competitors' items: [{ name, url, observations: Claim[] }]
//   'offers'      items: [{ name, price, fact: Claim(verified), hook: Claim|null, cta: Claim|null }]
//   'channels'    items: [{ channel, priority, role: Claim }]
//   'phases'      items: [{ id, label, title, focus: Claim, actions: Claim[], measure: Claim[] }]
```
  Page contents: page 1 = section "What we confirmed" (verified non-competitor facts as Verified claims, `factId` set, text copied from the sheet) + "What we read from this" (`whereToday` inferences) + "What we could not confirm" (sheet `unverified` entries as `unverified` claims with `reason`); page 2 = audience inferences, the territory (a `claims` section with the territory name and rationale and risk as Proposed, and the chosen `direction` when guided), and the line; page 3 = competitors the visitor named with an address (their verified facts as Verified claims plus model observations as Inference), then the named-but-not-researched ones as Unverified, or, when none were given, one static sentence "Add the names and addresses of up to three competitors to see this page." as a `claims` item tagged `proposed`; pages 4 to 5 and 7 to 9 map directly from the plan; page 6 lists each typed offer exactly as typed (Verified) with model hook and cta, or, when none typed, one static `proposed` sentence "Add up to three of your real offers, with their prices, to see hooks written for them." Phase `label` and `title` come from `PHASES` (code), never the model. `cover.logo` is `input.logoUrl` (source `typed`) else `sheet.assets.logo` else null with `logoNote`. Static sentences are written to the voice rules and live as constants at the top of the file.
- `pipeline.js`: `buildBlueprint({ input, sheet, direction, mode, now }, deps) -> Promise<{ result, qa }>` (runs `runPlan`, `assembleBlueprint`, `runQa`; throws `Error('planner returned no usable plan')` when `normalisePlan` returns null) and `proposeDirections({ input, sheet }, deps) -> Promise<Direction[]>` (`[]` when fewer than 2 survive the scanner). Both take `deps = { callLLM, parseJSON }` with the lazy real defaults.

- [ ] **Step 1: Write failing tests.** Fixtures: `blueprintSheet.json` (a complete sheet for "Sweet Co": facts F1 name, F2 sells, F3 audience, F4 goal, F5 offer `Birthday cake, ₹499`, F6 page title, F7 page description, F8 heading, F9 competitor title with `subject`, unverified U1 `Instagram page could not be read`, `basis: 'full'`), `blueprintPlanGood.json` (a valid planner output: 4 pillars, 30 calendar items, 1 offer on F5, 3 channels, 3 phases, 4 first steps, all sentences clean, no digits) and `blueprintPlanBad.json` (the same plus these injected items: a claim with a price `Sell cakes at 299`, `Customers love our cakes`, `Our award-winning team`, `Email hello@sweetco.in`, a quoted testimonial `"The best cake I ever tasted in Chennai"`, `Over 10,000 followers`, an `Exciting launch!`, an em dash sentence, a claim tagged `verified`, an inference citing `F99`, a calendar item for a pillar that does not exist, and a channel `TikTok`).
  `blueprintPrompt.test.js`: the two prompts exist with `locked: true`; `listPrompts()` has no `blueprint.*` id while still listing `creative.director`; `await resolveTemplate('someUserId', 'blueprint.plan')` returns the shipped template even when a fake `PromptOverride` is injected via `require.cache` or by stubbing `require('../models/PromptOverride').findOne` to return a weaker template (stub and restore); `routes/prompts.js` source contains `prompt.locked` in both the PUT and DELETE guards; every `{{name}}` in each template is declared in `variables` and every declared variable appears in the template; the plan template contains the strings `THE GOLDEN RULE`, `You cannot mark anything as verified`, `Write no digits in any sentence` and does not contain `{{` after `renderTemplate` with a full set of fake vars; rendered text for the fixture sheet stays under 14,000 characters.
  `blueprintQa.test.js` (table-driven over the sample strings): a clean sentence yields `[]`; `Customers love our cakes and we are award-winning!` yields `testimonial`, `award`, `exclamation`; `Your 499 rupee plan` is clean with `allowedNumbers: ['499']` and `invented_number` without; `Reach us at hello@cakes.in or +91 98765 43210` yields `invented_contact` and invented numbers; `Visit www.cakes.in` yields `invented_contact`; `They said "the best cake I ever had in my life"` yields `invented_quote`; `Over 10,000 followers and growing` yields `follower_claim`; a sentence with an em dash yields `em_dash`; `Thousands of families trust us` yields `number_word`; `A leading brand in Chennai` yields `ranking`; a sentence with an emoji yields `emoji`; `allowedNumbersOf(sheet)` returns `['499']` for the fixture. `runQa` on an assembled good fixture passes with no `block` flags; mutate copies and assert the matching rule is flagged: remove a page (`pages`), reorder two pages, drop `closing`, set a claim's `tag` to `'maybe'` (`untagged`), a `verified` claim with altered text (`verified_not_in_sheet`), an inference citing `F99` (`inference_without_basis`), `cover.businessName` altered (`brand_name`), `cover.logo.url` changed to another URL (`logo_changed`), `closing.contact.email` altered, an offer price not typed by the visitor, 5 calendar days only (`calendar_thin`), a calendar pillar not in the pillars, 2 pillars, and `dropped: 7` (`too_many_removed`). A property test over the assembled good document: every claim (walk all sections with `claimsOf`) has a tag in `TAGS`, and every `verified` claim's `text` is equal to a sheet fact text with `tag: 'verified'` (nothing outside the verified set is labelled Verified).
  `blueprintPlanner.test.js` (fake `callLLM` returning the fixture JSON string, fake `parseJSON = JSON.parse`): `buildPlanVars` puts typed and page facts with their ids in `facts`, puts only competitor facts in `competitors`, and never includes the visitor's email or user id; the prompt sent to `callLLM` contains the golden-rule text, and `callLLM` is called once with `{ jsonMode: true, temperature: 0.4, maxTokens: 6500, skipCache: true }`; `normalisePlan(good)` returns 4 pillars, 30 calendar days, `dropped: []`; `normalisePlan(bad)` returns a plan in which none of the injected strings survives anywhere in `JSON.stringify(plan)`, the `verified` claim became `inference`/`proposed`, the inference citing `F99` became `proposed`, the TikTok channel and the orphan-pillar calendar item are gone, and `dropped.length >= 8`; a plan with 2 pillars returns `null`; `buildBlueprint` with the good fixture returns `qa.passed === true`, nine pages in order, `cover.limitedNote === null` for `basis: 'full'` and `'Based on limited information'` for `basis: 'limited'`, `closing.contact` equal to `NEBULAA`, and offer prices equal to the typed ones exactly; with the bad fixture it still passes QA after sanitising (the removed items are gone) but with `dropped` recorded; with a fake LLM returning `{}` it throws `planner returned no usable plan`; with an LLM that returns invented-heavy output for 8 claims (dropped over 6) `qa.passed === false` and the flag `too_many_removed`; `proposeDirections` returns `[]` when only one direction survives. A static test asserts `services/blueprint/*.js` do not contain `require('../scraper')`, `socialMediaAPI`, `campaignPublisher`, `ayrshare`, `serperLookup`, `zoho`, `emailService`.
- [ ] **Step 2:** run the three new files. Expected: FAIL.
- [ ] **Step 3: Implement** the two registry edits, the prompt file, `qa.js`, `planner.js`, `assemble.js`, `pipeline.js`. Wording of every static sentence follows the voice spec; keep each under 25 words.
- [ ] **Step 4:** run the new files, then the whole backend suite (the existing prompt-related tests must still pass). Expected: PASS.
- [ ] **Step 5: Commit** `feat: Blueprint planner prompt, page assembly and QA gate`.

---

### Task 4: Routes, limits, charge once and refund on failure, background status, guided checkpoints

**Files:** Create `backend/services/blueprint/runner.js`, `backend/services/blueprint/service.js`, `backend/routes/blueprint.js`, `backend/tests/blueprintFakes.js`; Modify `backend/server-main.js`; Test `backend/tests/blueprintService.test.js`, `backend/tests/blueprintRoutes.test.js`.

**Interfaces:**

- `runner.js`: `enqueue(task, max = LIMITS.MAX_CONCURRENT_RUNS)`: an in-process FIFO with a concurrency cap, no timers, errors logged and never thrown:

```js
const queue = [];
let active = 0;
function pump(max) {
  while (active < max && queue.length) {
    const task = queue.shift();
    active += 1;
    Promise.resolve().then(task)
      .catch((e) => console.error('[blueprint] run error:', e && e.message))
      .finally(() => { active -= 1; pump(max); });
  }
}
function enqueue(task, max) { queue.push(task); pump(max || LIMITS.MAX_CONCURRENT_RUNS); }
module.exports = { enqueue, _state: () => ({ active, queued: queue.length }) };
```
- `service.js`: `createBlueprintService(deps)` with `deps = { Blueprint, deduct, refund, uploadLogo, discover, plan: { build, directions }, enqueue, now, uuid, hashIp }` and methods `start({ user, tier, body, ip })`, `get({ userId, id })`, `list({ userId })`, `continueRun({ userId, id, body })`, `run(id)` (exported for tests and the runner), each returning `{ status, json }` (except `run`). `defaultDeps()` lazy-requires the real pieces: `models/Blueprint`, `deductCredits`/`refundCredits` from `middleware/trialGuard`, `uploadBase64Image` from `services/imageUploader` (`uploadLogo = async (dataUrl) => { const r = await uploadBase64Image(dataUrl, 'nebula-blueprint-logos'); if (!r || !r.success || !isPublicHttpsUrl(r.url)) throw new Error('upload failed'); return r.url; }`), `discover`, `{ build: buildBlueprint, directions: proposeDirections }`, `enqueue`, `hashIp = (ip) => crypto.createHash('sha256').update(`${process.env.JWT_SECRET || 'blueprint'}:${ip}`).digest('hex')`. The charged action is the constant `ACTION = 'blueprint'` and the price the existing `QUARK_COSTS.blueprint` (read for `charge.quarks`, never typed). Behaviour, in order, for `start`:
  1. `tier === 'free'` and `user.isVerified !== true` -> 403 `{ success: false, verificationRequired: true, message: 'Please verify your email address before you create your Blueprint.' }`.
  2. `normaliseInput(body, { allowGuided: tier !== 'free' })`; failure -> 400 `{ success: false, errors, message: 'Please correct the highlighted fields.' }` (no document, no charge).
  3. Free tier: `findOne({ freeSlot: true, emailKey })` then `findOne({ freeSlot: true, businessKeys: { $in: keys } })`; a hit -> 409 `{ success: false, alreadyUsed: true, id: <that blueprintId>, message: 'You have already created your free Brand Growth Blueprint for this business. Open it, or upgrade to create more.' }`.
  4. Limits (all tiers): `countDocuments({ ipHash, createdAt: { $gte: now - 24 h } })` against `FREE_PER_IP_PER_DAY` or `PAID_PER_IP_PER_DAY`, and for paid tiers `countDocuments({ userId, createdAt: { $gte: ... } })` against `PAID_PER_ACCOUNT_PER_DAY` -> 429 `{ success: false, message: 'You have reached the daily limit for Blueprints. Please try again tomorrow.' }`.
  5. If a logo file was sent, `uploadLogo`; failure -> 400 `{ errors: { logo: 'The logo could not be uploaded. Try again, or continue without it.' } }`; success sets `input.logoUrl`.
  6. `Blueprint.create({ blueprintId: uuid(), userId, emailKey: emailKey(user.email), tierAtStart: tier, mode, status: 'queued', step: 'queued', progress: 0, checkpoint: null, heartbeatAt, input, businessKeys, freeSlot: tier === 'free', ipHash, approvals: [], qaFlags: [], charge: { state: 'pending', quarks: QUARK_COSTS.blueprint }, createdAt: now() })`. An error with `code === 11000` (a concurrent duplicate) -> the same 409 as step 3 (look up the existing id).
  7. `deduct(userId, ACTION, 1, 'Brand Growth Blueprint')`. A throw, or `success !== true` -> mark the document `failed`, `freeSlot: false`, `charge.state: 'none'` (no refund: nothing was taken) and return 403 `{ success: false, creditsExhausted: true, upgradeRequired: true, reason: 'quarks', message: 'You do not have enough Quarks for this. Please upgrade your plan, or buy an add-on pack or Quarks.' }`. Success -> set `charge.state: 'charged'`.
  8. `enqueue(() => run(blueprintId))`; return 202 `{ success: true, id: blueprintId, status: 'queued' }`.
  `run(id)`: atomic claim `findOneAndUpdate({ blueprintId: id, status: 'queued' }, { $set: { status: 'processing', startedAt, heartbeatAt } })` (null -> return, so a second run never happens); `step: 'reading'` progress 10; `discover` (when `doc.sheet` is absent) then store `sheet`, `sources`, `step: 'checking'`, progress 35; if `sheet.stop`, `failAndRefund(doc, sheet.stop.message, 'stopped', { stop: sheet.stop })`; guided and no approval for checkpoint 0 -> `status: 'awaiting_approval'`, `checkpoint: 0`, return; guided and no direction chosen -> `plan.directions` (store `directions`), when 2 or more -> `awaiting_approval` with `checkpoint: 1`, return (fewer than 2 -> continue automatically and add a `note` qa flag `directions_skipped`); `step: 'planning'` progress 60; `plan.build`; `qa.passed === false` -> `failAndRefund(doc, 'We could not check this Blueprint well enough to share it. Please try again.', 'failed', { qaFlags })`; otherwise `status: 'completed'`, `step: 'done'`, progress 100, store `result`, `qaFlags`, `completedAt`. Any thrown error -> `failAndRefund(doc, 'We could not finish your Blueprint. Please try again.')`. Every state write sets `heartbeatAt`. `failAndRefund` sets `status`, `step`, `error: { message }`, `freeSlot: false` and calls `refundOnce`. `refundOnce` is the Hero pattern: `findOneAndUpdate({ blueprintId, 'charge.state': 'charged' }, { $set: { 'charge.state': 'refunded' } })`; null -> false; else `refund(userId, ACTION, 1, 'Refund: Brand Growth Blueprint')`, and if it throws or returns `success: false`, set the state back to `charged` and return false.
  `get`: `findOne({ blueprintId: id, userId })` (null -> 404 `{ success: false, message: 'This Blueprint was not found.' }`); a document with status `queued` or `processing` whose `heartbeatAt` is older than `STALE_MS` is failed and refunded (`'This Blueprint took too long, so we stopped it. Please try again.'`) and re-read; returns `publicView(doc)`:

```js
{ id, status, step, progress, mode, checkpoint, businessName: doc.input.businessName, createdAt,
  refunded: doc.charge && doc.charge.state === 'refunded',
  stop: doc.stop && doc.stop.message ? { reason: doc.stop.reason, message: doc.stop.message } : null,
  error: doc.status === 'failed' && doc.error ? doc.error.message : null,       // the 'no_quarks' internal marker is never sent
  discovery: awaiting && checkpoint === 0 ? { facts: [{ id, text, source }], unverified: [{ id, text, reason }], missing, basis } : undefined,
  directions: awaiting && checkpoint === 1 ? doc.directions.map((d, i) => ({ id: i, name: d.name, rationale: d.rationale, risk: d.risk })) : undefined,
  result: status === 'completed' ? doc.result : undefined }
```
  (`ipHash`, `emailKey`, `charge`, `businessKeys`, raw `sheet` and `sources` are never returned.) `list`: the owner's latest 20 as `[{ id, businessName, status, createdAt }]`. `continueRun`: owner-only (404 otherwise); status must be `awaiting_approval` (409 `{ message: 'This Blueprint is not waiting for your approval.' }`); checkpoint 0 needs no body; checkpoint 1 needs an integer `directionId` within range (400 otherwise); records the approval (`approvals: [...doc.approvals, { checkpoint, at, choice }]` via `$set`), then `findOneAndUpdate({ blueprintId, status: 'awaiting_approval', checkpoint }, { $set: { status: 'queued', checkpoint: null, heartbeatAt, approvals } })` and `enqueue(() => run(id))`; returns 202 `{ success: true, id, status: 'queued' }`. `run` resumes from the stored `sheet` and `directions`, so discovery is never repeated.
- `routes/blueprint.js`: `createBlueprintRouter(impl = {})` (the Hero pattern: `impl.service` for tests, otherwise built lazily from `defaultDeps()`), exports the router with `router.createBlueprintRouter` attached. Routes (every one starts with `protect`): `POST /` -> `protect, requireFeature('blueprint'), checkTrial, requireCredits('blueprint', 1), writeLimiter` then the handler (tier from `resolveTier(user)`; `ip = req.ip`); `GET /` -> `protect, readLimiter`; `GET /:id` -> `protect, readLimiter`; `POST /:id/continue` -> `protect, writeLimiter`. Limiters are `express-rate-limit` with `keyGenerator: (req) => String(req.user?._id || req.user?.id || ipKeyGenerator(req.ip))` (write: 20 per 15 minutes, read: 600 per 15 minutes). A request with no user id returns 401. Unexpected errors return 500 `{ success: false, message: 'We could not complete that request. Please try again.' }` and never include stack text. `server-main.js`: `const blueprintRoutes = require('./routes/blueprint');` beside `heroVideoRoutes` and `app.use('/api/blueprint', blueprintRoutes);` beside `/api/hero-video`; add `{ method: 'POST', pattern: /^\/api\/blueprint$/, feature: 'blueprint_started', module: 'blueprint' }` to `FEATURE_ROUTE_MAP`.
- `tests/blueprintFakes.js` (not a test file): `makeBlueprintModel()` with `docs`, `create(doc)` (clones, stamps nothing, and throws `Object.assign(new Error('E11000'), { code: 11000 })` when `doc.freeSlot` is true and another doc with `freeSlot: true` shares the `emailKey` or any `businessKeys` element), `findOne(filter)`, `find(filter).sort().limit().lean()`, `findOneAndUpdate(filter, update)` (returns the pre-update clone, supports `$set` with dotted keys), `updateOne`, `countDocuments(filter)`; filters support equality (an array field matches when it contains the value), `$in` (any element), `$ne`, `$gte`, dotted paths. `makeDeps(over)` returns `{ Blueprint, calls: { deduct: [], refund: [], upload: [], discover: 0, directions: 0, build: 0 }, deduct, refund, uploadLogo, discover, plan, enqueue: (t) => { queued.push(t); }, now, uuid (sequential `bp-1`, `bp-2`), hashIp: (ip) => `h:${ip}` }` where the fake discover returns a sheet from `fixtures/blueprintSheet.json` and the fake build returns `{ result: <doc>, qa: { passed: true, flags: [] } }`; tests run queued tasks by `await drain()`.

- [ ] **Step 1: Write failing tests.**
  `blueprintService.test.js` (fakes only): validation failure -> 400, no document, `calls.deduct.length === 0`; a free unverified user -> 403 `verificationRequired`; a successful free start -> 202, document `status: 'queued'`, `freeSlot: true`, `charge.state: 'charged'`, `charge.quarks === QUARK_COSTS.blueprint`, `deduct` called exactly once with `(userId, 'blueprint', 1, ...)`; after `drain()` the document is `completed`, `result` stored, `progress` 100, and `refund` never called; the same user starting again for the same business -> 409 with the first id and no second charge; a different user with the same Gmail alias (`a.b@gmail.com` vs `ab+x@gmail.com`) -> 409; a different email with `https://www.sweetco.in` vs `sweetco.in` -> 409; with only the same Instagram handle -> 409; two concurrent `start` calls for the same business (`Promise.all`) -> exactly one 202 and one 409 and exactly one `deduct`; a failed Blueprint (planner throws) releases the slot (`freeSlot: false`) and the same user can start again (202); a stopped one (fake discover returning `sheet.stop`) also releases the slot, is `stopped`, and is refunded; the planner throwing -> `failed`, exactly one refund, `charge.state: 'refunded'`; QA failing -> `failed`, one refund, `qaFlags` stored; calling `refundOnce` twice (or `run` failing twice via a replayed task) refunds once; a refund that throws leaves `charge.state: 'charged'` (retryable) and does not throw; `deduct` returning `{ success: false }` -> 403 with `reason: 'quarks'`, document `failed`, `freeSlot: false`, `charge.state: 'none'`, `refund` never called, and a later start succeeds once the balance is fixed; free IP limit: three starts from one IP in 24 hours succeed (using different businesses and users), the fourth is 429, and a start 25 hours later succeeds (inject `now`); failed attempts count toward the IP limit; a paid tier is limited to 5 per account per day and 10 per IP; `get` for another user's id -> 404; `get` never returns `ipHash`, `emailKey`, `charge`, `businessKeys`, `sheet` or `sources` (assert with `JSON.stringify(json)` not containing those keys); a stale `processing` document (heartbeat 9 minutes old) is failed and refunded by `get`, a fresh one is untouched, a `queued` stale one with `charge.state: 'pending'` is failed with no refund call; a second `run` on the same id is a no-op; guided mode as a non-free tier: `run` stops at `awaiting_approval` checkpoint 0 and `get` returns `discovery` (and no `result`); `continueRun` by another user -> 404, in a wrong status -> 409, then `run` stops at checkpoint 1 with `directions` of 2 to 4 entries; `continueRun` without or with an out-of-range `directionId` -> 400; with a valid one, `run` completes and `build` received the chosen direction; discovery ran once in total (`calls.discover === 1`); a free user sending `mode: 'guided'` is run as `auto`; the logo upload is called only when a data URL was sent, an upload failure -> 400 and no document; the runner: with `max = 1`, two enqueued tasks run one after the other (use a task that records start and end order) and `_state()` returns to `{ active: 0, queued: 0 }`.
  `blueprintRoutes.test.js`: route introspection like `heroVideoRoutes.test.js`: the four routes exist; every route's first middleware is `protect`; `POST /` has `requireFeature`'s handler, `checkTrial` and the credits guard in the chain, in that order after `protect`; handlers called with a fake service return its `{ status, json }`; a request without a user id gets 401; a thrown service error gives 500 with the generic message and no stack; a static test reads `server-main.js` and asserts both the `require` and `app.use('/api/blueprint', blueprintRoutes)` lines; tier rules: with the real `requireFeature('blueprint', { loadUser })` a free user passes, while `requireFeature('publish', { loadUser })` for the same free user answers 403 `upgradeRequired` (a free account can create a Blueprint and cannot reach outside services); a static test asserts `routes/blueprint.js` and `services/blueprint/*.js` require none of `socialMediaAPI`, `campaignPublisher`, `ayrshareGuard`, `scraper`, `serperLookup`, `zohoBooks`, `emailService`.
- [ ] **Step 2:** run the two files. Expected: FAIL.
- [ ] **Step 3: Implement** the runner, service, routes, `server-main.js` lines, and the fakes helper.
- [ ] **Step 4:** run the new files and the full backend suite (every file exits by itself; `server-main.js` is read as text, never started). Expected: PASS.
- [ ] **Step 5: Commit** `feat: Blueprint routes with limits, single charge, refund on failure and guided checkpoints`.

---

### Task 5: Public landing section, sign-up deep link, form and progress page

**Files:** Create `frontend/utils/blueprint.ts`, `frontend/constants/blueprintCopy.ts`, `frontend/pages/BlueprintRoutes.tsx`, `frontend/pages/BlueprintStart.tsx`, `frontend/pages/BlueprintView.tsx` (progress and checkpoints only in this task; the document is Task 6), `frontend/tests/blueprint.test.mjs`; Modify `frontend/App.tsx`, `frontend/pages/Auth.tsx`, `frontend/pages/LandingPage.tsx`, `frontend/services/api.ts`, `frontend/tests/voice-scope.json`. Precondition: the pending edits to `Auth.tsx` and `LandingPage.tsx` made by another session are committed or discarded (see Global Constraints).

**Interfaces:**

- `utils/blueprint.ts` (pure, no imports from React; plain TypeScript that Node can run, like `utils/plans.ts`, so no enums): `BlueprintStatus`, `BlueprintView`, `BlueprintInputForm` types; `GOALS` (`[{ value: 'enquiries', label: 'More enquiries' }, { value: 'sales', label: 'More sales' }, { value: 'followers', label: 'More followers' }, { value: 'launch', label: 'A launch' }]`); `validateForm(form) -> { ok, errors }` mirroring the backend rules (same sentences as Task 1); `emptyForm()`; `isTerminal(status)`; `progressText(view) -> string` and `statusHeading(view) -> string` giving plain sentences per state (below); `pollDelayMs(attempt)` (3000 for the first 20 polls, then 6000); `quarksNote(cost?: number) -> string` (`'This uses {n} of your Quarks.'`, or `'This uses a small number of your Quarks.'` when the cost is unknown); `intentFromSearch(search) -> 'blueprint' | null`; `fileToDataUrl` is NOT here (browser only). Status copy (exact): `queued` "Your Blueprint is in the queue. This usually takes a few minutes."; step `reading` "Nebulaa is reading the pages you pointed to."; `checking` "Nebulaa is checking what it found."; `planning` "Nebulaa is writing your plan."; `awaiting_approval` checkpoint 0 "Please check what Nebulaa found before it writes your plan."; checkpoint 1 "Please choose the direction for your plan."; `stopped` shows the server `stop.message` then "Your Quarks were returned."; `failed` shows `error` then "Your Quarks were returned." when `refunded`; `completed` "Your Blueprint is ready."
- `constants/blueprintCopy.ts`: one exported object `BLUEPRINT_COPY` holding every line of the landing section and form (headline, subline, three "what you receive" lines, the tag legend lines, button labels, form labels and helper text, the free-mode note). Default text is Option A of the copy document (Task 7); no strings are written inside the components. Copy rules: no exclamation marks, no emoji, no claim of speed, no invented number (the Quark amount shown is read from `getCredits().costs.blueprint`).
- `services/api.ts` additions (use the existing `apiCall(..., true)` and the existing error object with `.data`): `blueprintStart(body)` -> POST `/blueprint`; `blueprintGet(id)` -> GET `/blueprint/:id`; `blueprintList()` -> GET `/blueprint`; `blueprintContinue(id, body?)` -> POST `/blueprint/:id/continue`. Types exported with them.
- `App.tsx`: add (before the `/*` catch-all, after the legal routes) `<Route path="/blueprint/*" element={user ? <BlueprintRoutes user={user} onLogout={handleLogout} /> : <Navigate to="/login?mode=signup&intent=blueprint" replace />} />`. `BlueprintRoutes` renders its own nested `<Routes>` (`''` list, `new`, `:id`) and wraps them in `Layout` only when `user.onboardingCompleted` (so a visitor who has just verified their email goes straight to the form, not through onboarding); otherwise a bare light page with the Nebulaa wordmark and a "Go to your dashboard" link. These routes sit outside the Quark paywall on purpose: a finished Blueprint stays readable at zero Quarks. The `/login` route's redirect for a signed-in user becomes `<LoginRedirect />`, a small component that reads `intent` with `useSearchParams` and navigates to `/blueprint/new` when `intentFromSearch` is `blueprint`, else `/dashboard`. `Auth.tsx`: after a successful login, sign-up verification or token response, replace the three `navigate('/dashboard')` calls with `navigate(target)` where `target = intentFromSearch(location.search) === 'blueprint' ? '/blueprint/new' : '/dashboard'`, and prefill nothing else. Nothing else in `Auth.tsx` changes.
- `LandingPage.tsx`: `const signUpBlueprint = () => navigate('/login?mode=signup&intent=blueprint');` a nav link "Free Blueprint" to `#blueprint`, a section `<section id="blueprint">` placed between `#what-it-makes` and `#how-it-works` (headline, subline, three received items, the tag legend as four labelled chips `[Verified] [Inference] [Proposed] [Unverified]`, a primary `CtaButton` calling `signUpBlueprint`, and one line "It uses a small number of your 100 free Quarks."), all strings from `BLUEPRINT_COPY`, using the page's existing constants (`INK`, `GROUND`, `SURFACE`, `RULE`, `CORAL`, `GOLD`, `CtaButton`) and the same section padding as its neighbours; layout must not overflow at 375 px.
- `BlueprintStart.tsx` (route `/blueprint/new`): a single-column form in the Nebulaa light tokens (`GravityPanel`, `GravityLabel`, `GravityButton` from `components/gravity`, `var(--gv-*)` colours; no hard-coded hex), fields in the order: business name, website, Instagram page, what you sell (one sentence), who it is for, main goal (radio buttons from `GOALS`), then a closed "Add more detail (optional)" group: city, up to three competitors (name and address), up to three offers (name and price, with the helper "Enter only real offers with the prices you charge; Nebulaa never adds prices of its own."), up to three brand colours (colour inputs), a logo file (PNG, JPG or WebP, 2 MB; read with `FileReader` into a data URL; shown as a thumbnail; "Nebulaa uses your logo exactly as it is."). Prefills `businessName` and `website` from `user.companyName` and `user.businessProfile?.website` when present. Non-free accounts (`user.plan?.tier` present and not `free`, or no `plan` for existing accounts) also see a mode choice: "Guided: you approve what Nebulaa found and choose the direction" or "Automatic"; free accounts do not. Shows `quarksNote(costs.blueprint)` from `apiService.getCredits()`. Submit runs `validateForm`, then `apiService.blueprintStart`; on success `navigate('/blueprint/' + id)`; on 409 `alreadyUsed` shows the plain message with a button "Open your Blueprint" to `/blueprint/<id>`; on a 403 with `upgradeInfoOf(err)` (from `utils/plans.ts`) renders `UpgradePrompt`; on 400 maps `errors` to the fields; on 429 shows the message. A short note under the form: "Nebulaa reads only the pages you point to, and nothing from your answers is published anywhere."
- `BlueprintView.tsx` (route `/blueprint/:id`): polls `blueprintGet` with `pollDelayMs` until `isTerminal` or `awaiting_approval` (cancel on unmount; handle errors by showing "We could not load your Blueprint. Please refresh the page."), shows a stepper (reading, checking, planning, ready) driven by `step`/`progress`, `statusHeading` and `progressText`; Checkpoint 0 shows `discovery` as two lists ("What Nebulaa confirmed" with each fact's text and a `[Verified]` chip, "What Nebulaa could not confirm" with `[Unverified]` chips and reasons, and "Not provided" from `missing`) and a button "Continue to the plan" (`blueprintContinue(id)`); Checkpoint 1 shows 2 to 4 direction cards (name, rationale with a `[Proposed]` chip, risk) with a radio choice and "Use this direction" (`blueprintContinue(id, { directionId })`); a `stopped` or `failed` view shows the message and a link "Change your answers" back to `/blueprint/new`; `completed` renders `<BlueprintDocument view={view} />` (a placeholder component exporting a "Your Blueprint is ready." panel in this task, replaced in Task 6). Tag chips are a small shared component in `components/blueprint/TagChip.tsx` (created here): the label text is always shown (`[Verified]` and so on) with the pastel token background from `--gv-mint`, `--gv-sky`, `--gv-lav`, `--gv-peach`, ink text, so meaning never depends on colour.
- `tests/voice-scope.json`: add `pages/BlueprintStart.tsx`, `pages/BlueprintView.tsx`, `pages/BlueprintRoutes.tsx`, `components/blueprint/BlueprintDocument.tsx`, `components/blueprint/TagChip.tsx`, `constants/blueprintCopy.ts`.

- [ ] **Step 1: Write failing tests** `frontend/tests/blueprint.test.mjs` (imports `../utils/blueprint.ts` and `../constants/blueprintCopy.ts`): `validateForm` mirrors the backend (empty form lists errors for name, website-or-Instagram, what you sell, who it is for, goal; Instagram only is valid; 9-character `whatYouSell` rejected; a competitor with a bad address is rejected; three offers max); `statusHeading` and `progressText` return the exact sentences above for each state and never contain `credit`, `trial`, `!`; a stopped view appends "Your Quarks were returned." only when `refunded`; `pollDelayMs(0) === 3000` and `pollDelayMs(25) === 6000`; `intentFromSearch('?mode=signup&intent=blueprint') === 'blueprint'` and `intentFromSearch('?mode=signup') === null`; `quarksNote(7) === 'This uses 7 of your Quarks.'`; every string in `BLUEPRINT_COPY` (walk the object) passes the same checks as the voice scanner (no `!`, no emoji, no em dash, none of `unlock`, `amazing`, `magic`, `game-changer`, `supercharge`, `seamless`, `hey`) and does not match `/\b(credits?|trial|7 days?)\b/i`; the four tag labels in the legend equal `[Verified]`, `[Inference]`, `[Proposed]`, `[Unverified]`.
- [ ] **Step 2:** `cd frontend && node --test tests/blueprint.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the helpers, copy file, API functions, pages, routes, `Auth.tsx` and `LandingPage.tsx` edits.
- [ ] **Step 4:** `cd frontend && node --test tests/*.test.mjs` (the quarks-wording, voice and brand scanners now cover the new files and must pass) and `npx tsc --noEmit` (exactly the 3 pre-existing errors). Then add the routes `/blueprint/new` and `/blueprint/:id` (a completed fixture is Task 6; here use the progress state) to `scripts/visual-audit/routes.json` and stub `/api/blueprint*` in `scripts/visual-audit/mock-session.js` (read the file's `ROUTES` table first and follow its format; the stub answers `GET /api/blueprint/<id>` with a `processing` view, `POST` with a canned 202, and `GET /api/credits` keeps its existing answer plus `costs.blueprint: 7`), and audit the new routes only on `http://127.0.0.1:3100` at 1280 and 375 widths (README of `frontend/scripts/visual-audit`; never reach :5000 or :3000). Expected: PASS with no contrast failures on the new routes; the landing `#blueprint` section checked on the `/` route at 1280 and 375.
- [ ] **Step 5: Commit** `feat: Blueprint landing section, sign-up link, form and progress page`.

---

### Task 6: Blueprint page with print stylesheet, in-app entry, guided checkpoints and calendar hand-off

**Files:** Create `frontend/components/blueprint/BlueprintDocument.tsx` (replaces the placeholder), `frontend/scripts/visual-audit/blueprint-fixture.json` (a copy of the backend fixture result wrapped in a completed view); Modify `frontend/utils/blueprint.ts`, `frontend/pages/BlueprintView.tsx`, `frontend/pages/BlueprintRoutes.tsx`, `frontend/components/Layout.tsx`, `frontend/pages/CalendarHome.tsx`, `frontend/scripts/visual-audit/routes.json`, `frontend/scripts/visual-audit/mock-session.js`; Test `frontend/tests/blueprint.test.mjs` (extend).

**Interfaces:**

- `utils/blueprint.ts` additions (pure): `claimLabel(tag) -> '[Verified]'|...`; `calendarTiles(items) -> Array<{ day: number, item: CalendarItem | null }>` (always 30 entries, day 1 to 30, `null` for an open day); `calendarFocusFrom(result) -> string` builds the text passed as `focus` to the existing calendar generator: `Plan this month around these content pillars: <names joined with ", ">. Territory: <territory name>. Main goal: <goal label>.` (names and goal only; at most 600 characters; no digits added; returns `''` when no pillars); `coverStyle(cover) -> { background, color }` that uses the visitor's first two verified colours when present, else the tokens; `documentFileName(businessName) -> 'Brand Growth Blueprint - <name>.pdf'` (ASCII-safe, used as the document title so the print dialog proposes it).
- `BlueprintDocument.tsx` renders the page-JSON from Task 3 exactly (cover, nine pages, closing) as A4 portrait pages (794 px wide on screen). Each page has a different visual grammar (skill section 10), all from `var(--gv-*)` tokens and the visitor's own colours: cover = large typographic business name over a band in the brand colours, the logo unchanged (`<img>` with `object-fit: contain`, no filters, no recolouring) or the name in plain type with "Logo not provided", the promise line with its tag chip, the limited-information note when present, the Nebulaa wordmark; page 1 = two columns "What we confirmed" (Verified) and "What we could not confirm" (Unverified), the sources footnote listing the page addresses read; page 2 = a large territory statement with the audience readings beside it; page 3 = one card per competitor (or the static explanation); page 4 = pillar cards in `--gv-peach`, `--gv-mint`, `--gv-sky`, `--gv-lav`, `--gv-panel-2` rotating; page 5 = a 7-column by 5-row grid of 30 typographic tiles (day, pillar, format, hook; an open day shows "Open day"); page 6 = offer cards with the typed price in large type, hook and call to action beneath; page 7 = ranked rows with priority; page 8 = three phase columns (label, title, focus, actions, measure); page 9 = numbered list; closing = heading, body, contact lines, and the button "Open Nebulaa" (hidden in print). Every claim is followed by its chip with the label text, `inference` claims show a `title` listing the facts they rest on (and in print the fact ids in small type). Toolbar above the document (class `bp-noprint`): "Print or save as PDF" (`window.print()`), "Use this plan in my calendar" (calls `POST /api/content-calendar/regenerate` through a new `apiService.regenerateCalendar({ focus })` wrapper, then navigates to `/content-calendar`; shown only to accounts with `onboardingCompleted`), "Create another Blueprint" (non-free) or an upgrade note for free accounts after the first one. While the page is open the document `<title>` is `documentFileName(...)` (restored on unmount). Print stylesheet inside the component:

```css
@page { size: A4; margin: 12mm; }
.bp-doc { --bp-gap: 24px; }
.bp-page { background: var(--gv-panel); border: 1px solid var(--gv-border-subtle); border-radius: 16px; max-width: 794px; margin: 0 auto var(--bp-gap); padding: 40px; box-shadow: var(--gv-shadow-card); }
@media (max-width: 640px) { .bp-page { padding: 20px; border-radius: 12px; } .bp-cal { grid-template-columns: repeat(2, minmax(0, 1fr)); } .bp-phases { grid-template-columns: 1fr; } }
@media print {
  html, body { background: #fff !important; }
  .bp-doc, .bp-doc * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .bp-noprint { display: none !important; }
  .bp-page { break-after: page; break-inside: avoid; max-width: none; margin: 0; padding: 0; border: 0; border-radius: 0; box-shadow: none; }
  .bp-page:last-child { break-after: auto; }
  .bp-cal { grid-template-columns: repeat(7, minmax(0, 1fr)); }
}
```
  The document must not use `bg-white/…` or other classes that the app's override layer in `index.html` remaps; use the `--gv-*` tokens directly (the layer notes in `index.html` explain why).
- `BlueprintView.tsx`: renders `BlueprintDocument` for `completed`. `BlueprintRoutes` list route (`''`): a page of the owner's Blueprints (`blueprintList`) with status chips and a "Create a Blueprint" button; an empty state "You have not created a Blueprint yet. Create one to see a 90-day plan for your business."
- In-app entry: `Layout.tsx` adds `{ path: '/blueprint', label: 'Growth Blueprint', icon: <a lucide icon already imported or `FileText`> }` to `secondaryNav` (first entry) and a `resolveTopBarMeta` case `pathname.startsWith('/blueprint')` -> `{ title: 'Growth Blueprint', crumb: '' }`; `CalendarHome.tsx` Plan tab gets a compact card above the calendar: heading "Brand Growth Blueprint", text "Build a 90-day plan from your website and Instagram page, then use it to plan your calendar.", button "Create a Blueprint" -> `/blueprint/new` (one short card; no other change to that page).
- Visual audit: add `blueprint-view` (completed fixture), `blueprint-list` and `blueprint-new` routes to `routes.json`, extend the mock stub with the fixture, audit those routes only at 1280 and 375.

- [ ] **Step 1: Write failing tests** (extend `blueprint.test.mjs`): `calendarTiles` returns 30 entries in order with `null` for missing days; `calendarFocusFrom` for a fixture result starts with `Plan this month around these content pillars:`, contains each pillar name, is at most 600 characters, contains no digits other than those in names, and returns `''` with no pillars; `coverStyle` uses the first two colours when given; `documentFileName("Sweet & Co/Cakes")` has no `/`, `&` or `:` and ends in `.pdf`; a static test reads `components/blueprint/BlueprintDocument.tsx` and asserts it contains `@page`, `break-after: page`, `print-color-adjust`, `.bp-noprint`, the four tag labels via `claimLabel` (no hard-coded colour-only meaning) and does not contain `bg-white/` or `text-white/`; a render-free structural test loads `backend/tests/fixtures/blueprintPlanGood.json`-derived result (via a copy at `frontend/scripts/visual-audit/blueprint-fixture.json`) and asserts the helper-derived page list has nine pages in the order of the table above plus cover and closing.
- [ ] **Step 2:** `cd frontend && node --test tests/blueprint.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the component, helpers, routes, nav entry, Calendar card, `regenerateCalendar` wrapper and audit entries.
- [ ] **Step 4:** run the frontend tests, `npx tsc --noEmit` (3 pre-existing errors only), the backend suite, and the audit on `blueprint-view`, `blueprint-list`, `blueprint-new` at 1280 and 375 on 127.0.0.1:3100 (no contrast failures; no horizontal scroll at 375; the 30-tile grid is two columns on a phone). Then a manual look at the print preview (`window.print()` preview in the audit browser, or Chrome print preview) at A4 on the fixture: cover, nine pages and closing each on their own sheet, nothing cut off, tags readable in black and white; record the result in the task report (a screenshot of the cover and page 5 saved under the scratchpad, not committed).
- [ ] **Step 5: Commit** `feat: Blueprint document page with print stylesheet, in-app entry and calendar hand-off`.

---

### Task 7: Copy options, wording scan and final verification

**Files:** Create `docs/superpowers/specs/assets/brand-growth-blueprint-copy-options.md`, `backend/tests/blueprintWording.test.js`; Modify `frontend/constants/blueprintCopy.ts` only if the owner picks another option (otherwise Option A stays); Test as listed.

**Interfaces:** the copy document holds three options for the ad and the landing section, written to the voice rules (plain complete sentences, no exclamation marks, no emoji, no slang, no invented claim, no speed promise, no number other than the 100 free Quarks). Each option has: ad headline (at most 40 characters), ad primary text, landing headline, landing subline, button label, and the one-line note. Commit these exact drafts:

  **Option A (default in the build)**
  - Ad headline: `Get your Brand Growth Blueprint, free`
  - Ad primary text: `Answer a few questions about your business. Nebulaa reads the pages you point to and writes a printable 90-day growth plan. Every statement in it is marked as verified or as a suggestion, so you can see what is fact and what is advice.`
  - Landing headline: `A written growth plan for your business, free.`
  - Landing subline: `Tell Nebulaa about your business. You receive a printable Brand Growth Blueprint with what Nebulaa confirmed about your brand, who to speak to, what to post and what to do first.`
  - Button: `Get my free Blueprint`
  - Note: `It uses a small number of your 100 free Quarks.`

  **Option B**
  - Ad headline: `Your brand, planned for 90 days`
  - Ad primary text: `Share your website and a few details. Nebulaa prepares a Brand Growth Blueprint: your audience, your content themes, a month of post ideas and the first steps to take. It is free to create.`
  - Landing headline: `See your next 90 days of marketing on paper.`
  - Landing subline: `The Blueprint shows what Nebulaa could confirm about your business, then proposes a plan you can print, share with your team or turn into posts.`
  - Button: `Create my Blueprint`
  - Note: `It uses a small number of your 100 free Quarks.`

  **Option C**
  - Ad headline: `A growth plan that shows its sources`
  - Ad primary text: `Most marketing plans mix facts with guesses. The Nebulaa Brand Growth Blueprint labels each statement as verified, inferred, proposed or unverified. Create yours free.`
  - Landing headline: `A marketing plan that separates facts from suggestions.`
  - Landing subline: `Every statement in your Blueprint is labelled, so you always know what Nebulaa confirmed from your own pages and what it is recommending.`
  - Button: `Get my free Blueprint`
  - Note: `It uses a small number of your 100 free Quarks.`

  Also in the document: a recommendation (A, because it uses the owner's own phrase) and the two questions the spec leaves open, answered with this plan's decision (competitor read only when the visitor names competitors with an address).
- `blueprintWording.test.js`: reads the customer-facing strings of the backend (the string literals assigned to `message`, `STOP_MESSAGES`, `LIMITED_NOTE`, the static sentences in `assemble.js`, and the `PAGES`/`PHASES` titles and purposes, obtained by `require`-ing the config and by scanning `routes/blueprint.js` and `services/blueprint/service.js` for `message: '...'` literals) and fails on any of: `!`, an emoji, an em dash, `credit(s)`, `trial`, `7 days`, and the voice scanner's banned words (`unlock`, `seamless`, `amazing`, `magic`, `game-changer`, `supercharge`, `vibe`, `hey`, `oops`, `yay`, `awesome`); asserts each message ends with a full stop; fixture scanner: runs `scanClaimText` over every claim text in the assembled good fixture (all Inference and Proposed text) and asserts zero violations, and over `blueprintPlanBad.json` asserts at least one violation per injected case (table-driven), so the scanner and the wording rule cannot silently weaken.
- [ ] **Step 1:** write the copy document and the failing test; run `cd backend && node --test tests/blueprintWording.test.js`. Expected: FAIL until the document and test are in place (the test also asserts the copy document exists and contains the three options and no `!`).
- [ ] **Step 2: Final verification (no new code):** `cd backend && node --test tests/*.test.js` (251 + all new, every file exits), `cd frontend && node --test tests/*.test.mjs` (56 + new), `cd frontend && npx tsc --noEmit` (exactly 3 pre-existing errors), `git status` shows only Blueprint files plus the pre-existing unrelated edits (do not compare against `main`: it is not the base for this branch). Search the diff for `localhost:5000`, `localhost:3000`, `.env` and keys: none.
- [ ] **Step 3: Commit** `docs: Blueprint copy options and wording scan`.

## Open questions for the owner

1. **Skill pages not in the spec.** The approved spec's nine pages leave out the skill's cinematic campaign concept (skill page 4) and identity or packaging exploration (skill page 6). The plan follows the spec. Should a later version add the cinematic concept page (it fits the Hero video product well)?
2. **Logo not provided.** The skill says automatic mode stops if the logo cannot be verified. For a free lead magnet that would reject many visitors, so this plan continues with the name in plain type and the note "Logo not provided". Confirm, or require a logo.
3. **Nebulaa contact details on the closing page.** Only `support@nebulaa.ai` is confirmed (it is on the website). The plan also uses `https://nebulaa.ai` as the website line and leaves out phone and social handles. Please confirm the website address and give any phone number or handles to show.
4. **Pending edits from another session.** `Auth.tsx`, `LandingPage.tsx`, `Onboarding.tsx`, `NotificationBell.tsx`, `index.html`, `routes/auth.js` and `tests/onboardingContract.test.js` carry uncommitted changes. Task 5 edits two of them; they should be committed or discarded first.
5. **Identity check strictness.** A website whose title, headings and address never mention the business name stops the run (`identity_mismatch`) and refunds. This protects against Blueprints for someone else's site but can stop a brand that only shows its name in a logo image. Keep, soften to a warning on the cover, or remove?
6. **Production index build.** Task 1 adds two partial unique indexes on a new empty `blueprints` collection. Given the earlier Atlas disk-limit incident, please confirm `autoIndex` is acceptable on production or tell me to create them manually after deploy.
7. **Existing unsafe fetch.** `routes/auth.js` calls `scrapeWebsite` on the signup website (`services/scraper.js`), which has no protection against private addresses. It is outside this build, but it is the same risk the Blueprint avoids; worth a separate fix.
8. **Copy choice.** Option A is the default in the build; the owner picks the final ad and landing wording from the copy document.
