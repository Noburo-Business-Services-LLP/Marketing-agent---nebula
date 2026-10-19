'use strict';
/**
 * "From the news calendar": a small, versioned list of public events a business can post about (Trending for you on Home
 * and the Competitors page). It is the honest foundation until the owner chooses a live trend source
 * (docs/superpowers/ops/trends-sources.md); a future source plugs in through services/trends/provider.js.
 *
 * Rules for an entry (tests/trendingEvents.test.js checks every one):
 *   - ONLY dates that are certain: a day fixed by law, custom or an official body, a date computed by a fixed rule, or a
 *     one-time event whose dates the organiser has officially announced. Never a guess, never a rumoured release date.
 *   - `kind`: sports | film | festival | national_day | public_event | shopping.
 *   - Recurring days: `every: { month, day }` (the same date each year) or `rule` (computed, see RULES).
 *     One-time events: `start` and `end` as 'YYYY-MM-DD' (India dates; end inclusive).
 *   - `industries`: tags from INDUSTRY_TAGS ('all' fits every business). Shown only to an account whose industry matches.
 *   - `idea`: one plain sentence, how a business can use it. No exclamation marks or long dashes, no vendor names,
 *     nothing about competitors, nothing that sounds like the event endorses the business (no official logos or marks).
 * Days already listed in config/festivals.js (New Year, Republic Day, Valentine's Day, Independence Day, Teachers' Day,
 * Children's Day, Christmas, Mother's Day, Father's Day) are NOT repeated here: they appear as "Coming up".
 *
 * Version: bump VERSION and add a line to the change list when entries change.
 *   2026-10-19  first list (fixed international and national days, two computed shopping days, two announced events).
 */
const VERSION = '2026-10-19';

/** The tags an entry can carry. industryTags() maps the account's industry text onto these. */
const INDUSTRY_TAGS = Object.freeze([
  'all', 'food', 'retail', 'fashion', 'beauty', 'fitness', 'health', 'education', 'finance', 'realestate', 'travel',
  'media', 'services', 'tech', 'auto', 'jewellery', 'home', 'nonprofit', 'events', 'agriculture'
]);

