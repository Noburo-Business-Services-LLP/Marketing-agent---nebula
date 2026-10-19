'use strict';
// Caps and limits for the Home drafts ("Make a post in response" and "Draft a witty comment" on a competitor's post).
// Cost and safety live here: change a number, not the code. Prices are NOT here: they come from config/apiCosts.js
// (home_response_post, home_witty_comment). How it works: docs/superpowers/ops/home-drafts.md
// The longest one request can run without refreshing its lease: every database read that can wait (up to two for the
// post, two for the brand) and every model call (a writing call and a check call for each attempt).
const DB_TIMEOUT_MS = 20000;
const CALL_TIMEOUT_MS = 60000;
const MAX_ATTEMPTS = 2;
const WORST_CASE_MS = 4 * DB_TIMEOUT_MS + MAX_ATTEMPTS * 2 * CALL_TIMEOUT_MS;

module.exports = Object.freeze({
  // Switch: the whole feature is off unless ENABLE_COMPETITOR_DRAFTS=on (the same default-off rule as the tracker).
  SWITCH_ENV: 'ENABLE_COMPETITOR_DRAFTS',

  // Per account (a client workspace counts as its own account), per India day.
  MAX_DRAFTS_PER_DAY: 20,        // requests that reached the writing model (whether the draft was shown or not)
  MAX_BLOCKED_PER_DAY: 10,       // requests that ended with "We could not write a draft we are happy with"
  MAX_PER_MINUTE: 3,             // requests of any outcome in the last 60 seconds
  // Across all accounts, per India day: requests that reached the writing model. A brake on top of the spend ceiling.
  MAX_DRAFTS_ALL_ACCOUNTS_PER_DAY: 3000,

  // One first draft and at most one more if the first one fails a check. Never more.
  MAX_ATTEMPTS,
  // A request whose lease (leaseAt, refreshed at every step) is older than this was lost (a restart): it is closed and
  // its Quarks returned. Longer than the whole worst case, so a live request is never closed by another process.
  DB_TIMEOUT_MS,
  WORST_CASE_MS,
  STALE_MS: WORST_CASE_MS + 3 * 60 * 1000,
  // The writing call and the check call each have this long.
  CALL_TIMEOUT_MS,
  WRITE_MAX_TOKENS: 700,
  CHECK_MAX_TOKENS: 200,

  // Length caps (characters as people count them, so Tamil and Hindi letters are never split).
  COMMENT_MAX: 220,
  COMMENT_MIN: 8,
  CAPTION_MAX: 600,
  CAPTION_MIN: 40,
  IMAGE_IDEA_MAX: 200,
  IMAGE_IDEA_MIN: 10,
  // Hashtags: none in a comment, at most this many in a post. Emoji: at most this many.
  POST_MAX_HASHTAGS: 3,
  COMMENT_MAX_EMOJI: 2,
  POST_MAX_EMOJI: 4,

  TONES: ['friendly', 'witty'],
  // The customer's content language. Other languages in the app's list are written in English for now, because the
  // local word list does not cover them (the second check still runs on every draft).
  LANGUAGES: ['english', 'tamil', 'hindi', 'telugu', 'kannada', 'malayalam'],
  KINDS: ['response_post', 'witty_comment'],
  // The idempotency key the page sends with each press of the button.
  KEY_RE: /^[A-Za-z0-9_-]{8,64}$/,
  // Rows are kept this long (for the caps, the staff counts and a replayed answer), then removed.
  KEEP_DAYS: 30
});
