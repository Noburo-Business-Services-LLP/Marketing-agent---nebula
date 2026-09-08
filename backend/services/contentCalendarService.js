const ContentCalendar = require('../models/ContentCalendar');
const Campaign = require('../models/Campaign');
const ContentDraft = require('../models/ContentDraft');
const { parseGeminiJSON, generateCampaignImageNanoBanana } = require('./geminiAI');
const { buildPrompt } = require('./promptRegistry');
const { callTextLLM } = require('./openAI');

const CONTENT_CALENDAR_PROMPT = `
You are a Senior Social Media Strategist, Brand Consultant, Content Marketing Expert, Consumer Psychologist, and Performance Marketing Specialist.

Your task is to create a professional {{TOTAL_DAYS}}-day content calendar for any business.

OUTPUT FORMAT:
Generate the content calendar in an Excel-ready JSON array with the following fields:
[
  {
    "day": "",
    "format": "",
    "contentPillar": "",
    "headline": "",
    "creativeConcept": "",
    "productServiceNeeded": "",
    "shootType": "",
    "cta": "",
    "objective": "",
    "status": "Planned"
  }
]

INPUT VARIABLES:
Business Name: {{BUSINESS_NAME}}
Industry: {{INDUSTRY}}
Location: {{LOCATION}}
Target Audience: {{TARGET_AUDIENCE}}
Business Goal: {{BUSINESS_GOAL}}
Language: {{LANGUAGE}}
Posting Frequency: {{POSTING_FREQUENCY}}
Posts Per Day: {{POSTS_PER_DAY}}
Reels This Month: {{MAX_REELS}}

CONTENT OBJECTIVES:
The content calendar should help achieve:
- Brand Awareness
- Lead Generation
- Customer Acquisition
- Sales Growth
- Website Traffic
- Store Visits
- WhatsApp Enquiries
- Bookings
- Appointments
- Community Building

CONTENT RULES:
1. Create exactly {{TOTAL_POSTS}} non-reel posts — {{POSTS_PER_DAY}} for each of the
   {{TOTAL_DAYS}} days — PLUS {{MAX_REELS}} reels on top of that count, not instead
   of it. Reels are additional content for their day, not a replacement for
   that day's regular post(s).
2. Mix Posters, Carousels, Reels, Campaigns properly.
2a. Use EXACTLY {{MAX_REELS}} reels across the whole month — no more, no fewer.
    Spread them out roughly evenly across the weeks, and reserve them for
    the ideas that genuinely need motion. Every non-reel entry must be a
    poster, carousel, story, or campaign.
3. Avoid repetitive content.
4. Every content must have a clear marketing objective.
5. Content must be engaging, shareable, and conversion-focused.
6. Include trending content where relevant.
7. Include local events, seasonal opportunities, and important festivals.
8. Include industry-specific buying occasions.
9. Content must be usable for both organic and paid ads.
10. LANGUAGE: Write every headline and creative concept in {{LANGUAGE}}.
    - If that names a single language, use only that language. Do not fall back to English for convenience, and do not transliterate into Latin script unless the language is normally written that way.
    - If it reads "<Language> + English Mix", blend both inside each headline the way people in that market actually speak — the natural code-switching of everyday speech, not one sentence per language and not alternating post by post. Keep brand and product names as they are.

CONTENT PILLARS:
Distribute among:
- Product/Service Promotion
- Customer Testimonials
- Behind The Scenes
- Brand Story
- Trending Content
- Offers & Promotions
- Seasonal Campaigns
- Social Proof
- Lifestyle Content
- Problem-Solution Content
- Customer Success Stories
- Industry-Specific Opportunities

SPECIAL DAYS & EVENTS:
Before generating:
- Identify upcoming local festivals
- National holidays
- Industry-specific dates
- Seasonal buying triggers
- Awareness days if relevant
- Local cultural events

IMPORTANT:
- Think like a premium marketing agency.
- Do not generate random ideas.
- Each content must have business purpose.
- Prioritize engagement, leads, sales, and growth.
- If Language = Tamil → Headlines and CTA in Tamil.
- If Language = English → Headlines and CTA in English.
- If Business Vertical = Jewellery → generate jewellery-focused content.
- If Business Vertical = Fashion → generate fashion-focused content.
- If Business Vertical = Clinic → generate healthcare-focused content.
- Adapt content completely based on business type.

Return ONLY valid JSON array.
`;

