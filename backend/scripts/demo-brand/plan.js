'use strict';
/**
 * "My plan" and the Brand Growth Blueprint of the demo brand, stored in the REAL shape and run through the app's own
 * assembler (services/blueprint/assemble.js), so every screen reads them exactly like a plan the planner made.
 * No model call: the plan below is the planner's answer written by hand (claims tagged proposed / inference, facts cited by id).
 *   - the plan is a Blueprint row of kind 'plan' (what GET /api/plan reads, newest completed one),
 *   - the Blueprint is a Blueprint row of kind 'blueprint' (the free summary, made soon after sign-up) with its designed
 *     edition (page pictures drawn locally; no PDF file, so the "download" link stays empty).
 * Both are tagged by blueprintId `demo-zaya-...` (safety.js MARKERS).
 */
const { assembleBlueprint } = require('../../services/blueprint/assemble');
const { buildDeck } = require('../../services/blueprint/designedDeck');
const { OFFLINE_CHANNELS, PLAN_METRICS } = require('../../config/blueprint');
const { BRAND, PALETTE, PRODUCTS, COMPETITORS } = require('./constants');
const { DEMO_EMAIL, DEMO_TAG } = require('./safety');

const DAY = 24 * 60 * 60 * 1000;
const PLAN_ID = `${DEMO_TAG}-plan-1`;
const BLUEPRINT_ID = `${DEMO_TAG}-blueprint-1`;

const prop = (text) => ({ text, tag: 'proposed' });
const inf = (text, ...factIds) => ({ text, tag: 'inference', factIds });

// ---- the facts the planner may cite (a business sheet, as services/blueprint/discovery.js would make it)
function factSheet() {
  const typed = (id, field, text) => ({ id, kind: 'typed', field, text });
  const facts = [
    typed('F1', 'Business', `${BRAND.name} makes ayurveda-inspired skincare and haircare in Chennai.`),
    typed('F2', 'City', 'Based in Chennai, Tamil Nadu.'),
    typed('F3', 'Sells to', 'Sells to individual customers across India.'),
    typed('F4', 'Goal', 'The main goal is more direct sales from its own website.'),
    typed('F5', 'Price level', 'Premium prices for small-batch products.'),
    typed('F6', 'What makes it different', BRAND.keyDifferentiator),
    typed('F7', 'Content language', 'Posts in English with light Tamil touches.'),
    typed('F8', 'Product', `Product: ${PRODUCTS[0].name}, Rs ${PRODUCTS[0].price.toLocaleString('en-IN')}`),
    typed('F9', 'Offer', 'Offer: Diwali Glow Gift Box, Rs 1,999'),
    typed('F10', 'Offer', 'Offer: Ritual Duo, Rs 1,699'),
    typed('F11', 'Offer', 'Offer: First order, 10 percent off'),
    { id: 'F12', kind: 'competitor_page', subject: COMPETITORS[0].name, text: 'Kaya Veda presents itself with a focus on festival gift sets.' },
    { id: 'F13', kind: 'competitor_page', subject: COMPETITORS[1].name, text: 'Pure Petal Co presents itself with a focus on rose and floral products.' }
  ];
  return { facts, unverified: [], basis: 'full', warnings: [], assets: { logo: null, colours: [PALETTE.plum, PALETTE.roseGold, PALETTE.cream].map((hex) => ({ hex, source: 'typed' })) } };
}

const PILLARS = [
  { name: 'Ritual and ingredients', why: inf('It shows what is inside each product and why the old recipes still work.', 'F1', 'F6'), example: prop('Show the saffron and manjistha going into the serum, with a short caption on how to use it at night.') },
  { name: 'Skin education', why: inf('Customers read labels, so plain answers about skin build trust before they buy.', 'F3', 'F6'), example: prop('A carousel that explains how to layer toner, serum and cream in the right order.') },
  { name: 'Founder story', why: inf('A small studio with a real founder is the thing a big brand cannot copy.', 'F1', 'F2'), example: prop('The founder tells how her grandmother made kumkumadi oil in a brass pot.') },
  { name: 'Customer glow stories', why: inf('People trust people like them, and repeat customers are the best proof.', 'F3'), example: prop('Share a customer message about her Sunday ritual, with her permission.') },
  { name: 'Offers and festivals', why: inf('Festival gifting is when the website sells most, so offers need a steady build-up.', 'F4', 'F9'), example: prop('Show the Diwali gift box opened on a table with diyas.') }
];

