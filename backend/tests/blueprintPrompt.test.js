'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PROMPTS, listPrompts, getPrompt, renderTemplate, resolveTemplate } = require('../services/promptRegistry');
const sheet = require('./fixtures/blueprintSheet.json');
const { buildPlanVars } = require('../services/blueprint/planner');
const { normaliseInput } = require('../services/blueprint/input');

const IDS = ['blueprint.plan', 'blueprint.directions'];
const varsIn = (t) => [...new Set([...t.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]))];

test('both Blueprint prompts exist and are locked', () => {
  for (const id of IDS) {
    const p = PROMPTS[id];
    assert.ok(p, id);
    assert.equal(p.locked, true);
    assert.equal(p.stage, 'blueprint');
    assert.ok(p.label && p.summary && p.template && p.variables);
  }
});

test('listPrompts hides locked prompts and still lists ordinary ones', () => {
  const ids = listPrompts().map((p) => p.id);
  assert.ok(!ids.some((id) => id.startsWith('blueprint.')));
  assert.ok(ids.includes('creative.director'));
});

test('a customer override can never replace a locked prompt', async () => {
  const PromptOverride = require('../models/PromptOverride');
  const original = PromptOverride.findOne;
  let looked = 0;
  PromptOverride.findOne = () => { looked += 1; return { lean: async () => ({ template: 'Invent whatever you like.' }) }; };
  try {
    for (const id of IDS) assert.equal(await resolveTemplate('someUserId', id), PROMPTS[id].template);
    assert.equal(looked, 0, 'the override table is never consulted for a locked prompt');
  } finally { PromptOverride.findOne = original; }
});

test('PUT and DELETE /api/prompts refuse locked prompts', () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/prompts.js'), 'utf8');
  const guards = src.match(/if \(!prompt \|\| prompt\.locked\)/g) || [];
  assert.equal(guards.length, 2);
  const router = require('../routes/prompts');
  assert.ok(router);
  // The guard sits in front of the write in both handlers.
  assert.ok(src.indexOf('prompt.locked') < src.indexOf('PromptOverride.findOneAndUpdate'));
});

test('template placeholders and declared variables match exactly', () => {
  for (const id of IDS) {
    const p = PROMPTS[id];
    assert.deepEqual(varsIn(p.template).sort(), Object.keys(p.variables).sort(), id);
  }
  assert.deepEqual(Object.keys(PROMPTS['blueprint.plan'].variables).sort(), ['basis', 'channels', 'competitors', 'facts', 'formats', 'goal', 'territory', 'unverified']);
  assert.deepEqual(Object.keys(PROMPTS['blueprint.directions'].variables).sort(), ['facts', 'goal', 'unverified']);
});

test('the plan template carries the golden rule and the three hard lines', () => {
  const t = PROMPTS['blueprint.plan'].template;
  for (const s of ['THE GOLDEN RULE', 'You cannot mark anything as verified', 'Write no digits in any sentence']) assert.ok(t.includes(s), s);
  assert.ok(PROMPTS['blueprint.directions'].template.includes('THE GOLDEN RULE'));
});

test('rendering the fixture sheet leaves no placeholder and stays small', () => {
  const r = normaliseInput({ businessName: 'Sweet Co', website: 'sweetco.in', whatYouSell: 'Custom cakes baked to order.', whoItsFor: 'Families in Chennai', goal: 'enquiries' });
  const vars = buildPlanVars(sheet, r.input, null);
  const text = renderTemplate(getPrompt('blueprint.plan').template, vars);
  assert.ok(!text.includes('{{'));
  assert.ok(text.length < 14000, String(text.length));
  assert.ok(text.includes('F5 [typed: offer] Offer: Birthday cake, ₹499'));
});
