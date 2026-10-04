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
  thin: 'We could not find enough about your business to build a reliable Blueprint. Add your website address, your Instagram page or one of your real offers, then try again.',
  identity_mismatch: 'The website you entered does not appear to belong to this business name. Check the name and the address, then try again.'
};
const LIMITED_NOTE = 'Based on limited information';

module.exports = { TAGS, TAG_LABEL, GOALS, FORMATS, CHANNELS, MODES, STATUS, PAGES, PHASES, LIMITS, NEBULAA, STOP_MESSAGES, LIMITED_NOTE };
