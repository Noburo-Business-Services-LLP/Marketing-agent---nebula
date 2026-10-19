import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { industryValueFor, isOtherIndustry, reachAreasOf, reachFromOld, showGenderChoice, sellsToBusinesses, toggleIn, voiceList, INDUSTRY_CHOICES } from '../utils/businessProfileForm.ts';

test('industry list: not retail only, Other last, older spellings agree', () => {
  assert.ok(INDUSTRY_CHOICES.includes('IT Services') && INDUSTRY_CHOICES.includes('Agency / Marketing') && INDUSTRY_CHOICES.includes('Coaching & Training'));
  assert.equal(INDUSTRY_CHOICES[INDUSTRY_CHOICES.length - 1], 'Other');
  assert.equal(industryValueFor('Technology/SaaS'), 'Technology / SaaS');
  assert.equal(industryValueFor('Finance/Fintech'), 'Finance / Fintech');
  assert.equal(industryValueFor('Something odd'), '');
  assert.equal(isOtherIndustry('Something odd'), true);
  assert.equal(isOtherIndustry('Other'), true);
  assert.equal(isOtherIndustry('Healthcare'), false);
  assert.equal(isOtherIndustry(''), false);
});

test('where customers are: old single answers still show up as the matching area', () => {
  assert.deepEqual(reachFromOld('hyperlocal'), ['neighbourhood']);
  assert.deepEqual(reachFromOld('regional'), ['state']);
  assert.deepEqual(reachAreasOf({ geographicReach: 'local_city' }), ['city']);
  assert.deepEqual(reachAreasOf({ reachAreas: ['india', 'international'], geographicReach: 'hyperlocal' }), ['india', 'international']);
  assert.deepEqual(reachAreasOf(null), []);
});

test('B2B rules: business questions for B2B and Both; no gender question for B2B', () => {
  assert.equal(sellsToBusinesses('B2B'), true); assert.equal(sellsToBusinesses('Both'), true); assert.equal(sellsToBusinesses('B2C'), false);
  assert.equal(showGenderChoice('B2B'), false); assert.equal(showGenderChoice('B2C'), true); assert.equal(showGenderChoice(''), true);
});

test('chips: toggling and voice text', () => {
  assert.deepEqual(toggleIn(['a'], 'b'), ['a', 'b']); assert.deepEqual(toggleIn(['a', 'b'], 'a'), ['b']); assert.deepEqual(toggleIn(undefined, 'x'), ['x']);
  assert.deepEqual(voiceList('Professional, Witty'), ['Professional', 'Witty']); assert.deepEqual(voiceList(['Bold', ' ']), ['Bold']); assert.deepEqual(voiceList(undefined), []);
});

test('Settings and sign-up render the same question components (they cannot drift)', () => {
  const settings = fs.readFileSync(new URL('../components/BusinessProfileFields.tsx', import.meta.url), 'utf8');
  const signup = fs.readFileSync(new URL('../pages/Onboarding.tsx', import.meta.url), 'utf8');
  for (const c of ['IndustryQuestion', 'SellsToQuestion', 'ReachQuestion', 'CustomerBranchQuestions', 'GoalsQuestion', 'VoiceQuestion', 'LanguageQuestion']) {
    assert.match(settings, new RegExp(`<${c} `), `Settings uses ${c}`);
    assert.match(signup, new RegExp(`<${c} `), `sign-up uses ${c}`);
  }
  for (const src of [settings, signup]) {
    assert.doesNotMatch(src, /'Brand Awareness'|'Professional', 'Friendly'|mostly_men|'hyperlocal'/, 'no own copy of a choice list');
  }
});
