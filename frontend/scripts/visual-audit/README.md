# Visual / contrast audit

Measures WCAG AA text contrast on every page of the app, with a fake signed-in session and canned
API data, without a backend. Used for the legibility pass (Tasks 6-8 of the Nebulaa foundation
plan). The baseline report is `docs/superpowers/specs/assets/nebulaa-contrast-baseline.md`.

| File | What it is |
|---|---|
| `contrast-math.mjs` | Pure maths: `parseColor`, `composite`, `luminance`, `ratio`, `isLargeText`, `requiredRatio`, plus gradient helpers (`parseBackgroundImage`, `gradientColorAt`, `gradientT`). Tested by `frontend/tests/contrast-math.test.mjs`. |
| `contrast-audit.js` | Body of an async function run inside the page. Returns `{ route, checked, failureCount, failures[], unknown[], disabled[], placeholders[], gradientText[], ... }`. The header comment explains exactly how backgrounds and text colours are measured and what is skipped. |
| `mock-session.js` | Fake session + stub for `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, and the in-page runner (`__auditRoute`, `__auditRun`, `__auditStart`, `__auditShot`). |
| `vite.audit.config.mjs` | Vite config that injects `mock-session.js` before the app boots, binds 127.0.0.1:3100, removes the backend proxy and writes results to disk. |
| `routes.json` | Every route in `frontend/App.tsx`, with the session mode it needs and the tab to click. |
| `summarize.mjs` | Turns the saved results into the Markdown report and a compact JSON summary; `--compare` gives a before/after table. |

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
  host is literally `localhost`). Never use ports 3000 or 5000 (the config refuses them).
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
     --md report.md --json summary.json [--compare ../docs/superpowers/specs/assets/nebulaa-contrast-baseline/summary.json]
   ```

8. Stop the dev server you started (Ctrl-C, or kill its PID; `lsof -nP -iTCP:3100 -sTCP:LISTEN`).
   Never touch the processes on 3000 or 5000.

## Reading the results

- `failures` are sorted worst first. `ratio` is the text colour (alpha composited) against the
  effective background; `required` is 4.5, or 3 for large text (>= 24px, or >= 18.66px at 700+).
- `textClass` / `bgClass` are the nearest Tailwind colour classes, to find the source quickly.
  The colours are the computed ones, i.e. after the `index.html` GRAVITY OVERRIDE LAYER, so
  `text-slate-900` can show as `#f5f4f1` when the layer overrides it.
- `unknown`: text over a url() background image or an img/video/canvas: check by eye.
- `disabled`: inactive controls below AA (WCAG exempts them; listed for information).
- `placeholders`: checked via `getComputedStyle(el, '::placeholder')`; failing ones are also in
  `failures` with `kind: "placeholder"`.
- Limits (also in the result's `limits`): ancestors only, apart from the media check; no
  pseudo-element backgrounds, shadows, blend modes or backdrop filters; SVG text not checked;
  only the first screen state of each page and tab (no modals, no hover states).

## Adding mock data

If a page crashes or renders empty, read `consoleErrors` in its result and
`__auditNetworkSummary().unmatched`, then add a route to `ROUTES` in `mock-session.js` with the
shape that page reads (look at how the page uses the `services/api.ts` response). Keep all data
fake and keep images as inline SVG data URIs so no image host is contacted.
