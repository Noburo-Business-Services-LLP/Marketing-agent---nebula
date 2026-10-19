'use strict';
// Words the competitor and trend sentences (GET /api/competitors/best-posts) may never contain. Shown to customers, so:
// the customer wording rule (no exclamation marks or long dashes, no "credit", "trial" or "7 days", no vendor names)
// and nothing unkind about a competitor. Kept here so a word can be added without touching the code.
module.exports = Object.freeze([
  /!/, /[—–]/, /\bcredits?\b/i, /\btrials?\b/i, /\b7 days\b/i, /\bseven days\b/i,
  /\b(apify|ayrshare|openai|gemini|gpt|anthropic|claude|scrap\w*)\b/i,
  /\b(worse|worst|bad|beat|beats|beating|crush\w*|fail\w*|weak\w*|poor\w*|mock\w*|destroy\w*|flop\w*|loser\w*|losing|savage|roast\w*|shame\w*|terrible|awful|useless)\b/i
]);
