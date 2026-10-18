const test = require('node:test');
const assert = require('node:assert');
const sv = require('../services/studioVideo');
const omni = require('../services/omniVideo');
const { QUARK_COSTS, STUDIO_CLIP_SECONDS, ACTION_USD } = require('../config/apiCosts');

test('a studio video is priced from the Omni rate, with the video margin', () => {
  assert.strictEqual(STUDIO_CLIP_SECONDS, 10);
  assert.ok(ACTION_USD.studio_video >= 1.0 && ACTION_USD.studio_video < 1.1);
  assert.strictEqual(QUARK_COSTS.studio_video, Math.round((ACTION_USD.studio_video * 3.2) / 0.02));
});

test('the prompt carries the owner words, the spoken line and the reference rules, and nothing invented', () => {
  const p = sv.assemblePrompt({ concept: 'Shop owner shows a gift box.', beats: ['close up', 'smile'], spokenLine: 'Fresh sweets daily.', style: 'product', language: 'tamil', aspectRatio: '9:16', hasProductPhoto: true, hasPersonPhoto: true, brandName: 'Sri Lakshmi' });
  assert.match(p, /Vertical 9:16/);
  assert.match(p, /Shop owner shows a gift box\./);
  assert.match(p, /says clearly in Tamil, saying exactly these words, word for word, without adding, dropping or changing any word: "Fresh sweets daily\."/);
  assert.match(p, /reference photo/);
  assert.match(p, /do not invent logos, prices or other text/);
});

test('the planner is told to keep dialogue the owner wrote word for word', () => {
  const q = sv.buildConceptPrompt({ idea: 'Owner says "Fresh sweets, made this morning, free delivery above 500 rupees in Adyar."', style: 'natural', language: 'english', brand: {} });
  assert.match(q, /MUST be exactly those words, copied unchanged/);
  assert.match(q, /exact words from the idea if it gives any/);
});

test('no language means music only, whatever line is passed', () => {
  const p = sv.assemblePrompt({ concept: 'x', spokenLine: 'ignored', style: 'cinematic', language: 'none', aspectRatio: '9:16' });
  assert.match(p, /No spoken words/);
  assert.doesNotMatch(p, /ignored/);
});

test('unknown style and language fall back to safe values', () => {
  assert.strictEqual(sv.styleOf('weird'), sv.DEFAULT_STYLE);
  assert.strictEqual(sv.languageOf('klingon'), 'english');
});

test('the concept parser survives wrapped and broken JSON', () => {
  const ok = sv.parseConcept('Sure!\n{"title":"Diwali box","concept":"A hand opens the box.","beats":["a","b","c","d","e"],"spokenLine":"Hello"}');
  assert.strictEqual(ok.title, 'Diwali box');
  assert.strictEqual(ok.beats.length, 4);
  assert.deepStrictEqual(sv.parseConcept('nonsense'), { title: '', concept: '', beats: [], spokenLine: '' });
});

test('the Omni client turns a quota error into a friendly retryable message and a safety block into a clear one', async () => {
  process.env.GEMINI_API_KEY = 'test';
  const quota = await omni.interact([{ type: 'text', text: 'x' }], {}, { fetch: async () => ({ ok: false, status: 429, json: async () => ({ error: { status: 'RESOURCE_EXHAUSTED' } }) }) });
  assert.strictEqual(quota.ok, false);
  assert.match(quota.message, /Quarks were returned/);
  const blocked = await omni.interact([{ type: 'text', text: 'x' }], {}, { fetch: async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'blocked by safety policy' } }) }) });
  assert.match(blocked.message, /change the wording/);
  const good = await omni.interact([{ type: 'text', text: 'x' }], {}, { fetch: async () => ({ ok: true, status: 200, json: async () => ({ steps: [{ type: 'model_output', content: [{ type: 'video', data: Buffer.from('abc').toString('base64') }] }] }) }) });
  assert.strictEqual(good.ok, true);
  assert.strictEqual(good.buffer.toString(), 'abc');
});

test('the reference prompts ask for a sheet of one person, or an empty real place, with no text', () => {
  const person = sv.buildReferencePrompt({ kind: 'person', description: 'A shopkeeper in her 40s', city: 'Chennai' });
  assert.match(person, /Character reference sheet/);
  assert.match(person, /front, three-quarter and side profile/);
  assert.match(person, /No text/);
  const place = sv.buildReferencePrompt({ kind: 'place', description: 'A busy sweet shop' });
  assert.match(place, /No people, no text/);
  assert.match(sv.buildReferencePrompt({ kind: 'person', description: '' }), /friendly local shop owner/);
});

test('a reference picture is priced as one medium picture', () => {
  const { QUARK_COSTS: Q, ACTION_USD: A } = require('../config/apiCosts');
  assert.strictEqual(Q.studio_reference, Math.round((A.studio_reference * 2.5) / 0.02));
  assert.ok(Q.studio_reference >= 4 && Q.studio_reference <= 10);
});

test('a spoken line is said once and the rest of the clip has no speech (the model used to repeat lines to fill 10 seconds)', () => {
  const p = sv.assemblePrompt({ concept: 'x', spokenLine: 'Order today and get free home delivery.', style: 'daily-life-vlog', language: 'english', aspectRatio: '9:16' });
  assert.match(p, /says the line ONCE only/);
  assert.match(p, /never repeats any word, phrase or sentence/);
  assert.match(p, /no speech at all/);
  assert.match(p, /finishing in about 3 seconds/);
  assert.strictEqual(sv.speechSeconds('தீபாவளி நல்வாழ்த்துகள்'), 2);
  assert.strictEqual(sv.speechSeconds(new Array(60).fill('word').join(' ')), 9);
});
