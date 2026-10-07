const test = require('node:test');
const assert = require('node:assert');
const { createHeroVideoRouter, normalizePlan } = require('../routes/heroVideo');
const router = require('../routes/heroVideo');

const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

function routes(r) {
  return r.stack.filter((l) => l.route).map((l) => ({
    path: l.route.path,
    methods: Object.keys(l.route.methods),
    names: l.route.stack.map((s) => s.name),
    handlers: l.route.stack.map((s) => s.handle)
  }));
}

test('router exposes the seven routes with protect first', () => {
  const found = routes(router.router || router);
  const key = (r) => `${r.methods[0]} ${r.path}`;
  assert.deepStrictEqual(found.map(key).sort(), ['get /jobs', 'get /jobs/:jobId', 'get /quota', 'get /styles', 'post /brief', 'post /generate', 'post /plan']);
  for (const r of found) assert.strictEqual(r.names[0], 'protect', key(r));
  for (const r of found.filter((x) => x.path === '/plan' || x.path === '/generate' || x.path === '/brief')) {
    assert.ok(r.names.includes('checkTrial'), key(r));
  }
});

test('normalizePlan: safe defaults and the v2 fields', () => {
  assert.strictEqual(normalizePlan(null), null);
  assert.strictEqual(normalizePlan({ prompt: '   ' }), null);
  assert.strictEqual(normalizePlan({}), null);
  const p = normalizePlan({ prompt: '  hi ', beatSheet: 'x', qaChecklist: 5, assumptions: null, dialogue: 7, story: 'x', heroCut: {}, shotList: 3, voice: [] });
  assert.deepStrictEqual(p, {
    story: { hook: '', tension: '', turn: '', payoff: '', cta: '' },
    heroCut: [], shotList: [], prompt: 'hi', beatSheet: [], dialogue: '', voice: '', qaChecklist: [], assumptions: []
  });
  const q = normalizePlan({
    prompt: 'a', dialogue: ' yo ', voice: ' warm ',
    story: { hook: ' h ', tension: 't', turn: 'u', payoff: 'p', cta: 'c', extra: 'x' },
    heroCut: [{ sceneId: ' scene-1 ', keep: true, reason: ' r ', time: ' 0-2s ' }, { sceneId: 's2', keep: 'true' }, { sceneId: 's3', keep: 'yes' }, 'junk', { keep: true }],
    shotList: Array.from({ length: 10 }, (_, i) => ({ time: `${i}`, shot: ' wide ', lens: '35mm', purpose: 'p', junk: 1 })),
    beatSheet: [{ time: ' 0-3s ', beat: ' open ', emotion: ' curious ' }, null], qaChecklist: [' a ', 3], assumptions: [' b ']
  });
  assert.deepStrictEqual(q.story, { hook: 'h', tension: 't', turn: 'u', payoff: 'p', cta: 'c' });
  assert.deepStrictEqual(q.heroCut, [
    { sceneId: 'scene-1', keep: true, reason: 'r', time: '0-2s' },
    { sceneId: 's2', keep: true, reason: '', time: '' },
    { sceneId: 's3', keep: false, reason: '', time: '' }
  ]);
  assert.strictEqual(q.shotList.length, 7);
  assert.deepStrictEqual(q.shotList[0], { time: '0', shot: 'wide', lens: '35mm', purpose: 'p' });
  assert.deepStrictEqual(q.beatSheet, [{ time: '0-3s', beat: 'open', emotion: 'curious' }]);
  assert.strictEqual(q.dialogue, 'yo');
  assert.strictEqual(q.voice, 'warm');
  assert.deepStrictEqual(q.qaChecklist, ['a']);
  assert.deepStrictEqual(q.assumptions, ['b']);
});

