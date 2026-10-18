# Visual refresh (tiles), Photoshoot studio, Competitor and trending posts: design

Status: DRAFT for the owner's approval. Branch `nebulaa-redesign`. Nothing is built from this yet. Written 2026-10-18 from the owner's message and 24 reference screenshots he supplied (Scalio, Magnific, Higgsfield, Pollo; PDFs in his Downloads folder, not in the repo).

## 1. What the owner asked for (his words, grouped)
1. Tiles with small pictures instead of plain buttons and text, everywhere: Dashboard/Home, Create content (single post, campaign, carousel, LinkedIn), Review queue, Inbox (messages and comments, Google reviews, automatic replies), Performance (reach, engagement, new followers), My plan, Brand assets, Brand Growth Blueprint, Memory, Videos (styles), Calendar. Pictures must be tiny and fast: SVG illustrations or small compressed photos like the existing video-style tiles; the app must not get slower.
2. A more beautiful, colourful look even in the light theme (not the old space theme): "glossy" feeling panels, attractive cards, "the dashboard is very boring".
3. A ready-made PHOTOSHOOT feature (product photoshoot, model photoshoot) using the products and environments already uploaded: one button, N photos, named styles, and a visible cost ("how many credits it could take").
4. Competitors tab: more than names: handles, recent posts, what worked well; plus "trending posts" and a "your competitors are posting these, so we should post something like this" suggestion, including a rivalry-style post.
5. Note the other features competitors have and take inspiration (not copy).
6. Two bugs (diagnosed in `docs/superpowers/ops/diagnosis-video-styles-and-calendar-cover.md`): the 22-style video grid and the calendar cover fix exist on the branch but not in production (release fixes them); calendar covers failed earlier and need a retry.

## 2. What the references show (inspiration, with what we should take)
**Scalio (closest competitor; note: its theme is LIGHT with a green accent, not dark)**
- Home: a hero banner with a named AI persona ("Maya, your video director") and one primary button; then "What will you create today?" with four BIG PHOTO TILES (Create Videos, Create Social Media Posts, Create Photoshoot, Growth Tools) each with a lifestyle photo and an arrow; then "Ideas for you": personalised idea cards (thumbnail or 2x2 photo collage, a tag like Showroom Showcase, title, one line, length, "Make Video: 40 credits" or "Unlock idea: 1 credit"). Credits balance is a chip in the top bar.
- Fashion Studio: a 4-step wizard (Select products, Configure, Generation summary, Results) with a "Photo quality" panel showing good and bad example photos; a "Choose your photoshoot" page with two big cards: Fashion Photoshoot (model look, pose, scene) and Marketplace Photo Pack (one garment, four photos sized for Myntra, Flipkart, Amazon, Ajio, Meesho: Front, Side, Close-up, Low hand close-up).
- Video agent: a chat ("Hi, I'm Maya. Let's make a reel that helps your business") with quick-start chips (Get more customers, Promote an offer, Show off a new product, Build trust with reviews), a sidebar of past videos and Ideas.
- Library: "Everything you've made, in one place." with All / Images / Videos tabs and ready-state cards.
- Calendar: month/week/list views, a "Plan your calendar" call to action showing the inputs (good-to-start photos, festivals like Navratri and Dussehra, post-type mix, language), "30+ posts ready in about 2 minutes".
- Customers: Inbox with Reviews and Messages tabs, People, AI Reply Assistant; the assistant has a sales-style landing ("Never leave a customer on read": replies while you're busy, turns comments into DMs, says only what's true, you stay in control).
- Automations page: cards per automation (Replies to messages and comments, Google reviews, Posting) each with a "Needs setup" status chip and one button.
**Magnific (dark)**: a big search/ask box, a row of tool icons (Image, Video, Audio, Design, 3D), a "What's new / Use cases / Academy / Community" carousel with large cover tiles, projects list. **Higgsfield (dark, lime accent)**: dense masonry galleries of examples per model/feature, bold feature banners. **Pollo**: model gallery tiles.
Take: big photo tiles for the main actions; personalised "Ideas for you"; a photoshoot studio with ready-made packs showing the photo count and the sizes; status chips on automations; quick-start chips; a single "everything you made" library; example galleries so people see the result before they start.
Do NOT take: a named human persona avatar (Maya): we keep "no agent names" (see memory `nebulaa-unified-platform-direction`); credits shown as the main unit (we show posts and videos with the Quark figure beside it, per commit `65d337a`); dark theme.