const EVENTS = Object.freeze([
  // ---- national and international days with a fixed date ----
  { id: 'gandhi_jayanti', name: 'Gandhi Jayanti', kind: 'national_day', every: { month: 10, day: 2 }, industries: ['all'], idea: 'Share a simple, respectful post about a value your business lives by, such as honesty or serving your neighbourhood.' },
  { id: 'world_food_day', name: 'World Food Day', kind: 'national_day', every: { month: 10, day: 16 }, industries: ['food', 'agriculture', 'nonprofit'], idea: 'Show where your ingredients come from or how you keep food from going to waste.' },
  { id: 'halloween', name: 'Halloween', kind: 'festival', every: { month: 10, day: 31 }, industries: ['food', 'retail', 'fashion', 'beauty', 'events', 'media'], idea: 'Dress up a product or your counter for the day and post a playful photo or short reel.' },
  { id: 'national_unity_day', name: 'National Unity Day', kind: 'national_day', every: { month: 10, day: 31 }, industries: ['all'], idea: 'Post about the people from different places who make your business work, with their permission.' },
  { id: 'world_diabetes_day', name: 'World Diabetes Day', kind: 'national_day', every: { month: 11, day: 14 }, industries: ['health', 'fitness', 'food'], idea: 'Share one simple, accurate habit for healthier days, or your low-sugar options if you have them.' },
  { id: 'constitution_day', name: 'Constitution Day', kind: 'national_day', every: { month: 11, day: 26 }, industries: ['education', 'services', 'nonprofit'], idea: 'Share a short, plain fact about the Constitution of India and what it means for your customers.' },
  { id: 'world_aids_day', name: 'World AIDS Day', kind: 'national_day', every: { month: 12, day: 1 }, industries: ['health', 'nonprofit'], idea: 'Share a respectful awareness message and where people can get tested or find support.' },
  { id: 'navy_day', name: 'Indian Navy Day', kind: 'national_day', every: { month: 12, day: 4 }, industries: ['all'], idea: 'A short thank-you post for those who serve, kept simple and respectful.' },
  { id: 'human_rights_day', name: 'Human Rights Day', kind: 'national_day', every: { month: 12, day: 10 }, industries: ['nonprofit', 'education', 'services'], idea: 'Share how your business treats every customer and worker fairly, with one real example.' },
  { id: 'mathematics_day', name: 'National Mathematics Day', kind: 'national_day', every: { month: 12, day: 22 }, industries: ['education', 'tech', 'finance'], idea: 'Post a small number puzzle or a fun fact tied to your work and ask people to answer in the comments.' },
  { id: 'kisan_diwas', name: 'Kisan Diwas (National Farmers Day)', kind: 'national_day', every: { month: 12, day: 23 }, industries: ['agriculture', 'food'], idea: 'Thank the farmers you buy from, with a photo of the produce and where it comes from.' },
  { id: 'consumer_day', name: 'National Consumer Day', kind: 'national_day', every: { month: 12, day: 24 }, industries: ['retail', 'finance', 'services', 'tech'], idea: 'Explain your return, refund or warranty promise in plain words.' },
  { id: 'new_years_eve', name: "New Year's Eve", kind: 'festival', every: { month: 12, day: 31 }, industries: ['all'], idea: 'Look back at your year in a carousel: favourite moments, products or customers, with permission.' },
  { id: 'national_youth_day', name: 'National Youth Day', kind: 'national_day', every: { month: 1, day: 12 }, industries: ['education', 'fitness', 'tech', 'media'], idea: 'Feature a young customer, student or team member and what they are working towards, with permission.' },
  { id: 'girl_child_day', name: 'National Girl Child Day', kind: 'national_day', every: { month: 1, day: 24 }, industries: ['education', 'nonprofit', 'health'], idea: 'Share a respectful message about education and opportunity for girls.' },
  { id: 'voters_day', name: "National Voters' Day", kind: 'national_day', every: { month: 1, day: 25 }, industries: ['all'], idea: 'A neutral reminder to check your name on the voter list. Keep it non-political.' },
  { id: 'world_cancer_day', name: 'World Cancer Day', kind: 'national_day', every: { month: 2, day: 4 }, industries: ['health', 'fitness', 'nonprofit'], idea: 'Share a respectful awareness post that points to screening and support.' },
  { id: 'national_science_day', name: 'National Science Day', kind: 'national_day', every: { month: 2, day: 28 }, industries: ['education', 'tech', 'health'], idea: 'Explain the science behind one thing you make or do, in one simple picture.' },
  { id: 'womens_day', name: "International Women's Day", kind: 'national_day', every: { month: 3, day: 8 }, industries: ['all'], idea: 'Feature the women on your team or among your customers, with their permission and in their own words.' },
  { id: 'consumer_rights_day', name: 'World Consumer Rights Day', kind: 'national_day', every: { month: 3, day: 15 }, industries: ['retail', 'finance', 'services', 'tech'], idea: 'Answer the three questions customers ask you most, plainly.' },
  { id: 'world_water_day', name: 'World Water Day', kind: 'national_day', every: { month: 3, day: 22 }, industries: ['food', 'home', 'agriculture', 'nonprofit', 'travel'], idea: 'Share one way your business saves water and invite customers to share theirs.' },
  { id: 'world_health_day', name: 'World Health Day', kind: 'national_day', every: { month: 4, day: 7 }, industries: ['health', 'fitness', 'food', 'beauty'], idea: 'Share one easy, accurate health tip that connects to what you offer.' },
  { id: 'earth_day', name: 'Earth Day', kind: 'national_day', every: { month: 4, day: 22 }, industries: ['all'], idea: 'Show one real step your business takes to waste less, such as packaging or energy.' },
  { id: 'world_book_day', name: 'World Book Day', kind: 'national_day', every: { month: 4, day: 23 }, industries: ['education', 'media', 'retail'], idea: 'Share the book your team recommends and why, and ask customers for theirs.' },
  { id: 'labour_day', name: 'Labour Day', kind: 'national_day', every: { month: 5, day: 1 }, industries: ['all'], idea: 'Thank the people behind your business with a behind-the-scenes photo, with their permission.' },
  { id: 'world_environment_day', name: 'World Environment Day', kind: 'national_day', every: { month: 6, day: 5 }, industries: ['all'], idea: 'Share a before and after of something you reused, repaired or recycled.' },
  { id: 'yoga_day', name: 'International Day of Yoga', kind: 'national_day', every: { month: 6, day: 21 }, industries: ['fitness', 'health', 'beauty', 'fashion'], idea: 'Post a simple stretch or calm moment that fits your product or space.' },
  { id: 'world_music_day', name: 'World Music Day', kind: 'national_day', every: { month: 6, day: 21 }, industries: ['media', 'food', 'events', 'retail'], idea: 'Share the playlist your shop or team loves, or a short reel set to music you have the right to use.' },
  { id: 'doctors_day', name: "National Doctors' Day", kind: 'national_day', every: { month: 7, day: 1 }, industries: ['health'], idea: 'Thank doctors with a simple post, or introduce your own doctors, with their permission.' },
  { id: 'photography_day', name: 'World Photography Day', kind: 'national_day', every: { month: 8, day: 19 }, industries: ['all'], idea: 'Ask customers to share their best photo of your product and repost the ones you have permission for.' },
  { id: 'national_sports_day', name: 'National Sports Day', kind: 'national_day', every: { month: 8, day: 29 }, industries: ['fitness', 'education', 'retail', 'health'], idea: 'Share how your team stays active, or a sports-themed offer if it fits your business.' },
  { id: 'engineers_day', name: "Engineers' Day", kind: 'national_day', every: { month: 9, day: 15 }, industries: ['tech', 'auto', 'realestate', 'home', 'services'], idea: 'Show the engineering behind one product or project, in one clear picture.' },
  { id: 'world_tourism_day', name: 'World Tourism Day', kind: 'national_day', every: { month: 9, day: 27 }, industries: ['travel', 'food', 'events'], idea: 'Share a local place visitors should not miss and how to find you nearby.' },
  { id: 'world_heart_day', name: 'World Heart Day', kind: 'national_day', every: { month: 9, day: 29 }, industries: ['health', 'fitness', 'food'], idea: 'Share one heart-friendly habit or option you offer, kept accurate and simple.' },

  // ---- shopping days computed by a fixed rule ----
  { id: 'black_friday', name: 'Black Friday', kind: 'shopping', rule: 'black_friday', industries: ['retail', 'fashion', 'beauty', 'tech', 'jewellery', 'home'], idea: 'If you run an offer, say clearly what it is, how long it lasts and how to order.' },
  { id: 'cyber_monday', name: 'Cyber Monday', kind: 'shopping', rule: 'cyber_monday', industries: ['retail', 'tech', 'fashion', 'beauty'], idea: 'A short post for online shoppers: what you deliver, how fast, and how to order.' },

  // ---- one-time events with officially announced dates ----
  { id: 'fifa_womens_world_cup_2027', name: "FIFA Women's World Cup 2027", kind: 'sports', start: '2027-06-24', end: '2027-07-25', industries: ['food', 'fitness', 'media', 'retail', 'events'], idea: 'Post match-day content around your product, such as a viewing snack or team colours, without using official logos.' },
  { id: 'la_olympics_2028', name: 'Olympic Games Los Angeles 2028', kind: 'sports', start: '2028-07-14', end: '2028-07-30', industries: ['all'], idea: 'Cheer for the athletes from your country with a respectful post, without using the Olympic rings or official marks.' }
]);