// A format counts as a reel if it implies motion.
const isReelFormat = (value = '') => /reel|video/i.test(String(value || ''));

/**
 * The account's own cadence, with safe defaults matching what everyone got
 * before this was configurable (1 post/day, ~1 reel/week). Read from
 * businessProfile.contentCadence — see models/User.js. Forward-only by
 * construction: this is read fresh each time a NEW month is generated, so
 * changing it in Settings reshapes next month's plan, never rewrites a
 * month a CSM may already be mid-review on.
 */
function getContentCadence(userProfile = {}) {
  const profile = getBusinessProfile(userProfile);
  const cadence = profile.contentCadence || {};
  const postsPerDay = Math.max(1, Math.min(5, Number(cadence.postsPerDay) || 1));
  const reelsPerWeekRaw = cadence.reelsPerWeek;
  const reelsPerWeek = Math.max(0, Math.min(7, reelsPerWeekRaw === undefined || reelsPerWeekRaw === null ? 1 : Number(reelsPerWeekRaw) || 0));
  return { postsPerDay, reelsPerWeek };
}

/**
 * Reels cost real money per item (Fal render + ElevenLabs voice + ffmpeg
 * merge), so a month is capped at a specific count regardless of what the
 * model returns — enforced in normalizeCalendarItems, which every calendar
 * passes through. Previously a flat 4/month on 4 fixed days; now driven by
 * the account's reelsPerWeek, spread evenly across the month's real weeks.
 */
function computeReelPlan(month, reelsPerWeek) {
  const totalDays = daysInMonth(month);
  const weeksInMonth = Math.ceil(totalDays / 7);
  const maxReels = Math.max(0, Math.round((Number(reelsPerWeek) || 0) * weeksInMonth));
  if (maxReels === 0) return { maxReels: 0, reelDays: [] };
  const reelDays = new Set();
  for (let i = 0; i < maxReels; i += 1) {
    const day = Math.min(totalDays, Math.max(1, Math.round((i + 0.5) * totalDays / maxReels)));
    reelDays.add(day);
  }
  // Rounding can collapse two anchors onto the same day when reelsPerWeek is
  // large relative to the month — the top-up loop in normalizeCalendarItems
  // already knows how to fill a shortfall against the real maxReels target,
  // so under-producing anchors here is recovered there, not a silent loss.
  return { maxReels, reelDays: Array.from(reelDays).sort((a, b) => a - b) };
}

// The regional languages the product supports, keyed by the value stored on
// the user. Each may be requested on its own or blended with English via the
// "<lang>_english_mix" suffix.
const SUPPORTED_LANGUAGES = {
  english: 'English',
  tamil: 'Tamil',
  telugu: 'Telugu',
  hindi: 'Hindi',
  kannada: 'Kannada',
  malayalam: 'Malayalam',
  marathi: 'Marathi',
  bengali: 'Bengali',
  gujarati: 'Gujarati',
  punjabi: 'Punjabi',
  odia: 'Odia',
  urdu: 'Urdu'
};

const LANGUAGE_ALIASES = { ta: 'tamil', te: 'telugu', hi: 'hindi', kn: 'kannada',
  ml: 'malayalam', mr: 'marathi', bn: 'bengali', gu: 'gujarati', pa: 'punjabi',
  or: 'odia', ur: 'urdu', en: 'english' };

/**
 * Turn a stored language value into the label the prompts are given.
 *
 * The previous version matched the substring "tamil", so "tamil_english_mix"
 * failed the exact-match check, fell through to the substring branch, and came
 * back as plain "Tamil" — the mix option had never once reached a prompt. It
 * also hard-coded Tamil as the only regional language, so any other selection
 * silently became English.
 */
function normalizeLanguage(value = '') {
  // Accepts both the stored form ("tamil_english_mix") and the display label
  // this function itself returns ("Tamil + English Mix"), so a value that has
  // already been normalised once survives a second pass unchanged.
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s+&-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (!raw) return 'English';

  const mix = /_english_mix$|_mix$/.test(raw);
  const base = raw.replace(/_english_mix$|_mix$/, '');
  const key = LANGUAGE_ALIASES[base] || base;
  const label = SUPPORTED_LANGUAGES[key];

  if (!label || label === 'English') return 'English';
  return mix ? `${label} + English Mix` : label;
}

