const test = require('node:test');
const assert = require('node:assert/strict');
const { selectReferences } = require('../services/heroVideoBrief');
const { buildHeroInput, describeFalError, customerFailureMessage, PEOPLE_REFUSAL_MESSAGE } = require('../services/heroVideoService');
const { buildPlanVars } = require('../routes/heroVideo');
const { buildPrompt } = require('../services/promptRegistry');
const { pollHeroJob, startHeroGeneration } = require('../services/heroVideoFlow');
const { makeDeps } = require('./heroFakes');

const CDN = 'https://res.cloudinary.com/demo/image/upload';
const brief = () => ({
  aspectRatio: '9:16',
  concept: { title: 'T', storySummary: 'S', coreEmotion: 'E', visualStyle: 'V' },
  cast: [
    { id: 'c1', name: 'Maya', age: '22', gender: 'female', role: 'student', appearance: 'tall, freckles', clothing: 'green hoodie', hairStyle: 'bun', hairColor: 'black', personality: 'shy', portraitUrl: `${CDN}/maya.png` },
    { id: 'c2', name: 'Ravi', age: '30', gender: 'male', role: 'barista', appearance: 'beard', clothing: 'apron', portraitUrl: `${CDN}/ravi.png` }
  ],
  castSheetUrl: `${CDN}/sheet.png`,
  environment: { enabled: true, notes: 'corner seat', images: [{ url: `${CDN}/room.png`, alt: 'Room' }] },
  scenes: [
    { sceneId: 's1', title: 'Hook', script: 'Yawn', visual: 'desk', durationSeconds: 5, charactersRequired: ['c1'], imageUrl: `${CDN}/kf1.png` },
    { sceneId: 's2', title: 'Turn', script: 'Sip', visual: 'cup', durationSeconds: 5, charactersRequired: ['c1', 'c2'], imageUrl: `${CDN}/kf2.png` }
  ]
});
const brand = () => ({ name: 'B', logoUrl: `${CDN}/logo.png`, productImages: [{ url: `${CDN}/p.png`, alt: 'Tumbler' }] });

test('default reference set has no cast or keyframe images, even when portraits and scene stills exist', () => {
  const refs = selectReferences(brief(), brand());
  assert.deepEqual(refs.map((r) => r.kind), ['environment', 'brand', 'brand']);
  assert.deepEqual(refs.map((r) => r.tag), ['@image1', '@image2', '@image3']);
  assert.ok(!refs.some((r) => r.kind === 'cast' || r.kind === 'keyframe' || r.source === 'cast-sheet'));
});

test('people photos join only when opted in, and only the ones asked for', () => {
  const all = selectReferences(brief(), brand(), { includePeople: true });
  assert.ok(all.some((r) => r.kind === 'cast') && all.some((r) => r.kind === 'keyframe'));
  for (const r of all) assert.equal(Boolean(r.mayShowPeople), r.kind === 'cast' || r.kind === 'keyframe');
  const one = selectReferences(brief(), brand(), { includePeople: [`${CDN}/maya.png`, 'https://evil.example/x.png'] });
  assert.deepEqual(one.map((r) => r.url).filter((u) => /maya|ravi|kf|sheet|evil/.test(u)), [`${CDN}/maya.png`]);
  assert.deepEqual(selectReferences(brief(), brand(), { includePeople: false }).map((r) => r.kind), ['environment', 'brand', 'brand']);
});

test('an empty set goes to the text model with no image_urls', () => {
  const b = brief(); b.environment.enabled = false;
  const refs = selectReferences(b, {});
  assert.equal(refs.length, 0);
  const built = buildHeroInput({ prompt: 'p', refImageUrls: refs.map((r) => r.url) });
  assert.match(built.model, /text-to-video/);
  assert.equal(built.input.image_urls, undefined);
});

test('planner prompt for a cast-only brief names every character in words and has no @image tag', async () => {
  const b = brief(); b.environment.enabled = false;
  const refs = selectReferences(b, {});
  const vars = buildPlanVars({ brief: b, brand: {}, refs, styleBlock: 'S', audioMode: 'native', ctaText: '' });
  const out = await buildPrompt(null, 'hero_video.plan', vars);
  assert.doesNotMatch(vars.castBlock, /@image/);
  assert.doesNotMatch(vars.referencesBlock, /@image/);
  assert.match(vars.castBlock, /Maya[^\n]*22[^\n]*\n?[^\n]*tall, freckles/);
  assert.match(vars.castBlock, /green hoodie/);
  assert.match(vars.castBlock, /Manner: shy/);
  assert.match(vars.castBlock, /same (clothing|wardrobe)/i);
  assert.match(vars.castBlock, /Ravi/);
  // the template's own example must not tag a person either
  assert.doesNotMatch(out, /@image\d[^\n]*(MAYA|face)/);
});

test('with product and logo references only, tags exist for those and none for people', () => {
  const refs = selectReferences(brief(), brand());
  const vars = buildPlanVars({ brief: brief(), brand: brand(), refs, styleBlock: 'S', audioMode: 'native', ctaText: '' });
  assert.match(vars.referencesBlock, /@image2[^\n]*product/i);
  assert.match(vars.brandBlock, /@image2/);
  assert.doesNotMatch(vars.castBlock, /@image/);
});

const REFUSAL = 'Unprocessable Entity: The images or videos provided may contain likenesses of real people or other private information that cannot be processed.';

test('the likeness refusal is detected and turned into a plain customer message with no vendor name', () => {
  assert.equal(customerFailureMessage(REFUSAL), PEOPLE_REFUSAL_MESSAGE);
  assert.equal(PEOPLE_REFUSAL_MESSAGE, 'The video model cannot use photos that show people. We have refunded your Quarks. Try again without the people photos, or use the default setting.');
  assert.doesNotMatch(PEOPLE_REFUSAL_MESSAGE, /fal|seedance|bytedance/i);
  assert.equal(customerFailureMessage('something else'), 'something else');
  const err = Object.assign(new Error('Unprocessable Entity'), { status: 422, body: { detail: [{ msg: 'The images or videos provided may contain likenesses of real people or other private information that cannot be processed.' }] } });
  assert.equal(customerFailureMessage(describeFalError(err)), PEOPLE_REFUSAL_MESSAGE);
});

test('a refused job refunds once, shows the plain message, and keeps the raw reason in the stored job', async () => {
  const d = makeDeps();
  const r0 = await startHeroGeneration(d, { userId: 'u1', body: { prompt: 'a hero shot' } });
  d.getStatus = async () => ({ state: 'failed', error: REFUSAL });
  const r = await pollHeroJob(d, { userId: 'u1', jobId: r0.json.jobId });
  assert.equal(r.json.status, 'failed');
  assert.equal(r.json.error, PEOPLE_REFUSAL_MESSAGE);
  const again = await pollHeroJob(d, { userId: 'u1', jobId: r0.json.jobId });
  assert.equal(again.json.error, PEOPLE_REFUSAL_MESSAGE);
  assert.equal(d.calls.refund.length, 1);
  assert.match(d.JobModel.docs[0].error.message, /likenesses of real people/);
});