// ---- /brief and /plan handlers via injected deps ----
function mkRes() {
  return { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}
function handlerFor(deps, path) {
  const r = routes(createHeroVideoRouter(deps)).find((x) => x.path === path);
  return r.handlers[r.handlers.length - 1];
}
const planHandler = (deps) => handlerFor(deps, '/plan');
const briefHandler = (deps) => handlerFor(deps, '/brief');

const CDN = 'https://res.cloudinary.com/demo/image/upload';
const BRAND = {
  name: 'Gravity Cafe', website: 'https://gravity.example', industry: 'Cafe', audience: 'Students', icp: 'Night owls', tone: ['warm'],
  heroProduct: 'Filter coffee', logoUrl: `${CDN}/logo.png`, colors: ['#F5A623'],
  productImages: [{ url: `${CDN}/product.png`, alt: 'Tumbler' }],
  secretField: 'SHOULD_NOT_LEAK'
};
function mkBrief(over = {}) {
  return {
    concept: { title: 'Late shift', storySummary: 'A tired student finds the cafe.', coreEmotion: 'relief', visualStyle: 'warm night' },
    aspectRatio: '9:16', language: 'English',
    cast: [{ id: 'cast-1', name: 'Maya', age: '22', gender: 'female', role: 'student', appearance: 'tall', clothing: 'hoodie', portraitUrl: `${CDN}/maya.png` }],
    environment: { enabled: true, notes: 'corner seat', images: [{ url: `${CDN}/room.png`, alt: 'Room' }] },
    scenes: [
      { sceneId: 'scene-1', title: 'Hook', script: 'Yawn', visual: 'desk', durationSeconds: 5, charactersRequired: ['cast-1'], imageUrl: `${CDN}/kf1.png` },
      { sceneId: 'scene-2', title: 'Turn', script: 'Sip', visual: 'cup', durationSeconds: 5, charactersRequired: ['cast-1'], imageUrl: `${CDN}/kf2.png` }
    ],
    ...over
  };
}
function mkDeps(over = {}) {
  const calls = { stage: [], loadBrand: [], style: [] };
  return {
    calls,
    deps: {
      buildPrompt: async (uid, key, vars) => { calls.build = { uid, key, vars }; return 'PROMPT'; },
      callTextLLM: async (p, o) => { calls.llm = { p, o }; return JSON.stringify({ prompt: ' Shot ', beatSheet: [{ time: '0s', beat: 'x', emotion: 'e' }], heroCut: [{ sceneId: 'scene-1', keep: true }], story: { hook: 'h' } }); },
      parseGeminiJSON: (s) => JSON.parse(s),
      loadBrand: async (uid) => { calls.loadBrand.push(uid); return { ...BRAND, productImages: BRAND.productImages.map((x) => ({ ...x })) }; },
      stageReferences: async (refs) => {
        calls.stage.push(refs.map((r) => ({ ...r })));
        const out = refs.map((r) => (r.dataUrl && !r.url ? { ...r, url: `${CDN}/uploaded-${calls.stage.length}.png`, dataUrl: undefined } : { ...r }));
        out.forEach((r, i) => { delete r.dataUrl; r.tag = `@image${i + 1}`; });
        return { refs: out, dropped: [] };
      },
      getStyleBlock: async (slug, uid) => { calls.style.push({ slug, uid }); return `STYLE_BLOCK_${slug}`; },
      ...over
    }
  };
}
const PEOPLE = [`${CDN}/maya.png`, `${CDN}/kf1.png`, `${CDN}/kf2.png`];
const reqOf = (body) => ({ user: { id: 'u1' }, body });

test('/brief: missing cast -> 400 with the plain message, no staging', async () => {
  const { deps, calls } = mkDeps();
  const res = mkRes();
  await briefHandler(deps)(reqOf({ brief: mkBrief({ cast: [] }) }), res);
  assert.strictEqual(res.code, 400);
  assert.deepStrictEqual(res.body, { success: false, message: 'Create your cast first: finish the cast step, then make the hero video.' });
  assert.strictEqual(calls.stage.length, 0);
  assert.strictEqual(calls.build, undefined);
});

test('/brief: staged references numbered @image1.. and a whitelisted brand summary', async () => {
  const { deps, calls } = mkDeps();
  const res = mkRes();
  await briefHandler(deps)(reqOf({ brief: mkBrief(), brand: { name: 'Evil', logoUrl: 'https://evil.example/x.png' } }), res);
  assert.strictEqual(res.code, 200);
  assert.strictEqual(res.body.success, true);
  assert.deepStrictEqual(calls.loadBrand, ['u1']);
  assert.deepStrictEqual(Object.keys(res.body.brand).sort(), ['colors', 'heroProduct', 'logoUrl', 'name', 'website']);
  assert.strictEqual(res.body.brand.name, 'Gravity Cafe');
  assert.ok(!JSON.stringify(res.body).includes('SHOULD_NOT_LEAK'));
  assert.ok(!JSON.stringify(res.body).includes('evil.example'));
  const refs = res.body.references;
  assert.deepStrictEqual(refs.map((r) => r.tag), refs.map((_, i) => `@image${i + 1}`));
  assert.deepStrictEqual(refs.map((r) => r.kind), ['environment', 'brand', 'brand']);
  assert.deepStrictEqual(res.body.peoplePhotos.map((r) => [r.kind, r.url, r.mayShowPeople]), [['cast', `${CDN}/maya.png`, true], ['keyframe', `${CDN}/kf1.png`, true], ['keyframe', `${CDN}/kf2.png`, true]]);
  for (const r of refs) assert.deepStrictEqual(Object.keys(r).sort(), ['kind', 'label', 'source', 'tag', 'url']);
  assert.deepStrictEqual(res.body.dropped, []);
  assert.strictEqual(res.body.brief.cast[0].name, 'Maya');
  assert.strictEqual(calls.build, undefined, 'no LLM work on /brief');
});

test('/brief: environment data URLs come back replaced by their staged URL', async () => {
  const { deps } = mkDeps();
  const res = mkRes();
  const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
  await briefHandler(deps)(reqOf({ brief: mkBrief({ environment: { enabled: true, notes: '', images: [{ dataUrl, alt: 'Shop' }] } }) }), res);
  assert.strictEqual(res.code, 200);
  const env = res.body.references.find((r) => r.kind === 'environment');
  assert.match(env.url, /uploaded-1\.png$/);
  assert.deepStrictEqual(res.body.brief.environment.images, [{ url: env.url, alt: 'Shop' }]);
  assert.ok(!JSON.stringify(res.body).includes('base64'));
});

test('/plan: missing brief or cast -> 400', async () => {
  const { deps } = mkDeps();
  const res = mkRes();
  await planHandler(deps)(reqOf({}), res);
  assert.strictEqual(res.code, 400);
  const res2 = mkRes();
  await planHandler(deps)(reqOf({ brief: mkBrief({ cast: [] }) }), res2);
  assert.strictEqual(res2.code, 400);
  assert.match(res2.body.message, /Create your cast first/);
});

test('/plan: bad aspect, audioMode, style, ctaText, references -> 400 without any LLM call', async () => {
  const bad = [
    { brief: mkBrief({ aspectRatio: '4:3' }) },
    { brief: mkBrief(), audioMode: 'loud' },
    { brief: mkBrief(), audioMode: 7 },
    { brief: mkBrief(), style: 'not-a-style' },
    { brief: mkBrief(), style: 'Cinematic Commercial' },
    { brief: mkBrief(), ctaText: 'x'.repeat(61) },
    { brief: mkBrief(), ctaText: 5 },
    { brief: mkBrief(), references: 'https://a' },
    { brief: mkBrief(), keptSceneIds: 'scene-1' }
  ];
  for (const body of bad) {
    const { deps, calls } = mkDeps();
    const res = mkRes();
    await planHandler(deps)(reqOf(body), res);
    assert.strictEqual(res.code, 400, JSON.stringify(Object.keys(body)));
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.message);
    assert.strictEqual(calls.llm, undefined);
  }
});

