# Impact map: landing page rework (public page at `/`)

Written 2026-10-20 before building, per the ledger rule 3. Owner request (ledger, LANDING PAGE AND WEBSITE): "make landing page and website sexy like Higgsfield and Pollo: proof-first galleries of real results, What you can make, Built for cards, glow bands, FAQ, wordmark footer, phone mock; same copy for the separate website". Direction: `docs/superpowers/specs/2026-10-18-visual-refresh-and-photoshoot-design.md` section 2b. Brand rules: `docs/superpowers/ops/tile-system.md`.

## Audience and the one job of the page
- Audience: Indian small business owners (shops, cafes, salons, clinics, hotels, D2C brands, local services) and small agencies, mostly on a phone, often arriving from a shared link or an ad. Not technical. Price sensitive.
- The one job: get the visitor to press **Start for ₹{Starter price}** (sign up, then choose a plan). Everything on the page shows what they will get (proof first), how safe it is (nothing goes out without approval) and what it costs (plans from config).

## What depends on the page, and what it changes elsewhere
| Thing | Effect | Handling |
|---|---|---|
| Route `/` in `App.tsx` (`!user ? <LandingPage/> : <Navigate .../>`) | Unchanged. The page stays a lazy route (`utils/routeChunks.ts` `LandingPage`), so its code and CSS load only for logged-out visitors. | No change to `App.tsx` or `routeChunks.ts`. |
| Sign-up `/login?mode=signup`, Blueprint sign-up `BLUEPRINT_SIGNUP_PATH`, sign-in `/login` | Same targets as today. The sign-up page (`pages/Auth.tsx`) owns the invitation code (`signupConfig.inviteRequired`) and the bot check (Turnstile); the landing never touches them. | Same `navigate()` calls; Auth not touched. |
| Legal links | `tests/legal.test.mjs` needs `pages/LandingPage.tsx` to link the refund page or use `LegalLinks`. | Footer uses `LegalLinks` (Terms, Privacy, Refunds) and `LandingPage.tsx` imports it. |
| Plans | Today the figures are typed in the page and a test compares them with `backend/config/apiCosts.js`. | The page now reads the public `GET /api/payment/plans` (`apiService.getPlans`, the same answer the plans page uses). Until it answers, or if it fails, a snapshot in `utils/landingPlans.ts` is shown; the test rebuilds the catalogue from `apiCosts.js` and `config/plans.js` and fails if the snapshot drifts. No price is typed anywhere else. |
| `tests/landing.test.mjs`, `tests/quarks-wording.test.mjs` (landing block), `tests/xss.test.mjs` (href allowlist) | They read `pages/LandingPage.tsx` only. | Updated deliberately: they read all landing files (`pages/LandingPage.tsx`, `components/landing/*`, `constants/landingCopy.ts`, `utils/landingPlans.ts`). Anchor links use `` `#${id}` `` (a static href the XSS test accepts). |
| Quark wording | The old landing test banned "Quark". The app convention now (Help page, Create tiles, ledger line of 2026-10-19): Quarks are the unit, shown as a plain amount ("600 Quarks"), never "posts' worth"; plan cards show posts and videos like the plans page. | The FAQ "How does pricing work?" explains Quarks with the Help page's wording and the plan amounts from config. Plan cards keep posts and videos. The test now bans "worth", credits, trial and 7 days instead. |
| `tests/pageFrame.test.mjs` | Guards menu pages and `index.html` against page glows. The landing is not in its list. | Glows live only in `components/landing/landing.css`, scoped under `.nb-land`. `index.html` is not edited. |
| Voice and brand audits | `voice-scope.json` does not list the landing. | `tests/landing.test.mjs` runs `findVoiceViolations` over the landing files itself (no change to the shared scope file). |
| Art budget | Applies to `components/art/` and the photo folders. | No new art files. The phone mock is CSS plus existing art pieces. |
| Separate marketing website | Copy was pasted by hand into `website-copy-workflow.md`. | All landing words live in `constants/landingCopy.ts`; the website document is regenerated from it. |

