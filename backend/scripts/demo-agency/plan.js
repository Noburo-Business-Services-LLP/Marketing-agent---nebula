'use strict';
/**
 * "My plan" of each demo client, in the real stored shape and through the app's own assembler (services/blueprint/assemble.js), so
 * the Plan page and the This week card read it like a plan the planner made. No model call: the plan is built from the client's own
 * facts (constants.js). Shaped after scripts/demo-brand/plan.js (the Zaya plan), but written for any client.
 */
const { assembleBlueprint } = require('../../services/blueprint/assemble');
const { OFFLINE_CHANNELS, PLAN_METRICS } = require('../../config/blueprint');
const { TAG } = require('./build');

const DAY = 24 * 60 * 60 * 1000;
const prop = (text) => ({ text, tag: 'proposed' });
const inf = (text, ...factIds) => ({ text, tag: 'inference', factIds });
const lc = (s) => String(s).charAt(0).toLowerCase() + String(s).slice(1);

function factSheet(c) {
  const typed = (id, field, text) => ({ id, kind: 'typed', field, text });
  const it = c.items;
  const facts = [
    typed('F1', 'Business', `${c.name} is ${lc(c.profile.description)}`),
    typed('F2', 'City', `Based in ${c.city}.`),
    typed('F3', 'Sells to', `Sells to ${lc(c.profile.targetAudience)}.`),
    typed('F4', 'Goal', 'The main goal is more sales and more enquiries from Instagram and Facebook.'),
    typed('F5', 'What makes it different', c.profile.niche),
    typed('F6', 'Content language', 'Posts in English.'),
    typed('F7', 'Product', `Product: ${it[0].n}`),
    typed('F8', 'Product', `Product: ${it[1].n}`),
    typed('F9', 'Offer', `Offer: ${c.offer}`)
  ];
  return { facts, unverified: [], basis: 'full', warnings: [], assets: { logo: null, colours: [c.palette.ink, c.palette.accent, c.palette.bg].map((hex) => ({ hex, source: 'typed' })) } };
}

function pillars(c) {
  const [a, b] = c.items;
  return [
    { name: 'Our products', why: inf(`Showing ${lc(a.n)} and ${lc(b.n)} up close is what turns a scroll into a visit.`, 'F7', 'F8'), example: prop(`A clear picture of ${lc(a.n)} with one line on why people choose it.`) },
    { name: 'Tips and answers', why: inf('Plain answers to the questions customers ask build trust before they buy.', 'F3', 'F5'), example: prop(`A short post that answers the most common question about ${lc(b.n)}.`) },
    { name: 'Behind the scenes', why: inf('A small business with real people is what a big chain cannot copy.', 'F1', 'F2'), example: prop(`Show the team getting ${lc(a.n)} ready for the day.`) },
    { name: 'Customer stories', why: inf('People trust people like them, and regulars are the best proof.', 'F3'), example: prop('Share a kind message from a regular customer, with permission.') },
    { name: 'Offers and events', why: inf('A steady offer gives people a reason to act this week.', 'F4', 'F9'), example: prop(`Announce ${lc(c.offer)} with a clear way to claim it.`) }
  ];
}

function calendar(c) {
  const names = pillars(c).map((p) => p.name);
  const formats = ['image post', 'carousel', 'reel', 'image post', 'reel', 'carousel', 'image post'];
  return Array.from({ length: 30 }, (_, i) => {
    const pillar = names[[0, 1, 4, 3, 0, 1, 2, 0, 4, 3][i % 10]];
    const item = c.items[i % c.items.length];
    return { day: i + 1, pillar, format: formats[i % formats.length], hook: prop(`${pillar === 'Offers and events' ? 'Announce' : 'Show'} ${lc(item.n)}: ${lc(word(item.d))}.`) };
  });
}
const word = (s) => String(s).replace(/\.$/, '');

function offlineRows(c) {
  const by = Object.fromEntries(OFFLINE_CHANNELS.map((o) => [o.id, o]));
  const row = (id, reason, youDo) => ({ id, channel: by[id].name, mode: 'offline', spend: by[id].spend, reason: prop(reason), youDo: youDo.map(prop), nebulaaDoes: [] });
  return [
    row('local_events', 'People who meet the business in person remember it and follow it.', [`Take a stall or a table at one local event in ${c.cityShort} this month.`, 'Put the Instagram handle on every bill and board.']),
    row('partnerships', 'Neighbouring businesses already serve the same customers.', [`Agree a small cross-offer with two businesses near ${c.name}.`]),
    row('referrals', 'Most customers choose on a friend\'s advice.', ['Give every customer a card that offers a friend a first-visit benefit.'])
  ];
}

function metricRows() {
  const by = Object.fromEntries(PLAN_METRICS.map((m) => [m.id, m]));
  const row = (id, why) => ({ id, name: by[id].name, meaning: by[id].meaning, where: by[id].where, count: by[id].count, why: prop(why), start: null });
  return [
    row('reach', 'It shows whether new people are finding the business.'), row('engagement', 'Saves and shares show which posts people want to keep.'),
    row('followers', 'Steady growth tells whether the content is earning attention.'), row('messages', 'Most bookings and orders start as a message.')
  ];
}

