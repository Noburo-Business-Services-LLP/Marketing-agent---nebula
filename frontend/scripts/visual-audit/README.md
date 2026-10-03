# Visual / contrast audit

Measures WCAG AA text contrast on every page of the app, with a fake signed-in session and canned
API data, without a backend. Used for the legibility pass (Tasks 6-8 of the Nebulaa foundation
plan). The baseline report is `docs/superpowers/specs/assets/nebulaa-contrast-baseline.md`.

| File | What it is |
|---|---|
| `contrast-math.mjs` | Pure maths, all unit tested in `frontend/tests/contrast-math.test.mjs`: `parseColor`, `composite`, `luminance`, `ratio`, `isLargeText`, `requiredRatio`; gradients (`parseBackgroundImage`, `gradientColorAt`, `gradientT`); compositing (`over`, `overGroup`, `flatten` with opacity groups, image substitutes and covers; `assemblePaints` for positioned layers; `expandAlternatives`; `classifyUncertain`). |
| `contrast-audit.js` | Body of an async function run inside the page. Returns `{ route, checked, failureCount, failures[], unknown[], disabled[], placeholders[], gradientText[], unparsedColors[], ... }`. The header comment explains exactly how backgrounds and text colours are measured and what is skipped. |
| `unknown-signoff.json` | Items the audit cannot measure that a person has checked by eye (see the gate). Starts empty. |
| `mock-session.js` | Fake session + stub for `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, and the in-page runner (`__auditRoute`, `__auditRun`, `__auditStart`, `__auditShot`). |
| `vite.audit.config.mjs` | Vite config that injects `mock-session.js` before the app boots, binds 127.0.0.1:3100, removes the backend proxy and writes results to disk. |
| `routes.json` | Every route in `frontend/App.tsx`, with the session mode it needs and the tab to click. |
| `summarize.mjs` | Turns the saved results into the Markdown report and a compact JSON summary; `--compare` gives a before/after table. |
| `gate-logic.mjs` | The gate's pure rules (route status, PASS/PARTIAL/FAIL), unit tested in `frontend/tests/audit-gate.test.mjs`. |

## Safety model

- The page never talks to a backend. Every request whose path starts with `/api`, `/audio` or
  `/generated-media`, on any host (including the `http://localhost:5000` hard-coded in
  `services/api.ts`, `GravityCreate.tsx`, `AdminLogin.tsx` and `Campaigns.tsx`), is answered inside
  the page from `ROUTES` in `mock-session.js`. Writes (POST/PUT/PATCH/DELETE) get a canned
  "audit stub" answer and go nowhere. Any other host is refused in the page (503) and listed in
  `window.__AUDIT.blocked`. Only same-origin, non-API requests (Vite modules, `/assets`) reach
  the dev server.
- Backstop: the audit server itself answers `/api`, `/audio` and `/generated-media` with 503 and
  has no proxy, so even a request that escaped the stub could not reach port 5000.
- Open the app as `127.0.0.1`, never `localhost` (several files switch to `localhost:5000` when the
  host is literally `localhost`, and `<img>`/`<video>` URLs built from it would bypass the stub).
  The server answers any other Host with 403, and the stub refuses to boot the app (console error,
  page replaced) if it ever runs on `localhost`. Never use ports 3000 or 5000 (the config refuses them).
- The audit config reads no `.env` (empty `envDir`) and defines `process.env.API_KEY` /
  `GEMINI_API_KEY` as empty strings, so no key can be inlined into the served code.
- Not stubbed (they are `<script>`/`<link>`/`<img>` tags, part of the app as built): Tailwind
  CDN, Google Fonts, esm.sh (import map), Razorpay `checkout.js` (which loads `api.razorpay.com` /
  `cdn.razorpay.com`; its `sendBeacon` log call is blocked). No user data goes to them.
- The fake token is `audit-fake-token`. No real credentials, no `.env`, no database.

## Run it

1. Start the audit dev server (from `frontend/`; `AUDIT_OUT` is where results and screenshots
   go, default `scripts/visual-audit/out/`, which is git-ignored):

   ```sh
   cd frontend
   AUDIT_OUT=/some/scratch/dir npx vite --config scripts/visual-audit/vite.audit.config.mjs
   # -> http://127.0.0.1:3100/   (AUDIT_PORT=3101 to change the port)
   ```

2. In the Browser pane (or any Chromium), open `http://127.0.0.1:3100/?audit=normal#/dashboard`.
   The `audit` query sets the session mode for this tab:
   `normal` (signed in, onboarding done), `logged-out` (landing, sign-in), `onboarding` (signed in,
   onboarding not done), `admin` (fake admin token for `/admin`). Set the viewport (e.g. 1280x800
   or 375x812) **before** starting, and re-check `innerWidth`: the pane may drop the emulation.

3. Check the stub is in: `typeof window.__auditRoute === 'function'` and `window.__AUDIT.mode`.

4. Audit. One route, returns a summary line and saves `results/<width>__<label>.json`:

   ```js
   await __auditRoute({ label: 'settings-profile', path: '/settings' })
   ```

   All routes of the current mode (a tool call may time out after ~45s, so start it and poll):

   ```js
   __auditStart(null, 1280)            // or __auditStart(['dashboard','upload'], 375)
   __auditJob                          // { done, out: ['<name> <finalHash> <checked> <failures> <unknown> BLANK? <errors>'] }
   ```

   The run stops if the app crashes (a crash unmounts everything) and prints the labels left;
   reload the page and run those. It also stops if the viewport width is not the expected one.