Money and entitlement effects: none. The page only reads public prices. Data and migration effects: none.

## Sections (top to bottom), layout, copy and visual

Every word below lives in `frontend/constants/landingCopy.ts`. Prices and allowances are filled in from the plans answer (shown here with today's values in braces).

### 0. Sticky nav
- Layout: a cream glass bar (white 82 percent, 1 px warm border once scrolled), logo left, links centre (desktop), Sign in and the gold button right. Phone: logo, the gold button and a menu button; the menu opens a sheet with the links.
- Links: What you can make (`#make`), How it works (`#how`), Free Blueprint (`#blueprint`, from `BLUEPRINT_COPY`), Plans (`#plans`), Questions (`#faq`).
- Buttons: "Sign in" (`/login`), "Start for ₹{999}" (`/login?mode=signup`).

### 1. Hero (glow band 1)
- Layout: two columns from 960 px (text left, phone mock right), stacked on a phone (text, then the phone at 260 px wide). Background: the cream base with two soft gold and amber radial glows and a faint grain, scoped to the hero.
- Eyebrow: "Social media for Indian small businesses"
- Headline: "A month of posts," then, in the gold italic serif: "made for your business."
- Line: "Tell Nebulaa about your business once. It writes the captions, makes the pictures and short videos, and lays every post out on your calendar. You check each one and approve it."
- Buttons: "Start for ₹{999}" (gold, sign-up), "See what it makes" (outline, `#make`).
- Small line: "Nothing is posted until you approve it." Second small line (kept from the old page, owner-confirmed claim per spec 2b): "Built on real experience with 2,000+ MSMEs and startups."
- Visual: **phone mock** in CSS: a rounded frame with a notch, the screen showing a Review and approve card drawn from tile art (`SinglePostArt` on a gold cover gradient as the post picture, a sample business line "Your business, Instagram", an example caption, Edit and Approve buttons, "2 more waiting"), a small "Example" chip on the screen. Two floating chips beside it ("Caption written", "Picture made"), drifting slowly only without reduced motion. No real customer data. No raster in the mock.

### 2. Examples (proof first)
- Layout: four columns from 900 px (two rows of four, eight posts), two columns on a phone (the first six). Square images, 18 px radius, an "Example" chip on each, the business type under it.
- Eyebrow: "Examples"
- Headline: "Posts for every kind of business."
- Line: "Example posts in the styles Nebulaa makes, for hotels, shops, food brands, real estate and more."
- Visual: the existing showcase posts (`public/assets/showcase/*.webp`, already in the repo and already on the old landing), lazy, async decoding, fixed width and height. No new raster.

### 3. What you can make (`#make`)
- Layout: six cover tiles (`CoverTile`, the app's own component) in three columns from 640 px (two rows of three), two columns on a phone (three rows of two). Every row filled.
- Eyebrow: "What you can make"
- Headline: "Everything your page needs, in one place."
- Tiles (order fixed): Posts ("A picture and a caption, ready to approve"), Carousels ("Swipeable slides that explain or sell"), Campaigns ("A set of posts for one offer or festival"), Videos ("Short videos with voice and music"), Photoshoot ("Product photos from the photos you upload", chip "Coming soon": the studio is built but switched off until the owner's real proof), LinkedIn ("Professional posts for your company page").
- Line under the tiles: "Every price is shown in Quarks before you make anything."
- Visual: the cover-tile art (`SinglePostArt`, `CarouselArt`, `CampaignArt`, `VideoArt`, `PhotoshootArt`, `LinkedInArt`) with the photo slots `create-single`, `create-carousel`, `create-campaign`, `create-video`, `create-photoshoot`, `create-linkedin` (`utils/samplePhotos.ts`). Until the owner promotes the photos, the drawn art shows (SamplePhoto falls back on a load error). Each tile links to sign-up.

### 4. How approval works (glow band 2, warm gold card, no dark panel)
- Layout: one wide warm gold card (cream to soft gold, gold border and glow, brown ink like Home's "Do this next"), the headline left, three point tiles right (stacked on a phone).
- Eyebrow: "How approval works"
- Headline: "Nothing goes out until you approve it."
- Points: "You see every post first": "Captions, pictures and videos wait in Review and approve. Change the words, make it again or delete it." / "You choose when it goes out": "Approve a post and it is scheduled for its planned day, or post it now. Publishing needs the Publish and schedule add-on." / "Replies wait for you too": "With the Inbox add-on, replies to comments and messages are drafted for you to read, change and approve." (`// CONFIRM AFTER INBOX TEST`)

### 5. How it works (`#how`): the seven real steps
- Layout: a grid of four columns from 1024 px: steps 1 to 4, then steps 5 to 7 and a gold "Start with step one" card, so both rows are full. Two columns on a tablet (four full rows), one on a phone. Numbered gold badges; add-on steps carry an "Add-on" chip.
- Eyebrow: "How it works"; Headline: "Plan, create, approve, publish, learn."
- Steps: 1 "Tell us about your business" (questions, website and social pages, free Brand Growth Blueprint). 2 "Get your plan" (ideal customer and a simple strategy, in My plan). 3 "Posts and videos every week" (made for you and laid out on your calendar). 4 "Review and approve" (check on your phone, change, approve). 5 "Publish and schedule", add-on (connect accounts, post now or on the day you pick). 6 "Reply from one inbox", add-on (one list, each reply drafted for you to approve; `// CONFIRM AFTER INBOX TEST`). 7 "Learn what works" (reach, engagement and new followers for your posts; Nebulaa keeps notes on what works for your business; competitor insights as an add-on).
- Eighth card: "Start with step one", "It takes a few questions. You can change every answer later.", button "Start for ₹{999}".

### 6. Built for
- Layout: four audience cards in one row from 1024 px, two by two on a tablet, one column on a phone; each card has a small art piece in a tinted frame, a title and one line. Equal heights.
- Eyebrow: "Built for"; Headline: "Made for people who run a business."
- Cards: Small business owners ("Shops, cafes, salons and studios that need to post often without hiring a designer."; `SinglePostArt`), D2C brands ("Launches, offers and festival posts that look like your brand every time."; `ProductArt`), Local services ("Clinics, coaching centres, hotels and real estate teams that want to stay visible nearby."; `CalendarArt`), Agencies ("Several client brands from one account, with a usage report for each client."; `CampaignArt`).

### 7. Free Brand Growth Blueprint (`#blueprint`)
- Kept as it is today, restyled: all words from `BLUEPRINT_COPY.landing` (the Blueprint copy file is shared with the Blueprint pages and not changed). `BlueprintArt` beside the legend. Its `note` ("It uses 7 of your Quarks.") is not shown: a typed Quark figure that reads against "free".

### 8. Plans (`#plans`)
- Layout: three cards in one row from 900 px (one centred column of up to 560 px below that), in the order Starter, Growth, Agency (`orderedPlans`), one column on a phone. Growth has a gold ring and the chip "Best value" (true from config: the lowest price per Quark of the three).
- Eyebrow: "Plans"; Headline: "Three plans. Start from ₹{999}."
- Line: "Prices are per month plus GST. Starter and Growth do the same things, and Growth makes over three times as much. Agency is for running several client brands. Publishing, competitor insights and the inbox are add-ons on Starter and Growth, and are included in Agency."
- Each card: name, price, "/month + GST", the server description, the server feature lines (posts and videos from `outputsFor`, team members, client brands), the Agency extra client price from `agency.slotInr`, button "Choose {name}" to sign-up.
- Add-on line, built from the catalogue with the landing's own names (the server label "Inbox and automatic replies" is not shown): "Add-ons, per month plus GST: Publish and schedule ₹{1,000}, Competitor insights ₹{500}, Inbox ₹{500}, or all three for ₹{1,800}."
- Top-up line: "Need more? Top up any time from inside the app. Top-ups stay valid for 60 days."

### 9. Questions (`#faq`), eight answers, native `<details>`
1. How does pricing work? "Each plan adds Quarks every month: {600} on Starter, {2,000} on Growth and {6,000} on Agency. Quarks are what you spend to make posts, carousels, videos and photos, and every price is shown before you make something. Plan Quarks are for the month you paid for; top-ups stay valid for 60 days. Prices are shown without GST; 18% GST is added at checkout."
2. What needs my approval? "Every post. Captions, pictures and videos wait in Review and approve, and nothing is published or scheduled before you approve it." Plus, `// CONFIRM AFTER INBOX TEST`: "With the Inbox add-on, replies are drafted for you to approve too."
3. Where can my posts go? "With the Publish and schedule add-on you connect your accounts and send approved posts to Instagram, Facebook, LinkedIn, X and Google Business, and videos to YouTube. You can also download any post and share it yourself." (`utils/platforms.ts`, none marked soon.)
4. Which languages does it write in? "English and Tamil today, on their own or mixed in one post. We add more languages only after our team can check them." (`constants/languages.ts` offers English, Tamil and the Tamil and English mix by default.)
5. Do I need a designer or a website? "No. Nebulaa writes the captions and makes the pictures and videos. If you have a website, add it and Nebulaa fills in most of your details. If not, answer a few simple questions."
6. What happens to my data? "Your details, photos and posts are used to make your content, and we do not sell your personal data. You can download your data and delete your account yourself in Settings, under Security. The Privacy Policy explains what is kept and for how long." (link)
7. Can I cancel any time? "Yes. Go to Settings, then Billing, and choose Cancel plan. Your plan stays available until the end of the month you paid for, and you are not charged again." (Refund Policy 1.1 and 1.2; link)
8. Does it work for agencies? "Yes, on the Agency plan: {5} client brands included, one shared pool of posts and videos for all clients, and a usage report for each client. Extra client brands are ₹{1,499} a month plus GST."

### 10. Closing band (glow band 3)
- A wide gold-glow card: "Start your first month of posts." / "Sign up, answer a few questions and choose a plan. Your first posts are made for you to review." / button "Start for ₹{999}" / "Already have an account? Sign in".

### 11. Footer
- A giant wordmark "Nebulaa" in the serif, filled with the gold to amber gradient (CSS, `aria-hidden`, the logo image keeps the accessible name), the section links, `LegalLinks` (Terms, Privacy, Refunds), "Contact: support@nebulaa.ai" (mailto from `SUPPORT_EMAIL`), "© {year} Nebulaa. All rights reserved."

### 12. Phone sign-up bar
- Kept: after the hero, a fixed gold "Start for ₹{999}" bar at the foot on phones.

## Nav and CTA flow
Every gold button goes to `/login?mode=signup` (Auth handles invitation code and the bot check; the plan is chosen after sign-up on the plans page). The Blueprint button goes to `BLUEPRINT_SIGNUP_PATH`. Sign in goes to `/login`. In-page links scroll to `#make`, `#how`, `#blueprint`, `#plans`, `#faq` (HashRouter: in-page links are handled by a click handler that scrolls to the section and moves focus to it, so the address stays `#/`; checked in the browser).

## Performance budget
- Lazy route: unchanged. No third-party script, no new font. No new raster file: the phone mock, glows and wordmark are CSS and existing inline SVG art. Photos come only through the existing photo slots (lazy, async, fixed size, each at most 36 KB once promoted).
- Above the fold: no raster image (the phone mock is CSS and SVG). The showcase posts below are `loading="lazy"`, `decoding="async"`, with width and height.
- JS: the landing chunk should stay small (target under 20 KB gzip for the chunk; reported after `vite build`). CSS: one plain stylesheet `components/landing/landing.css`.
- Motion: only inside `@media (prefers-reduced-motion: no-preference)`: hero glow drift, floating chips, tile hover lift.

## Accessibility
One `h1`; each section an `h2` with `aria-labelledby`; nav is a `<nav>` with a label; the phone menu button has `aria-expanded` and `aria-controls`; FAQ uses native `<details>`/`<summary>`; decorative art, glows and the wordmark are `aria-hidden`; example images have alt text naming the business type and "example"; visible focus rings (3 px, brown ink); colour contrast at least 4.5 to 1 for body text over the worst point of every gradient (computed in the test), 3 to 1 for large headings; tap targets at least 44 px.

## Mobile at 375
Single column; hero text first then the phone mock (centred, 250 to 270 px wide); examples two a row; cover tiles two a row; steps one a row; plans one a row; no sideways scroll (checked with `scrollWidth`), sign-up bar after the hero.

## SEO basics
The app is a single page app with one static `index.html` (title "Nebulaa - Your marketing, done for you", no description or Open Graph tags today). The landing sets `document.title` and the `description` meta while it is shown (restored when it unmounts), which search engines that run scripts read. Link previews (WhatsApp, Facebook, LinkedIn) do not run scripts, so Open Graph tags must be in `index.html`; that file is shared and is not edited in this change. Ready-to-paste tags for the controller or the owner:

```html
<meta name="description" content="Nebulaa writes the captions, makes the pictures and short videos, and plans every post for your business. You approve each one." />
<meta property="og:title" content="Nebulaa: a month of posts, made for your business" />
<meta property="og:description" content="Captions, pictures and short videos planned on a calendar. Nothing is posted until you approve it." />
<meta property="og:type" content="website" />
<meta property="og:image" content="/assets/logo-nebulaa.png" />
```

## Deliberately left out, and why
- Customer logos, testimonials, ratings, "trusted by" counts, results numbers: none are real yet.
- "Ready in minutes", "Set up in 3 minutes" and "3 minutes away": not measured; removed.
- "Most popular" on Growth: no data; replaced by "Best value" (true from config).
- Automatic replies: the Inbox has never been tested live; only "drafted for your approval", every such sentence marked `// CONFIRM AFTER INBOX TEST`, and one switch `INBOX_LINES_VISIBLE` in `landingCopy.ts` hides them all.
- Photoshoot as available: it is off until the owner's real proof; the tile says "Coming soon".
- Hindi, Telugu and other languages: not offered to new choices today.
- A platform logo strip with brand marks: we have no licensed logo files; the platforms are named in words in the FAQ.
- A prompt box in the hero (Pollo): it would need a working generation for logged-out visitors (cost and abuse risk).
- Vendor names, credits, trial, 7 days: banned by the voice rules.

## Reuse for the separate website
Every customer-facing word is in `frontend/constants/landingCopy.ts` (sections in page order; Inbox lines carry `inbox: true`). The website copy document `docs/superpowers/ops/website-copy-workflow.md` is regenerated from that file by hand (copy the sections in order and fill the braces from the plans answer); a note at its top says so.

## Tests
- `tests/landing.test.mjs` (rewritten): forbidden words over all landing files (credits, trial, 7 days, worth, exclamation marks, em dashes, vendor names); every sentence about replies says drafted or approve; every Inbox line is marked in the copy file; seven steps; plan order Starter, Growth, Agency; the snapshot equals the catalogue rebuilt from `apiCosts.js` and `config/plans.js`; the add-on line never shows the server's "automatic replies" label; the voice audit over the landing files is clean; computed contrast for the text over the hero glow, the gold card and the closing band; the six cover tiles use the six photo slots; the landing keeps `LegalLinks`, the sign-up and sign-in targets and the Blueprint path.
- `tests/quarks-wording.test.mjs` landing block: reads the snapshot instead of typed card text.
- Run: `node --test tests/*.test.mjs`, `npx tsc --noEmit`, `npm run lint`, brand and voice audits, art budget, `node scripts/visual-audit/gen-layer-lists.mjs`, the contrast audit on the `landing` route, `npx vite build` (landing chunk size).