/**
 * Left out until the owner adds a date that is certain (never shown): films and streaming releases, cricket and other
 * tournaments whose schedule is not announced, budget day and other dates that are customary but not fixed.
 */
const NEEDS_A_DATE = Object.freeze([
  { name: 'IPL 2027', why: 'The schedule is not announced.' },
  { name: "ICC Men's Cricket World Cup 2027", why: 'The match dates are not confirmed in this list.' },
  { name: 'Union Budget day', why: 'Usually 1 February, but it is not fixed by law.' },
  { name: 'Big film and streaming releases', why: 'Release dates move; add one only after the official announcement, with the source.' },
  { name: 'Lunar-calendar festivals (Diwali, Holi, Eid, Pongal, Onam and others)', why: 'They belong in config/festivals.js with the owner-approved date for each year.' }
]);

const RULES = Object.freeze({
  // Black Friday is the day after the fourth Thursday of November; Cyber Monday the Monday after it.
  black_friday: (year) => { const first = new Date(Date.UTC(year, 10, 1)).getUTCDay(); const thursday = 1 + ((4 - first + 7) % 7) + 21; return { month: 11, day: thursday + 1 }; },
  cyber_monday: (year) => { const first = new Date(Date.UTC(year, 10, 1)).getUTCDay(); const thursday = 1 + ((4 - first + 7) % 7) + 21; const d = new Date(Date.UTC(year, 10, thursday + 4)); return { month: d.getUTCMonth() + 1, day: d.getUTCDate() }; }
});

