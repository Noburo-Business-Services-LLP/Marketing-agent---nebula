const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { createDraftLocalizer } = require('../services/draftLocalization');
const Draft = require('../models/Draft');

const ID = () => String(new mongoose.Types.ObjectId());
const OWNER = ID();
const OTHER = ID();

function fakeDraftModel(seed = []) {
  const rows = seed.map((r) => ({ ...r }));
  return {
    rows,
    async findOne(q) {
      return rows.find((r) => String(r._id) === String(q._id) && String(r.userId) === String(q.userId)) || null;
    },
    async find(q) {
      return rows.filter((r) => String(r.userId) === String(q.userId)
        && String(r.languageVariantOf) === String(q.languageVariantOf)
        && q.language.$in.includes(r.language));
    },
    async create(doc) {
      const row = { _id: ID(), ...doc };
      rows.push(row);
      return row;
    },
  };
}

const source = () => ({
  _id: ID(), userId: OWNER, title: 'Diwali offer', caption: 'Big Diwali sale on silk sarees this week.', hashtags: ['#Diwali'],
  cta: 'Visit us', imageUrl: 'https://img.test/a.png', imageUrlNoLogo: 'https://img.test/a0.png', logoApplied: true,
  platforms: ['Instagram'], language: 'English', tone: 'Warm', objective: 'Sales', sourceType: 'post', contentType: 'post',
  status: 'scheduled', campaignId: ID(), scheduledDate: new Date(), creative: { textContent: 'x', imageUrls: ['https://img.test/a.png'] },
});

const fakeUser = { findById: () => ({ select: async () => ({ businessProfile: { name: 'Sample Traders', industry: 'Retail', businessLocation: 'Chennai' } }) }) };

function setup({ localize, seed } = {}) {
  const src = source();
  const Model = fakeDraftModel([src, ...(seed || [])]);
  const calls = [];
  const loc = localize || (async (payload) => { calls.push(payload); return payload.localizations.map((l) => ({ caption: `caption ${l.language}`, hashtags: ['#a', '#b'], cta: `cta ${l.language}`, language: l.language, fallback: false })); });
  const wrapped = async (p) => { if (!localize) return loc(p); calls.push(p); return localize(p); };
  const run = createDraftLocalizer({ Draft: Model, User: fakeUser, localize: wrapped });
  return { src, Model, calls, run };
}

test('someone else\'s or a missing draft is 404, never 403', async () => {
  const { src, run, calls } = setup();
  assert.strictEqual((await run({ userId: OTHER, draftId: String(src._id), languages: ['kannada'] })).status, 404);
  assert.strictEqual((await run({ userId: OWNER, draftId: ID(), languages: ['kannada'] })).status, 404);
  assert.strictEqual((await run({ userId: OWNER, draftId: 'not-an-id', languages: ['kannada'] })).status, 404);
  assert.strictEqual(calls.length, 0);
});

test('creates one new draft per language, linked, with the same picture, from one localisation call', async () => {
  const { src, run, calls, Model } = setup();
  const before = JSON.stringify(src);
  const out = await run({ userId: OWNER, draftId: String(src._id), languages: ['kannada', 'telugu'] });
  assert.strictEqual(out.status, 200);
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0].localizations.map((l) => l.language), ['Kannada', 'Telugu']);
  assert.strictEqual(calls[0].baseCaption, src.caption);
  assert.strictEqual(calls[0].brandName, 'Sample Traders');
  assert.deepStrictEqual(out.json.results.map((r) => [r.language, r.ok]), [['kannada', true], ['telugu', true]]);
  assert.strictEqual(Model.rows.length, 3);
  const v = Model.rows[1];
  assert.strictEqual(String(v.languageVariantOf), String(src._id));
  assert.strictEqual(v.language, 'kannada');
  assert.strictEqual(v.caption, 'caption Kannada');
  assert.strictEqual(v.cta, 'cta Kannada');
  assert.strictEqual(v.imageUrl, src.imageUrl);
  assert.strictEqual(v.imageUrlNoLogo, src.imageUrlNoLogo);
  assert.deepStrictEqual(v.platforms, ['Instagram']);
  assert.strictEqual(v.status, 'draft');
  assert.strictEqual(String(v.userId), OWNER);
  assert.strictEqual(v.campaignId, null);
  assert.strictEqual(v.scheduledDate, null);
  assert.strictEqual(v.creative.textContent, 'caption Kannada');
  assert.strictEqual(JSON.stringify(src), before, 'the original is untouched');
  assert.strictEqual(out.json.results[0].draftId, String(v._id));
});