/** True when the label asks for two languages blended inside each post. */
function isMixedLanguage(label = '') {
  return /\+ English Mix$/i.test(String(label || ''));
}

function getBusinessProfile(userProfile = {}) {
  return userProfile.businessProfile || userProfile;
}

function calendarMonth(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** "2026-09" -> 30. The actual day count for that specific month, not a
 * guess — used everywhere this file used to hardcode 30 regardless of which
 * month was actually being planned, which silently dropped day 31 in every
 * 31-day month and left February referencing two days that don't exist. */
function daysInMonth(monthStr) {
  const [y, m] = String(monthStr || '').split('-').map(Number);
  if (!y || !m) return 30;
  return new Date(y, m, 0).getDate();
}

/** Monday of the real calendar week containing this date, normalized to
 * midnight. Mirrors the exact logic the Schedule grid (GravityCalendar.tsx)
 * uses on the frontend, so a "week" means the same thing in both places. */
function startOfMondayWeek(d) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  const dow = c.getDay(); // 0=Sun..6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  c.setDate(c.getDate() + diff);
  return c;
}

/**
 * Groups items into REAL calendar weeks (Monday-Sunday) instead of the
 * fixed 8/8/8/6 buckets this used to use — a scheme with no relationship to
 * actual dates, which is why some "weeks" showed 8 items and others 6. Each
 * item's `day` (1-based within the month) is resolved to a real Date, and
 * items are grouped by which Monday-anchored week that date falls in. A
 * week that straddles a month boundary will legitimately have fewer than 7
 * items in this month's list (the rest belong to the adjacent month's own
 * plan) — that's correct, not a bug, the way a real calendar works.
 */
function groupIntoRealWeeks(items, monthStr) {
  const [y, m] = String(monthStr || '').split('-').map(Number);
  if (!y || !m) {
    // No usable month context — fall back to plain chunks of 7 rather than
    // the old 8/8/8/6 scheme, so this degrades gracefully instead of
    // reintroducing the bug being fixed.
    const rows = [];
    for (let i = 0; i < items.length; i += 7) rows.push(items.slice(i, i + 7));
    return rows.map((weekItems, i) => ({ weekNumber: i + 1, items: weekItems }));
  }

  const buckets = new Map(); // weekStart ISO date -> items
  for (const item of items) {
    const date = new Date(y, m - 1, item.day);
    const weekStart = startOfMondayWeek(date).toISOString();
    if (!buckets.has(weekStart)) buckets.set(weekStart, []);
    buckets.get(weekStart).push(item);
  }

  const orderedStarts = Array.from(buckets.keys()).sort();
  return orderedStarts.map((start, i) => ({ weekNumber: i + 1, items: buckets.get(start) }));
}

async function llmRouter(prompt) {
  // The monthly plan and the cover's theme-naming pass both go through
  // here — copy/planning text, so OpenAI first, Gemini as the fallback.
  return callTextLLM(prompt, { jsonMode: true, temperature: 0.75, maxTokens: 12000, skipCache: true });
}

function deriveBusinessGoal(profile = {}) {
  const niche = String(profile.niche || '').trim();
  const customerType = String(profile.customerType || '').trim();
  const customerGoalMap = {
    mostly_new: 'build awareness and convert new customers',
    mix_new_repeat: 'balance new customer acquisition with repeat purchases',
    mostly_loyal: 'increase retention, referrals, and loyalty'
  };
  return [niche, customerGoalMap[customerType] || 'grow qualified demand and sales']
    .filter(Boolean)
    .join(' - ');
}

function replacePromptVariable(prompt, key, value) {
  return prompt.replaceAll(`{{${key}}}`, String(value || ''));
}