const HOOKS = {
  'Ritual and ingredients': ['Show the saffron going into the serum.', 'Pour the rose water for the toner in one slow shot.', 'Explain what manjistha does in plain words.', 'Show the neem and turmeric cleanser lathering.', 'Open a jar of the mask and show the texture.', 'Walk through the Sunday oil bath step by step.'],
  'Skin education': ['Explain the right order for toner, serum and cream.', 'Answer why sunscreen is needed in Chennai humidity.', 'Tell what bakuchi is and how it differs from retinol.', 'Share three label words to look for.', 'Explain how often to use a clay mask.'],
  'Founder story': ['Tell how the first batch was poured at home.', 'Show the studio shelf on a quiet morning.', 'Share what paati taught about kumkumadi.', 'Introduce the chemist friend who checks every batch.'],
  'Customer glow stories': ['Share a customer note about her night routine.', 'Show a customer unboxing with her words on top.', 'Repost a happy reply from a first order.', 'Share a customer ritual from a Bengaluru flat.'],
  'Offers and festivals': ['Introduce the gift box for the festive season.', 'Announce the first order offer for new customers.', 'Show the ritual duo as a simple gift.', 'Remind that festival orders close early.']
};
const FORMAT_CYCLE = ['image post', 'carousel', 'reel', 'image post', 'reel', 'carousel', 'image post'];

function calendar() {
  const names = PILLARS.map((p) => p.name);
  const used = {};
  return Array.from({ length: 30 }, (_, i) => {
    const pillar = names[[0, 1, 4, 3, 0, 1, 2, 0, 4, 3][i % 10]];
    used[pillar] = (used[pillar] || 0) + 1;
    const list = HOOKS[pillar];
    return { day: i + 1, pillar, format: FORMAT_CYCLE[i % FORMAT_CYCLE.length], hook: prop(list[(used[pillar] - 1) % list.length]) };
  });
}

function offlineRows() {
  const by = Object.fromEntries(OFFLINE_CHANNELS.map((o) => [o.id, o]));
  const row = (id, reason, youDo) => ({ id, channel: by[id].name, mode: 'offline', spend: by[id].spend, reason: prop(reason), youDo: youDo.map(prop), nebulaaDoes: [] });
  return [
    row('local_events', 'Pop-up stalls at weekend markets let people smell and feel the products before they buy online.', ['Book two weekend pop-up stalls before the festival season.', 'Collect names and numbers at the stall to invite them to the WhatsApp list.']),
    row('partnerships', 'Salons and spas already serve the customers who care about skin, and can stock small gift sets.', ['Offer five salons in Chennai a tester set and a small stand for their reception.', 'Send influencer gifting boxes to a few local skin creators with a plain note.']),
    row('referrals', 'Skincare is bought on a friend\'s advice more than on any advertisement.', ['Put a small card in every parcel that gives a friend a first order offer.', 'Ask repeat customers to tell one friend about the ritual that worked for them.'])
  ];
}

function metricRows() {
  const by = Object.fromEntries(PLAN_METRICS.map((m) => [m.id, m]));
  const row = (id, why, start) => ({ id, name: by[id].name, meaning: by[id].meaning, where: by[id].where, count: by[id].count, why: prop(why), start: start ? prop(start) : null });
  return [
    row('reach', 'It shows whether new people are finding the brand before festival season.'),
    row('engagement', 'Saves and shares show which education posts people want to keep.'),
    row('followers', 'Steady follower growth tells whether the content is earning attention.'),
    row('messages', 'Most product questions and orders start as a comment or a message.'),
    row('referral_customers', 'It shows whether the parcel cards and the ask for a friend are working.', 'Ask each new customer how she heard about the brand.')
  ];
}

const mixOf = (channels, effort, offline) => ({
  channels: [
    ...channels.map((c) => { const e = effort.find((x) => x.channel === c.channel); return { channel: c.channel, mode: 'online', organicPct: e ? e.organicPct : null, paidPct: e ? e.paidPct : null }; }),
    ...offline.map((o) => ({ channel: o.channel, mode: 'offline', organicPct: o.spend === 'paid' ? 0 : 100, paidPct: o.spend === 'paid' ? 100 : 0 }))
  ],
  online: channels.length, offline: offline.length, paidTag: 'proposed', paidBy: 'you'
});

