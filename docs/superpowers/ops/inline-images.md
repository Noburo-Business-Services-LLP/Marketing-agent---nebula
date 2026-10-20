# Pictures out of the database: what changed and the production steps (owner)

Why: posts and campaigns kept their pictures inside the database as long text (base64). On the dev database a post averaged 723 KB, a campaign 1.62 MB and a performance row 3.21 MB; one read of the campaigns collection took 134 seconds. Every list, every scheduler minute and every background sweep paid for it. Details and measurements: `docs/superpowers/impact-maps/inline-images.md`. Decisions D101 to D106.

## What changes when this release goes out (no action needed)

- New pictures are saved to Cloudinary and only the link is stored. If Cloudinary fails in production the generation fails with the normal "please try again" message and the Quarks come back through the existing refund paths (before: the picture was kept as base64).
- Any picture still written as base64 by another path is moved to Cloudinary when it is saved; if that fails the save still goes through (and the migration below catches it later).
- Provider answers (Ayrshare) are stored in short form: ids, statuses, links, codes, a message of at most 500 characters.
- The scheduler and the background checks read only the fields they need.
- Emergency switch (no deploy): `INLINE_IMAGE_MODE=legacy` brings back the old behaviour (base64 kept when Cloudinary fails). Set it with `bash docs/superpowers/ops/set-secret-value.sh` like the other switches, and remove it again when Cloudinary is back.

## Production migration of the old rows (owner only, after the release)

The assistant never runs this against production. Do it off-peak (late evening India time), one collection at a time.

1. Take an Atlas backup (snapshot) of the production cluster and note its time. Check Atlas disk usage first: the cluster is shared with dev and has hit its write-blocking disk ceiling before; this migration makes the data smaller, but the backup fields are written first.
2. Dry run (reads only, nothing is uploaded or written). From the `backend` folder with the PRODUCTION connection string in `.env`:

```
ALLOW_PROD_MIGRATION=yes node scripts/migrate-inline-images.js
```

   It prints, per collection, how many documents need work and how many MB would be saved. Note the numbers (each picture found is one Cloudinary upload: check the Cloudinary plan's storage and monthly credits against that count; about 1 to 3 MB per picture).
3. First real run, small: one collection, 5 batches of 20:

```
ALLOW_PROD_MIGRATION=yes CONFIRM_MIGRATE=yes MIGRATE_COLLECTIONS=drafts MIGRATE_MAX_BATCHES=5 node scripts/migrate-inline-images.js
```

   Open a few of the moved posts in the app (Drafts, Calendar, a scheduled post) and check the pictures show.
4. Continue collection by collection (it resumes where it stopped; the cursor is in `backend/temp/migrate-inline-images.state.json`):

```
ALLOW_PROD_MIGRATION=yes CONFIRM_MIGRATE=yes MIGRATE_COLLECTIONS=drafts node scripts/migrate-inline-images.js
```

```
ALLOW_PROD_MIGRATION=yes CONFIRM_MIGRATE=yes MIGRATE_COLLECTIONS=campaigns node scripts/migrate-inline-images.js
```

```
ALLOW_PROD_MIGRATION=yes CONFIRM_MIGRATE=yes MIGRATE_COLLECTIONS=ai_content_performance,ai_campaign_history node scripts/migrate-inline-images.js
```

   Watch Atlas (disk, CPU, slow queries) while it runs. It pauses 1.5 s between batches; to go slower add `MIGRATE_SLEEP_MS=5000`. Stopping it (Ctrl+C) is safe: run the same command again later.
5. Run the dry run again (step 2): it should show 0 to change, except pictures that failed to upload (rerun with `MIGRATE_RESTART=yes` added to retry them from the start; it is safe to repeat).
6. After a week without complaints, remove the backups the migration kept for small pictures (dry run first, then for real):

```
ALLOW_PROD_MIGRATION=yes node scripts/migrate-inline-images.js drop-backups
```

```
ALLOW_PROD_MIGRATION=yes CONFIRM_MIGRATE=yes node scripts/migrate-inline-images.js drop-backups
```

## What the migration does to each document

- Pictures (`imageUrl`, `imageUrlNoLogo`, `creative.imageUrls`, carousel slides): uploaded to Cloudinary (folder `nebula-migrated`), the link is checked with a HEAD request (must answer 2xx with an image type) and only then replaces the base64. The same picture in two fields is uploaded once.
- Provider answers (`publishResult`, `lastPublishError`, post `errorMessage`, `sourceResponse`): rewritten in short form.
- Copies of pictures in `ai_content_performance.assets` and `ai_campaign_history.generatedImages`: base64 copies are dropped (the campaign holds the picture; the Performance view only uses links).
- Backup: `legacyInline.<field>` keeps the old value when the document stays under 256 KB with it; otherwise only its sha256 and size are kept. `legacyInline.migratedAt` marks the document.
- A document that changed while it was being migrated is skipped and picked up on the next run.

## Rollback

- Code: the emergency switch above, or revert the commits (new writes then store base64 again when Cloudinary fails).
- Data: for documents with a backup, put the old value back with one update per field (`$set` the field from `legacyInline.<field>`); for the others the Cloudinary link is the same picture (re-encoded by Cloudinary). The Atlas snapshot from step 1 is the full fallback.

## Checks on dev (assistant, throwaway data only)

- `node scripts/doc-size-report.js` (read-only size table, bounded sample).
- `node scripts/inline-images-check.js` (throwaway `zz.inline-images-` user, fake store, fake HEAD, no network; 8 checks; deletes everything at the end).
- Bounded dry run on the dev data: `MIGRATE_MAX_BATCHES=1 node scripts/migrate-inline-images.js`.