function calendarPrompt(userProfile = {}, month = null, languageOverride = '') {
  const profile = getBusinessProfile(userProfile);
  const language = languageOverride || normalizeLanguage(profile.language || profile.contentLanguage);
  const location = profile.location || profile.businessLocation || userProfile.location || '';
  const targetAudience = profile.targetCustomerProfile || profile.targetAudience || '';
  const businessName = profile.businessName || profile.name || userProfile.businessName || userProfile.companyName || '';
  const industry = profile.businessVertical || profile.industry || '';
  const businessGoal = deriveBusinessGoal(profile);

  const totalDays = daysInMonth(month);
  const { postsPerDay, reelsPerWeek } = getContentCadence(userProfile);
  const { maxReels } = computeReelPlan(month, reelsPerWeek);
  const totalPosts = totalDays * postsPerDay;

  return [
    ['BUSINESS_NAME', businessName],
    ['INDUSTRY', industry],
    ['LOCATION', location],
    ['TARGET_AUDIENCE', targetAudience],
    ['BUSINESS_GOAL', businessGoal],
    ['LANGUAGE', language],
    ['POSTING_FREQUENCY', `${totalDays} Days`],
    ['TOTAL_DAYS', totalDays],
    ['POSTS_PER_DAY', postsPerDay],
    ['TOTAL_POSTS', totalPosts],
    ['MAX_REELS', maxReels]
  ].reduce((prompt, [key, value]) => replacePromptVariable(prompt, key, value), CONTENT_CALENDAR_PROMPT);
}

function tamilFallbackHeadline(day, businessName, heroProduct) {
  const product = heroProduct || businessName || 'எங்கள் சேவை';
  const templates = [
    `${product} உங்கள் நாளை எளிதாக்கும் விதம்`,
    `${businessName || 'எங்கள் பிராண்ட்'} தேர்வு செய்ய 3 காரணங்கள்`,
    `இன்றைய சிறப்பு: ${product}`,
    `வாடிக்கையாளர்கள் விரும்பும் நன்மை`,
    `உங்களுக்கு ஏற்ற தீர்வு இங்கே`
  ];
  return templates[(day - 1) % templates.length];
}

function fallbackCalendar(userProfile = {}, month = null) {
  const profile = getBusinessProfile(userProfile);
  const businessName = profile.businessName || profile.name || userProfile.companyName || 'Your Business';
  const heroProduct = profile.heroProduct || profile.niche || 'your offer';
  const language = normalizeLanguage(profile.language || profile.contentLanguage);
  const otherFormats = ['post', 'carousel', 'story', 'campaign'];
  const pillars = ['education', 'product', 'social proof', 'behind the scenes', 'offer'];
  const objectives = ['awareness', 'engagement', 'leads', 'sales', 'community'];
  const totalDays = daysInMonth(month);
  const { postsPerDay, reelsPerWeek } = getContentCadence(userProfile);
  const { reelDays } = computeReelPlan(month, reelsPerWeek);

  // Reels are additional to the day's regular post(s), not a replacement —
  // see CONTENT_CALENDAR_PROMPT's rule 1. postsPerDay non-reel items per
  // day, plus one reel item per entry in reelDays.
  const totalPosts = totalDays * postsPerDay;
  let otherIndex = 0;
  const nonReelItems = Array.from({ length: totalPosts }, (_, index) => {
    const day = Math.floor(index / postsPerDay) + 1;
    const format = otherFormats[otherIndex++ % otherFormats.length];
    // Only Tamil fallback copy exists, so it covers Tamil (pure or mixed) and
    // English stands in for the rest — better than emitting Tamil headlines
    // to a Telugu or Hindi account.
    const headline = /^Tamil/.test(language)
      ? tamilFallbackHeadline(day, businessName, heroProduct)
      : `${businessName}: ${heroProduct} idea for day ${day}`;
    return {
      day,
      format,
      contentPillar: pillars[index % pillars.length],
      headline,
      creativeConcept: `Show ${heroProduct} through a ${pillars[index % pillars.length]} angle for the target customer.`,
      productNeeded: heroProduct,
      shootType: 'photo',
      cta: index % 3 === 0 ? 'Book now' : index % 3 === 1 ? 'Message us' : 'Learn more',
      objective: objectives[index % objectives.length],
      status: 'draft'
    };
  });

  const reelItems = reelDays.map((day, index) => {
    const headline = /^Tamil/.test(language)
      ? tamilFallbackHeadline(day, businessName, heroProduct)
      : `${businessName}: ${heroProduct} reel for day ${day}`;
    return {
      day,
      format: 'reel',
      contentPillar: pillars[index % pillars.length],
      headline,
      creativeConcept: `Show ${heroProduct} through a short, motion-led reel for the target customer.`,
      productNeeded: heroProduct,
      shootType: 'video',
      cta: 'Learn more',
      objective: objectives[index % objectives.length],
      status: 'draft'
    };
  });

  return {
    weeks: groupIntoRealWeeks([...nonReelItems, ...reelItems], month)
  };
}