/** The plan in the stored shape (result.plan). */
function buildPlan() {
  const channels = [
    { channel: 'Instagram', priority: 1, role: prop('Show the products, the rituals and the founder, with a reel or two every week.') },
    { channel: 'WhatsApp', priority: 2, role: prop('Answer product questions and send the festival offers to people who asked for them.') },
    { channel: 'Facebook', priority: 3, role: prop('Reach the older customers and gift buyers who still look for brands there.') },
    { channel: 'YouTube', priority: 4, role: prop('Keep longer how-to videos for skincare routines and the oil bath.') }
  ];
  const effort = [
    { channel: 'Instagram', mode: 'online', organicPct: 80, paidPct: 20, nebulaaDoes: ['posts', 'reels', 'captions and hashtags'], youDo: [prop('Reply to comments and messages on the same day.'), prop('Send gifting boxes to a few skin creators and tag them when they post.')] },
    { channel: 'WhatsApp', mode: 'online', organicPct: 100, paidPct: 0, nebulaaDoes: [], youDo: [prop('Send one festival offer message to the list each fortnight.')] },
    { channel: 'Facebook', mode: 'online', organicPct: 90, paidPct: 10, nebulaaDoes: ['posts', 'captions and hashtags'], youDo: [prop('Answer questions on the page within a day.')] },
    { channel: 'YouTube', mode: 'online', organicPct: 100, paidPct: 0, nebulaaDoes: ['video scripts'], youDo: [prop('Record one routine video a month in the studio.')] }
  ];
  const offline = offlineRows();
  return {
    promise: prop('A steady rhythm of rituals, education and stories that turns followers into repeat buyers on your own website.'),
    positioning: {
      audience: [
        inf('Women in metro India who read labels and want the rituals they grew up with.', 'F3', 'F6'),
        inf('Gift buyers looking for something thoughtful for family at festival time.', 'F9')
      ],
      territory: {
        name: 'Rituals that remember where they came from',
        rationale: prop('It joins the old recipes with clean, light formulas, which is the one thing the big brands do not say.'),
        risk: prop('It can sound old-fashioned unless each post shows a real product and a clear reason to try it.')
      },
      line: prop('Skin care that remembers where it came from.')
    },
    whereToday: [
      inf('The brand presents itself as a small Chennai maker of ayurveda-inspired skincare and haircare.', 'F1', 'F2'),
      inf('The main goal is direct sales from its own website, so each post needs a clear next step.', 'F4'),
      inf('Prices sit at the premium end, so the content has to show care and proof.', 'F5')
    ],
    competitors: [
      { name: COMPETITORS[0].name, observations: [] }, // what their pages say comes from the cited facts F12 and F13
      { name: COMPETITORS[1].name, observations: [] }
    ],
    pillars: PILLARS,
    calendar: calendar(),
    offers: [
      { factId: 'F9', hook: prop('Show the gift box opened on a table at festival time.'), cta: prop('Order the box on the website.') },
      { factId: 'F10', hook: prop('Present the duo as the simplest nightly ritual.'), cta: prop('Shop the duo today.') },
      { factId: 'F11', hook: prop('Welcome new followers with a first order offer.'), cta: prop('Use the code on your first order.') }
    ],
    channels,
    icp: {
      who: [
        inf('The ritual keeper: a woman in her late twenties to mid thirties in Chennai, Bengaluru or Hyderabad who grew up with oil baths and wants clean versions of them.', 'F3'),
        inf('The label reader: a working woman in her mid twenties who compares ingredients, follows skin creators and buys online two or three times a month.', 'F3', 'F6'),
        inf('The gift buyer: a son, daughter or friend, often a man, who buys a thoughtful box at festival time.', 'F9')
      ],
      pains: [
        prop('Heavy fragrance and harsh chemicals make her unsure what is safe for her skin.'),
        prop('She cannot tell which ayurvedic brands are genuine and which only use the word.'),
        prop('Choosing a gift that feels personal, not generic, takes time.')
      ],
      where: [prop('Instagram reels and skin creators, WhatsApp family groups, and marketplace reviews.')],
      triggers: [prop('A festival in the coming weeks, a change of season, or a friend who recommends a product.')]
    },
    effort,
    roadmap: [
      { phase: 'foundation', focus: prop('Set a steady rhythm of posts around the five pillars and build the WhatsApp list.'), actions: [prop('Publish on the days set in the calendar.'), prop('Book the first two pop-up stalls and brief five salons.')], measure: [prop('Track reach and saves on the education posts.')] },
      { phase: 'storytelling', focus: prop('Tell the founder and ingredient stories in more depth, in video.'), actions: [prop('Add a short video of one product from ingredient to jar.'), prop('Share two customer glow stories every week.')], measure: [prop('Note which stories bring messages and new followers.')] },
      { phase: 'growth', focus: prop('Repeat what worked and prepare the festival gifting push.'), actions: [prop('Run the best performing format twice as often.'), prop('Launch the gift box with a build-up of four posts.')], measure: [prop('Compare website orders and referrals with the earlier phases.')] }
    ],
    firstSteps: [prop('Confirm the five pillars.'), prop('Approve this week\'s posts in Review and approve.'), prop('Book the first pop-up stall.'), prop('Prepare a standard reply for product questions.')],
    offline,
    metrics: metricRows(),
    mix: mixOf(channels, effort, offline)
  };
}

