# Photoshoot studio: how it works

Built 2026-10-19 on branch `nebulaa-redesign`. NOT released. Off in every environment until `ENABLE_PHOTOSHOOT=on` is set (after the owner's one real proof run, `photoshoot-real-proof.md`). Impact map and decisions: `docs/superpowers/impact-maps/photoshoot.md`.

## What the customer sees

- **Photoshoot** in the sidebar (under Create content and Videos), a Photoshoot cover tile second on Create content (Video, Photoshoot, Single post, Campaign, Carousel, LinkedIn), a Photoshoot tile and tab on Home, and a "Ready-made photoshoot packs" rail on Home.
- `/photoshoot`: 1 choose a pack (six cover tiles with their price and time), 2 choose up to three of their own products that have a photo (or add one: name and a PNG, JPEG or WEBP photo up to 6 MB, saved as a normal product), 3 choose the look (photos per product where the pack allows it, shape, background, and "Your space" where the pack allows it and they have place photos). The summary shows the photos, the price in Quarks with posts' worth (agency accounts see posts' worth only) and the time BEFORE Create.
- While it is being made: progress, photo tiles fill in as they finish; the page can be left and reopened.
- Results: Use in Create (opens Create content with the photo picked as the product picture), Download, Save to Library (on by default; a toggle), Make again (priced, one photo). A photo that could not be made says "You were not charged for it."; the banner states the refund.
- Library: a "Photoshoots" source; every finished photo kept in the Library is listed there.
- Free plan: packs and prices are shown with a calm "part of the paid plans" note and See plans. Inside an agency client: no plan note, no Quarks.
- Switch off: packs and prices show; "Photoshoots open soon." No charge is possible.

## The packs (config/photoshootPacks.js) and prices

Each photo is the action `photoshoot_image` in `config/apiCosts.js`: medium picture (USD 0.0457, the measured post rate) + 3 reference photos x USD 0.012 (ESTIMATE, the real proof measures it) + storage (USD 0.002) = about USD 0.084, x 2.5 margin, at USD 0.02 a Quark = **10 Quarks a photo** (a post is 11).

| Pack | Photos (choices) | Shapes | Options | Price (default count) |
|---|---|---|---|---|
| Product photoshoot | 6 (4 or 6) | Square, Portrait | Background (cream, grey, pastel, deep colour), Your space | 60 Quarks, about 5 posts' worth, about 3 minutes |
| Marketplace pack | 4 | Square | pure white, fixed | 40 Quarks, about 4 posts' worth, about 2 minutes |
| Festival pack | 8 (4 or 8) | Square, Portrait, Story | none (generic festive scenes, no festival named) | 80 Quarks, about 7 posts' worth, about 4 minutes |
| Lifestyle and in use | 6 (4 or 6) | Portrait, Square, Story | Your space | 60 Quarks, about 5 posts' worth, about 3 minutes |
| Flat lay | 4 | Square, Portrait | Background (wood, marble, linen, pastel) | 40 Quarks, about 4 posts' worth, about 2 minutes |
| Clean white background | 4 | Square, Portrait | none | 40 Quarks, about 4 posts' worth, about 2 minutes |

Several products multiply the photos (at most 3 products, 24 photos). Changing a provider rate in `apiCosts.js` reprices everything; no price is typed anywhere else.

## The money path (services/photoshoot/service.js)

