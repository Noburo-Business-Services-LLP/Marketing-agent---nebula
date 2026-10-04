'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { discover, verifyFacts, evaluateStop, nameTokens } = require('../services/blueprint/discovery');
const { extractPage, toText } = require('../services/blueprint/pageFacts');
const { STOP_MESSAGES, WARNING_MESSAGES, LIMITS } = require('../config/blueprint');
const { normaliseInput } = require('../services/blueprint/input');

const HOME = `<html><head><title>Sweet Co | Custom cakes</title>
<meta name="description" content="Custom cakes baked to order in Chennai.">
<link rel="apple-touch-icon" href="/icon.png"></head><body>
<h1>Cakes for every day</h1><p>Call 98765 43210 or email hello@sweetco.in</p>
<a href="/about">About</a><a href="/shop/cakes">Cakes</a><a href="https://other.com/x">x</a><a href="/privacy">p</a></body></html>`;
const page = (title, h1 = 'Welcome') => `<html><head><title>${title}</title></head><body><h1>${h1}</h1></body></html>`;

const baseInput = (over = {}) => {
  const r = normaliseInput({ businessName: 'Sweet Co', website: 'sweetco.in', whatYouSell: 'Custom cakes baked to order.', whoItsFor: 'Families in Chennai', goal: 'enquiries', city: 'Chennai', ...over });
  assert.ok(r.ok, JSON.stringify(r.errors));
  return r.input;
};

function fakeFetcher(map) {
  const f = async (url) => {
    f.calls.push(url);
    const v = map[url];
    if (v instanceof Error) throw v;
    if (v === undefined) return { ok: false, reason: 'status', status: 404 };
    return { ok: true, status: 200, finalUrl: url, text: v };
  };
  f.calls = [];
  return f;
}
const allowAll = async () => true;

test('discovery fetches the home page and only the allowed same-site pages', async () => {
  const f = fakeFetcher({ 'https://sweetco.in/': HOME, 'https://sweetco.in/about': page('About Sweet Co', 'Our story'), 'https://sweetco.in/shop/cakes': page('Cakes', 'Birthday cakes') });
  const { sheet, sources } = await discover({ input: baseInput(), fetchPage: f, robots: allowAll });
  assert.deepEqual(f.calls, ['https://sweetco.in/', 'https://sweetco.in/about', 'https://sweetco.in/shop/cakes']);
  const title = sheet.facts.find((x) => x.field === 'Page title' && x.kind === 'page');
  assert.ok(title.source.url);
  assert.equal(title.quote, 'Sweet Co | Custom cakes');
  assert.ok(sheet.facts.every((x) => x.tag === 'verified' && /^F\d+$/.test(x.id)));
  assert.ok(sheet.facts.some((x) => x.kind === 'typed'));
  assert.deepEqual(sheet.assets.logo, { url: 'https://sweetco.in/icon.png', source: 'page' });
  assert.ok(sources.every((s) => /^S\d+$/.test(s.id)));
  assert.equal(sheet.version, 1);
});

test('no contact, follower or long-number facts ever enter the sheet', async () => {
  const f = fakeFetcher({ 'https://sweetco.in/': HOME });
  const { sheet } = await discover({ input: baseInput(), fetchPage: f, robots: allowAll });
  for (const x of sheet.facts) assert.doesNotMatch(`${x.text} ${x.quote}`, /@\w|\bFollowers\b|\d{5,}|tel:|mailto:|98765|hello@/i, x.text);
});

test('typed logo wins over the page logo', async () => {
  const f = fakeFetcher({ 'https://sweetco.in/': HOME });
  const { sheet } = await discover({ input: baseInput({ logoUrl: 'https://cdn.sweetco.in/logo.png' }), fetchPage: f, robots: allowAll });
  assert.deepEqual(sheet.assets.logo, { url: 'https://cdn.sweetco.in/logo.png', source: 'typed' });
});

