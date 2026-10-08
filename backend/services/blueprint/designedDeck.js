'use strict';
// The exact short text of every page of the designed Blueprint PDF, built from the finished Blueprint by code.
// No AI is involved here: this is what the image model is asked to print and what the page check compares against.
const { NEBULAA } = require('../../config/blueprint');

const MAX_LINE = 96;
const MAX_LINES = 7;

const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

/** Shortens a sentence to fit a page: the first sentence, then cut at a word boundary. Returns '' for nothing. */
function shorten(text, max = MAX_LINE) {
  const s = clean(text);
  if (!s) return '';
  const first = s.split(/(?<=[.!?])\s/)[0];
  if (first.length <= max) return first.replace(/\.$/, '');
  const cut = first.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > 40 ? cut.slice(0, at) : cut).replace(/[,;:\s]+$/, '')}…`;
}

const textOf = (c) => (c && typeof c === 'object' ? c.text : c);
const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));
const take = (arr, n = MAX_LINES) => uniq(arr).slice(0, n);

function sectionsOf(page) { return Array.isArray(page && page.sections) ? page.sections : []; }
function itemsOf(page, kind) {
  return sectionsOf(page).filter((s) => s.kind === kind).flatMap((s) => (Array.isArray(s.items) ? s.items : []));
}
function claimsOf(page, heading) {
  return sectionsOf(page).filter((s) => s.kind === 'claims' && (!heading || s.heading === heading))
    .flatMap((s) => (Array.isArray(s.items) ? s.items : []))
    .filter((c) => c && c.tag !== 'unverified');
}

/** Page copy per content page id. Every line is short, and only from the finished Blueprint. */
const BUILDERS = {
  'where-today': (p) => ({
    visual: 'a clean dashboard of icon cards, one confirmed fact on each card',
    lines: take([...claimsOf(p, 'What we confirmed'), ...claimsOf(p, 'What we read from this')].map((c) => shorten(textOf(c))))
  }),
  'audience-positioning': (p) => ({
    visual: 'a target-audience illustration on the left and a bold positioning statement card on the right',
    lines: take(claimsOf(p).map((c) => shorten(textOf(c))))
  }),
  'competitor-read': (p) => ({
    visual: 'a comparison board with one card for each competitor',
    lines: take(itemsOf(p, 'competitors').flatMap((c) => [clean(c.name), ...(c.observations || []).slice(0, 2).map((o) => shorten(textOf(o), 80))]), 8)
  }),
  'content-pillars': (p) => ({
    visual: 'three to five large icon cards, one for each content pillar',
    lines: take(itemsOf(p, 'pillars').flatMap((x) => [clean(x.name), shorten(textOf(x.why), 80)]), 8)
  }),
  'calendar-preview': (p) => {
    const tiles = itemsOf(p, 'calendar').slice(0, 6).map((c) => `Day ${c.day}: ${shorten(textOf(c.hook), 60)}`);
    return { visual: 'a month calendar grid with small post tiles and format icons', lines: take(tiles, 6) };
  },
  'offers-hooks': (p) => ({
    visual: 'offer cards like shop-window tags, each with its hook',
    lines: take(itemsOf(p, 'offers').flatMap((o) => [clean(o.price ? `${o.name}, ${o.price}` : o.name), shorten(textOf(o.hook), 80)]), 6)
  }),
  'channel-plan': (p) => ({
    visual: 'a hub-and-spoke diagram with the channels around the brand, each with its role',
    lines: take(itemsOf(p, 'channels').map((c) => `${clean(c.channel)}: ${shorten(textOf(c.role), 70)}`), 6)
  }),
  'roadmap-90': (p) => ({
    visual: 'a three-step road with a milestone flag for each phase',
    lines: take(itemsOf(p, 'phases').flatMap((ph) => [`${clean(ph.label)}: ${clean(ph.title)}`, shorten(textOf(ph.focus), 80)]), 6)
  }),
  'first-steps': (p) => ({
    visual: 'a numbered checklist of first steps with tick icons',
    lines: take(claimsOf(p).map((c) => shorten(textOf(c))), 6)
  }),
};

/**
 * Builds the page list: cover, the nine content pages, then the closing page.
 * Each page: { n, id, kind, title, kicker, lines[], visual }.
 */
function buildDeck(result) {
  const r = result || {};
  const cover = r.cover || {};
  const pages = Array.isArray(r.pages) ? r.pages : [];
  const deck = [];

  deck.push({
    kind: 'cover',
    id: 'cover',
    title: clean(cover.businessName) || 'Your business',
    kicker: 'Brand Growth Blueprint',
    lines: take([shorten(cover.promise || '', 110), cover.limitedNote ? clean(cover.limitedNote) : ''], 2),
    visual: 'a bold, welcoming cover with the headline large and a hero illustration that fits the business',
  });

  pages.forEach((p) => {
    const b = (BUILDERS[p.id] || (() => ({ lines: [], visual: 'a clean infographic page' })))(p);
    deck.push({ kind: 'content', id: p.id, title: clean(p.title), kicker: clean(p.purpose), lines: b.lines, visual: b.visual });
  });

  const c = r.closing || {};
  const contact = c.contact || NEBULAA;
  const contactLines = [
    contact.website ? contact.website.replace(/^https?:\/\//, '').replace(/\/$/, '') : '',
    contact.email, contact.phone,
  ].map(clean).filter(Boolean);
  deck.push({
    kind: 'closing',
    id: 'closing',
    title: 'Thank you',
    kicker: 'Let us build this together',
    lines: take(contactLines, 3),
    visual: 'a warm closing page with a sunrise-style skyline and the contact details in clear cards',
  });

  return deck.map((d, i) => ({ n: i + 1, ...d }));
}

module.exports = { buildDeck, shorten, MAX_LINE, MAX_LINES };