function normalizeCalendarItems(rawCalendar, userProfile = {}, month = null) {
  const totalDays = daysInMonth(month);
  const { postsPerDay, reelsPerWeek } = getContentCadence(userProfile);
  const { maxReels, reelDays } = computeReelPlan(month, reelsPerWeek);
  const totalPosts = totalDays * postsPerDay;

  const fallback = fallbackCalendar(userProfile, month);
  const fallbackFlat = fallback.weeks.flatMap((week) => week.items);
  const fallbackNonReel = fallbackFlat.filter((it) => !isReelFormat(it.format));
  const fallbackReel = fallbackFlat.filter((it) => isReelFormat(it.format));

  const rawWeeks = Array.isArray(rawCalendar?.weeks) ? rawCalendar.weeks : fallback.weeks;
  const flat = Array.isArray(rawCalendar)
    ? rawCalendar
    : rawWeeks.flatMap((week) => Array.isArray(week?.items) ? week.items : []);

  const normalizeOne = (raw, fb, day) => ({
    day,
    format: String(raw?.format || fb?.format || 'post').trim().toLowerCase(),
    contentPillar: String(raw?.contentPillar || raw?.pillar || fb?.contentPillar || '').trim(),
    headline: String(raw?.headline || fb?.headline || '').trim(),
    creativeConcept: String(raw?.creativeConcept || raw?.concept || fb?.creativeConcept || '').trim(),
    productNeeded: String(raw?.productNeeded || raw?.productServiceNeeded || fb?.productNeeded || '').trim(),
    shootType: String(raw?.shootType || fb?.shootType || 'photo').trim(),
    cta: String(raw?.cta || fb?.cta || 'Learn more').trim(),
    objective: String(raw?.objective || fb?.objective || 'awareness').trim().toLowerCase(),
    status: ['approved', 'rejected'].includes(String(raw?.status || '').toLowerCase()) ? String(raw.status).toLowerCase() : 'draft'
  });

  // The model was told reels are ADDITIONAL to the day's post(s), not
  // slotted at a fixed position — so they can land anywhere in its array.
  // Split by what each entry actually is rather than assuming position,
  // the way the old code could when reels and posts shared one index space.
  const rawReel = flat.filter((it) => isReelFormat(it?.format));
  const rawNonReel = flat.filter((it) => !isReelFormat(it?.format));

  // Non-reel posts: exactly totalPosts of them, postsPerDay per day. Day is
  // assigned by position, not whatever the model wrote in `day` — the same
  // defensive stance the old code took by indexing instead of trusting raw
  // day numbers, now doing double duty to guarantee the right posts-per-day
  // distribution regardless of model drift.
  const nonReelItems = Array.from({ length: totalPosts }, (_, index) => {
    const day = Math.floor(index / postsPerDay) + 1;
    const fb = fallbackNonReel.length ? fallbackNonReel[index % fallbackNonReel.length] : null;
    return normalizeOne(rawNonReel[index], fb, day);
  });

  // Reels: hard cap at maxReels, same reasoning as before (real money per
  // item) — just driven by the account's cadence instead of a flat 4.
  let reelItems = rawReel.map((raw, i) => {
    const day = reelDays.length ? reelDays[i % reelDays.length] : 1;
    const fb = fallbackReel.length ? fallbackReel[i % fallbackReel.length] : null;
    return normalizeOne(raw, fb, day);
  });

  if (reelItems.length > maxReels) {
    // Over-delivered (or maxReels is 0 and the model made some anyway).
    // Keep whichever sit closest to the preferred days rather than the
    // first N, so spacing stays sane; discard the rest entirely — a reel
    // that doesn't make the cut does not get demoted to a post, since the
    // model already used its "this is worth motion" judgment on it and a
    // demoted concept described for video rarely works as a still image.
    const pool = reelItems.map((_, i) => i);
    const keep = new Set();
    for (const day of reelDays) {
      if (!pool.length || keep.size >= maxReels) break;
      let best = 0;
      for (let k = 1; k < pool.length; k += 1) {
        if (Math.abs(reelItems[pool[k]].day - day) < Math.abs(reelItems[pool[best]].day - day)) best = k;
      }
      keep.add(pool[best]);
      pool.splice(best, 1);
    }
    reelItems = reelItems.filter((_, i) => keep.has(i));
  } else if (reelItems.length < maxReels) {
    // Under-delivered (including a model that returned zero). Top up on
    // whichever preferred days aren't already spoken for.
    const usedDays = new Set(reelItems.map((r) => r.day));
    for (const day of reelDays) {
      if (reelItems.length >= maxReels) break;
      if (usedDays.has(day)) continue;
      const fb = fallbackReel.length ? fallbackReel[reelItems.length % fallbackReel.length] : null;
      reelItems.push(normalizeOne(null, fb, day));
      usedDays.add(day);
    }
  }
  reelItems.forEach((item) => { item.format = 'reel'; item.shootType = 'video'; });

  return groupIntoRealWeeks([...nonReelItems, ...reelItems], month);
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-06" -> "June 2026". Falls back to the raw value if it is not that shape. */
function monthLabel(month = '') {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || '').trim());
  if (!m) return String(month || '');
  const idx = parseInt(m[2], 10) - 1;
  return MONTH_NAMES[idx] ? `${MONTH_NAMES[idx]} ${m[1]}` : String(month);
}

