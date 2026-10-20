# Security hardening, frontend part (XSS)

Scope: ledger item SECURITY HARDENING, part (3). The backend part is in `security-hardening.md` (separate file, to be merged by the controller). Guard: `frontend/tests/xss.test.mjs`.

## Helpers
- `frontend/utils/safeHref.ts`: `safeHref(url)` returns the normalised URL only for http/https (relative paths resolve against the app origin); rejects `javascript:`, `data:`, `vbscript:`, `file:`, `blob:`, `mailto:`, control characters and whitespace tricks (`java\tscript:`), protocol-relative and backslash forms, addresses with a user name or password, and anything unparsable. `safeSrc(url)` is for pictures and videos: http(s), `blob:` and base64 png/jpeg/webp/gif data URLs only (never SVG). `openSafe(url)` is `window.open` with a checked address and `noopener,noreferrer`.
- `frontend/utils/sanitizeHtml.ts`: DOMPurify cleaner. Allowed tags in one constant (`h1 h2 h3 p ul ol li strong em table thead tbody tr th td br`), attributes `colspan` and `rowspan` only (and only 1 to 2 digit numbers), `style`, `class`, `id`, `href`, `src`, `on*` forbidden, data- and aria- attributes off. Fails closed (empty string) when there is no DOM.
- `dompurify` 3.4.16 is now a direct dependency (the version already in the lockfile through jspdf, pinned exactly). `jsdom` is a dev dependency used only by the tests.

## Link and address sites fixed (every `href`, `window.open`, redirect built from scraped, provider or user data)
| File | What |
|---|---|
| `components/CompetitorTiles.tsx` | profile link, best post link, post open link, grid tile link (4) |
| `components/home/DraftSheet.tsx` | Open the post |
| `components/performance/PerformanceSections.tsx` | Open post |
| `components/blueprint/DesignedEdition.tsx` | page link and image, PDF download (3) |
| `components/PostActions.tsx` | video download opens (2) |
| `components/TermsPrompt.tsx` | rel made `noopener noreferrer` |
| `utils/download.ts` | `clickLink` href, image fallback open |
| `pages/Analytics.tsx` | View Post, Preview Ad (2) |
| `pages/Campaigns.tsx` | suggestion image open, create image link and fallback, post preview open, poster link and fallback (6) |
| `pages/Dashboard.tsx` | competitor post open, strategic post link and fallback, Google Calendar popup address (4) |
| `pages/Competitors.tsx` | View post |
| `pages/IdeaInbox.tsx` | idea source link |
| `pages/Influencers.tsx` | profile card link (placeholder `#` removed) |
| `pages/Inventory.tsx` | download fallback open, generated ad open (2) |
| `pages/Library.tsx` | video Download |
| `pages/HeroVideo.tsx` | video and raw clip downloads (2) |
| `pages/ReelGenerator.tsx` | Open in new tab, Download MP4 (2) |
| `pages/Settings.tsx` | invoice View |
| `pages/staff/StaffBilling.tsx` | invoice link |
| `pages/ConnectSocials.tsx` | authorization popup address |
| `pages/Onboarding.tsx` | authorization redirect |

Links render only when `safeHref` returns a value (otherwise plain text or no link); `target="_blank"` always carries `rel="noopener noreferrer"` (test-enforced). Remaining `href={...}` in the app are fixed constants (landing menu, legal pages) or in-app routes and are listed with reasons in the test.

## HTML written into the page
- `utils/strategyPdf.ts`: the regex `sanitizeStrategyHtml` is replaced by the DOMPurify cleaner; the wrapper is built with DOM calls, the cleaned string is the only `innerHTML` in the app (allowlisted with a reason, test-enforced).
- `pages/ConnectSocials.tsx`: `document.write` (popup) and `document.body.innerHTML` (success page) replaced by DOM calls with `textContent`.
- Static scan fails on `dangerouslySetInnerHTML`, `innerHTML =`, `outerHTML =`, `insertAdjacentHTML`, `document.write`, `createContextualFragment`, `new DOMParser`, `eval`, `new Function` outside the allowlist.

## Escape on output audit (non-React sinks)
- CSV: `utils/staffCsv.ts` already prefixed `= + - @ tab CR` (kept, tested). Excel: `downloadXlsx` now prefixes the same (new `spreadsheetCell`, used by the AI strategy export). The agency usage CSV is built by the server (backend job).
- `mailto:` links: all fixed support addresses, no user text (test-enforced).
- `document.title`: set from a cleaned file name or a fixed platform name; titles are not parsed as HTML.
- `window.print`: prints the React-rendered Blueprint (escaped by React). PDF generators: `jspdf` draws text, `html2canvas` draws React-rendered nodes or the cleaned strategy wrapper.

## Not changed here
Image and video `src` from data (a `javascript:` value does not run in `<img>`/`<video>`) except where a link wraps the same address. Server side URL validation, CSP, cookie token, email-template escaping, SVG upload block: backend and infra parts.
