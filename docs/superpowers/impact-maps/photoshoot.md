# Impact map and build plan: PHOTOSHOOT STUDIO v1 (product only)

Written 2026-10-19 on branch `nebulaa-redesign`, before any Photoshoot code. Inputs read: `OWNER-REQUESTS-LEDGER.md` (Create content items "Photoshoot option in Images and on Home" and "Templates and ready-made packs", the visual rules), `HANDOVER-nebulaa-redesign-15.md` (rules), the design draft `specs/2026-10-18-visual-refresh-and-photoshoot-design.md` (sections 2, 2b, 3, 4, 5, 8, 10; the owner accepted the recommended defaults), `impact-maps/home-and-plan.md` (the packs rail and the Photoshoot tab and tile on Home were deferred to this area, decision 9), `ops/tile-system.md` (compact tiles, cover tiles for hero choices, no dark panels on light pages) and the existing image and money code listed below.

Area-complete rule: this map covers every ledger item of the area: the Photoshoot page, the packs, the Home tab, tile and packs rail, the Create content tile, Library, and the templates line (see 9: the post templates are recorded with a stated reason).

## 0. The short version

1. There is no Photoshoot today. Everything it needs already exists in pieces: product photos (`models/Product.js` `imageUrl`, `images[]`), place photos (`models/BrandAsset.js` type `environment`), an image model that takes reference photos (`services/openaiImage.js` `generateOpenAIImage`, edit endpoint, up to 6 references), the wallet (`services/quarkBuckets.js` `spend`, `refundTo`, `settleWallet`, agency pool through `resolvePayer`), the daily AI ceiling and per-provider staff switches (`services/spendGuard.js`), the Quark wording (`config/quarkWording.js` `priceText`, `worthText`), entitlements (`config/entitlements.js`), the safest money pattern in the code (Home drafts: ledger row before the charge and before every call, idempotency key, one request at a time, caps, refund once; `services/homeDrafts/service.js`) and the Videos pattern for background work with partial refunds (`routes/studioVideos.js` `finishShort`).
2. v1 is product only: no person, no model, no face appears in any picture. The prompts are written by code from fixed lists (no free text from the customer, no text model call), so every word that reaches the image model is reviewed in this repository.
3. Money: one new action `photoshoot_image` in `config/apiCosts.js`, derived from the existing picture rate (medium quality, the same rate the posts use), the reference photos and storage, times the default margin. One photo costs about one post (see 3). A pack is charged once, up front, for all its photos; each photo is counted on the job before its call; failed photos are refunded, all of it when none succeeds.
4. The feature is behind a switch, `ENABLE_PHOTOSHOOT=on`, off by default until the owner's one real proof run (`ops/photoshoot-real-proof.md`). With the switch off the page, the packs and the prices still show, and the Create button says photoshoots open soon.

## 1. What exists and what it changes elsewhere

