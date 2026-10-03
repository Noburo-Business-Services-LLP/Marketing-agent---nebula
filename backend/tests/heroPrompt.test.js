const test = require('node:test');
const assert = require('node:assert/strict');
const { PROMPTS, buildPrompt } = require('../services/promptRegistry');

const ID = 'hero_video.plan';
const VARS = [
  'brandContextBlock', 'conceptTitle', 'conceptStory', 'conceptEmotion',
  'conceptVisualStyle', 'duration', 'aspectRatio', 'language', 'hasReferences'
];

test('hero_video.plan is registered on the hero-video stage', () => {
  const p = PROMPTS[ID];
  assert.ok(p, 'entry exists');
  assert.equal(p.stage, 'hero-video');
  assert.deepEqual(Object.keys(p.variables).sort(), [...VARS].sort());
});

test('every {{placeholder}} in the template is a declared variable', () => {
  const p = PROMPTS[ID];
  const used = [...p.template.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);
  assert.ok(used.length > 0);
  for (const name of used) assert.ok(name in p.variables, `undeclared: ${name}`);
  for (const name of VARS) assert.ok(used.includes(name), `unused: ${name}`);
});

test('template names the 11 blocks, budget rule, integrity rules and JSON keys', () => {
  const t = PROMPTS[ID].template;
  for (const b of ['LOOK', 'CONTEXT', 'REFS', 'HEADCOUNT', 'CAMERA', 'STAGING', 'ACTION', 'ACTING', 'DIALOGUE', 'SFX', 'NEGATIVES']) {
    assert.ok(t.includes(b), `block ${b}`);
  }
  assert.match(t, /35-40 words/);
  assert.match(t, /never invent statistics/i);
  assert.match(t, /real customers/i);
  assert.match(t, /@image1/);
  for (const k of ['"prompt"', '"beatSheet"', '"time"', '"beat"', '"dialogue"', '"qaChecklist"', '"assumptions"']) {
    assert.ok(t.includes(k), `json key ${k}`);
  }
});

test('buildPrompt fills all variables without touching the DB', async () => {
  const vars = Object.fromEntries(VARS.map((v) => [v, `VAL_${v}`]));
  const out = await buildPrompt(null, ID, vars);
  for (const v of VARS) assert.ok(out.includes(`VAL_${v}`), v);
  assert.ok(!/\{\{/.test(out));
});