## 3. Visual system (light theme, more alive)
- Keep the cream light theme and tokens (`--gv-*`). Add: a soft gradient "glow" behind hero and tile sections (two accent hues from the logo gold and one cool tint, very low opacity), subtle glass panels (white at 70 to 85 percent with a 1px border and a soft shadow; no heavy blur on large areas), generous radius (16 to 24 px), larger type for headings, colour-coded tile accents (one accent per area: create = gold, review = green, inbox = blue, performance = purple, plan = teal, brand = rose), motion only on hover and reduced-motion respected.
- **Tile component** (`frontend/components/Tile.tsx`): props `title`, `subtitle`, `art` (an inline SVG component or a small image URL), `accent`, `badge` (for example "Add-on", "New", a count), `footer` (for example "12 photos, about 4 posts' worth"), `onClick`/`to`, `locked`. Variants: `hero` (photo, 2 columns), `standard`, `compact`, `ideaCard`. One `TileGrid` for responsive layout (1 column on a phone, 2 on a tablet, 3 to 4 on desktop).
- **Illustration set** (`frontend/components/art/`): a small family of flat, colourful inline SVGs (single-colour shapes on a tinted background with 2 or 3 accent colours from the tokens), each under 2 KB, drawn once and reused: single post, campaign, carousel, LinkedIn, video, reel, calendar, inbox, reviews, auto-reply, performance, plan, brand assets, blueprint, memory, competitors, photoshoot, product, model. Where a real photo is better (video styles, photoshoot styles, idea cards) use small WebP/JPEG tiles of 12 to 40 KB each, `loading="lazy"`, `decoding="async"`, explicit width and height (no layout shift), served from the app's own assets, with a plain gradient fallback if one fails to load.
- **Performance budget (a test enforces it):** total new illustration SVG under 40 KB gzip for the whole set; no page loads more than 6 raster tiles above the fold; each raster tile at most 40 KB; no blocking requests for art; Lighthouse-style check on Home with the sample-data preview: first contentful paint not worse than the current build by more than 100 ms. A script `frontend/scripts/art-budget.mjs` fails the test run if any asset exceeds its limit.

## 4. Page by page
1. **Home (Dashboard):** replace the plain list with: a hero strip (greeting by business name, one primary action: the next best step from Setup or This week), "What will you create today?" with four photo or art tiles (Posts, Videos, Photoshoot, Growth tools (plan, competitors, insights)), the existing Setup and This week cards restyled as tiles, "Ideas for you" (section 6), a compact performance strip, and the competitor and trending card (section 7).
2. **Create content:** tiles with pictures for Single post, Campaign, Carousel, LinkedIn post (what it makes, how many images, the cost in posts/Quarks), plus "Photoshoot" and "Video" entries.
3. **Videos:** the 22-style grid already exists (released with the next build); add category chips and tile hover previews; optionally surface Hero Studio's richer rules (decision pending).
4. **Photoshoot studio (new, section 5).**
5. **Calendar:** cover and month hero as in Scalio ("<Business>'s October posts, in one tap"), plan inputs card (good-to-start photos, festivals, post mix, language), retry covers (bug fix).
6. **Inbox:** tabs Comments and messages / Google reviews / Automatic replies as tiles with status chips (Connected, Needs setup, Add-on); an explainer card for automatic replies ("drafted for your approval; automatic only when you switch it on": keep honest; the Inbox is not yet live-tested).
7. **Performance:** reach, engagement, new followers as KPI tiles with small sparklines and an up/down chip, a "best post this month" card, then the existing charts (dataviz rules: tokens, text summary, table fallback).
8. **My plan, Brand assets, Brand Growth Blueprint, Memory:** section tiles with art and a status line (for example "Ideal customer: done", "Logo: uploaded", "Blueprint: ready, download"), each opening its existing page.
9. **Competitors (section 7)** and **Library** ("Everything you've made, in one place" with All/Images/Videos/Photoshoots tabs).

