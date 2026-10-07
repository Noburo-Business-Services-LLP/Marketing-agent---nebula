/**
 * Google Business Profile reviews: read them through Ayrshare and draft replies with AI.
 *
 * Sending a reply is NOT done here: the Ayrshare documentation checked on 2026-10-06 lists
 * how to read reviews (GET /api/reviews?platform=gmb, Premium plan and up) but no endpoint
 * to answer one. Until that is confirmed, the owner copies the draft into Google.
 */

const AYRSHARE_REVIEWS_URL = 'https://api.ayrshare.com/api/reviews';

// Which platform names mean Google Business Profile in our code and in Ayrshare.
function toAyrsharePlatform(name) {
  const value = String(name || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (['gmb', 'google', 'googlebusiness', 'googlebusinessprofile'].includes(value)) return 'gmb';
  if (value === 'x') return 'twitter';
  return String(name || '').trim().toLowerCase();
}

const STAR_WORDS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

function ratingOf(raw) {
  const value = raw && (raw.rating ?? raw.starRating);
  if (typeof value === 'number') return Math.max(0, Math.min(5, Math.round(value)));
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) return Math.max(0, Math.min(5, Math.round(asNumber)));
  return STAR_WORDS[String(value || '').toUpperCase()] || 0;
}

/** Turns Ayrshare's review objects into one flat shape the Inbox can show. */
function normalizeReviews(payload) {
  const list = Array.isArray(payload) ? payload : (payload && (payload.reviews || payload.data)) || [];
  return (Array.isArray(list) ? list : []).map((raw) => {
    const reviewer = raw.reviewer || {};
    const reviewerName = typeof reviewer === 'string' ? reviewer : (reviewer.displayName || reviewer.name || 'A customer');
    const reply = raw.reviewReply || raw.reply || null;
    return {
      id: String(raw.id || raw.reviewId || raw.name || ''),
      rating: ratingOf(raw),
      text: String(raw.review || raw.comment || raw.text || '').trim(),
      reviewer: reviewerName,
      createdAt: raw.created || raw.createTime || null,
      replied: Boolean(reply && (reply.comment || reply.text || reply === true)),
      existingReply: reply && (reply.comment || reply.text) ? String(reply.comment || reply.text) : ''
    };
  }).filter((review) => review.id);
}

/** Low ratings are public and sensitive: they are never replied to automatically. */
function needsHumanApproval(review) {
  return review.rating > 0 && review.rating <= 3;
}

function buildReplyPrompt({ review, business = {} }) {
  const name = business.name || 'the business';
  const tone = business.tone || 'warm, polite and professional';
  const languages = business.language ? ` Write the reply in ${business.language}.` : ' Reply in the language the customer used.';
  return [
    `You write public replies to Google reviews for ${name}. Tone: ${tone}.${languages}`,
    'Rules:',
    '- Two to four sentences. Plain, human wording. No emojis unless the review has them.',
    '- Thank the customer by first name if one is given. Refer to something specific from the review.',
    '- Never invent facts, offers, discounts, refunds, opening hours or promises the business has not stated.',
    '- For a complaint: apologise sincerely, do not argue or blame, and invite them to contact the business directly. Do not put a phone number or email in the reply unless it is given below.',
    '- Never mention that you are an AI.',
    business.contact ? `Contact the business offers: ${business.contact}` : '',
    '',
    `Reviewer: ${review.reviewer}`,
    `Rating: ${review.rating} out of 5`,
    `Review: ${review.text || '(no text, rating only)'}`,
    '',
    'Return only the reply text.'
  ].filter((line) => line !== '').join('\n');
}

async function fetchReviews({ profileKey, apiKey = process.env.AYRSHARE_API_KEY, fetchImpl = fetch }) {
  if (!apiKey || String(process.env.AYRSHARE_KILL_SWITCH || '').toLowerCase() === 'true') return { success: false, reason: 'not_configured', reviews: [] };
  const headers = { Authorization: `Bearer ${apiKey}` };
  if (profileKey && profileKey !== 'primary') headers['Profile-Key'] = profileKey;
  const response = await fetchImpl(`${AYRSHARE_REVIEWS_URL}?platform=gmb`, { headers });
  let data = null;
  try { data = await response.json(); } catch (_) { data = null; }
  if (!response.ok || (data && data.status === 'error')) {
    return { success: false, reason: 'provider_error', status: response.status, providerError: data, reviews: [] };
  }
  return { success: true, reviews: normalizeReviews(data), summary: data && { averageRating: data.averageRating, totalReviewCount: data.totalReviewCount } };
}

async function draftReply({ review, business, llm }) {
  const generate = llm || require('./openAI').callTextLLM;
  const text = await generate(buildReplyPrompt({ review, business }), { temperature: 0.6, maxTokens: 300, skipCache: true });
  return String(text || '').replace(/^["'\s]+|["'\s]+$/g, '').trim();
}

module.exports = { toAyrsharePlatform, normalizeReviews, needsHumanApproval, buildReplyPrompt, fetchReviews, draftReply };
