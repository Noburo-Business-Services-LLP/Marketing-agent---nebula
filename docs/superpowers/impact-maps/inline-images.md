# Impact map and build plan: INLINE IMAGES AND RAW PROVIDER ANSWERS IN DOCUMENTS

Written 2026-10-20 on branch `nebulaa-redesign` (head `4e86f46`), before any code for this item. Owner's complaint: the app feels sluggish; this is the biggest remaining speed risk. Inputs read: `ops/performance-week1.md` (lean list fields, the 740 KB / 1.7 MB measurement, "images stored as base64 ... a separate, careful job"), handovers 27 and 28, `ops/generation-parallelism.md`, the models and the code cited below. Line numbers are those of `4e86f46`.

This document decides scope. Everything outside "Build order" is listed so nothing is forgotten, not because it is done here.

## 0. The short version

1. Measured on `nebulaa_dev` (bounded sample, section 1): **drafts** average 723 KB, **campaigns** 1.62 MB, **ai_content_performance** 3.21 MB, **ai_brand_memory** rows up to 12 MB, **ai_campaign_history** 236 KB. Nearly all of it is base64 pictures and copies of them.
2. A campaign that holds a base64 picture carries it **four times**: `creative.imageUrls`, `publishResult.error`, `publishResult.instagramFix` and `lastPublishError`. The scheduler sends the base64 picture to Ayrshare as the media link (`services/campaignPublisher.js:54-78` never uploads it), Ayrshare refuses it, and our error text, which echoes the request, is stored whole. So these posts fail AND bloat.
3. `ai_content_performance.assets.images` and `.thumbnails` copy the campaign's `creative.imageUrls` (`services/aiPerformanceTracker.js:35-39`), base64 included, twice. The Performance view only ever uses an https link from them (`services/performance/metrics.js:208-215` `httpsUrl`).
4. Plan: (a) a storage seam `services/imageStore.js` used by the generators that today "fall back to base64" when the upload fails, plus a save-time backstop on Draft and Campaign that uploads any data URI still being written; (b) compact provider answers at the model (`publishResult`, `lastPublishError`, Draft `errorMessage`), https-only assets in `ai_content_performance`; (c) projections on the background readers; (d) a dry-run-first, resumable, batch migration for existing rows, never run by the assistant beyond throwaway `zz.` documents.

## 1. Measurements (`backend/scripts/doc-size-report.js`, read-only, `nebulaa_dev` only)

How: `$collStats` for totals (metadata, no scan); field sizes from the newest N documents by `_id` plus the newest N older than 90 days (two `_id` index walks), sizes computed in the database with `$bsonSize`, `maxTimeMS` 15 s (45 s on the retry with N = 5 for the two heaviest collections, whose 20-document read timed out at 15 s: the cold read of about 35 MB). Never a full scan, never a write. Run 2026-10-20.

| Collection | Docs | Avg (collection) | Sample | Top fields by bytes in the sample (share of sample bytes) |
|---|---|---|---|---|
| campaigns | 459 | **1.62 MB** (745 MB data) | 10 (5 + 5), avg 3.79 MB | `publishResult` 50.0% (max 6.5 MB) of which `publishResult.error` 25.0% and `publishResult.instagramFix` 25.0%; `lastPublishError` 25.0% (max 3.3 MB); `creative.imageUrls` 25.0% (data URI in 3 of 10); everything else < 0.1% |
| drafts | 536 | **723 KB** (378 MB data) | 40 (20 + 20), avg 636 KB | `creative.imageUrls` 49.7% (max 3.3 MB) and `imageUrl` 49.7% (data URI in 4 of 40; the same picture twice); `imagePromptResolved` 0.3%; captions 0.1% |
| ai_content_performance | 33 | **3.21 MB** (106 MB data) | 10 (5 + 5), avg 3.93 MB | `assets.images` 50.0% and `assets.thumbnails` 50.0% (data URI in all 10); `rawAnalytics` 0.1% (about 2 KB per row: NOT a problem) |
| ai_brand_memory | 306 | 81 KB (24 MB data) | 18, avg 1.33 MB | `rawProfile.pastPosts` 98.7% (max 12.4 MB) |
| ai_campaign_history | 759 | 236 KB (175 MB data) | 20, avg 8 KB | sample rows are small; the average says older middle rows carry `generatedImages` / `sourceResponse` copies (same source as campaigns) |
| ai_video_memory | 1090 | 67 KB (72 MB data) | 20, avg 7.5 KB | `sceneData` 55% (sample small) |
| video_drafts | 28 | 155 KB | 37 | `input` 81% (max 608 KB: uploaded reference pictures) |
| contentcalendars | 31 | 23 KB | 37 | `weeks` 98% (text plans; fine) |
| users, products, brandassets, cachedcampaigns, notifications, studio_videos | | 0.2 to 5 KB | | fine |