1. Switch, staff (a CSM or agency pass is allowed), entitlement (`photoshoot`: Starter, Growth, Agency and its clients, managed; not free), choices from fixed lists, the products and the place are the caller's own and have a photo.
2. One request at a time in the process; lost runners are resumed.
3. Idempotency: the page sends a key per press; the same key returns the same job, never a second charge. A key used for another request (a pack key on Make again, or a Make again key for another photo) gets 409 "That request was already used for something else." 
4. One job in flight per account (unique partial index `one_in_flight_per_account`), caps (`config/photoshoot.js`): 3 starts a minute, 60 photos per India day (redos count), 30 running jobs across all accounts. The all-accounts cap is counted and then inserted, so a burst across several server processes can pass it by a few jobs; the daily AI spend ceiling still applies (accepted).
5. Spend guard: the Photoshoots switch, the Pictures switch, the daily AI ceiling. Refused before any charge ("Nothing was charged").
6. The `photoshoot_jobs` row is written (queued, every photo pending) BEFORE the charge. No row, no charge.
7. One atomic charge of the whole price from the paying wallet (`quarkBuckets.spend`, the agency pool for a client; units = photos, so the daily spend record is right). Refused: the row is closed as refused.
8. The row is marked charged (running, quarks, payer). If that write fails the Quarks go straight back and nothing is called.
9. The runner takes a 10-minute lease and makes the photos two at a time. Each photo is marked `calling` with `attempts + 1` BEFORE its call. A failed photo gets one more call (its estimated cost is added to the daily record). A missing product photo fails the photo without a call. A result that is not a stored https link is a failure. The staff switches are checked before every pair; switching off stops the rest (refunded). The daily ceiling does not stop a job already counted.
10. When every photo is finished: status done, partial or failed; refund = failed photos x price (all of it when none was made), claimed once in the same update that finishes the job, sent to the recorded payer. A refund that does not land sets `refundFailed` and raises an ops alert (`photoshoot_refund`); the page then says the Quarks are being returned.
11. A charge that throws (the debit may or may not have landed) is never closed as "no balance": the proof (`quarkBuckets.chargeProof`: the Quark ledger row, else the `credits.history` entry with the job's `ref`, written in the same atomic update as the debit) decides at once when it shows a charge (closed `ledger`, refunded once); otherwise the row stays queued and the stale sweep decides 3 minutes later. A charge that landed but could not be marked on the job is refunded only after the refund is claimed on the row (`repo.closeLedger`), so the stale sweep and the Create can never both refund it.

Refund retries: the resume loop (every 2 minutes) also tries again, at most 10 a run, every job with `refundFailed: true`: the row is claimed first (`refundRetryAt` moved forward and `refundAttempts + 1` in one conditional update), the proof is read (a refund that already landed is only marked), then `refundTo` to the recorded payer. A failed try waits 2, 4, 8, 16 minutes; after `REFUND_RETRY_MAX` (5) tries the job gets `refundGaveUp: true` and one alert email is sent (`photoshoot_refund_gave_up`). Runbook for a gave-up job: check the payer's (`payerId`) `credits.history` for an entry with `ref` = the job id and a positive amount; if there is none, grant `refundedQuarks` Quarks to that payer with the staff grant, then unset `refundFailed` on the job.

On worker consumers (E9 stage B2, `ENABLE_PHOTOSHOOT_CONSUMER`, default off): step 9 does not run in the web task. The charged job waits in the database (`queued` with its charge recorded, `via: 'consumer'`) and a worker claims it with a 60-second lease; every photo start, photo result and the close are written only while the worker still holds the claim; a worker that stops is replaced by another that makes only the unfinished photos; every close reads the charge proof first and claims the refund in the closing write. How it works and how to turn it on and off: `generation-parallelism.md` (stage B2) and `ecs-web-worker.md` "Photoshoot on the worker" (the drain wait before any rollback is mandatory). The rules below are the switch-off (in-process) path.

Restart: a lost runner's job has an expired lease. The resume loop (`services/photoshoot/index.js`, 30 s after start and every 2 minutes; off with `ENABLE_PHOTOSHOOT_RESUME=off`), the next Create and opening the job all pick it up. A photo left `calling` gets one more call only if it has one left; otherwise it fails and is refunded. A job not finished 60 minutes after its charge is closed (stale) and its unfinished photos refunded. So a crash never causes more than two paid calls per photo, or a failure without a refund.

## Safety

- Product only: every prompt ends with fixed rules (`services/photoshoot/prompt.js`): no people, faces, hands, bodies or mannequins; the product exactly as in the reference; no added logo, brand name, text, price or watermark; no other company's products or marks; no religious figures or symbols, flags, emblems, alcohol, tobacco or weapons. Prompts are written by code from fixed scene lists; the only customer words are the product name (one line, 60 characters, quotes removed). A test reads every scene line for words about people, logos or festivals.
- Uploads and references (`services/photoshoot/refs.js`): the upload has the same gates as Create (the `ENABLE_PHOTOSHOOT` switch and a paid plan), so nothing is stored for a free account or while the studio is off; the type is read from the file's first bytes (PNG, JPEG, WEBP), 6 MB, 20 uploads an hour; references only from the caller's own records, only https links to public host names (no IP addresses or local names, no redirects) or the product's stored data image. The image model's own safety system refuses unsafe pictures; that ends as a failed, refunded photo.
- Ownership: every read and change is filtered by the signed-in account (inside a pass, the client). No cache is shared; the Home rail and the art are our own drawings.
- Only `services/photoshoot/generator.js` reaches the image model; every test and the real-database check replace it with a fake.

## API (routes/photoshoot.js, all behind sign-in and a rate limit)

`GET /api/photoshoot/packs`, `GET /options`, `POST /jobs`, `GET /jobs`, `GET /jobs/:id`, `POST /jobs/:id/photos/:index/redo`, `PATCH /jobs/:id/photos/:index` (`{ inLibrary }`), `DELETE /jobs/:id/photos/:index` (deletes one finished photo for good: owner-only, 409 while the photoshoot runs, stored picture removed from the image host best effort, never touches the charge, refund or ledger), `GET /library`, `POST /upload` (`{ name, imageData }`, the only route with the big body allowance).

## Staff

- Switch "Photoshoots" on the AI spend screen (provider `photoshoot`); the "Pictures" switch also stops photoshoots.
- Staff usage: `photoshoot_image` counts under Images and posts.
- Counts per outcome and day: `dailyCounts()` in the service (ok, partial, none, no_balance, frozen, ledger, switched_off, stale).
- Data: `photoshoot_jobs` is erased with the account (data registry); the photo files are found by the image cleanup like other generated pictures.

## Checks

- Unit tests: `backend/tests/photoshootService.test.js`, `photoshootPacks.test.js`, `photoshootRoutes.test.js`, `photoshootRealProof.test.js`; `frontend/tests/photoshoot.test.mjs`, `createTiles.test.mjs`, `homeLayout.test.mjs`, `coverTile.test.mjs`.
- Real database (nebulaa_dev only, fake image generator): `cd backend && node scripts/photoshoot-check.js` (24 checks, plus section 10 delete one photo: charge and ledger, partial and full refunds, idempotency, the database lock, per-minute and per-day caps, no balance, restart takeover, a photo left calling, stale close, ownership, Library, redo, agency pool, free plan, switch off, staff switch, upload, no outside call; since the money-path review: a charge that throws, the history proof, refund retries, the refund claim on a failed mark, upload gates, scoped keys). `node scripts/photoshoot-check.js cleanup` removes leftovers of an interrupted run. Last run 2026-10-19: 32 PASS, 0 FAIL, 83 rows removed, 0 left, estimated spend (USD 6.03) taken off again.
- Preview: `?photoshootstate=` ready, empty, nophoto, free, off, running, partial, failed, client, error; `#/photoshoot?pack=<key>`.

## To switch it on (owner)

1. The one real proof (`photoshoot-real-proof.md`) with the owner's OK; correct `photoshoot_reference_input_per_photo` if the measured cost differs.
2. Release, then set `ENABLE_PHOTOSHOOT=on` on the server and restart.