| Piece | Today | What Photoshoot does with it | Side effect to watch |
|---|---|---|---|
| `services/openaiImage.js` `generateOpenAIImage(prompt, { aspectRatio, references, quality })` | Used by posts, carousels, Videos people and places. Uploads the result to the image store folder `nebula-campaign-posts`; returns a `data:` URL when the upload fails. | Called through a small interface `services/photoshoot/generator.js` (faked in every test). A result that is not an `https://` link counts as a failed photo (no base64 is ever stored on a job). | None: the function is not changed. |
| `config/apiCosts.js` | `PROVIDER_RATES.gpt_image_2_per_picture` (low, medium, high), `assetCost`, `MARGIN.default` 2.5. | New rate `photoshoot_reference_input_per_photo` (estimate for the reference photos, marked to verify on the real proof), constants `PHOTOSHOOT_QUALITY` and `PHOTOSHOOT_MAX_REFERENCES`, action `photoshoot_image`, unit "per photo". | `QUARK_COSTS` gains a key: the staff price tables and `GET /api/credits/costs` list it automatically. No plan allowance changes (plans do not commit photoshoots). |
| `services/spendGuard.js` | Per-provider switches with labels. | New provider `photoshoot` ("Photoshoots"). A job also checks the Pictures switch (`image_generated` maps to `openai_image`), so either switch stops it. Checked before the charge and before every photo; a switch flipped mid-job stops the rest and refunds them. | `spendGuard.test.js` asserts the list: updated with the reason. The staff AI-spend screen lists providers from `status()`, so the new switch appears with no screen change. |
| `config/entitlements.js` | Features: create, video, publish ... | New feature `photoshoot`: allowed on Starter, Growth, Agency (and its client workspaces, which carry the agency tier) and managed accounts; refused on the free plan with the existing upgrade message. | The entitlement tests list the features: extended. |
| `services/quarkBuckets.js` | Atomic `spend` with the agency pool, `refundTo` the recorded payer. | Used as is: one spend per job (`units` = photos, so the daily ceiling records the true estimate), one refund per job at the end. | None. No new file reads `credits.balance` (the guard `creditAccessGuard.test.js` stays as it is). |
| `services/dataRegistry.js` | Every model that points at a user must be listed for deletion and export. | New model `PhotoshootJob` (field `user`, action delete; `payer` acknowledged in the test like `StudioVideo.payer`). | The registry test fails until listed: listed. |
| Products and place photos | `GET /api/products` (all fields), Brand assets > Environment. | The Photoshoot options list only the caller's own products that have a photo, and their own place photos. "Add a product" on the page uploads one photo and creates a normal product (it then also shows in Brand assets > Products and in Create content's product picker). | A product made here has only a name and a photo; Create and the planner treat it like any other product. |
| Library (`frontend/pages/Library.tsx`, `utils/library.ts`) | Posts, step-by-step videos, Hero videos. | New source "Photoshoots": every finished photo is in the Library, tagged Photoshoot, until the customer takes it out ("Save to Library" is a toggle that starts on). | The Library makes one more request; a failure of it only hides the photoshoots (same pattern as the other sources). |
| Create content (`pages/GravityCreate.tsx`, `utils/createTiles.ts`) | Cover tiles: Video, Single post, Campaign, Carousel, LinkedIn (owner: Video first). | A "Photoshoot" cover tile in second place (Video, Photoshoot, Single post, Campaign, Carousel, LinkedIn). "Use in Create" on a photo opens Create with that photo picked as the product picture (`CarouselPrefill.photo`), using the existing product reference path (`productReferenceImages`). | Six tiles in a row at 1280: the row stays one even row (`columns={6}`), two columns on a phone. Owner's order kept; Photoshoot second is a choice, noted for the owner. |
| Home (`components/home/HomeBlocks.tsx`, `utils/homeLayout.ts`) | Create tiles (Post, Carousel, Campaign, Video), describe box tabs Post and Video, packs rail hidden. | A Photoshoot tile, a Photoshoot tab (the typed idea is not sent anywhere: the tab says the photoshoot uses ready-made packs and opens the page; nothing typed is turned into a prompt), and a compact packs rail from `GET /api/photoshoot/packs`. | The rail adds one small cached request on Home; it hides itself when the request fails or the account is staff. |
| Sidebar (`components/Layout.tsx`) | Create content, Videos, Review and approve, Library. | "Photoshoot" entry under Create content (beside Videos). | `navMenu.test.mjs` and the tour anchors are unchanged (no new tour step). |
| Server start (`server-main.js`) | Mounts routes; background jobs started after the database connects. | Mounts `/api/photoshoot`; starts the resume loop (every 2 minutes, plus once at start) that picks up jobs whose runner was lost. | One small indexed query every 2 minutes. |

## 2. Data

New collection `photoshoot_jobs` (model `PhotoshootJob`). One row per press of Create (a pack) or per "Make this one again" (a redo of one photo). It is the durable ledger:

