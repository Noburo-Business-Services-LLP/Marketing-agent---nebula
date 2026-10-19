'use strict';
// Caps and limits for the Photoshoot studio. Cost and safety live here: change a number, not the code. Prices are NOT
// here: they come from config/apiCosts.js (photoshoot_image). How it works: docs/superpowers/ops/photoshoot.md
module.exports = Object.freeze({
  // Switch: the whole feature is off unless ENABLE_PHOTOSHOOT=on (off until the owner's one real proof run).
  SWITCH_ENV: 'ENABLE_PHOTOSHOOT',

  // Per account (a client workspace counts as its own account), per India day: photos charged (a redo counts as one).
  MAX_PHOTOS_PER_DAY: 60,
  // Photoshoots started (any outcome) in the last 60 seconds.
  MAX_STARTS_PER_MINUTE: 3,
  // Photoshoots running at once across all accounts. A brake on top of the daily spend ceiling.
  MAX_RUNNING_ALL_ACCOUNTS: 30,

  // One job: at most this many products, and this many photos in all.
  MAX_PRODUCTS: 3,
  MAX_PHOTOS_PER_JOB: 24,
  // Calls per photo: the first one, and one more if it fails. Never more, even after a restart.
  MAX_CALLS_PER_PHOTO: 2,
  // Photos made at the same time inside one job.
  CONCURRENCY: 2,
  // Rough time per photo, for the "about N minutes" line (measured on the real proof run).
  PHOTO_SECONDS: 60,

  // The runner holds a lease on its job; another process may take the job over only after it ran out.
  LEASE_MS: 10 * 60 * 1000,
  // How often lost jobs are looked for (and once when the server starts).
  RESUME_EVERY_MS: 2 * 60 * 1000,
  // A job still not finished this long after it was charged is closed: unfinished photos fail and are refunded.
  MAX_AGE_MS: 60 * 60 * 1000,

  // Uploads ("Add a product" on the Photoshoot page).
  UPLOAD_MAX_BYTES: 6 * 1024 * 1024,
  UPLOADS_PER_HOUR: 20,
  NAME_MAX: 100,
  // How much of the product name reaches a prompt.
  PROMPT_NAME_MAX: 60,

  // The idempotency key the page sends with each press of Create or Make this one again.
  KEY_RE: /^[A-Za-z0-9_-]{8,64}$/
});