test('/plan no prompt from model -> 502', async () => {
  const { deps } = mkDeps({ callTextLLM: async () => '{"prompt":""}' });
  const res = mkRes();
  await planHandler(deps)(reqOf({ brief: mkBrief() }), res);
  assert.strictEqual(res.code, 502);
});

test('/plan LLM throws -> 500', async () => {
  const { deps } = mkDeps({ callTextLLM: async () => { throw new Error('boom'); } });
  const res = mkRes();
  await quiet(() => planHandler(deps)(reqOf({ brief: mkBrief() }), res));
  assert.strictEqual(res.code, 500);
  assert.strictEqual(res.body.success, false);
});

test('/plan happy path: blocks, style, audio and references reach buildPrompt', async () => {
  const { deps, calls } = mkDeps();
  const res = mkRes();
  await planHandler(deps)(reqOf({ brief: mkBrief(), style: 'daily-life-vlog', audioMode: 'sfx_only', ctaText: ' Visit tonight ', includePeoplePhotos: PEOPLE }), res);
  assert.strictEqual(res.code, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.plan.prompt, 'Shot');
  assert.deepStrictEqual(res.body.plan.beatSheet, [{ time: '0s', beat: 'x', emotion: 'e' }]);
  assert.deepStrictEqual(res.body.plan.heroCut, [{ sceneId: 'scene-1', keep: true, reason: '', time: '' }]);
  assert.strictEqual(res.body.plan.story.hook, 'h');
  assert.strictEqual(calls.build.key, 'hero_video.plan');
  assert.strictEqual(calls.build.uid, 'u1');
  assert.deepStrictEqual(calls.style, [{ slug: 'daily-life-vlog', uid: 'u1' }]);
  const v = calls.build.vars;
  assert.deepStrictEqual(Object.keys(v).sort(), ['aspectRatio', 'audioMode', 'brandBlock', 'brandContextBlock', 'brandName', 'castBlock',
    'conceptEmotion', 'conceptStory', 'conceptTitle', 'conceptVisualStyle', 'ctaText', 'duration', 'environmentBlock', 'language',
    'referencesBlock', 'scenesBlock', 'styleBlock'].sort());
  assert.strictEqual(v.styleBlock, 'STYLE_BLOCK_daily-life-vlog');
  assert.match(v.audioMode, /no music/i);
  assert.match(v.ctaText, /Visit tonight/);
  assert.strictEqual(v.brandName, 'Gravity Cafe');
  assert.match(v.brandContextBlock, /Gravity Cafe/);
  assert.match(v.castBlock, /Maya[\s\S]*@image1/);
  assert.match(v.environmentBlock, /corner seat/);
  assert.match(v.environmentBlock, /@image2/);
  assert.match(v.brandContextBlock, /Hero product: Filter coffee/);
  assert.match(v.brandBlock, /Hero product[^\n]*@image3/);
  assert.match(v.brandBlock, /Logo @image4/);
  assert.match(v.brandBlock, /#F5A623/);
  assert.match(v.scenesBlock, /\[S1\] Hook/);
  assert.match(v.scenesBlock, /\[S2\] Turn/);
  assert.match(v.referencesBlock, /@image1[^\n]*Maya/);
  assert.strictEqual(v.conceptTitle, 'Late shift');
  assert.strictEqual(v.aspectRatio, '9:16');
  assert.strictEqual(v.duration, '15');
  assert.deepStrictEqual(calls.llm.o, { jsonMode: true, maxTokens: 6000 });
  assert.deepStrictEqual(res.body.references.map((r) => r.tag), res.body.references.map((_, i) => `@image${i + 1}`));
  for (const r of res.body.references) assert.deepStrictEqual(Object.keys(r).sort(), ['kind', 'label', 'source', 'tag', 'url']);
});

test('/plan defaults: cinematic-commercial style and native audio with a music line', async () => {
  const { deps, calls } = mkDeps();
  const res = mkRes();
  await planHandler(deps)(reqOf({ brief: mkBrief() }), res);
  assert.strictEqual(res.code, 200);
  assert.deepStrictEqual(calls.style, [{ slug: 'cinematic-commercial', uid: 'u1' }]);
  assert.match(calls.build.vars.audioMode, /music/i);
  assert.doesNotMatch(calls.build.vars.audioMode, /no music/i);
});

test('/plan ignores any brand in the body; brand comes from loadBrand(user)', async () => {
  const { deps, calls } = mkDeps();
  const res = mkRes();
  const evil = { name: 'EvilCorp', logoUrl: 'https://evil.example/logo.png', productImages: [{ url: 'https://evil.example/p.png' }], heroProduct: 'EVIL_PRODUCT' };
  await planHandler(deps)(reqOf({ brief: { ...mkBrief(), brand: evil }, brand: evil, references: ['https://evil.example/logo.png', 'https://evil.example/p.png'] }), res);
  assert.strictEqual(res.code, 200);
  assert.deepStrictEqual(calls.loadBrand, ['u1']);
  const text = JSON.stringify(calls.build.vars) + JSON.stringify(res.body);
  for (const bad of ['EvilCorp', 'evil.example', 'EVIL_PRODUCT']) assert.ok(!text.includes(bad), bad);
});

test('/plan reference selection can only choose from the server-staged set', async () => {
  const { deps, calls } = mkDeps();
  const res = mkRes();
  const references = [`${CDN}/product.png`, 'https://attacker.example/x.png', `${CDN}/maya.png`, `${CDN}/maya.png`, 'not a url'];
  await planHandler(deps)(reqOf({ brief: mkBrief(), references, includePeoplePhotos: PEOPLE }), res);
  assert.strictEqual(res.code, 200);
  // only the two staged URLs the user kept, in the user's order, re-tagged from @image1
  assert.deepStrictEqual(res.body.references.map((r) => [r.tag, r.url]), [['@image1', `${CDN}/product.png`], ['@image2', `${CDN}/maya.png`]]);
  assert.deepStrictEqual(calls.stage[0].map((r) => r.url), [`${CDN}/product.png`, `${CDN}/maya.png`]);
  assert.ok(!JSON.stringify(calls.build.vars).includes('attacker.example'));
  assert.match(calls.build.vars.referencesBlock, /@image1[^\n]*product/i);
  // an empty selection means no references at all
  const { deps: d2, calls: c2 } = mkDeps();
  const res2 = mkRes();
  await planHandler(d2)(reqOf({ brief: mkBrief(), references: [] }), res2);
  assert.deepStrictEqual(res2.body.references, []);
  assert.match(c2.build.vars.referencesBlock, /no reference images/i);
});

test('/plan keptSceneIds limit keyframes to the kept scenes and mark them in the scenes block', async () => {
  const { deps, calls } = mkDeps();
  const res = mkRes();
  await planHandler(deps)(reqOf({ brief: mkBrief(), keptSceneIds: ['scene-2'], includePeoplePhotos: PEOPLE }), res);
  assert.strictEqual(res.code, 200);
  const kf = res.body.references.filter((r) => r.kind === 'keyframe').map((r) => r.url);
  assert.deepStrictEqual(kf, [`${CDN}/kf2.png`]);
  assert.match(calls.build.vars.scenesBlock, /\[S2\] KEEP/);
  assert.match(calls.build.vars.scenesBlock, /\[S1\] \(dropped\)/);
});

test('/plan heroCut maps S-labels back to real scene ids and drops unknown ones', async () => {
  const { deps } = mkDeps({ callTextLLM: async () => JSON.stringify({ prompt: 'p', heroCut: [{ sceneId: 'scene-1', keep: true }, { sceneId: 'S2', keep: false }, { sceneId: 'S9', keep: true }, { sceneId: 'ghost', keep: true }] }) });
  const res = mkRes();
  await planHandler(deps)(reqOf({ brief: mkBrief() }), res);
  assert.deepStrictEqual(res.body.plan.heroCut.map((h) => [h.sceneId, h.keep]), [['scene-1', true], ['scene-2', false]]);
});

test('/plan ignores keptSceneIds that are not in the brief; none left means no preference', async () => {
  const { deps, calls } = mkDeps();
  const res = mkRes();
  await planHandler(deps)(reqOf({ brief: mkBrief(), keptSceneIds: ['ghost', 'other'], includePeoplePhotos: PEOPLE }), res);
  assert.strictEqual(res.code, 200);
  assert.doesNotMatch(calls.build.vars.scenesBlock, /KEEP|\(dropped\)/);
  assert.deepStrictEqual(res.body.references.filter((r) => r.kind === 'keyframe').map((r) => r.url), [`${CDN}/kf1.png`, `${CDN}/kf2.png`]);
  const { deps: d2, calls: c2 } = mkDeps();
  await planHandler(d2)(reqOf({ brief: mkBrief(), keptSceneIds: ['ghost', 'scene-2'] }), mkRes());
  assert.match(c2.build.vars.scenesBlock, /\[S2\] KEEP/);
  assert.match(c2.build.vars.scenesBlock, /\[S1\] \(dropped\)/);
});

test('/plan CastError -> 404', async () => {
  const { deps } = mkDeps({ loadBrand: async () => { const e = new Error('x'); e.name = 'CastError'; throw e; } });
  const res = mkRes();
  await planHandler(deps)(reqOf({ brief: mkBrief() }), res);
  assert.strictEqual(res.code, 404);
});

// ---- Ruling 7: jobs / generate / poll / middleware order ----
function routeHandler(impl, path, method) {
  const r = routes(createHeroVideoRouter(mkDeps().deps, impl)).find((x) => x.path === path && x.methods[0] === method);
  return r.handlers[r.handlers.length - 1];
}

test('GET /jobs returns only whitelisted fields and filters by owner + kind', async () => {
  let seen = null;
  const rows = [
    { jobId: 'a', status: 'completed', createdAt: 'T1', userId: 'u1', result: { videoUrl: 'http://v' }, payload: { prompt: 'P', refImageUrls: ['x'] }, metadata: { kind: 'hero', falRequestId: 'fal1' }, error: { stack: 'S' } },
    { jobId: 'b', status: 'failed', createdAt: 'T0', result: { videoUrl: 'http://no' }, payload: {}, metadata: { falRequestId: 'fal2' }, error: { message: 'm', stack: 'S2' } }
  ];
  const JobModel = { find(f) { seen = { filter: f }; const q = { sort(s) { seen.sort = s; return q; }, limit(n) { seen.limit = n; return q; }, lean: async () => rows }; return q; } };
  const res = mkRes();
  await routeHandler({ JobModel }, '/jobs', 'get')({ user: { id: 'u1' } }, res);
  assert.deepStrictEqual(seen, { filter: { userId: 'u1', 'metadata.kind': 'hero' }, sort: { createdAt: -1 }, limit: 20 });
  assert.deepStrictEqual(res.body.jobs, [
    { jobId: 'a', status: 'completed', createdAt: 'T1', videoUrl: 'http://v', prompt: 'P' },
    { jobId: 'b', status: 'failed', createdAt: 'T0' }
  ]);
  const text = JSON.stringify(res.body);
  for (const bad of ['falRequestId', 'metadata', 'payload', 'stack', 'fal1']) assert.ok(!text.includes(bad), bad);
});

test('GET /jobs whitelist includes rawVideoUrl and finishError, still nothing internal', async () => {
  const rows = [{ jobId: 'a', status: 'completed', createdAt: 'T1', result: { videoUrl: 'http://v', rawVideoUrl: 'http://raw', finishError: 'Plain.' }, payload: { prompt: 'P', finish: { realism: true } }, metadata: { falRequestId: 'fal1' }, error: { stack: 'S' } }];
  const JobModel = { find() { const q = { sort: () => q, limit: () => q, lean: async () => rows }; return q; } };
  const res = mkRes();
  await routeHandler({ JobModel }, '/jobs', 'get')({ user: { id: 'u1' } }, res);
  assert.deepStrictEqual(res.body.jobs, [{ jobId: 'a', status: 'completed', createdAt: 'T1', videoUrl: 'http://v', rawVideoUrl: 'http://raw', finishError: 'Plain.', prompt: 'P' }]);
  const text = JSON.stringify(res.body);
  for (const bad of ['falRequestId', 'metadata', 'payload', 'stack', 'fal1', 'realism']) assert.ok(!text.includes(bad), bad);
});

test('GET /jobs/:jobId CastError -> 404', async () => {
  const pollHeroJob = async () => { const e = new Error('bad id'); e.name = 'CastError'; throw e; };
  const res = mkRes();
  await routeHandler({ pollHeroJob, deps: {} }, '/jobs/:jobId', 'get')({ user: { id: 'u1' }, params: { jobId: 'zzz' } }, res);
  assert.strictEqual(res.code, 404);
  assert.strictEqual(res.body.success, false);
});

test('POST /generate and poll send {status,json} verbatim', async () => {
  const out = { status: 403, json: { success: false, creditsExhausted: true, extra: 1 } };
  let args;
  const startHeroGeneration = async (d, a) => { args = { d, a }; return out; };
  const res = mkRes();
  await routeHandler({ startHeroGeneration, deps: { tag: 'D' } }, '/generate', 'post')({ user: { id: 'u1' }, body: { prompt: 'p' } }, res);
  assert.strictEqual(res.code, 403);
  assert.deepStrictEqual(res.body, out.json);
  assert.deepStrictEqual(args, { d: { tag: 'D' }, a: { userId: 'u1', body: { prompt: 'p' } } });
  const pollHeroJob = async () => ({ status: 202, json: { success: true, status: 'processing' } });
  const res2 = mkRes();
  await routeHandler({ pollHeroJob, deps: {} }, '/jobs/:jobId', 'get')({ user: { id: 'u1' }, params: { jobId: 'j' } }, res2);
  assert.strictEqual(res2.code, 202);
  assert.deepStrictEqual(res2.body, { success: true, status: 'processing' });
});

test('checkTrial before handler on exactly /brief, /plan and /generate; limiter on every route', () => {
  for (const r of routes(router)) {
    const idx = r.names.indexOf('checkTrial');
    const wants = r.path === '/plan' || r.path === '/generate' || r.path === '/brief';
    assert.strictEqual(idx !== -1, wants, r.path);
    if (wants) assert.ok(idx < r.names.length - 1 && idx > 0, r.path);
    assert.ok(r.names.length >= 3 && r.names[r.names.length - 2] !== 'protect' || r.names.length >= 3, r.path);
    assert.ok(r.names.slice(1, -1).some((n) => n !== 'checkTrial'), `limiter on ${r.path}`);
  }
});

// ---- C2(a): GET /jobs reconciles non-terminal rows through the real poll flow ----
const { makeDeps: makeFlowDeps } = require('./heroFakes');
async function seedJob(d, jobId, over = {}) {
  await d.JobModel.create({
    jobId, userId: 'u1', status: 'processing', createdAt: d.now(), payload: { prompt: 'P-' + jobId, model: 'm' },
    metadata: { kind: 'hero', refunded: false, falRequestId: 'fal-' + jobId }, ...over
  });
}
async function listVia(d, impl = {}) {
  const res = mkRes();
  await routeHandler({ deps: d, JobModel: d.JobModel, ...impl }, '/jobs', 'get')({ user: { id: 'u1' } }, res);
  return res;
}

test('GET /jobs: completed-on-fal job is finished and returned with videoUrl', async () => {
  const d = makeFlowDeps({ getStatus: async () => ({ state: 'completed', videoUrl: 'https://fal/v.mp4' }) });
  await seedJob(d, 'j1');
  const res = await listVia(d);
  assert.strictEqual(res.code, 200);
  assert.deepStrictEqual(res.body.jobs, [{ jobId: 'j1', status: 'completed', createdAt: d.JobModel.docs[0].createdAt, videoUrl: 'https://cdn.example/stored.mp4', prompt: 'P-j1' }]);
  assert.strictEqual(d.calls.copy.length, 1);
});

test('GET /jobs: failed-on-fal job is failed and refunded once', async () => {
  const d = makeFlowDeps({ getStatus: async () => ({ state: 'failed', error: 'nsfw' }) });
  await seedJob(d, 'j1');
  const res = await listVia(d);
  assert.strictEqual(res.body.jobs[0].status, 'failed');
  await listVia(d);
  assert.strictEqual(d.calls.refund.length, 1);
});

test('GET /jobs: a per-row reconcile error does not break the list', async () => {
  const d = makeFlowDeps();
  await seedJob(d, 'bad');
  await seedJob(d, 'good', { status: 'completed', result: { videoUrl: 'https://v' } });
  const pollHeroJob = async () => { throw new Error('mongo blip'); };
  const res = await quiet(() => listVia(d, { pollHeroJob }));
  assert.strictEqual(res.code, 200);
  assert.deepStrictEqual(res.body.jobs.map((j) => [j.jobId, j.status]).sort(), [['bad', 'processing'], ['good', 'completed']]);
});

test('GET /jobs reconciles at most 3 non-terminal rows and skips terminal ones', async () => {
  const d = makeFlowDeps();
  for (const id of ['a', 'b', 'c', 'e']) await seedJob(d, id);
  await seedJob(d, 'done', { status: 'completed', result: { videoUrl: 'https://v' } });
  const polled = [];
  const pollHeroJob = async (deps, a) => { polled.push(a); return { status: 200, json: { success: true, status: 'processing' } }; };
  await listVia(d, { pollHeroJob });
  assert.strictEqual(polled.length, 3);
  for (const p of polled) assert.strictEqual(p.userId, 'u1');
  assert.ok(!polled.some((p) => p.jobId === 'done'));
});

// ---- M1: 500s never echo internal error text ----
test('500 responses use a fixed generic message', async () => {
  const { deps } = mkDeps({ callTextLLM: async () => { throw new Error('E11000 duplicate key mongo internals'); } });
  const res = mkRes();
  await quiet(() => planHandler(deps)(reqOf({ brief: mkBrief() }), res));
  assert.strictEqual(res.code, 500);
  assert.deepStrictEqual(res.body, { success: false, message: 'Something went wrong. Please try again.' });
  const res2 = mkRes();
  const startHeroGeneration = async () => { throw new Error('secret internals'); };
  await quiet(() => routeHandler({ startHeroGeneration, deps: {} }, '/generate', 'post')({ user: { id: 'u1' }, body: { prompt: 'p' } }, res2));
  assert.strictEqual(res2.code, 500);
  assert.strictEqual(res2.body.message, 'Something went wrong. Please try again.');
});

test('POST /generate forwards refImageUrls and references untouched and relays a 400 verbatim', async () => {
  const body = { prompt: 'p', refImageUrls: ['https://cdn.example.com/a.png'], references: [{ tag: '@a', kind: 'logo', label: 'A', url: 'https://cdn.example.com/a.png' }] };
  let seen;
  const startHeroGeneration = async (d, a) => { seen = a; return { status: 400, json: { success: false, message: 'At most 9 reference images allowed' } }; };
  const res = mkRes();
  await routeHandler({ startHeroGeneration, deps: {} }, '/generate', 'post')({ user: { id: 'u1' }, body }, res);
  assert.deepStrictEqual(seen.body, body);
  assert.strictEqual(res.code, 400);
  assert.strictEqual(res.body.message, 'At most 9 reference images allowed');
});

test('/plan default sends no people photos; an opt-in list adds only the staged ones asked for', async () => {
  const { deps, calls } = mkDeps();
  const res = mkRes();
  await planHandler(deps)(reqOf({ brief: mkBrief() }), res);
  assert.deepStrictEqual(res.body.references.map((r) => r.kind), ['environment', 'brand', 'brand']);
  assert.doesNotMatch(calls.build.vars.castBlock, /@image/);
  assert.match(calls.build.vars.castBlock, /Maya/);
  const { deps: d2 } = mkDeps();
  const res2 = mkRes();
  await planHandler(d2)(reqOf({ brief: mkBrief(), includePeoplePhotos: [`${CDN}/maya.png`, 'https://attacker.example/x.png'] }), res2);
  assert.deepStrictEqual(res2.body.references.filter((r) => r.mayShowPeople !== undefined || r.kind === 'cast' || r.kind === 'keyframe').map((r) => r.url), [`${CDN}/maya.png`]);
  const bad = mkRes();
  await planHandler(mkDeps().deps)(reqOf({ brief: mkBrief(), includePeoplePhotos: 'yes' }), bad);
  assert.strictEqual(bad.code, 400);
});