test('instagram: bio only, never counts; failure is unverified', async () => {
  const ig = '<html><head><meta property="og:description" content="1,234 Followers, 56 Following, 78 Posts - Custom cakes (@sweetco)"></head></html>';
  const f = fakeFetcher({ 'https://sweetco.in/': HOME, 'https://www.instagram.com/sweetco/': ig });
  const { sheet } = await discover({ input: baseInput({ instagram: '@sweetco' }), fetchPage: f, robots: allowAll });
  const fact = sheet.facts.find((x) => x.kind === 'instagram');
  assert.ok(fact && /Custom cakes/.test(fact.text));
  assert.doesNotMatch(fact.text, /1,234|Followers/);
  const f2 = fakeFetcher({ 'https://sweetco.in/': HOME });
  const r2 = await discover({ input: baseInput({ instagram: '@sweetco' }), fetchPage: f2, robots: allowAll });
  assert.ok(r2.sheet.unverified.some((u) => /Instagram/i.test(u.text)));
  assert.ok(r2.sheet.missing.some((m) => /instagram/i.test(m)));
});

test('competitors: no address, robots disallow, and a read one', async () => {
  const input = baseInput({ competitors: [{ name: 'No Address Bakes' }, { name: 'Blocked Bakes', url: 'blocked.com' }, { name: 'Open Bakes', url: 'open.com' }] });
  const f = fakeFetcher({ 'https://sweetco.in/': HOME, 'https://open.com/': page('Open Bakes | Cakes', 'Fresh daily') });
  const robots = async (u) => !u.startsWith('https://blocked.com');
  const { sheet } = await discover({ input, fetchPage: f, robots });
  assert.ok(sheet.unverified.some((u) => /No Address Bakes/.test(u.text) && u.reason === 'Named by you; not researched'));
  assert.ok(sheet.unverified.some((u) => /Blocked Bakes/.test(u.text)));
  assert.ok(!f.calls.some((u) => u.includes('blocked.com')));
  const cf = sheet.facts.filter((x) => x.kind === 'competitor_page');
  assert.ok(cf.length >= 1 && cf.every((x) => x.subject === 'Open Bakes'));
});

test('a fetcher that throws never throws out of discover', async () => {
  const f = async () => { throw new Error('boom'); };
  const { sheet, sources } = await discover({ input: baseInput(), fetchPage: f, robots: allowAll });
  assert.ok(sources.some((s) => s.ok === false));
  assert.ok(sheet.unverified.length > 0);
});

test('at most 9 fetches with 5 pages, instagram and 3 competitors', async () => {
  const links = ['about', 'shop', 'menu', 'pricing', 'contact', 'story'].map((p) => `<a href="/${p}">${p}</a>`).join('');
  const map = { 'https://sweetco.in/': `<html><title>Sweet Co</title><body>${links}</body></html>`, 'https://www.instagram.com/sweetco/': '<meta property="og:description" content="1 Followers, 2 Following, 3 Posts - Cakes">' };
  for (const p of ['about', 'shop', 'menu', 'pricing', 'contact', 'story']) map[`https://sweetco.in/${p}`] = page(p);
  const comps = ['a', 'b', 'c'].map((n) => ({ name: `Comp ${n}`, url: `${n}-bakes.com` }));
  for (const n of ['a', 'b', 'c']) map[`https://${n}-bakes.com/`] = page(`Comp ${n}`);
  const f = fakeFetcher(map);
  await discover({ input: baseInput({ instagram: '@sweetco', competitors: comps }), fetchPage: f, robots: allowAll });
  assert.equal(f.calls.length, LIMITS.MAX_PAGES_FETCHED + 1 + 3);
  assert.ok(f.calls.length <= 9);
  assert.equal(f.calls.filter((u) => u.startsWith('https://sweetco.in/')).length, 5);
});

test('stops fetching new pages once the budget has passed', async () => {
  let t = 0;
  const f = fakeFetcher({ 'https://sweetco.in/': HOME, 'https://sweetco.in/about': page('x'), 'https://sweetco.in/shop/cakes': page('y') });
  const orig = f;
  const timed = async (u) => { t += LIMITS.TOTAL_BUDGET_MS + 1; return orig(u); };
  await discover({ input: baseInput(), fetchPage: timed, robots: allowAll, now: () => t });
  assert.deepEqual(orig.calls, ['https://sweetco.in/']);
});