Earlier measurement (performance week 1): one scan of `campaigns` took 134 s on dev; the list projections (`services/listPage.js:73,97-103`) already drop `imageUrlNoLogo`, `publishResult` and cut `lastPublishError` to 500 characters in the lists.

## 2. Every code path that WRITES the heavy fields

### 2a. Pictures (`Draft.imageUrl`, `Draft.imageUrlNoLogo`, `Draft.creative.imageUrls`, `Draft.carouselSlides[].imageUrl`, `Campaign.creative.imageUrls`)

| Path | Where | Today | This change |
|---|---|---|---|
| Campaign post image (Nano Banana 2 primary and fallback) | `services/geminiAI.js:4842-4852`, `4896-4903` `generateCampaignImageNanoBananaCore` | upload; on failure returns the base64 | **converted**: `imageStore.finishGeneratedImage`; a failed store in production returns `{ success: false, storageFailed: true }` without trying another paid model |
| OpenAI image (first choice or third tier) | `services/openaiImage.js:164-172` | upload; on failure returns base64 | **converted** (same rule); the Nano Banana core stops at `storageFailed` instead of calling Google |
| Header and footer frames | `services/postFrames.js:80-87` `addFramesToImage` | upload; on failure keeps the framed base64 | **converted**: a failed store keeps the unframed (already stored) picture, `applied: false` |
| Edit image (`POST /drafts/:id/edit-image`) | `services/geminiAI.js:3392-3396` `refineImageWithPrompt` | upload; on failure returns base64 | **converted**: failure returns `{ success: false }` and the route refunds (existing path, `routes/drafts.js:886-889`) |
| Logo overlay (apply-logo, generation) | `services/logoOverlay.js:210-230`, `308-330`, `overlayBrandLogoIfPresent:344` | upload; failure returns `success: false`, callers keep the clean (already stored) picture | already clean, no change |
| Carousel slides | `routes/carousels.js:327` | stores only `http` links, '' otherwise | already clean |
| Upload media (`POST /drafts/upload-media`) | `routes/drafts.js:521-535` | uploads, error on failure | already clean |
| Reference-poster job | `services/backgroundQueue.js:371-374` | uploads, throws on failure | already clean |
| Campaign create (`POST /campaigns`) | `routes/campaigns.js:2505-2530` `uploadEverywhere` | uploads every data URI strictly before saving | already clean |
| Draft save / update by the customer (`POST /drafts/save`, `PUT /drafts/:id`) and the campaign copy made by `PUT` | `routes/drafts.js:43-75`, `138-200` | stores whatever the client sends (the frontend may send base64 from the poster routes below) | **backstop** (save hook, section 4) |
| Poster routes that return base64 to the browser (`/process-aspect-ratio`, template poster, edit poster, poster from reference, batch) | `routes/campaigns.js:5076-5090`, `5295-5310`, `5385-5398`, `5505-5518`, `5605-5615` | return `imageBase64` and an `imageUrl` that is null when the upload failed; the browser may save the base64 later | not converted (they return to the browser, they do not persist); the backstop catches a later save |
| Background generation of posts and campaign images | `services/backgroundQueue.js:88-110`, `331`, `470`, `571-601` | stores the generator's `imageUrl` (base64 when the generator fell back) | fixed through the converted generators; backstop for the rest |
| Calendar, weekly items, Home drafts, localisation copies | `services/contentCalendarService.js:952`, `services/week/*`, `services/homeDrafts/*`, `services/draftLocalization.js:41` | copy links from other drafts | fixed by the backstop and the migration (they copy what is there) |
| Video scene images with logo | `routes/videoGeneration.js:2640`, `2786-2800` | uploads | already clean (VideoDraft, not in scope) |
| Product, brand asset, idea, content images | `routes/products.js:277-281`, `routes/brandAssets.js:262,653,766`, `routes/ideas.js:48`, `routes/content.js` | upload | already clean |
| Older generators (`generateAIImage`, `generateImageWithVertexAIFallback`, `generateImageFromCustomPrompt`, template posters) | `services/geminiAI.js:844-965`, `1122`, `1152`, `3659-4181` | campaign suggestions (`cachedcampaigns`, measured small) and posters returned to the browser | **left**: not persisted into Draft/Campaign directly; backstop covers a later save |