## 5. Photoshoot studio (new feature)
- Entry points: Home tile, Create content tile, Images menu. A start page "Choose your photoshoot" with big tiles: **Product photoshoot**, **Model photoshoot** (only where a person wearing/using the product makes sense), **Marketplace photo pack** (one product, four or more photos sized for the marketplaces the business sells on: a configurable list), **Festival pack** (the product in a festival scene from the calendar). Each tile shows what you get ("4 photos", "8 photos"), the styles included, how long it takes, and the cost ("about N posts' worth", with the Quark figure beside it).
- Flow (3 steps, like Scalio's wizard but shorter): 1 Pick products (from Brand assets and Inventory: they are already uploaded, with a "photo quality" guide showing good and bad examples), 2 Pick a style set (visual style tiles: Studio white, Lifestyle, Festive, Minimal, Outdoor, Flat lay, On model, plus the business's environment photos as "Your space"), 3 Review the summary (photos count, sizes, cost) and Create. Results appear in the Library and Review and approve.
- Building blocks that already exist: product and environment uploads (`BrandAssets`, `Inventory`), the image generator and reference-photo support (`services/openaiImage.js` edits endpoint accepts reference photos, `geminiAI.js`), `image_generated` costs in `apiCosts.js`. People-photo rule: the video model refuses real faces; the image models accept references but real-person likeness must stay the customer's own photos; AI-generated people are labelled and never shown as real customers.
- Cost: derive a `photoshoot_pack` action from `image_generated` units x photos, never typed prices; show it before Create; charge exactly once with refund on failure per photo (reuse the Task 5 payer/refund patterns); caps and the daily spend ceiling apply.
- Open decisions: which packs and how many photos each (suggest: 4 for marketplace, 6 for product lifestyle, 8 for festive), which marketplaces to list (owner), whether model photoshoots ship in v1 (suggest product-only first).

## 6. "Ideas for you" (personalised cards on Home)
Source: the plan and the calendar already know festivals, pillars and weekly proposals. Each card: tag, title, one line, format (post, carousel, video, photoshoot) and cost, one-click Make. Built from existing proposal data (no new model call for the list); cost is incurred only when the customer presses Make. Respect the weekly proposal limits and the pool.

## 7. Competitors: more useful, and trending/rivalry posts
- The Stage 4 tracker already stores per competitor per week: followers, posts count, average engagement, best post, with a verified handle. Add a tile per competitor: avatar or initial, name and @handle (link), followers, posts this week with the up/down chip, their best recent post (caption snippet, likes, comments, link), and "what worked": the format and topic of their best post. Use only data we have; show "Not enough data yet" honestly.
- New section **"What's working for your competitors"**: the three strongest recent competitor posts across tracked accounts, each as a card with a "Make something like this" button.
- **"Make something like this"** creates a draft in the customer's own voice, inspired by the topic and format (NEVER copying the competitor's text or images, never naming or insulting a competitor, no false claims about them): types: "Same idea, our way", "Our strength" (a comparison post built only from the customer's own verified facts), and an optional "Playful rivalry" tone that stays light, names nobody and invents nothing. Uses one model call per draft behind the cost guard (a `competitor_inspired_post` action derived in `apiCosts.js`, charged like a caption), with the QA rules from the Blueprint/plan work (tagged facts, no invented numbers).
- **Trending posts:** a "Trending for your business" strip on Home and the Competitors page, from three honest sources only: (a) the competitor best posts above, (b) the customer's own best-performing posts, (c) the festival and plan pillars; no scraped third-party "trending" feed (Meta must never be scraped). Say clearly what each card is based on.

## 8. Phasing (each phase shipped and looked at before the next)
1. **Foundation:** Tile component, TileGrid, the illustration set, the art-budget script and test, design tokens for glow/glass, wording guard. Apply to Create content as the first proof.
2. **Home + Library + navigation tiles** (Dashboard, "What will you create today?", Ideas for you).
3. **Photoshoot studio** (backend action and cost, flow, results in Library), product-only first.
4. **Competitors upgrade and trending/inspired posts.**
5. **Inbox, Performance, My plan, Brand assets, Blueprint, Memory, Calendar tiles.**
6. **Videos:** category chips and hover previews; optional Hero rule sets.
Each phase: TDD for helpers, sample-data preview screenshots at 375 and 1280, contrast AA, brand and voice audits 0, layer lists regenerated, the art budget test green, no change to money paths except Phase 3 and the Phase 4 draft action (reviewed on the most capable model with a real-database check).

## 9. Not in scope / risks
- No dark theme, no new persona names, no scraping of social platforms, no new paid model call without the cost guard and the owner's OK per real run.
- Image generation for tile art is NOT used: the art is hand-authored SVG (cheap, tiny); photo tiles reuse existing assets or are generated once offline with the owner's OK and committed compressed.
- The Inbox is untested live: tile copy must not promise automatic replies.

## 10. Decisions needed from the owner
1. Approve the phases and order (or reorder).
2. Photoshoot v1: which packs and photo counts; product-only first? marketplaces to list.
3. Competitor "rivalry" tone: allowed as a light, nameless style (recommended) or leave out.
4. Whether to bring Hero Studio's richer rules to the Videos styles and add Hero to the menu.
5. Calendar covers: stay free to the customer? retry failed ones automatically (one per day)?