test('verifyFacts drops a tampered fact and keeps a typed one', () => {
  const input = baseInput();
  const texts = new Map([['https://sweetco.in/', 'Sweet Co | Custom cakes Cakes for every day']]);
  const facts = [
    { id: 'F1', tag: 'verified', kind: 'page', field: 'Page title', text: 'Page title: Sweet Co', quote: 'sweet co | custom   cakes', source: { type: 'page', url: 'https://sweetco.in/', field: 'title' } },
    { id: 'F2', tag: 'verified', kind: 'page', field: 'Page title', text: 'x', quote: 'Award winning bakery', source: { type: 'page', url: 'https://sweetco.in/', field: 'title' } },
    { id: 'F3', tag: 'verified', kind: 'typed', field: 'Business name', text: 'Business name: Sweet Co', quote: 'Sweet Co', source: { type: 'typed', field: 'businessName' } },
    { id: 'F4', tag: 'verified', kind: 'typed', field: 'Business name', text: 'Business name: Fake', quote: 'Fake Co', source: { type: 'typed', field: 'businessName' } }
  ];
  const r = verifyFacts(facts, texts, input);
  assert.deepEqual(r.facts.map((x) => x.id), ['F1', 'F3']);
  assert.equal(r.removed, 2);
});

const sheetOf = (facts) => ({ facts, client: {} });
const pf = (kind, n = 1) => Array.from({ length: n }, (_, i) => ({ id: `F${i}`, kind, field: 'Heading', text: `t${i}`, quote: `t${i}`, tag: 'verified' }));

test('evaluateStop: unreachable and thin, with the configured messages', () => {
  const input = baseInput();
  const s = evaluateStop(sheetOf([]), input, { websiteRead: false, instagramRead: false });
  assert.equal(s.stop.reason, 'unreachable');
  assert.equal(s.stop.message, STOP_MESSAGES.unreachable);
  const thin = evaluateStop(sheetOf([]), baseInput({ website: '', instagram: '@sweetco' }), { websiteRead: false, instagramRead: false });
  assert.equal(thin.stop.reason, 'unreachable'); // an address was given but nothing read
  const { websiteUrl, websiteHost, instagramHandle, instagramUrl, ...rest } = input;
  const none = evaluateStop(sheetOf([]), { ...rest, websiteUrl: '', websiteHost: '', instagramHandle: '', instagramUrl: '' }, { websiteRead: false, instagramRead: false });
  assert.equal(none.stop.reason, 'thin');
  assert.equal(none.stop.message, STOP_MESSAGES.thin);
});

test('evaluateStop: one typed offer means limited mode, no stop', () => {
  const input = baseInput({ offers: [{ name: 'Birthday cake', price: 'Rs 1200' }] });
  const r = evaluateStop(sheetOf([]), input, { websiteRead: false, instagramRead: false });
  assert.equal(r.stop, null);
  assert.equal(r.basis, 'limited');
  assert.equal(r.evidence, 3);
});

test('identity mismatch is a visible warning, never a stop', () => {
  const input = baseInput({ businessName: 'Zenith Interiors', website: 'acme.com' });
  const facts = [
    { id: 'F1', kind: 'page', field: 'Page title', text: 'Page title: Acme Hardware', quote: 'Acme Hardware', tag: 'verified' },
    { id: 'F2', kind: 'page', field: 'Heading', text: 'Heading: Tools', quote: 'Tools', tag: 'verified' },
    { id: 'F3', kind: 'page', field: 'Heading', text: 'Heading: Nails', quote: 'Nails', tag: 'verified' }
  ];
  const r = evaluateStop(sheetOf(facts), input, { websiteRead: true, instagramRead: false });
  assert.equal(r.stop, null);
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0].reason, 'identity_mismatch');
  assert.equal(r.warnings[0].message, WARNING_MESSAGES.identity_mismatch);
  const ok = evaluateStop(sheetOf(facts), baseInput({ businessName: 'Zenith Interiors', website: 'zenithinteriors.in' }), { websiteRead: true, instagramRead: false });
  assert.deepEqual(ok.warnings, []);
  const titled = evaluateStop(sheetOf([{ ...facts[0], text: 'Page title: Zenith | Rooms', quote: 'Zenith | Rooms' }, facts[1], facts[2]]), input, { websiteRead: true, instagramRead: false });
  assert.deepEqual(titled.warnings, []);
  const ig = evaluateStop(sheetOf(facts), input, { websiteRead: true, instagramRead: true, instagramCorroborates: true });
  assert.deepEqual(ig.warnings, []);
});