### 2b. Raw provider answers

| Field | Writers | This change |
|---|---|---|
| `Campaign.publishResult` | `routes/campaigns.js:2952-2971` (`persistPublishFailure`), `3772`, `3900`, `3966`, `4000`, `4075`; `routes/drafts.js:314`; `services/campaignScheduler.js:287`, `325`, `368`; `services/campaignStatusSync.js:155`, `186` | **schema setter** `compactAnswer` (one place, covers documents and update queries, mongoose 8 runs setters on `$set`): data URIs replaced by a marker, strings over 500 characters cut (links up to 2048 kept), arrays at most 25 items, depth at most 6, and a whitelist summary when the result is still over 32 KB |
| `Campaign.lastPublishError` | same writers plus `campaigns.js:3237`, `campaignStatusSync.js:86,209,215` | **schema setter**: data URIs inside the text replaced, then cut to 500 characters |
| `Draft.errorMessage` | many (`routes/drafts.js:326`, `staleDrafts.js:19`, background queue) | **schema setter** (same 500-character rule) |
| `ai_content_performance.assets` | `services/aiMemoryService.js:440` (from `aiPerformanceTracker.js:35`) | **https only** (`assets.images/videos/thumbnails` keep `http(s)` links, drop data URIs) in `trackPerformance`; `rawAnalytics` unchanged (2 KB; `metricsFromRaw` reads it) |
| `ai_campaign_history.generatedImages`, `.sourceResponse` | `services/aiCampaignLearning.js:19-37`, `aiMemoryService` | **https only** for `generatedImages`, `compactAnswer` for `sourceResponse` (schema setters) |
| `ai_brand_memory.rawProfile.pastPosts` | brand memory import of past posts | **left** (listed for a next item: same pattern, needs its own reader check) |

Readers of `publishResult` that must keep working (all kept by `compactAnswer`, which keeps keys and short values): `publishResult.postIds[]` (`platform`, `id`, `postUrl`, `status`) and `publishResult.postUrl` (Performance view, `services/performance/metrics.js:175-177`, `service.js:34`), `publishResult.retryCount`/`retryRequestedAt` (`campaignStatusSync.js:120-122`), `publishResult.data`/`errorDetails`/`errors` (`routes/adCampaigns.js:873-1087`). No frontend screen reads `publishResult` (lists drop it already).

## 3. Readers (who pays for the weight)

| Reader | Where | Today | This change |
|---|---|---|---|
| Drafts and Campaigns lists | `services/listPage.js` | lean projections (week 1) | none |
| One post (`GET /drafts/:id`, `/campaigns/:id`) | routes | full document (needed by the editor) | none; lighter after the migration |
| Scheduler tick (every minute) | `services/campaignScheduler.js:217` | FULL campaign documents, up to 20 | `-publishResult -lastPublishError` (the publisher needs the rest, it never reads these two) |
| Status sync | `services/campaignStatusSync.js:252` | FULL documents, up to 200 | inclusion projection of the 17 fields it reads (incl. `publishResult.retryCount`, `publishResult.retryRequestedAt`) |
| Performance checkpoints | `services/performanceTracker.js:93` | FULL documents, `limit * 3` | inclusion projection |
| Notification scheduler fallback | `services/notificationScheduler.js:107` | FULL documents of every scheduled campaign | same projection as its primary query |
| Stale drafts reaper | `services/staleDrafts.js:16` | FULL processing drafts, up to 200 | projection `userId contentType imageUrl carouselSlides.imageUrl` |
| Home summary, Performance view, brand memory | `services/homeSummary.js:89-94`, `services/performance/service.js:31-36`, `services/brandMemory/runner.js:64-66` | already select; they do read `imageUrl`/`creative.imageUrls` (base64 when not migrated) | none; lighter after the migration |
| Bin purge | `services/binPurge.js:58-86` | binned rows in full (daily, at most 500), media fields for the others | left (needs the media fields to clean Cloudinary) |
| Frontend | `pages/Drafts.tsx`, `Campaigns.tsx`, `GravityApprove.tsx`, `GravityCalendar.tsx`, `Library.tsx`, `components/PlatformPreview.tsx`, `DraftPreviewModal.tsx` and others | render `imageUrl` in `<img src>`; https and data URIs both work | none (https already accepted everywhere: the generators return Cloudinary links on success today) |