function mixOf(channels, effort, offline) {
  return {
    channels: [
      ...channels.map((ch) => { const e = effort.find((x) => x.channel === ch.channel); return { channel: ch.channel, mode: 'online', organicPct: e ? e.organicPct : null, paidPct: e ? e.paidPct : null }; }),
      ...offline.map((o) => ({ channel: o.channel, mode: 'offline', organicPct: o.spend === 'paid' ? 0 : 100, paidPct: o.spend === 'paid' ? 100 : 0 }))
    ], online: channels.length, offline: offline.length, paidTag: 'proposed', paidBy: 'you'
  };
}

function buildPlan(c) {
  const channels = [
    { channel: 'Instagram', priority: 1, role: prop(`Show ${lc(c.items[0].n)}, the team and the day-to-day, with a reel or two every week.`) },
    { channel: 'Facebook', priority: 2, role: prop('Reach the older customers and families who still look for businesses there.') }
  ];
  const effort = [
    { channel: 'Instagram', mode: 'online', organicPct: 85, paidPct: 15, nebulaaDoes: ['posts', 'reels', 'captions and hashtags'], youDo: [prop('Reply to comments and messages on the same day.')] },
    { channel: 'Facebook', mode: 'online', organicPct: 90, paidPct: 10, nebulaaDoes: ['posts', 'captions and hashtags'], youDo: [prop('Answer questions on the page within a day.')] }
  ];
  const offline = offlineRows(c);
  return {
    promise: prop(`A steady rhythm of products, tips and stories that brings more people through the door of ${c.name}.`),
    positioning: {
      audience: [inf(`${c.profile.targetCustomerProfile}.`, 'F3'), inf(`People searching for ${lc(c.profile.niche)} in ${c.cityShort}.`, 'F2', 'F5')],
      territory: { name: `The local choice for ${lc(c.profile.niche)}`, rationale: prop('Being close, friendly and easy to reach is what a large chain cannot offer.'), risk: prop('It can sound generic unless every post shows a real product and a clear reason to visit.') },
      line: prop(`${c.name}: ${lc(c.profile.niche)}, made for ${c.cityShort}.`)
    },
    whereToday: [
      inf(`${c.name} presents itself as ${lc(c.profile.description)}`, 'F1', 'F2'),
      inf('The main goal is more sales and enquiries, so each post needs a clear next step.', 'F4')
    ],
    competitors: [],
    pillars: pillars(c),
    calendar: calendar(c),
    offers: [{ factId: 'F9', hook: prop(`Put ${lc(c.offer)} on the picture and in the first line.`), cta: prop('Message us or visit this week.') }],
    channels,
    icp: {
      who: [inf(`${c.profile.targetCustomerProfile}.`, 'F3')],
      pains: [prop('They have little time and want a business they can trust at first glance.'), prop('They compare two or three options on Instagram before they choose.')],
      where: [prop('Instagram reels and posts, Facebook groups for the neighbourhood, and word of mouth.')],
      triggers: [prop('A weekend, a festival or a recommendation from a friend.')]
    },
    effort,
    roadmap: [
      { phase: 'foundation', focus: prop('Set a steady rhythm of posts around the five pillars.'), actions: [prop('Publish on the days set in the calendar.'), prop('Reply to every message the same day.')], measure: [prop('Reach and followers each week.')] },
      { phase: 'storytelling', focus: prop('Show the people and the process in short videos.'), actions: [prop('Add two short videos a month.'), prop('Share two customer stories a month.')], measure: [prop('Saves and shares on videos.')] },
      { phase: 'growth', focus: prop('Repeat what worked and add an offer every fortnight.'), actions: [prop('Run the best performing format twice as often.')], measure: [prop('Enquiries and visits that mention Instagram.')] }
    ],
    firstSteps: [prop('Confirm the five pillars.'), prop('Approve this week\'s posts in Review and approve.'), prop('Prepare a standard reply for common questions.')],
    offline,
    metrics: metricRows(),
    mix: mixOf(channels, effort, offline)
  };
}

function inputOf(c, logoUrl) {
  return { businessName: c.name, logoUrl: logoUrl || '', competitors: [], offers: [{ name: c.offer.charAt(0).toUpperCase() + c.offer.slice(1), price: '' }] };
}

/** One completed plan row for a client, refreshed 3 days ago. */
function planRow({ client: c, userId, email, now, logoUrl }) {
  const at = new Date(now.getTime() - 3 * DAY);
  const sheet = factSheet(c);
  const input = inputOf(c, logoUrl);
  const result = assembleBlueprint({ input, sheet, plan: buildPlan(c), direction: null, mode: 'auto', now: at, sources: [] });
  result.plan = buildPlan(c);
  return {
    userId, emailKey: email, tierAtStart: 'agency', mode: 'auto', status: 'completed', step: 'completed', progress: 100, input, sheet, sources: [], qaFlags: [],
    blueprintId: `${TAG}-plan-${c.slug}`, kind: 'plan', freeSlot: false, businessKeys: [], result,
    startedAt: new Date(at.getTime() - 4 * 60 * 1000), completedAt: at, heartbeatAt: at, charge: { state: 'none' }, createdAt: new Date(at.getTime() - 4 * 60 * 1000), updatedAt: at
  };
}

module.exports = { planRow, buildPlan, factSheet };
