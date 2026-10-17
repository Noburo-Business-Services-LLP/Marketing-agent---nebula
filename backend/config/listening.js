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
  // Words that keep a comment from ever being shown as a quote (whole words, case-insensitive; the filter also catches
  // common obfuscation such as f*ck, b!tch and spaced-out letters). This list is a MINIMUM safety net and is deliberately
  // conservative: a harmless comment that is skipped costs nothing, a harmful quote on a customer's card costs a lot.
  // It cannot cover every slur or every Indian-language transliteration, so the final review should confirm it.
  // The real protection is structural: a quote is shown only when a positive or negative item passes ALL filters
  // (public comment, length, no contact details, numbers, links, handles or addresses, low spam score, no word below),
  // and when nothing passes, no quote is shown at all.
  ABUSE_WORDS: [
    // English: profanity
    'fuck', 'fucking', 'fucker', 'fucked', 'motherfucker', 'mofo', 'shit', 'shitty', 'bullshit', 'bitch', 'bastard', 'bastards',
    'asshole', 'ass', 'arse', 'dick', 'cunt', 'slut', 'whore', 'piss', 'crap', 'damn', 'hell', 'wtf', 'stfu', 'bloody',
    // English: insults and accusations (kept out of quotes on purpose)
    'idiot', 'stupid', 'moron', 'dumb', 'jerk', 'scumbag', 'loser', 'trash', 'garbage', 'useless', 'pathetic', 'rascal',
    'scam', 'scammer', 'fraud', 'cheat', 'cheater', 'thief', 'thieves', 'liar', 'liars', 'sucks',
    // English: slurs, violence and adult content
    'retard', 'retarded', 'nigger', 'nigga', 'faggot', 'fag', 'dyke', 'tranny', 'paki', 'chink', 'spic', 'kike',
    'kill', 'killed', 'die', 'rape', 'rapist', 'suicide', 'terrorist', 'sex', 'porn', 'nude', 'nudes',
    // Hindi, Marathi, Bengali and others (Latin spelling, common variants)
    'chutiya', 'chutiye', 'chut', 'madarchod', 'maderchod', 'behenchod', 'bhenchod', 'bhosdi', 'bhosdike', 'bhosadike', 'gandu', 'gaandu',
    'harami', 'haramkhor', 'haramzada', 'kamina', 'kamine', 'kutta', 'kutti', 'saala', 'saale', 'randi', 'lund', 'lauda', 'loda', 'bhadwa', 'bhadwe',
    'chakka', 'zavadya', 'khanki',
    // Tamil, Telugu, Malayalam, Kannada (Latin spelling, common variants)
    'otha', 'ootha', 'thevidiya', 'thevdiya', 'punda', 'pundai', 'koothi', 'kuthi', 'mayiru', 'mairu', 'poolu', 'naaye', 'pottai', 'oombu',
    'lanja', 'lanjakodaka', 'dengey', 'thendi', 'bevarsi',
    // Native script (matched anywhere in the text)
    'चूतिया', 'मादरचोद', 'बहनचोद', 'भोसड़ी', 'गांडू', 'हरामी', 'कमीना', 'रंडी', 'कुत्ता', 'கூதி', 'புண்டை', 'ஒத்தா', 'தேவடியா', 'பொட்டை', 'ஓழ்'
  ]
};
