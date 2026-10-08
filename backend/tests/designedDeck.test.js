const test = require('node:test');
const assert = require('node:assert');
const { buildDeck, shorten } = require('../services/blueprint/designedDeck');
const { PAGES } = require('../config/blueprint');

const claim = (text, tag = 'proposed') => ({ text, tag });
function fakeResult() {
  const pages = PAGES.map((p) => ({ n: p.n, id: p.id, title: p.title, purpose: p.purpose, sections: [] }));
  const by = (id) => pages.find((p) => p.id === id);
  by('where-today').sections.push({ heading: 'What we confirmed', kind: 'claims', items: [claim('Sells filter coffee beans online', 'verified'), claim('Based in Chennai', 'verified')] });
  by('where-today').sections.push({ heading: 'What we could not confirm', kind: 'claims', items: [claim('Customer count unknown', 'unverified')] });
  by('content-pillars').sections.push({ heading: 'Your pillars', kind: 'pillars', items: [{ name: 'Origin stories', why: claim('Shows where the beans come from. It builds trust over time with every post.') }] });
  by('calendar-preview').sections.push({ heading: 'Thirty days of posts', kind: 'calendar', items: [{ day: 1, pillar: 'Origin stories', format: 'reel', hook: claim('Meet the farm behind your cup') }] });
  by('offers-hooks').sections.push({ heading: 'Your offers', kind: 'offers', items: [{ name: 'Starter box', price: 'Rs 499', hook: claim('Taste three roasts') }] });
  by('channel-plan').sections.push({ heading: 'Where', kind: 'channels', items: [{ channel: 'Instagram', priority: 1, role: claim('Show the daily craft') }] });
  by('roadmap-90').sections.push({ heading: 'Three phases', kind: 'phases', items: [{ id: 'foundation', label: 'Days 1 to 30', title: 'Foundation', focus: claim('Set up the basics'), actions: [], measure: [] }] });
  return { cover: { businessName: 'Bean Co', promise: 'A steady monthly rhythm of stories that make people choose your coffee.', limitedNote: null }, pages, closing: { contact: { email: 'support@nebulaa.ai', website: 'https://www.nebulaa.ai', phone: '+91 9384801049' } } };
}

test('the deck is cover, nine content pages and a closing page, numbered 1 to 11', () => {
  const d = buildDeck(fakeResult());
  assert.equal(d.length, 11);
  assert.deepEqual(d.map((p) => p.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(d[0].kind, 'cover'); assert.equal(d[10].kind, 'closing');
  assert.equal(d[0].title, 'Bean Co');
});

test('only confirmed or proposed text is used, short, and nothing is invented', () => {
  const d = buildDeck(fakeResult());
  const where = d.find((p) => p.id === 'where-today');
  assert.deepEqual(where.lines, ['Sells filter coffee beans online', 'Based in Chennai']);
  const pillars = d.find((p) => p.id === 'content-pillars');
  assert.equal(pillars.lines[0], 'Origin stories');
  assert.ok(pillars.lines[1].length <= 96 && !pillars.lines[1].includes('trust over time'));
  assert.deepEqual(d.find((p) => p.id === 'calendar-preview').lines, ['Day 1: Meet the farm behind your cup']);
  assert.deepEqual(d.find((p) => p.id === 'offers-hooks').lines, ['Starter box, Rs 499', 'Taste three roasts']);
  for (const p of d) for (const l of p.lines) assert.ok(l.length <= 112, l);
});

test('the closing page shows only contact details that exist', () => {
  const r = fakeResult(); r.closing.contact = { email: 'support@nebulaa.ai' };
  const d = buildDeck(r);
  assert.deepEqual(d[10].lines, ['support@nebulaa.ai']);
});

test('shorten cuts at the first sentence or a word boundary', () => {
  assert.equal(shorten('One. Two.'), 'One');
  const long = shorten('word '.repeat(60));
  assert.ok(long.length <= 96 && long.endsWith('…'));
  assert.equal(shorten(''), '');
});

test('an empty result still gives a complete deck', () => {
  assert.equal(buildDeck({}).length, 2);
  assert.equal(buildDeck(null)[0].title, 'Your business');
});
