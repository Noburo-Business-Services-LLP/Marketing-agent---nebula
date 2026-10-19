'use strict';
// Brand Growth Blueprint constants. Pure config: no database, no network.
const TAGS = ['verified', 'inference', 'proposed', 'unverified'];
const TAG_LABEL = { verified: '[Verified]', inference: '[Inference]', proposed: '[Proposed]', unverified: '[Unverified]' };
const GOALS = ['enquiries', 'sales', 'followers', 'launch'];
const FORMATS = ['image post', 'carousel', 'reel', 'story'];
const CHANNELS = ['Instagram', 'Facebook', 'LinkedIn', 'WhatsApp', 'YouTube', 'Google Business Profile', 'Website'];
const MODES = ['auto', 'guided'];
const STATUS = ['queued', 'processing', 'awaiting_approval', 'completed', 'stopped', 'failed'];

// The nine pages after the cover, in order (approved spec). `n` is the page number shown.
const PAGES = [
  { n: 1, id: 'where-today', title: 'Where you are today', purpose: 'What can be confirmed about your business today.' },
  { n: 2, id: 'audience-positioning', title: 'Audience and positioning', purpose: 'Who you speak to and the territory you can own.' },
  { n: 3, id: 'competitor-read', title: 'Competitor read', purpose: 'What the competitors you named say about themselves.' },
  { n: 4, id: 'content-pillars', title: 'Content pillars', purpose: 'The themes your content returns to.' },
  { n: 5, id: 'calendar-preview', title: 'Your first 30 days', purpose: 'A month of posts, one tile for each day.' },
  { n: 6, id: 'offers-hooks', title: 'Offers and hooks', purpose: 'How your own offers become reasons to act.' },
  { n: 7, id: 'channel-plan', title: 'Channel plan', purpose: 'Where to be present and what each channel is for.' },
  { n: 8, id: 'roadmap-90', title: 'The next 90 days', purpose: 'Three phases, each with actions and what to measure.' },
  { n: 9, id: 'first-steps', title: 'What to do first', purpose: 'The first steps to take this week.' }
];
const PHASES = [
  { id: 'foundation', label: 'Days 1 to 30', title: 'Foundation' },
  { id: 'storytelling', label: 'Days 31 to 60', title: 'Storytelling and engagement' },
  { id: 'growth', label: 'Days 61 to 90', title: 'Growth' }
];

const LIMITS = {
  FREE_PER_IP_PER_DAY: 3, PAID_PER_IP_PER_DAY: 10, PAID_PER_ACCOUNT_PER_DAY: 5,
  MAX_PAGES_FETCHED: 5, MAX_COMPETITORS: 3, MAX_OFFERS: 3, MAX_COLOURS: 3,
  PAGE_BYTES: 400 * 1024, FETCH_TIMEOUT_MS: 8000, TOTAL_BUDGET_MS: 40000,
  STALE_MS: 8 * 60 * 1000, MIN_EVIDENCE: 3, FULL_EVIDENCE: 8, MAX_DROPPED: 6,
  MIN_CALENDAR_DAYS: 20, MAX_CONCURRENT_RUNS: 2, LOGO_DATA_BYTES: 2 * 1024 * 1024
};

// Nebulaa's own details for the closing page, confirmed by the owner 2026-10-04.
const NEBULAA = {
  email: 'support@nebulaa.ai',
  website: 'https://www.nebulaa.ai',
  phone: '+91 9384801049',
  instagram: 'https://www.instagram.com/nebulaa.os/',
  facebook: 'https://www.facebook.com/profile.php?id=61588215321901',
}; // render only what is present, never invent others

const STOP_MESSAGES = {
  unreachable: 'We could not read your website or Instagram page, so there was not enough to build a reliable Blueprint. Check the address, or add one of your real offers, then try again.',
  thin: 'We could not find enough about your business to build a reliable Blueprint. Add your website address, your Instagram page or one of your real offers, then try again.'
};
// Owner ruling 2026-10-04: a name mismatch is a visible warning carried in the result, never a stop.
const WARNING_MESSAGES = {
  identity_mismatch: 'The website you entered does not appear to mention this business name. Check that the name and the address belong together.'
};
const LIMITED_NOTE = 'Based on limited information';

