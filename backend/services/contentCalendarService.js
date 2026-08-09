const ContentCalendar = require('../models/ContentCalendar');
const Campaign = require('../models/Campaign');
const ContentDraft = require('../models/ContentDraft');
const { parseGeminiJSON } = require('./geminiAI');
const { generateWithLLM } = require('./llmRouter');

const CONTENT_CALENDAR_PROMPT = `
You are a Senior Social Media Strategist, Brand Consultant, Content Marketing Expert, Consumer Psychologist, and Performance Marketing Specialist.

Your task is to create a professional 30-day content calendar for any business.

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
1. Create exactly 30 days of content.
2. Mix Posters, Carousels, Reels, Campaigns properly.
2a. Use EXACTLY 4 reels across the whole month — no more, no fewer.
    Spread them out, roughly one per week, and reserve them for the
    ideas that genuinely need motion. Every other day must be a
    poster, carousel, story, or campaign.
3. Avoid repetitive content.
4. Every content must have a clear marketing objective.
5. Content must be engaging, shareable, and conversion-focused.
6. Include trending content where relevant.
7. Include local events, seasonal opportunities, and important festivals.
8. Include industry-specific buying occasions.
9. Content must be usable for both organic and paid ads.
10. Headlines must strictly follow the selected language.

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

// Reels cost real money per item (Fal render + ElevenLabs voice + ffmpeg
// merge), so a month is capped at this many regardless of what the model
// returns. Enforced in normalizeCalendarItems, which every calendar passes
// through — AI-generated and fallback alike.
const MAX_REELS_PER_MONTH = 4;
// Preferred reel days when we get to choose: one per week.
const REEL_DAYS = [4, 11, 18, 25];
// A format counts as a reel if it implies motion.
const isReelFormat = (value = '') => /reel|video/i.test(String(value || ''));

function normalizeLanguage(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (['tamil', 'ta'].includes(normalized)) return 'Tamil';
  if (['english', 'en'].includes(normalized)) return 'English';
  if (normalized.includes('tamil')) return 'Tamil';
  return 'English';
}

function getBusinessProfile(userProfile = {}) {
  return userProfile.businessProfile || userProfile;
}

function calendarMonth(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

async function llmRouter(prompt) {
  return generateWithLLM({
    provider: 'gemini',
    taskType: 'content_calendar',
    prompt,
    temperature: 0.75,
    maxTokens: 12000
  });
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

function calendarPrompt(userProfile = {}) {
  const profile = getBusinessProfile(userProfile);
  const language = normalizeLanguage(profile.language || profile.contentLanguage);
  const location = profile.location || profile.businessLocation || userProfile.location || '';
  const targetAudience = profile.targetCustomerProfile || profile.targetAudience || '';
  const businessName = profile.businessName || profile.name || userProfile.businessName || userProfile.companyName || '';
  const industry = profile.businessVertical || profile.industry || '';
  const businessGoal = deriveBusinessGoal(profile);

  return [
    ['BUSINESS_NAME', businessName],
    ['INDUSTRY', industry],
    ['LOCATION', location],
    ['TARGET_AUDIENCE', targetAudience],
    ['BUSINESS_GOAL', businessGoal],
    ['LANGUAGE', language],
    ['POSTING_FREQUENCY', '30 Days']
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

function fallbackCalendar(userProfile = {}) {
  const profile = getBusinessProfile(userProfile);
  const businessName = profile.businessName || profile.name || userProfile.companyName || 'Your Business';
  const heroProduct = profile.heroProduct || profile.niche || 'your offer';
  const language = normalizeLanguage(profile.language || profile.contentLanguage);
  // Reels are the expensive format (Fal + ElevenLabs + ffmpeg per item), so
  // the month gets exactly MAX_REELS_PER_MONTH of them — one per week.
  // Every other day cycles through the cheap formats.
  const otherFormats = ['post', 'carousel', 'story', 'campaign'];
  const pillars = ['education', 'product', 'social proof', 'behind the scenes', 'offer'];
  const objectives = ['awareness', 'engagement', 'leads', 'sales', 'community'];
  let otherIndex = 0;
  const items = Array.from({ length: 30 }, (_, index) => {
    const day = index + 1;
    const isReel = REEL_DAYS.includes(day);
    const format = isReel ? 'reel' : otherFormats[otherIndex++ % otherFormats.length];
    const headline = language === 'Tamil'
      ? tamilFallbackHeadline(day, businessName, heroProduct)
      : `${businessName}: ${heroProduct} idea for day ${day}`;
    return {
      day,
      format,
      contentPillar: pillars[index % pillars.length],
      headline,
      creativeConcept: `Show ${heroProduct} through a ${pillars[index % pillars.length]} angle for the target customer.`,
      productNeeded: heroProduct,
      shootType: isReel ? 'video' : 'photo',
      cta: index % 3 === 0 ? 'Book now' : index % 3 === 1 ? 'Message us' : 'Learn more',
      objective: objectives[index % objectives.length],
      status: 'draft'
    };
  });

  return {
    weeks: [1, 2, 3, 4].map((weekNumber) => ({
      weekNumber,
      items: items.slice((weekNumber - 1) * 8, weekNumber === 4 ? 30 : weekNumber * 8)
    }))
  };
}

function normalizeCalendarItems(rawCalendar, userProfile = {}) {
  const fallback = fallbackCalendar(userProfile);
  const rawWeeks = Array.isArray(rawCalendar?.weeks) ? rawCalendar.weeks : fallback.weeks;
  const flat = Array.isArray(rawCalendar)
    ? rawCalendar
    : rawWeeks.flatMap((week) => Array.isArray(week?.items) ? week.items : []);
  const fallbackFlat = fallback.weeks.flatMap((week) => week.items);
  const items = Array.from({ length: 30 }, (_, index) => {
    const raw = flat[index] || fallbackFlat[index];
    return {
      day: index + 1,
      format: String(raw?.format || fallbackFlat[index].format || 'post').trim().toLowerCase(),
      contentPillar: String(raw?.contentPillar || raw?.pillar || fallbackFlat[index].contentPillar || '').trim(),
      headline: String(raw?.headline || fallbackFlat[index].headline || '').trim(),
      creativeConcept: String(raw?.creativeConcept || raw?.concept || fallbackFlat[index].creativeConcept || '').trim(),
      productNeeded: String(raw?.productNeeded || raw?.productServiceNeeded || fallbackFlat[index].productNeeded || '').trim(),
      shootType: String(raw?.shootType || fallbackFlat[index].shootType || 'photo').trim(),
      cta: String(raw?.cta || fallbackFlat[index].cta || 'Learn more').trim(),
      objective: String(raw?.objective || fallbackFlat[index].objective || 'awareness').trim().toLowerCase(),
      status: ['approved', 'rejected'].includes(String(raw?.status || '').toLowerCase()) ? String(raw.status).toLowerCase() : 'draft'
    };
  });

  // Hard cap on reels. The prompt asks for 4, but models drift and the reel
  // path is the expensive one — so enforce it here rather than trust output.
  const reelIndexes = items.reduce((acc, item, i) => (isReelFormat(item.format) ? [...acc, i] : acc), []);
  const keep = new Set();

  if (reelIndexes.length > MAX_REELS_PER_MONTH) {
    // Over-delivered. Rather than keeping the first N (which bunches them
    // at the top of the month), keep whichever the model chose that sit
    // closest to the preferred weekly slots, so spacing stays sane.
    const pool = [...reelIndexes];
    for (const day of REEL_DAYS) {
      if (!pool.length || keep.size >= MAX_REELS_PER_MONTH) break;
      let best = 0;
      for (let k = 1; k < pool.length; k += 1) {
        if (Math.abs(pool[k] + 1 - day) < Math.abs(pool[best] + 1 - day)) best = k;
      }
      keep.add(pool[best]);
      pool.splice(best, 1);
    }
  } else {
    reelIndexes.forEach((i) => keep.add(i));
  }

  for (const i of reelIndexes) {
    if (keep.has(i)) {
      items[i].format = 'reel';
      items[i].shootType = 'video';
    } else {
      items[i].format = 'carousel';
      items[i].shootType = 'photo';
    }
  }

  // Under-delivery is possible too (a model that returns zero reels). Top up
  // on the preferred days, skipping any that are already reels.
  for (const day of REEL_DAYS) {
    if (keep.size >= MAX_REELS_PER_MONTH) break;
    const index = day - 1;
    const item = items[index];
    if (!item || keep.has(index)) continue;
    item.format = 'reel';
    item.shootType = 'video';
    keep.add(index);
  }

  return [1, 2, 3, 4].map((weekNumber) => ({
    weekNumber,
    items: items.slice((weekNumber - 1) * 8, weekNumber === 4 ? 30 : weekNumber * 8)
  }));
}

async function generateMonthlyCalendar(userProfile = {}, targetMonth = null) {
  const profile = getBusinessProfile(userProfile);
  const userId = userProfile._id || userProfile.userId || profile.userId;
  if (!userId) throw new Error('userId is required to generate a content calendar');

  let aiCalendar = null;
  try {
    const response = await llmRouter(calendarPrompt(userProfile));
    aiCalendar = parseGeminiJSON(response);
  } catch (error) {
    console.warn('[ContentCalendar] AI generation failed, using fallback:', error.message);
    aiCalendar = fallbackCalendar(userProfile);
  }

  const language = normalizeLanguage(profile.language || profile.contentLanguage);
  const month = targetMonth || calendarMonth();
  const calendarData = {
    userId,
    businessName: profile.businessName || profile.name || userProfile.companyName || '',
    niche: profile.niche || '',
    businessVertical: profile.businessVertical || profile.industry || '',
    businessType: profile.businessVertical || profile.industry || '',
    language,
    month,
    weeks: normalizeCalendarItems(aiCalendar, userProfile),
    generatedAt: new Date()
  };

  return ContentCalendar.findOneAndUpdate(
    { userId, month },
    { $setOnInsert: { autoGenerate: false, approved: false }, $set: calendarData },
    { upsert: true, new: true }
  );
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
    const item = todaySuggestion(calendar, now);
    if (!item || ['rejected', 'published', 'scheduled'].includes(String(item.status || '').toLowerCase())) continue;
    await createDraftsForItem(calendar, item, { publish: true });
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
  processAutoGeneration,
  startContentCalendarScheduler,
  createDraftsForItem,
  todaySuggestion,
  findItem,
  calendarMonth,
  normalizeCalendarItems,
  MAX_REELS_PER_MONTH,
  CONTENT_CALENDAR_PROMPT
};