/**
 * Name the month's theme and render a cover image for it.
 *
 * Runs after the calendar is saved and is never awaited by the caller: a
 * calendar with no cover is fine, a calendar the user waited an extra minute
 * for is not. Failure is recorded on the document rather than thrown.
 */
async function generateCalendarCover(calendar, userProfile = {}) {
  if (!calendar?._id) return null;

  try {
    await ContentCalendar.updateOne({ _id: calendar._id }, { $set: { coverStatus: 'pending' } });

    const items = (calendar.weeks || []).flatMap((w) => w.items || []);
    if (items.length === 0) {
      await ContentCalendar.updateOne({ _id: calendar._id }, { $set: { coverStatus: 'none' } });
      return null;
    }

    // The theme is read off what is actually planned, so it describes the
    // month rather than being invented alongside it.
    const pillarCounts = new Map();
    items.forEach((i) => {
      const p = String(i.contentPillar || '').trim();
      if (p) pillarCounts.set(p, (pillarCounts.get(p) || 0) + 1);
    });
    const pillars = Array.from(pillarCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => `${name} (${n})`)
      .join(', ') || 'none recorded';

    const headlines = items
      .map((i) => String(i.headline || '').trim())
      .filter(Boolean)
      .slice(0, 12)
      .map((h) => `- ${h}`)
      .join('\n') || '- none recorded';

    const profile = getBusinessProfile(userProfile);
    const brandDisplayName =
      calendar.businessName || profile.businessName || profile.name || 'The brand';
    const industry = calendar.businessVertical || profile.industry || 'General';

    const planPrompt = await buildPrompt(calendar.userId, 'calendar.cover', {
      brandDisplayName,
      industry,
      monthLabel: monthLabel(calendar.month),
      pillars,
      headlines,
      brandContextBlock: ''
    });

    const raw = await llmRouter(planPrompt);
    const parsed = parseGeminiJSON(raw) || {};

    const themeTitle = String(parsed.themeTitle || '').trim().slice(0, 60);
    const themeSummary = String(parsed.themeSummary || '').trim().slice(0, 200);
    const coverImagePrompt = String(parsed.coverImagePrompt || '').trim();

    if (!coverImagePrompt) {
      await ContentCalendar.updateOne({ _id: calendar._id }, { $set: { coverStatus: 'failed' } });
      return null;
    }

    // 16:9 — the cover is shown as a wide banner, and generating it square
    // would mean cropping away the composition that was just briefed.
    const result = await generateCampaignImageNanoBanana(coverImagePrompt, {
      userId: calendar.userId,
      aspectRatio: '16:9',
      brandName: brandDisplayName,
      industry,
      tone: 'editorial',
      campaignTheme: themeTitle || monthLabel(calendar.month)
    });

    // An inline data URI would be roughly a megabyte inside a document that
    // is read on every calendar view. Only a hosted URL is worth keeping.
    const url = String(result?.imageUrl || '');
    const coverImageUrl = url.startsWith('http') ? url : '';

    await ContentCalendar.updateOne({ _id: calendar._id }, {
      $set: {
        themeTitle,
        themeSummary,
        coverImagePrompt,
        coverImageUrl,
        coverStatus: coverImageUrl ? 'ready' : 'failed'
      }
    });

    return coverImageUrl;
  } catch (error) {
    console.error('[ContentCalendar] cover generation failed:', error.message);
    try {
      await ContentCalendar.updateOne({ _id: calendar._id }, { $set: { coverStatus: 'failed' } });
    } catch (_) { /* the original failure is the one that matters */ }
    return null;
  }
}