Regression guard: a test scans the background services (scheduler, status sync, performance tracker, notification scheduler, stale drafts, binPurge excepted by name) and fails when a `Campaign`/`Draft` `find`/`findOne` there has no `.select(`.

## 4. Storage options and what the publishers expect

- Storage today: **Cloudinary** (`services/imageUploader.js`, `uploadBase64Image`: refuses SVG/HTML, retries network errors, returns `secure_url`). Configured by `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. Local `backend/storage/` holds only generated videos (`/generated-media`), not pictures. S3 is used for no picture (signed S3 uploads are a separate hardening item). So the seam wraps Cloudinary.
- Ayrshare needs a public https link. Today: the in-request publish (`routes/campaigns.js:3168-3185`) uploads a data URI first (strict when Instagram with audio, else posts without media on failure); the scheduler (`services/campaignPublisher.js:54-78`) sends `creative.imageUrls` as they are, so a base64 campaign scheduled for later fails at Ayrshare. Migrating existing rows and storing new pictures fixes this; no publisher change in this item.
- URL checks: `services/safeUrl.js` (`urlSetter`, `allowDataImage`) is used on scraped/user addresses; the stored Cloudinary links pass it.

### `services/imageStore.js` (the seam)

- `storeImage(input, { folder })`: input is a data URI or a Buffer (plus mime). Checks: png, jpeg, webp or gif by claimed type AND first bytes (`uploadSafety.checkDataUrl`/`checkUpload`), SVG/HTML refused, at most `IMAGE_STORE_MAX_BYTES` (default 15 MB decoded). An https link is returned unchanged. Returns `{ url, stored: true, publicId }`.
- Storage not configured: development/test return `{ url: <the data URI>, stored: false }` (dev keeps working without Cloudinary keys); **production throws** `ImageStoreError`.
- Upload fails: throws `ImageStoreError` everywhere (the caller's existing error/refund path runs).
- `finishGeneratedImage(dataUri, opts)`: the generator helper: `{ ok: true, url }` or `{ ok: false, error, storageFailed: true }` with a customer-safe message.
- Switch `INLINE_IMAGE_MODE`: `store` (default) or `legacy` (emergency: the old behaviour, a failed upload keeps the base64; no deploy needed to go back).
- Fakeable: `createImageStore({ upload, env })`; the default instance uses `uploadBase64Image`.

### Save-time backstop (`models/plugins/inlineImages.js`)

On Draft and Campaign: `pre('save')`, `pre('insertMany')` and the update-query hooks look at the picture fields only (`imageUrl`, `imageUrlNoLogo`, `creative.imageUrls`, `creative` objects, `carouselSlides[].imageUrl`, `$set`/top-level/`$push`), and store any data URI through the seam. When the store fails the write is NOT failed: the picture is kept as it is and an error is logged (`[inline-images] kept a data URI`): a hook failing a write after a charge could skip a refund in a route that does not expect a save error (e.g. `edit-image` refunds only when the generator fails). The generators above are where a failure fails cleanly; the migration sweeps what the backstop had to keep. Off with `INLINE_IMAGE_MODE=legacy`.

## 5. Migration of existing rows (`backend/scripts/migrate-inline-images.js`)

- Dry run by default: counts documents and bytes that WOULD be saved per collection and field. `CONFIRM_MIGRATE=yes` acts.
- Refuses any database whose name is not exactly `nebulaa_dev`; acting there needs `ALLOW_PROD_MIGRATION=yes` AND `CONFIRM_MIGRATE=yes` (the owner decides production; the assistant never sets them). Built addition (D106): `ALLOW_PROD_MIGRATION=yes` alone allows a read-only DRY RUN there, so the owner can see the numbers before deciding.
- Batches of 20 by `_id` ascending, `maxTimeMS` on every read, a sleep between batches (`MIGRATE_SLEEP_MS`, default 1500), resumable from a small state file (`backend/temp/migrate-inline-images.state.json`, last `_id` per collection).
- Each batch reads the next 20 `_id`s and computes in the database a small `needs` flag per document (a data URI in a picture field, an answer over 2 KB, a message over 500 characters); only those documents are then fetched. Every read is bounded to 20 documents (no regex scan that could walk the whole collection).
- Per picture: store through the seam, **HEAD the returned link** (must answer 2xx with an image type) before replacing; the update is conditional on the old value still being there (a customer edit in between wins). Provider answers: rewritten through `compactAnswer`/the message cap.
- Backup: the old value goes into `legacyInline.<field>` ONLY when the document stays under a size cap (`MIGRATE_BACKUP_CAP_BYTES`, default 256 KB, chosen during the build: with a 2 MB cap a migrated campaign kept its old 1 MB of backups and did not get lighter) after the change; otherwise only `legacyInline.<field>Sha256` and the byte count are kept (the HEAD-checked link is the picture). `node scripts/migrate-inline-images.js drop-backups` (dry run unless `CONFIRM_MIGRATE=yes`) unsets `legacyInline` after the owner has checked.
- Idempotent: a rerun finds nothing (URLs are not data URIs; compacted answers are under the caps).
- Collections: `drafts`, `campaigns`, `ai_content_performance` (data URIs in `assets` are removed, not uploaded: the campaign holds the picture), `ai_campaign_history` (same).
- Real-database check `backend/scripts/inline-images-check.js`: throwaway `zz.inline-images-` user and documents on `nebulaa_dev`, FAKE store and FAKE HEAD (no network): dry-run counts, migration replaces, rerun is a no-op, sizes drop, the readers (list projection, scheduler projection, Performance thumbnail) still work, everything deleted at the end.

## 6. Rollback

- Write path: `INLINE_IMAGE_MODE=legacy` restores the old fallback (base64 kept when the upload fails) without a deploy; reverting the commits removes the seam.
- Compaction: setters only change new writes; reverting the commit restores whole answers on new writes (old compacted rows stay compacted: nothing reads the removed bulk).
- Migration: rows keep `legacyInline.*` when small enough; a revert script is one `$set` of the backup back into the field (documented in `ops/inline-images.md`); for rows over the cap the Cloudinary link stays (the hash proves which picture it was). Take an Atlas backup / snapshot first (owner step).

## 7. Edge cases

- No Cloudinary keys in dev: generators and the backstop keep data URIs (works as today); the migration dry run still counts; acting refuses to run when storage is not configured (it would change nothing).
- Production without keys: generators fail cleanly (refund paths) instead of storing base64; the server already needs Cloudinary for publishing.
- Cloudinary rate limit or outage during migration: a failed upload skips that field (counted), the batch goes on, the state file is only advanced past documents that were fully handled or skipped on purpose; a rerun retries them.
- A customer edits a draft while it is migrated: the conditional update matches nothing and the row is retried on the next run.
- Pictures that are not data URIs but `blob:` or broken links: untouched.
- SVG or HTML data URIs: refused by the seam, left in place, counted as `refused`.
- Duplicate pictures (`imageUrl` and `creative.imageUrls[0]` the same base64): uploaded once per document (hash cache), both fields get the same link.
- Cloudinary cost: one stored picture per unique base64 (about 1 to 3 MB each); 536 drafts and 459 campaigns on dev; the production count is the owner's dry run.

## 8. Build order (each step its own commit, tests first with fakes)

1. This map and `scripts/doc-size-report.js` (with a unit test of its summary function).
2. `services/imageStore.js` + tests; convert the generators in 2a marked "converted"; the save-time backstop + tests.
3. `compactAnswer` + the setters on `Campaign.publishResult`, `Campaign.lastPublishError`, `Draft.errorMessage`, `AICampaignHistory`; https-only assets in `trackPerformance`; tests including the Performance normaliser and `metricsFromRaw` fields.
4. Reader projections + the scanner test.
5. Migration script + unit tests with fakes + the real-database check on throwaway `zz.` documents + `ops/inline-images.md` (production steps for the owner).
6. Ledger, decisions log, hardening mapping.