- `user`, `key` (idempotency, unique per user), `kind` (`pack` or `redo`), `parent` and `parentIndex` for a redo, `pack`, `day` (India date, for caps), options (`aspectRatio`, `background`, `count`), `products` (a snapshot: id, name, photo link), `place` (id, name, photo link, optional).
- `status`: `queued` (row written, not charged), `running`, `done`, `partial`, `failed`, `refused` (not charged: no balance or frozen client). `outcome` code for the staff counts.
- `inFlight: true` while not finished, with a unique partial index: one photoshoot at a time per account, enforced by the database across server processes.
- `photos[]`: `index`, `productIndex`, `scene` key and label, `status` (`pending`, `calling`, `done`, `failed`), `attempts` (incremented BEFORE each call), `url`, `inLibrary` (default true), `startedAt`, `finishedAt`. The prompt is stored for support and never sent to the page.
- Money: `photoCount`, `quarksPerPhoto`, `quarks`, `payerId` (the wallet that paid; the agency for a client), `refunded` (flips once), `refundedQuarks`, `refundFailed`.
- Runner lease: `leaseOwner`, `leaseUntil`. Only the holder of an unexpired lease may mark a photo `calling`.
- Kept: no expiry (the photos are the customer's Library). Deleted with the account (registry), and with a client workspace.

No migration: nothing existing changes shape. `CarouselPrefill` (session storage hand-over) gains an optional `photo` field; old hand-overs without it work as before.

## 3. Money (strongest care)

Price, derived (never typed): `photoshoot_image` = medium picture (`gpt_image_2_per_picture.medium`, USD 0.0457, the same measured rate the posts use) + reference photos (`PHOTOSHOOT_MAX_REFERENCES` 3 x estimated USD 0.012, priced at the maximum on purpose) + storing and serving it (`assetCost(1.5 MB)`, USD 0.002) = about USD 0.084, times the default margin 2.5, at USD 0.02 per Quark = **10 Quarks per photo** (a single post is 11, so one photo is about one post's worth). No text model call and no proofreading: the pictures carry no text. The reference input rate is an estimate and is the first thing the real proof measures.

Packs (photos x 10 Quarks, shown with the posts equivalent through `worthText`): Product photoshoot 6 photos (60), Marketplace pack 4 (40), Festival pack 8 (80), Lifestyle and in use 6 (60), Flat lay 4 (40), Clean white background 4 (40). Where a pack lets the customer choose the count, the price follows it. Several products in one job multiply the photos (at most 3 products and 24 photos per job).

The order of one Create (mirrors Home drafts, which had the strongest-model review):
1. switch on, not staff (a CSM or agency pass is allowed and charges the client's payer), entitled, input valid (pack, options from fixed lists, product ids that are the caller's own and have a photo);
2. one at a time in this process, then lost runners are resumed or closed;
3. idempotency: the same key returns the same job, never a second charge;
4. one in flight per account (database index), caps (below);
5. spend guard (`photoshoot_image` and `image_generated`), refused before any charge with "Nothing was charged";
6. the job row is written (`queued`, photos `pending`) BEFORE the charge; no row, no charge;
7. one atomic charge of the whole price from the paying wallet; refused: row closed as `refused`, nothing made;
8. the row is marked charged (`running`, `quarks`, `payerId`); if that write fails the Quarks go straight back and nothing is called;
9. the runner (lease) makes the photos, two at a time; each photo is marked `calling` with `attempts + 1` BEFORE its call; a failed photo gets one more try (counted the same way, and its extra estimated cost is added to the daily ceiling record); a provider refusal counts as a failure;
10. when every photo is finished: failed photos are refunded (`failed x per photo`), all of it when none succeeded, in one `refundTo` to the recorded payer, once (the `refunded` flag flips first). A refund that does not land is flagged `refundFailed` and raised as an ops alert.

Caps (config file `config/photoshoot.js`, numbers not code): 60 photos per account per India day (redos count), 1 job at a time per account, 3 starts per minute, 30 running jobs across all accounts (a brake on top of the spend ceiling), 24 photos per job, at most 2 calls per photo, a job older than 60 minutes is closed (unfinished photos failed and refunded).

Restart: a lost runner (server restart, crash) leaves `leaseUntil` in the past. The resume loop (and any read of the job) takes the lease and carries on with the `pending` photos. A photo left `calling` when its runner died is tried again only if it has a try left, otherwise failed and refunded, so a crash can never cause more than two paid calls per photo or an unrefunded failure.

Agency: the client workspace is `req.user` inside a pass; the charge comes from the agency pool through `resolvePayer`; a frozen client is refused; the refund goes back to the pool (`payerId`). Agency owners and client workspaces see photos and posts' worth, never Quarks (the existing `postsOnly` rule).

Staff: staff accounts cannot start a photoshoot outside a client pass. The switch "Photoshoots" stops new jobs and the rest of running ones (refunded).

## 4. Safety

- Product only: every prompt says no people, no faces, no hands or bodies, no mannequins.
- No logos, brand names, text, watermarks or labels that are not already on the supplied product; the product's shape, colour and label stay as in the photo; no other company's products or trademarks; no religious figures or symbols, flags, political or national emblems; no alcohol, tobacco or weapons props.
- Prompts are code-built from fixed scene lists. The only customer words in a prompt are the product name (cleaned: one line, at most 60 characters, quotes and control characters removed) and it is described as "the product in the reference photo".
- Uploads (the "Add a product" photo): PNG, JPEG or WEBP checked by the file's first bytes, not its name; at most 6 MB; a name of 1 to 100 characters; 20 uploads an hour per account. The photo is stored in the product image folder like any product photo. We do not run a separate picture moderation model in v1; the image model's own safety system refuses unsafe references, which ends as a failed, refunded photo.
- Reference photos are read on the server from the caller's own product and place records only (ids from the page are checked against the account); only `https://` links to public hosts (no IP addresses or local names) or the product's own stored `data:` image; image types and the 6 MB limit are checked again.
- Results are never reused across accounts: every read is filtered by the signed-in account (inside a pass, the client); no shared cache; the packs rail and preview art are our own drawings, not customer photos.

## 5. Edge cases (each has a test or a preview state)

| Case | Behaviour |
|---|---|
| No products at all | The product step shows a calm empty state: "Add a product photo to start" with the upload form and a link to Brand assets > Products. |
| Products without photos | Listed greyed with "Needs a photo" and a link to add one; not selectable. The server refuses a product id without a photo. |
| No place photos | The "Your space" option is hidden; scenes are used instead. |
| Free plan | Packs and prices are shown; Create is replaced by a calm note ("Photoshoots are part of the paid plans") with a link to Plans. |
| Agency client workspace | Entitled through the agency plan; no upgrade or buy text is shown inside a pass; charged to the pool; frozen client refused with the existing message. |
| Managed account | Entitled, charged as usual. |
| Switch off | Page and prices show, Create is disabled with "Photoshoots open soon." |
| Not enough Quarks | Refused before anything is made, nothing charged; the message names the price and points to top up or plans (no Quarks wording for agency, posts' worth instead). |
| Spend ceiling or switch off | "Making things is very busy right now ... Nothing was charged." |
| Some photos fail | The job ends `partial`; failed tiles show "This photo could not be made. You were not charged for it."; the banner states the refund. |
| All photos fail | The job ends `failed`; the whole price is returned; the banner says so. |
| Double click or retry of the same press | Same key, same job, one charge. |
| A second photoshoot while one runs | Refused: "A photoshoot is already being made." |
| Restart mid-job | Resumed by the loop; the page keeps polling and shows progress. |
| Regenerate one photo | Priced as one photo, shown before pressing, same pipeline (its own job row), counts toward the daily cap. |
| Phone (375) | Pack tiles two columns, steps stacked, results two columns, all buttons at least 40 px. |
| Other languages | The page copy is English (the app has no translation layer outside onboarding); photos carry no text, so the content language does not matter. Tamil and Hindi product names are kept as typed and pass the name cleaner (letters of any script are allowed). |
| Festival pack | Generic festive scenes only (lamps and lights, flowers, gift wrap, a celebration table, warm evening glow), no festival is named and no religious symbol is drawn. Named festivals wait for the owner-approved festival dates (ledger, Competitors area). |
| Accessibility | Real buttons and links, `aria-pressed` on choices, a live region for progress, alt text on result photos ("Photo 3 of 6, <scene>"), focus rings, reduced motion respected. |

## 6. Tests needed

Backend (`node --test`): price derivation and pack prices (from `QUARK_COSTS`, not typed), pack catalogue shape and wording, prompt rules (no people, no added logos, name cleaner), upload checks (magic bytes, size, name), entitlement variants, the service with fakes: charge once, ledger-before-call (attempts counted before each fake call), partial refund, full refund, retry once, switch mid-job, caps, idempotency replay, one in flight, lease and resume after a lost runner, stale close, another account's job never visible, agency payer and refund to the pool, frozen client, routes (status codes and messages), data registry, spend guard providers. Frontend (`node --test`): the photoshoot helpers (price lines, step rules, result notices, library mapping), createTiles order (Video, Photoshoot, Single post, Campaign, Carousel, LinkedIn), Home create tiles and tab, voice scope. Real database: `backend/scripts/photoshoot-check.js` on `nebulaa_dev` only with a fake generator.

## 7. Build order (each phase committed)

1. This map.
2. Backend, test first: `config/photoshoot.js` (caps), `config/photoshootPacks.js` (catalogue), `apiCosts.js` action, `entitlements.js` feature, `spendGuard.js` provider, `models/PhotoshootJob.js`, `services/photoshoot/{prompt,generator,refs,service}.js`, `routes/photoshoot.js`, mount and resume loop, registry.
3. Frontend: `services/api` methods, `utils/photoshoot.ts`, `pages/Photoshoot.tsx` and styles, route and sidebar entry, Create tile, Home tile, tab and packs rail, Library source, "Use in Create" hand-over, small SVG art inside the budget, preview mocks (`?photoshootstate=`), routes.json, screenshots at 1280 and 375.
4. Real-database check, the real-proof card, ops doc, ledger status.

## 8. Decisions (recommended defaults, used unless the owner says otherwise)

1. Product only in v1; model photoshoots later with their own safety design. Default: yes.
2. Packs and counts: Product photoshoot 6, Marketplace 4, Festival 8, Lifestyle and in use 6, Flat lay 4, Clean white background 4 (the draft's suggestion for marketplace, lifestyle and festive). Default: yes.
3. Quality: medium, the same rate as post pictures (about one post's worth per photo). High quality would be about 2.6 times the price. Default: medium.
4. Marketplaces: no marketplace names on screen; the Marketplace pack makes square photos on pure white, which the main Indian marketplaces accept. Default: yes (owner to name marketplaces if he wants them listed).
5. Who can use it: paid plans, agency clients and managed accounts; the free plan sees packs and prices with a calm upgrade note. Default: yes.
6. No free-text instruction in v1 (fixed choices only), so no customer words but the product name reach the image model. Default: yes.
7. Switch `ENABLE_PHOTOSHOOT`, off by default until the owner's one real proof run. Default: yes.
8. Photos go to the Library automatically, tagged Photoshoot; "Save to Library" is a toggle that starts on. Default: yes.
9. Post templates on the Home rail: not built in this area (stated reason: a template needs its own content design and copy per business type; recorded in the ledger as still to do). The rail shows the photoshoot packs.
10. Photoshoot tile second on Create content, after Video. Default: yes, noted for the owner.
11. Two photos at a time per job, about one minute each (time estimate on each pack: photos divided by two, in minutes, rounded up). Default: yes; measured on the real proof.