async function generateMonthlyCalendar(userProfile = {}, targetMonth = null, { language: languageOverride = '' } = {}) {
  const profile = getBusinessProfile(userProfile);
  const userId = userProfile._id || userProfile.userId || profile.userId;
  if (!userId) throw new Error('userId is required to generate a content calendar');

  // A per-plan language beats the account default, so one month can be
  // planned in Telugu without changing the setting for everything else.
  const language = normalizeLanguage(
    languageOverride || profile.language || profile.contentLanguage
  );

  // Resolved before the AI call, not after, so both the prompt (day count,
  // posts/reels targets) and the fallback path agree on which month —
  // and which cadence — they are planning for.
  const month = targetMonth || calendarMonth();

  let aiCalendar = null;
  try {
    const response = await llmRouter(calendarPrompt(userProfile, month, language));
    aiCalendar = parseGeminiJSON(response);
  } catch (error) {
    console.warn('[ContentCalendar] AI generation failed, using fallback:', error.message);
    aiCalendar = fallbackCalendar(userProfile, month);
  }

  const calendarData = {
    userId,
    businessName: profile.businessName || profile.name || userProfile.companyName || '',
    niche: profile.niche || '',
    businessVertical: profile.businessVertical || profile.industry || '',
    businessType: profile.businessVertical || profile.industry || '',
    language,
    month,
    weeks: normalizeCalendarItems(aiCalendar, userProfile, month),
    generatedAt: new Date()
  };

  const calendar = await ContentCalendar.findOneAndUpdate(
    { userId, month },
    { $setOnInsert: { autoGenerate: false, approved: false }, $set: calendarData },
    { upsert: true, new: true }
  );

  // Deliberately not awaited. The plan is what the user is waiting for; the
  // cover arrives a little later and the UI polls for it.
  generateCalendarCover(calendar, userProfile).catch(() => { /* recorded on the document */ });

  return calendar;
}

function findItem(calendar, itemId) {
  for (const week of calendar.weeks || []) {
    const item = (week.items || []).find((entry) => String(entry._id) === String(itemId));
    if (item) return item;
  }
  return null;
}

function todaySuggestion(calendar, date = new Date()) {
  const day = Math.min(30, Math.max(1, date.getDate()));
  const items = (calendar?.weeks || []).flatMap((week) => week.items || []);
  return items.find((item) => Number(item.day) === day) || items[0] || null;
}

function campaignObjective(value = '') {
  const normalized = String(value || '').toLowerCase();
  if (['awareness', 'engagement', 'traffic', 'sales', 'leads'].includes(normalized)) return normalized;
  return 'awareness';
}

function campaignFormat(value = '') {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('reel') || normalized.includes('video')) return 'reel';
  if (normalized.includes('carousel')) return 'carousel';
  if (normalized.includes('story')) return 'story';
  return 'image';
}

