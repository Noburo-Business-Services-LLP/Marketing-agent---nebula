import test from 'node:test';
import assert from 'node:assert/strict';
import { industryChoicesFor, industryValueFor, reachAreasOf, reachFromOld, showGenderChoice, sellsToBusinesses, toggleIn, voiceList, INDUSTRY_CHOICES } from '../utils/businessProfileForm.ts';

test('industry list: not retail only, Other last, onboarding and Settings spellings agree', () => {
  assert.ok(INDUSTRY_CHOICES.includes('IT Services') && INDUSTRY_CHOICES.includes('Agency / Marketing') && INDUSTRY_CHOICES.includes('Logistics & Transport'));
  assert.equal(INDUSTRY_CHOICES[INDUSTRY_CHOICES.length - 1], 'Other');
  assert.equal(industryValueFor('Technology/SaaS'), 'Technology / SaaS');
  assert.equal(industryValueFor('Finance/Fintech'), 'Finance / Fintech');
  assert.equal(industryValueFor('Something odd'), 'Something odd');
  assert.equal(industryChoicesFor('Something odd')[0], 'Something odd');
  assert.deepEqual(industryChoicesFor('Healthcare'), INDUSTRY_CHOICES);
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

import fs from 'node:fs';
test('the copied onboarding lists are identical to the real ones', () => {
  const src = fs.readFileSync(new URL('../components/onboarding/onboardingStrings.ts', import.meta.url), 'utf8');
  const grab = (name) => [...src.slice(src.indexOf(`export const ${name}`)).split('] as const')[0].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const mine = fs.readFileSync(new URL('../utils/businessProfileForm.ts', import.meta.url), 'utf8');
  const own = (name) => [...mine.slice(mine.indexOf(`const ${name}`)).split('];')[0].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  for (const n of ['INDUSTRY_VALUES', 'VOICE_VALUES', 'GOAL_VALUES']) assert.deepEqual(own(n), grab(n), n);
});