test('asking again creates nothing and calls the AI only for missing languages', async () => {
  const { src, run, calls, Model } = setup();
  await run({ userId: OWNER, draftId: String(src._id), languages: ['kannada'] });
  const again = await run({ userId: OWNER, draftId: String(src._id), languages: ['kannada'] });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(Model.rows.length, 2);
  assert.deepStrictEqual(again.json.results.map((r) => [r.ok, r.existing]), [[true, true]]);
  const mixed = await run({ userId: OWNER, draftId: String(src._id), languages: ['kannada', 'hindi'] });
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(calls[1].localizations.map((l) => l.language), ['Hindi']);
  assert.strictEqual(Model.rows.length, 3);
  assert.strictEqual(mixed.json.results[0].existing, true);
});

test('at most 3 languages, at least 1, only base codes, not the draft\'s own language', async () => {
  const { src, run, calls } = setup();
  const id = String(src._id);
  const bad = async (languages) => run({ userId: OWNER, draftId: id, languages });
  assert.strictEqual((await bad(['kannada', 'telugu', 'hindi', 'urdu'])).status, 400);
  assert.strictEqual((await bad([])).status, 400);
  assert.strictEqual((await bad(undefined)).status, 400);
  const unsupported = await bad(['klingon']);
  assert.strictEqual(unsupported.status, 400);
  assert.match(unsupported.json.message, /not supported/);
  assert.strictEqual((await bad(['tamil_english_mix'])).status, 400);
  const own = await bad(['english']);
  assert.strictEqual(own.status, 400);
  assert.match(own.json.message, /already in English/);
  assert.strictEqual(calls.length, 0);
});

test('a language that fails is reported on its own and nothing is created for it', async () => {
  const { src, run, Model } = setup({
    localize: async (p) => p.localizations.map((l, i) => (i === 0
      ? { caption: 'x', hashtags: [], cta: '', language: l.language, fallback: true }
      : { caption: 'ok text', hashtags: ['#a'], cta: 'c', language: l.language, fallback: false })),
  });
  const out = await run({ userId: OWNER, draftId: String(src._id), languages: ['kannada', 'telugu'] });
  assert.strictEqual(out.status, 200);
  const [a, b] = out.json.results;
  assert.strictEqual(a.ok, false);
  assert.match(a.message, /could not write the Kannada version/);
  assert.ok(!a.draftId);
  assert.strictEqual(b.ok, true);
  assert.strictEqual(Model.rows.length, 2);
});

test('if the AI call throws, every language fails with a plain message and no draft is made', async () => {
  const { src, run, Model } = setup({ localize: async () => { throw new Error('secret provider detail'); } });
  const e = console.error; console.error = () => {};
  const out = await run({ userId: OWNER, draftId: String(src._id), languages: ['kannada'] });
  console.error = e;
  assert.strictEqual(out.json.results[0].ok, false);
  assert.ok(!/secret/.test(JSON.stringify(out.json)));
  assert.strictEqual(Model.rows.length, 1);
});

test('the Draft model has the two link fields and a variant is a valid draft', () => {
  const id = new mongoose.Types.ObjectId();
  const d = new Draft({ userId: id, title: 't', sourceType: 'post', languageVariantOf: id, language: 'kannada' });
  assert.strictEqual(d.validateSync(), undefined);
  assert.strictEqual(new Draft({ userId: id, title: 't', sourceType: 'post' }).languageVariantOf, null);
});

test('the route is protected, rate limited, and answers through the injected localiser', async () => {
  const { protect } = require('../middleware/auth');
  const router = require('../routes/draftLocalize');
  const layer = router.stack.find((l) => l.route && l.route.path === '/:id/localize' && l.route.methods.post);
  assert.ok(layer, 'POST /:id/localize exists');
  const handlers = layer.route.stack.map((s) => s.handle);
  assert.strictEqual(handlers[0], protect);
  assert.strictEqual(handlers.length, 3, 'protect, limiter, handler');
  // a real handler call with a fake localiser and no database: a bad body is a 400 before any lookup
  router.localizeDeps.localize = async () => { throw new Error('must not be called'); };
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handlers[2]({ user: { _id: OWNER }, params: { id: ID() }, body: { languages: ['klingon'] } }, res);
  assert.strictEqual(res.code, 400);
});