async function createDraftsForItem(calendar, item, { publish = false } = {}) {
  if (!calendar || !item || item.generatedCampaignId) return null;

  const now = new Date();
  const scheduledFor = new Date(now);
  scheduledFor.setDate(now.getDate() + Math.max(0, Number(item.day || 1) - now.getDate()));
  scheduledFor.setHours(10, 0, 0, 0);

  const draft = await ContentDraft.create({
    userId: calendar.userId,
    title: item.headline || `${calendar.businessName} content idea`,
    platform: 'instagram',
    contentType: campaignFormat(item.format) === 'reel' ? 'reel' : 'post',
    topic: item.creativeConcept || item.headline || 'Smart calendar content',
    objective: campaignObjective(item.objective),
    tone: 'professional',
    cta: item.cta || '',
    finalContent: [item.headline, item.creativeConcept, item.cta].filter(Boolean).join('\n\n'),
    status: publish ? 'scheduled' : 'draft',
    scheduledFor: publish ? scheduledFor : null
  });

  const campaign = await Campaign.create({
    userId: calendar.userId,
    name: item.headline || `${calendar.businessName} content`,
    objective: campaignObjective(item.objective),
    platforms: ['instagram'],
    status: publish ? 'scheduled' : 'draft',
    aiGenerated: true,
    creative: {
      type: campaignFormat(item.format),
      textContent: [item.headline, item.creativeConcept].filter(Boolean).join('\n\n'),
      captions: item.headline || '',
      hashtags: [],
      callToAction: '',
      imageUrls: []
    },
    scheduling: {
      startDate: publish ? scheduledFor : null,
      postTime: '10:00',
      timezone: 'Asia/Kolkata',
      frequency: 'once'
    },
    scheduledFor: publish ? scheduledFor : null,
    notes: `Generated from Gravity Smart Calendar day ${item.day}. ${item.cta || ''}`.trim()
  });

  item.generatedDraftId = draft._id;
  item.generatedCampaignId = campaign._id;
  item.scheduledFor = publish ? scheduledFor : null;
  item.status = publish ? 'scheduled' : 'generated';
  await calendar.save();

  return { draft, campaign };
}

async function processAutoGeneration({ now = new Date(), limit = 20 } = {}) {
  const calendars = await ContentCalendar.find({
    autoGenerate: true,
    approved: true
  }).limit(limit);

  for (const calendar of calendars) {
    // Stop once the month's allowance is spent. Without this it worked
    // through every planned day, and the only way to stop it was to notice
    // and switch it off.
    const cap = Number(calendar.autoGenerateLimit) || 7;
    if (Number(calendar.autoGeneratedCount || 0) >= cap) continue;

    const item = todaySuggestion(calendar, now);
    if (!item || ['rejected', 'published', 'scheduled'].includes(String(item.status || '').toLowerCase())) continue;

    // Uses the same generator as "generate this week", which writes a caption
    // and renders an image, then leaves the Draft in Approve for review.
    //
    // The old path built a text-only ContentDraft plus a Campaign marked
    // scheduled, which the campaign scheduler then published to the connected
    // accounts with no image and no review — while the toggle described itself
    // as "drafting a post each day". Requiring lazily keeps the queue module,
    // which pulls in image generation, out of this module's load path.
    const { generateSingleCalendarItem } = require('./backgroundQueue');
    const weekNumber = (calendar.weeks || []).find((w) =>
      (w.items || []).some((i) => String(i._id) === String(item._id)))?.weekNumber || 1;

    try {
      await generateSingleCalendarItem(calendar, item, weekNumber);
      calendar.autoGeneratedCount = Number(calendar.autoGeneratedCount || 0) + 1;
    } catch (error) {
      console.error('[ContentCalendar] auto-generation failed for item:', error.message);
    }

    calendar.lastAutoRunAt = new Date();
    await calendar.save();
  }
}

function startContentCalendarScheduler({ intervalMs = 60_000, logger = console } = {}) {
  if (String(process.env.ENABLE_CONTENT_CALENDAR_SCHEDULER || 'true').toLowerCase() === 'false') {
    logger.log('[ContentCalendar] Scheduler disabled');
    return () => {};
  }

  logger.log(`[ContentCalendar] Scheduler started (interval ${intervalMs}ms)`);
  const timer = setInterval(() => {
    processAutoGeneration().catch((error) => logger.error('[ContentCalendar] Scheduler error:', error));
  }, intervalMs);
  processAutoGeneration().catch((error) => logger.error('[ContentCalendar] Scheduler error:', error));
  return () => clearInterval(timer);
}

module.exports = {
  generateMonthlyCalendar,
  generateCalendarCover,
  monthLabel,
  normalizeLanguage,
  processAutoGeneration,
  startContentCalendarScheduler,
  createDraftsForItem,
  todaySuggestion,
  findItem,
  calendarMonth,
  normalizeCalendarItems,
  getContentCadence,
  computeReelPlan,
  CONTENT_CALENDAR_PROMPT
};