test('mismatch end to end: sheet carries the warning and the run is not stopped', async () => {
  const f = fakeFetcher({ 'https://acme.com/': '<html><head><title>Acme Hardware</title><meta name="description" content="Tools and nails for builders."></head><body><h1>Tools</h1><h2>Nails</h2><h2>Paint</h2></body></html>' });
  const { sheet } = await discover({ input: baseInput({ businessName: 'Zenith Interiors', website: 'acme.com', offers: [{ name: 'Design visit', price: 'Rs 500' }] }), fetchPage: f, robots: allowAll });
  assert.equal(sheet.stop, null);
  assert.deepEqual(sheet.warnings.map((w) => w.reason), ['identity_mismatch']);
});

test('missing logo does not stop the run', async () => {
  const f = fakeFetcher({ 'https://sweetco.in/': '<html><head><title>Sweet Co</title><meta name="description" content="Cakes baked to order."></head><body><h1>Cakes</h1><h2>Pies</h2></body></html>' });
  const { sheet } = await discover({ input: baseInput(), fetchPage: f, robots: allowAll });
  assert.equal(sheet.assets.logo, null);
  assert.ok(sheet.missing.includes('logo'));
  assert.equal(sheet.stop, null);
});

test('basis is full with 8 or more page facts', async () => {
  const h = Array.from({ length: 6 }, (_, i) => `<h2>Heading number ${i}</h2>`).join('');
  const f = fakeFetcher({ 'https://sweetco.in/': `<html><head><title>Sweet Co</title><meta name="description" content="Cakes baked to order."></head><body><h1>Cakes daily</h1>${h}</body></html>` });
  const { sheet } = await discover({ input: baseInput(), fetchPage: f, robots: allowAll });
  assert.equal(sheet.basis, 'full');
  assert.ok(sheet.evidence >= LIMITS.FULL_EVIDENCE);
});

test('nameTokens', () => {
  assert.deepEqual(nameTokens('The Sweet Co Pvt Ltd'), ['sweet']);
  assert.deepEqual(nameTokens('Zenith Interiors'), ['zenith', 'interiors']);
});

test('pageFacts extraction and text', () => {
  const p = extractPage(`<html><head><title> A  Title </title><meta property="og:site_name" content="Site"><meta name="theme-color" content="#112233">
  <link rel="apple-touch-icon" href="/a.png"><meta property="og:image" content="https://x.com/banner.jpg">
  <script type="application/ld+json">{"@graph":[{"@type":"Organization","name":"Sweet","description":"Bakers","sameAs":["https://instagram.com/sweet"],"logo":"https://sweetco.in/l.png","address":{"addressLocality":"Chennai"}}]}</script></head>
  <body><style>.a{}</style><h1>One</h1><h2>One</h2><h2>ab</h2><p>Hello <b>world</b></p><a href="/about?x=1#y">a</a><a href="http://sweetco.in/shop">insecure</a></body></html>`, 'https://sweetco.in/');
  assert.equal(p.title, 'A Title');
  assert.equal(p.siteName, 'Site');
  assert.equal(p.themeColor, '#112233');
  assert.deepEqual(p.headings, ['One']);
  assert.equal(p.ld.name, 'Sweet');
  assert.equal(p.ld.locality, 'Chennai');
  assert.deepEqual(p.logoCandidates.sort(), ['https://sweetco.in/a.png', 'https://sweetco.in/l.png']);
  assert.deepEqual(p.links, ['https://sweetco.in/about']);
  assert.ok(!/\.a\{/.test(p.text));
  assert.equal(toText('<p>a</p><p>b&amp;c</p>'), 'a b&c');
});