function inputOf() {
  return {
    businessName: BRAND.name, logoUrl: '',
    competitors: COMPETITORS.slice(0, 2).map((c) => ({ name: c.name, url: `https://${c.handle.replace('.demo', '')}.example` })),
    offers: [{ name: 'Diwali Glow Gift Box', price: 'Rs 1,999' }, { name: 'Ritual Duo', price: 'Rs 1,699' }, { name: 'First order', price: '10 percent off' }]
  };
}

/** The finished result of one run (cover, nine pages, plan), through the real assembler. */
function buildResult({ at, logoUrl }) {
  const sheet = factSheet();
  const input = inputOf();
  input.logoUrl = logoUrl || '';
  // The offers page matches each offer to a typed fact by its exact text.
  const result = assembleBlueprint({ input, sheet, plan: buildPlan(), direction: null, mode: 'auto', now: at, sources: [] });
  result.plan = buildPlan();
  return result;
}

/**
 * The Blueprint rows. `createdAt` is the account's sign-up day: the free Blueprint came an hour later, the plan was last
 * refreshed `planAgeDays` days ago. Returns { plan, blueprint, deck } (deck = the designed pages to draw).
 */
function planRows({ userId, createdAt, now, logoUrl, designedBase }) {
  const planAt = new Date(now.getTime() - 3 * DAY);
  const bpAt = new Date(createdAt.getTime() + 70 * 60 * 1000);
  const planResult = buildResult({ at: planAt, logoUrl });
  const bpResult = buildResult({ at: bpAt, logoUrl });
  const deck = buildDeck(bpResult);
  const common = { userId, emailKey: DEMO_EMAIL, tierAtStart: 'professional', mode: 'auto', status: 'completed', step: 'completed', progress: 100, input: inputOf(), sheet: factSheet(), sources: [], qaFlags: [] };
  const plan = {
    ...common, blueprintId: PLAN_ID, kind: 'plan', freeSlot: false, businessKeys: [], result: planResult,
    startedAt: new Date(planAt.getTime() - 4 * 60 * 1000), completedAt: planAt, heartbeatAt: planAt, charge: { state: 'none' }, createdAt: new Date(planAt.getTime() - 4 * 60 * 1000), updatedAt: planAt
  };
  const blueprint = {
    ...common, tierAtStart: 'free', blueprintId: BLUEPRINT_ID, kind: 'blueprint', freeSlot: true, businessKeys: [`${DEMO_TAG}-naturals`], result: bpResult,
    startedAt: bpAt, completedAt: new Date(bpAt.getTime() + 6 * 60 * 1000), heartbeatAt: bpAt, charge: { state: 'none' }, createdAt: bpAt, updatedAt: bpAt,
    designed: {
      status: 'completed', total: deck.length, progress: 100, pdfUrl: '', startedAt: bpAt, completedAt: new Date(bpAt.getTime() + 12 * 60 * 1000), heartbeatAt: bpAt,
      pages: deck.map((p, i) => ({ n: i + 1, id: p.id, title: p.title, status: 'ok', attempts: 1, imageUrl: designedBase(i + 1), note: '' })),
      charge: { state: 'charged', quarks: 20, ref: `${DEMO_TAG}:blueprint-designed` }
    }
  };
  return { plan, blueprint, deck };
}

module.exports = { PLAN_ID, BLUEPRINT_ID, PILLARS, buildPlan, buildResult, planRows, factSheet };