// The only things Nebulaa may be said to do for a customer in a plan. The planner drops anything else.
const PLAN_NEBULAA_CAN = ['posts', 'carousels', 'videos', 'captions and hashtags', 'scheduling and publishing', 'inbox replies', 'competitor tracking'];
const PLAN_RUNS_PER_DAY_MAX = 100; // global safety cap on plan runs the system creates in 24 hours
const PLAN_REFRESH_DAYS = 7; // one manual plan refresh per account in this many days

// Offline activity in a plan: a FIXED list. The owner does all of it; Nebulaa does nothing offline, so a row never
// carries "Nebulaa does". `spend` is a fixed reading of the activity (stall fees and printing cost money; the rest
// mostly cost time), never a model output. Chosen for small Indian businesses; see docs/superpowers/ops/plan-additions.md.
const OFFLINE_CHANNELS = [
  { id: 'referrals', name: 'Referrals and word of mouth', spend: 'organic' },
  { id: 'local_events', name: 'Local events and stalls', spend: 'paid' },
  { id: 'print', name: 'Printed material and hoardings', spend: 'paid' },
  { id: 'counter', name: 'In-store and at-counter prompts', spend: 'organic' },
  { id: 'partnerships', name: 'Partnerships with nearby businesses', spend: 'organic' },
  { id: 'personal_followup', name: 'Phone and personal WhatsApp follow-up', spend: 'organic' }
];

// Numbers to watch: a FIXED list. `count` says who has the number: 'nebulaa' (shown on the named page) or 'you'
// (the owner counts it by hand). `needs` ties a metric to a channel or an offline activity the plan chose.
const PLAN_METRICS = [
  { id: 'reach', name: 'Reach', meaning: 'How many people saw your posts.', where: 'Performance', count: 'nebulaa' },
  { id: 'engagement', name: 'Engagement', meaning: 'Likes, comments, saves and shares on your posts.', where: 'Performance', count: 'nebulaa' },
  { id: 'followers', name: 'New followers', meaning: 'How many people started following your page.', where: 'Performance', count: 'nebulaa' },
  { id: 'posts_published', name: 'Posts published', meaning: 'How many posts went out on your pages.', where: 'Performance', count: 'nebulaa' },
  { id: 'messages', name: 'Messages and comments', meaning: 'Messages and comments people send you on your pages.', where: 'Inbox (add-on)', count: 'nebulaa' },
  { id: 'enquiries', name: 'Enquiries', meaning: 'Calls, walk-ins and messages asking about what you sell.', where: 'You count this', count: 'you' },
  { id: 'reviews', name: 'New reviews', meaning: 'New reviews on your Google Business Profile.', where: 'You count this', count: 'you', needs: { channel: 'Google Business Profile' } },
  { id: 'website_visits', name: 'Website visits', meaning: 'Visits to your website, from its own statistics.', where: 'You count this', count: 'you', needs: { channel: 'Website' } },
  { id: 'referral_customers', name: 'Customers from referrals', meaning: 'New customers who came because someone sent them.', where: 'You count this', count: 'you', needs: { offline: 'referrals' } },
  { id: 'event_contacts', name: 'Contacts from events', meaning: 'Names and numbers you collect at events and stalls.', where: 'You count this', count: 'you', needs: { offline: 'local_events' } }
];
const PLAN_LIMITS = { MAX_OFFLINE: 3, MIN_METRICS: 3, MAX_METRICS: 5, MAX_PRODUCTS: 6, PRODUCT_NAME: 80, PRODUCT_TEXT: 160, PRODUCT_PRICE: 24, ROW_TEXT: 200, MAX_YOU_DO: 2 };
// The planner's visible answer budget. Fixture plans with every block measure about 4,600 output tokens; this leaves
// about twice that before a cut. A reasoning model gets three times this for thinking plus answer (openAI.js).
const PLAN_MAX_TOKENS = 9000;

module.exports = { PLAN_RUNS_PER_DAY_MAX, PLAN_NEBULAA_CAN, PLAN_REFRESH_DAYS, OFFLINE_CHANNELS, PLAN_METRICS, PLAN_LIMITS, PLAN_MAX_TOKENS, TAGS, TAG_LABEL, GOALS, FORMATS, CHANNELS, MODES, STATUS, PAGES, PHASES, LIMITS, NEBULAA, STOP_MESSAGES, WARNING_MESSAGES, LIMITED_NOTE };
