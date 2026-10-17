'use strict';
// Caps and thresholds for social listening (scoring the customer's own comments and messages).
// Cost safety lives here: change a number, not the code. The model name is NOT here: it comes from LISTENING_MODEL.
module.exports = {
  BATCH_SIZE: 40,                    // comments sent to the model in one call
  MAX_ITEMS_PER_RUN: 400,            // most comments scored for one account in one run
  MAX_ITEMS_PER_ACCOUNT_PER_DAY: 400,
  MAX_BATCHES_PER_DAY: 300,          // model calls per UTC day across all accounts
  RUN_EVERY_DAYS: 7,
  ACCOUNTS_PER_PASS: 60,
  LEASE_MINUTES: 45,
  ITEM_WINDOW_DAYS: 35,              // only inbox items this recent are considered
  PERIOD_DAYS: 28,
  TREND_DAYS: 7,
  MIN_ITEMS: 20,                     // below this many scored items in the period, no numbers are shown
  TREND_MIN_RECENT: 8,
  TREND_MIN_BASELINE: 20,
  TREND_MIN_MOVE_PCT: 15,
  FAIL_PAUSE_AFTER: 3,
  ITEM_MAX_CHARS: 300,               // each comment is cut to this before it goes to the model
  BODY_MIN: 3,
  BODY_MAX: 1000,
  SPAM_MAX: 50,
  QUOTE_MIN: 20,
  QUOTE_MAX: 160,
  QUOTE_SPAM_MAX: 20,
  MAX_QUOTES: 3,
  RECENT_NEGATIVE_MAX: 5,
  KEEP_WEEKS: 8,
  REASONS: ['delivery', 'price', 'quality', 'service', 'product', 'praise', 'question', 'other'],
  LABELS: ['pos', 'neu', 'neg'],
  MODEL_VERSION: 'listen-1',
  // Words that keep a comment from ever being shown as a quote (matched as whole words, lower case).
  ABUSE_WORDS: [
    'fuck', 'fucking', 'fucker', 'shit', 'bitch', 'bastard', 'asshole', 'dick', 'cunt', 'slut', 'whore',
    'idiot', 'stupid', 'moron', 'scam', 'scammer', 'fraud', 'cheat', 'cheater', 'rascal', 'bloody',
    'bastards', 'crap', 'damn', 'piss', 'retard', 'loser', 'trash', 'garbage', 'useless', 'pathetic'
  ]
};