5. Screenshot of the current viewport (html2canvas; good enough for review, not pixel exact):
   `await __auditShot('1280-settings')` -> `shots/1280-settings.jpg`.

6. Network check: `__auditNetworkSummary()` (hosts the page loaded, what was mocked, blocked,
   and API paths that fell back to the generic answer) and, in the Browser pane,
   `read_network_requests` filtered on `5000`, `localhost` and `/api/` must show nothing new.

7. Report:

   ```sh
   node scripts/visual-audit/summarize.mjs --results $AUDIT_OUT/results \
     --md report.md --json summary.json [--compare ../docs/superpowers/specs/assets/nebulaa-contrast-baseline/summary.json] \
     [--since 2026-10-04T09:00:00Z]
   ```

   Pass `--since <time the run started>` (ISO or epoch ms) whenever the results directory may
   hold files from an earlier run: any result saved before it is `STALE` and fails the gate.
   Without `--since` the file times are not checked, so use a fresh `AUDIT_OUT` per run.

   It prints one line per width and `GATE: PASS|FAIL` (exit 1 on FAIL; see "The gate").
   An audit that throws is saved as an `ERROR` result; a crash stops the run, and the routes not
   reached show as `MISSING` until you reload and run them.

8. Stop the dev server you started (Ctrl-C, or kill its PID; `lsof -nP -iTCP:3100 -sTCP:LISTEN`).
   Never touch the processes on 3000 or 5000.

## Reading the results

- `failures` are sorted worst first. `ratio` is the text colour (alpha composited) against the
  effective background; `required` is 4.5, or 3 for large text (>= 24px, or >= 18.66px at 700+).
- How the background is found: the text box is sampled at 5 points; at each,
  `document.elementsFromPoint` (with pointer-events forced on) gives the real paint stack, so
  positioned overlays, cards and SVG shapes under the text count, in paint order, with `opacity`
  as a group over the real backdrop. Non-descendant layers above the text are drawn over it.
- `kind`: `text`, `value` (typed input value), `placeholder`, `svg-text` (SVG `<text>`/`<tspan>`,
  colour = computed `fill` x `fill-opacity`).
- `failureKind`: `contrast` (background fully known); `image-underlying` (an image of unknown
  colour - url()/unsupported background layer, img/video/canvas/picture/iframe - is in the stack,
  and the text already fails on the colour beneath it); `image-any` (fails even against both
  opaque black and opaque white, so no opaque image can make it pass). `positioned: true` means a
  non-ancestor layer contributed to the background.
- `unknown`: cannot be decided: over an image where it passes on black or white but not both
  (`black`/`white`/`ratioUnder` given), covered by an opaque layer at every point, not
  hit-testable, or transparent text. `unparsedColors`: colours neither the parser nor a 1x1 canvas
  could resolve. `gradientText`: background-clip:text or SVG `fill: url(#...)`.
- `textClass` / `bgClass` are the nearest Tailwind colour classes, to find the source quickly.
  The colours are the computed ones (after the `index.html` override layer), so `text-slate-900`
  can show as `#f5f4f1`.
- `disabled`: inactive controls below AA (exempt, listed). `placeholders`: via
  `getComputedStyle(el, '::placeholder')`; failing ones are also in `failures`.
- Limits (also in each result's `limits`): no mix-blend-mode, filters, backdrop-filter,
  box-shadow, masks or clip-path; pseudo-element (`::before/::after`) backgrounds and `content`
  text are not seen; `display: contents` text is sampled through its text range; SVG strokes and
  text-shadow ignored; only the current state of each page/tab (no modals, hover, focus).

## The gate (Tasks 7-8)

`summarize.mjs` expects every `routes.json` entry at every width (default 1280 and 375) and prints
`GATE: PASS` (exit 0) only when, for every route in scope (all except `otherSession` pages):

1. a result exists and the page rendered where expected: no `MISSING` (no result file, e.g. after
   a crash stopped the run), `STALE` (saved before `--since`), `BLANK` (the app crashed), `EMPTY`
   (the audit checked 0 elements, so nothing was measured), `ERROR` (the audit threw), `REDIRECT`
   (landed elsewhere than `expectHash`/`path`) or `TAB-NOT-FOUND`. None of these ever counts as
   0 failures; and
2. `failures` is 0; and
3. every `unknown`, `unparsedColors` and `gradientText` item is listed in `unknown-signoff.json`
   (entry: `kind`, `route`, optional `width`, `text` prefix or `*` or exact `selector`, `reason`,
   `verifiedBy` = who checked it by eye, how and when).

Otherwise it prints `GATE: FAIL` and exits 1 (it still writes the report). A run narrowed with
`--widths` that leaves out 1280 or 375 never prints PASS: when everything measured passes it
prints `GATE: PARTIAL (widths: ...)` and still exits 1. `--compare` totals
only routes that rendered in both runs, so a broken route cannot make the total drop.

## Adding mock data

If a page crashes or renders empty, read `consoleErrors` in its result and
`__auditNetworkSummary().unmatched`, then add a route to `ROUTES` in `mock-session.js` with the
shape that page reads (look at how the page uses the `services/api.ts` response). Keep all data
fake and keep images as inline SVG data URIs so no image host is contacted.