// Industry choices (frontend/utils/businessProfileForm.ts) and free text, matched by keywords onto the tags above.
const INDUSTRY_WORDS = [
  ['food', /food|beverage|restaurant|cafe|café|bar|bakery|sweet|grocery|supermarket|catering|cloud kitchen/i],
  ['retail', /retail|e-commerce|ecommerce|shop|store|grocery|supermarket|electronics|mobile|wholesale|distribution/i],
  ['fashion', /fashion|apparel|clothing|boutique|saree|textile/i],
  ['beauty', /beauty|salon|spa|cosmetic|skin|makeup/i],
  ['fitness', /gym|fitness|yoga|sport/i],
  ['health', /health|clinic|hospital|dental|doctor|pharma|wellness|diagnostic/i],
  ['education', /education|school|coaching|tuition|college|training|academy/i],
  ['finance', /finance|fintech|bank|insurance|accounting|tax|loan/i],
  ['realestate', /real estate|property|construction|builder|interior/i],
  ['travel', /travel|hospitality|hotel|tour|resort|homestay/i],
  ['media', /media|entertainment|film|music|studio|news|creator/i],
  ['services', /professional services|legal|consult|agency|marketing|services|logistics|transport/i],
  ['tech', /technology|saas|software|it services|tech|app/i],
  ['auto', /automotive|auto|car|bike|garage|vehicle/i],
  ['jewellery', /jewel/i],
  ['home', /home|furniture|decor|interior|kitchenware/i],
  ['nonprofit', /non-profit|nonprofit|ngo|charity|trust|foundation/i],
  ['events', /event|wedding|party|decorat/i],
  ['agriculture', /agri|farm|dairy|organic/i]
];

/** The tags for an account's industry text ('all' always included). An unknown industry only sees 'all' entries. */
function industryTags(industry) {
  const text = String(industry || '').trim();
  const tags = new Set(['all']);
  for (const [tag, re] of INDUSTRY_WORDS) if (text && re.test(text)) tags.add(tag);
  return tags;
}

const DAY = 864e5;
const pad = (n) => String(n).padStart(2, '0');
const istToday = (now) => new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/** Every dated occurrence of an entry in a year: { start, end }. */
function occurrences(e, year) {
  if (e.every) return [{ start: `${year}-${pad(e.every.month)}-${pad(e.every.day)}`, end: `${year}-${pad(e.every.month)}-${pad(e.every.day)}` }];
  if (e.rule && RULES[e.rule]) { const d = RULES[e.rule](year); const x = `${year}-${pad(d.month)}-${pad(d.day)}`; return [{ start: x, end: x }]; }
  if (e.start && e.end && Number(e.start.slice(0, 4)) === year) return [{ start: e.start, end: e.end }];
  return [];
}

/**
 * Entries for this account between today (India date) and `withinDays` ahead, plus events running today, soonest first:
 * { id, name, kind, idea, start, end, daysAway (0 while running), running }.
 */
function upcomingEvents({ now = new Date(), withinDays = 30, industry = '' } = {}) {
  const today = istToday(now);
  const year = Number(today.slice(0, 4));
  const tags = industryTags(industry);
  const out = [];
  for (const e of EVENTS) {
    if (!e.industries.some((t) => tags.has(t))) continue;
    for (const y of [year - 1, year, year + 1]) {
      for (const o of occurrences(e, y)) {
        const toStart = daysBetween(today, o.start);
        const toEnd = daysBetween(today, o.end);
        if (toEnd < 0 || toStart > withinDays) continue;
        out.push({ id: e.id, name: e.name, kind: e.kind, idea: e.idea, start: o.start, end: o.end, daysAway: Math.max(0, toStart), running: toStart <= 0 && toEnd >= 0 && o.start !== o.end });
      }
    }
  }
  return out.sort((a, b) => a.daysAway - b.daysAway || (a.start < b.start ? -1 : 1) || (a.id < b.id ? -1 : 1));
}

module.exports = { VERSION, EVENTS, NEEDS_A_DATE, INDUSTRY_TAGS, RULES, industryTags, upcomingEvents, occurrences };
