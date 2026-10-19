import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as Q from '../constants/businessQuestions.ts';

const require = createRequire(import.meta.url);
const B = require('../../backend/config/businessQuestions.js');

test('the frontend mirror equals the backend definition, list by list', () => {
  for (const name of ['SELLS_TO', 'INDUSTRY_GROUPS', 'OTHER_INDUSTRY', 'INDUSTRIES', 'INDUSTRY_ALIASES', 'REACH_AREAS', 'OLD_REACH', 'AGE_GROUPS', 'GENDERS', 'OLD_GENDERS',
    'BUYER_INDUSTRIES', 'COMPANY_SIZES', 'DECISION_MAKERS', 'SALES_CYCLES', 'VOICES', 'GOALS', 'LANGUAGES', 'MIX_SUFFIX', 'OFFERED_CONTENT_LANGUAGES', 'LIMITS']) {
    assert.deepEqual(JSON.parse(JSON.stringify(Q[name])), JSON.parse(JSON.stringify(B[name])), name);
  }
  assert.deepEqual({ people: [...Q.BRANCHES.people], business: [...Q.BRANCHES.business] }, B.BRANCHES);
});

const flat = (obj, prefix = '', out = {}) => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v; else flat(v, key, out);
  }
  return out;
};

test('every choice has words in English, Tamil and Hindi, and nothing extra', () => {
  for (const lang of ['en', 'ta', 'hi']) {
    const w = Q.QUESTION_WORDS[lang];
    const same = (obj, values, what) => assert.deepEqual(Object.keys(obj).sort(), [...values].sort(), `${lang} ${what}`);
    same(w.industries, Q.INDUSTRIES, 'industries');
    same(w.groups, Q.INDUSTRY_GROUPS.map((g) => g.id), 'groups');
    same(w.sellsTo, Q.SELLS_TO, 'sellsTo');
    same(w.reach, Q.REACH_AREAS, 'reach');
    same(w.ages, Q.AGE_GROUPS, 'ages');
    same(w.genders, Q.GENDERS, 'genders');
    same(w.buyers, Q.BUYER_INDUSTRIES, 'buyers');
    same(w.sizes, Q.COMPANY_SIZES, 'sizes');
    same(w.deciders, Q.DECISION_MAKERS, 'deciders');
    same(w.cycles, Q.SALES_CYCLES, 'cycles');
    same(w.voices, Q.VOICES, 'voices');
    same(w.goals, Q.GOALS, 'goals');
    same(w.languages, Q.LANGUAGES, 'languages');
  }
  const base = Object.keys(flat(Q.QUESTION_WORDS.en));
  for (const lang of ['ta', 'hi']) assert.deepEqual(Object.keys(flat(Q.QUESTION_WORDS[lang])), base, `${lang} has the same words`);
});

test('Tamil and Hindi are really translated, keep the numbers, no empty words', () => {
  const en = flat(Q.QUESTION_WORDS.en);
  for (const lang of ['ta', 'hi']) {
    const t = flat(Q.QUESTION_WORDS[lang]);
    const script = lang === 'ta' ? /[஀-௿]/ : /[ऀ-ॿ]/;
    for (const [k, v] of Object.entries(t)) {
      assert.ok(v.trim(), `${lang}.${k} is empty`);
      assert.match(v, script, `${lang}.${k} has no ${lang} letters: ${v}`);
      for (const d of en[k].match(/\d+/g) || []) assert.ok(v.includes(d), `${lang}.${k} lost the number ${d}`);
      assert.doesNotMatch(v, /[௦-௯०-९]/, `${lang}.${k} uses local digits`);
    }
  }
});

test('the branch rule: people questions for B2C and Both, business questions for B2B and Both, none before an answer', () => {
  assert.deepEqual(['B2C', 'B2B', 'Both', ''].map((t) => [Q.sellsToPeople(t), Q.sellsToBusinesses(t)]), [[true, false], [false, true], [true, true], [false, false]]);
});

test('old answers read as the new choices', () => {
  assert.deepEqual(Q.reachAreasOf({ geographicReach: 'national' }), ['india']);
  assert.deepEqual(Q.reachAreasOf({ reachAreas: ['city', 'state'], geographicReach: 'hyperlocal' }), ['city', 'state']);
  assert.equal(Q.genderValueOf({ targetGender: 'both_equally' }), '');
  assert.equal(Q.genderValueOf({ targetGender: 'families' }), 'families');
  assert.equal(Q.industryValueFor('Technology/SaaS'), 'Technology / SaaS');
  assert.equal(Q.isOtherIndustry('Pet grooming'), true);
});

test('language tiles: six writer languages, mixes for the five regional ones, older values kept', () => {
  assert.deepEqual(Q.languageParts('tamil_english_mix'), { base: 'tamil', mix: true });
  assert.deepEqual(Q.languageParts('english'), { base: 'english', mix: false });
  assert.equal(Q.languageValue('hindi', true), 'hindi_english_mix');
  assert.equal(Q.languageValue('english', true), 'english');
  assert.equal(Q.languageValue('marathi', false), 'marathi');
  assert.equal(Q.OFFERED_CONTENT_LANGUAGES.length, 11);
});

test('suggestions match a choice or nothing', () => {
  assert.equal(Q.matchChoice('friendly', Q.VOICES), 'Friendly');
  assert.equal(Q.matchChoice('lead generation', Q.GOALS), 'Lead Generation');
  assert.equal(Q.matchChoice('Grow revenue', Q.GOALS), '');
});
