const test = require('node:test');
const assert = require('node:assert');
const { normaliseQuickConcepts, conceptToBrief, QUICK_STYLES } = require('../services/heroQuick');
const { normalizeHeroBrief } = require('../services/heroVideoBrief');

const good = (t) => ({ title: t, emotion: 'Warm', hook: 'A phone buzzes face down.', beats: ['She looks up.', 'She smiles.', 'She taps the screen.'], dialogue: ['One', 'Two', 'Three'], cta: 'Try it today' });

test('ideas are kept short: three beats, at most two spoken lines, three ideas', () => {
  const out = normaliseQuickConcepts({ concepts: [good('A'), good('B'), good('C'), good('D')] });
  assert.equal(out.length, 3);
  assert.equal(out[0].beats.length, 3);
  assert.equal(out[0].dialogue.length, 2);
});

test('long text is cut and ideas without three beats are dropped', () => {
  const long = { ...good('A'), hook: 'x'.repeat(500), beats: ['y'.repeat(900), 'b', 'c'] };
  const out = normaliseQuickConcepts({ concepts: [long, { ...good('B'), beats: ['only one'] }, 'junk', null] });
  assert.equal(out.length, 1);
  assert.ok(out[0].hook.length <= 120 && out[0].beats[0].length <= 160);
  assert.deepEqual(normaliseQuickConcepts(null), []);
});

test('the brief made from an idea passes the existing brief check without a cast', () => {
  const brief = conceptToBrief(normaliseQuickConcepts({ concepts: [good('A')] })[0], { aspectRatio: '9:16', language: 'Tamil' });
  const n = normalizeHeroBrief(brief);
  assert.equal(n.ok, true);
  assert.equal(n.brief.scenes.length, 3);
  assert.equal(n.brief.cast.length, 0);
  assert.equal(n.brief.quick, true);
  assert.equal(normalizeHeroBrief({ ...brief, quick: false }).ok, false);
});

test('both styles map to a real hero style', () => {
  const { isHeroStyle } = require('../services/heroVideoStyles');
  for (const s of Object.values(QUICK_STYLES)) assert.ok(isHeroStyle(s.slug));
});

test('POST /concepts: refuses a missing idea, writes ideas, never charges', async () => {
  const { createHeroVideoRouter } = require('../routes/heroVideo');
  const calls = [];
  const r = createHeroVideoRouter({
    loadBrand: async () => ({ name: 'Nebulaa', industry: 'Marketing' }),
    buildPrompt: async (_u, id, vars) => { calls.push([id, vars]); return 'P'; },
    callTextLLM: async () => ({ concepts: [good('A'), good('B'), good('C')] }),
    parseGeminiJSON: (x) => x
  });
  const layer = r.stack.find((l) => l.route && l.route.path === '/concepts');
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  const call = async (body) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await handler({ user: { id: 'u1' }, body }, res);
    return res;
  };
  assert.equal((await call({ idea: '' })).code, 400);
  assert.equal((await call({ idea: 'Launch our new feature', style: 'weird' })).code, 400);
  const ok = await call({ idea: 'Launch our new feature', style: 'ugc' });
  assert.equal(ok.code, 200);
  assert.equal(ok.body.concepts.length, 3);
  assert.equal(ok.body.style, 'social-media-reel');
  assert.equal(ok.body.concepts[0].brief.quick, true);
  assert.equal(calls[0][0], 'hero_quick.concepts');
});
