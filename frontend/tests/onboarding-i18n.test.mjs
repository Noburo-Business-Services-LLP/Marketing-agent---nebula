import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ONBOARDING_STRINGS, ONBOARDING_LANGS, getChoices, fillTemplate, splitTemplate,
  INDUSTRY_VALUES, VOICE_VALUES, GENDER_VALUES, GOAL_VALUES, CONTENT_LANGUAGE_BASES,
} from '../components/onboarding/onboardingStrings.ts';
import { LANG_STORAGE_KEY } from '../components/onboarding/onboardingLangStore.ts';
import { GUIDE_STEPS, GUIDE_LANGS } from '../components/onboarding/guideData.ts';
import { CONTENT_LANGUAGES } from '../constants/languages.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const en = ONBOARDING_STRINGS.en;

/** Flattens nested strings to { 'a.b': 'text' }. */
function flat(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'string' ? (out[`${key}[${i}]`] = x) : flat(x, `${key}[${i}]`, out)));
    else if (v && typeof v === 'object') flat(v, key, out);
    else out[key] = v;
  }
  return out;
}
const names = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('the three languages are en, ta and hi, matching the step guide', () => {
  assert.deepEqual(ONBOARDING_LANGS, ['en', 'ta', 'hi']);
  assert.deepEqual(GUIDE_LANGS.map((l) => l.id), ONBOARDING_LANGS);
  assert.equal(LANG_STORAGE_KEY, 'nebulaa_onboarding_lang');
});

test('every key in English exists in Tamil and Hindi, and nothing extra', () => {
  const base = Object.keys(flat(en));
  assert.ok(base.length > 150, 'expected the full question set');
  for (const lang of ['ta', 'hi']) {
    const keys = Object.keys(flat(ONBOARDING_STRINGS[lang]));
    assert.deepEqual(base.filter((k) => !keys.includes(k)), [], `${lang} is missing keys`);
    assert.deepEqual(keys.filter((k) => !base.includes(k)), [], `${lang} has extra keys`);
  }
});

test('no string is empty or only spaces in any language', () => {
  for (const lang of ONBOARDING_LANGS) {
    for (const [k, v] of Object.entries(flat(ONBOARDING_STRINGS[lang]))) {
      assert.equal(typeof v, 'string', `${lang}.${k} is not a string`);
      assert.ok(v.trim().length > 0, `${lang}.${k} is empty`);
    }
  }
});

test('{places} are the same in every language', () => {
  const base = flat(en);
  for (const lang of ['ta', 'hi']) {
    const t = flat(ONBOARDING_STRINGS[lang]);
    for (const k of Object.keys(base)) assert.equal(names(t[k]), names(base[k]), `${lang}.${k}`);
  }
});

test('Tamil and Hindi are really translated (not a copy of the English)', () => {
  const base = flat(en);
  for (const lang of ['ta', 'hi']) {
    const t = flat(ONBOARDING_STRINGS[lang]);
    for (const k of Object.keys(base)) {
      assert.notEqual(t[k], base[k], `${lang}.${k} is still the English text`);
      const script = lang === 'ta' ? /[஀-௿]/ : /[ऀ-ॿ]/;
      assert.match(t[k], script, `${lang}.${k} has no ${lang} letters: ${t[k]}`);
    }
  }
});

test('product words and numbers survive translation', () => {
  const words = ['Nebulaa', 'Instagram', 'Quarks', 'WhatsApp', 'Hero video'];
  const base = flat(en);
  for (const lang of ['ta', 'hi']) {
    const t = flat(ONBOARDING_STRINGS[lang]);
    for (const k of Object.keys(base)) {
      for (const w of words) if (base[k].includes(w)) assert.ok(t[k].includes(w), `${lang}.${k} lost "${w}"`);
      for (const d of base[k].match(/\d+/g) || []) assert.ok(t[k].includes(d), `${lang}.${k} lost the number ${d}`);
    }
  }
});

test('Tamil and Hindi use no Tamil or Hindi digits', () => {
  for (const lang of ['ta', 'hi']) {
    for (const [k, v] of Object.entries(flat(ONBOARDING_STRINGS[lang]))) {
      assert.doesNotMatch(v, /[௦-௯०-९]/, `${lang}.${k}`);
    }
  }
});

test('choice labels cover exactly the English values', () => {
  for (const lang of ONBOARDING_LANGS) {
    const s = ONBOARDING_STRINGS[lang];
    assert.deepEqual(Object.keys(s.industryLabels).sort(), [...INDUSTRY_VALUES].sort());
    assert.deepEqual(Object.keys(s.voiceLabels).sort(), [...VOICE_VALUES].sort());
    assert.deepEqual(Object.keys(s.genderLabels).sort(), [...GENDER_VALUES].sort());
    assert.deepEqual(Object.keys(s.goalLabels).sort(), [...GOAL_VALUES].sort());
    assert.deepEqual(Object.keys(s.languageNames).sort(), [...CONTENT_LANGUAGE_BASES].sort());
  }
});

test('the values saved on the profile are the English ones from before, in every language', () => {
  // These are the values the form has always saved. They must never change with the language.
  const saved = {
    industries: ['Technology / SaaS', 'E-commerce / Retail', 'Food & Beverage', 'Restaurants / Cafes / Bars', 'Salon & Spa', 'Gym & Fitness', 'Grocery & Supermarket', 'Electronics & Mobile', 'Fashion & Apparel', 'Beauty & Wellness', 'Healthcare', 'Education', 'Finance / Fintech', 'Real Estate', 'Travel & Hospitality', 'Media & Entertainment', 'Professional Services', 'Manufacturing', 'Automotive', 'Jewellery', 'Home & Furniture', 'Non-profit', 'Other'],
    voices: ['Professional', 'Friendly', 'Witty', 'Empathetic', 'Bold', 'Educational'],
    genders: ['mostly_men', 'mostly_women', 'both_equally', 'families'],
    goals: ['Brand Awareness', 'Lead Generation', 'Direct Sales', 'Community Engagement', 'Website Traffic'],
    contentLanguages: CONTENT_LANGUAGES.map((l) => l.value),
  };
  for (const lang of ONBOARDING_LANGS) {
    const c = getChoices(lang);
    for (const group of Object.keys(saved)) {
      assert.deepEqual(c[group].map((o) => o.value), saved[group], `${lang}.${group}`);
    }
  }
});

test('the same answers give an identical payload in English, Tamil and Hindi', () => {
  // Pick the 3rd industry, 2 voices, the 4th audience, 2 goals and the 14th post language, as a person would by tapping.
  const payloadFor = (lang) => {
    const c = getChoices(lang);
    return JSON.stringify({
      industry: c.industries[2].value,
      brandVoice: [c.voices[1].value, c.voices[4].value],
      targetGender: c.genders[3].value,
      marketingGoals: [c.goals[0].value, c.goals[2].value],
      contentLanguage: c.contentLanguages[13].value,
    });
  };
  const english = payloadFor('en');
  assert.equal(payloadFor('ta'), english);
  assert.equal(payloadFor('hi'), english);
  assert.equal(english, JSON.stringify({
    industry: 'Food & Beverage', brandVoice: ['Friendly', 'Bold'], targetGender: 'families',
    marketingGoals: ['Brand Awareness', 'Direct Sales'], contentLanguage: 'telugu_english_mix',
  }));
});

test('English labels are what the form showed before translation', () => {
  const c = getChoices('en');
  assert.deepEqual(c.contentLanguages.map((o) => o.label), CONTENT_LANGUAGES.map((l) => l.label));
  assert.equal(c.industries.find((o) => o.value === 'Restaurants / Cafes / Bars').label, 'Restaurants, Cafés & Bars');
  assert.equal(c.goals[0].label, 'More people know about my business');
});

test('the page sends values, never translated labels', () => {
  const src = fs.readFileSync(path.join(ROOT, 'pages/Onboarding.tsx'), 'utf8');
  assert.match(src, /<option key=\{o\.value\} value=\{o\.value\}>\{o\.label\}<\/option>/);
  assert.match(src, /toggleGoal\(goal\)/);
  assert.match(src, /handleChange\('targetGender', option\.value/);
  assert.match(src, /handleChange\('contentLanguage', option\.value/);
  assert.doesNotMatch(src, /handleChange\([^)]*\bt\./, 'a translated string must not be saved');
  assert.doesNotMatch(src, /toggleGoal\(goalLabel|brandVoice.*voiceLabel/);
});

test('every question on the page comes from the strings file, not typed into the page', () => {
  const src = fs.readFileSync(path.join(ROOT, 'pages/Onboarding.tsx'), 'utf8');
  for (const phrase of ['Business name', 'Mobile Number', 'Type of business', 'What do you sell most', 'Who buys from you', 'Finish Setup', 'Skip for now', 'Continue', "Let's set up", 'Please enter your', 'Account Already Exists']) {
    assert.ok(!src.includes(phrase), `"${phrase}" is still written in Onboarding.tsx`);
  }
  assert.doesNotMatch(src, /placeholder="/, 'a placeholder is typed into the page');
});

test('the step guide names the same buttons the screen shows', () => {
  for (const lang of ['ta', 'hi']) {
    const s = ONBOARDING_STRINGS[lang];
    const text = (n) => GUIDE_STEPS[n].lines[lang].join(' ');
    assert.ok(text(1).includes(s.analyze), `${lang} step 1 should name "${s.analyze}"`);
    assert.ok(text(2).includes(s.voiceLabels.Friendly), `${lang} step 2 should name "${s.voiceLabels.Friendly}"`);
    assert.ok(text(4).includes(s.connect), `${lang} step 4 should name "${s.connect}"`);
    assert.ok(text(4).includes(s.skipForNow), `${lang} step 4 should name "${s.skipForNow}"`);
    assert.ok(text(4).includes(s.finishSetup), `${lang} step 4 should name "${s.finishSetup}"`);
  }
});

test('fillTemplate and splitTemplate fill the places', () => {
  assert.equal(fillTemplate('Step {step} of {total}', { step: 2, total: 4 }), 'Step 2 of 4');
  assert.equal(fillTemplate('{a} and {b}', { a: 'x' }), 'x and {b}');
  assert.deepEqual(splitTemplate('Same {fields} found', { fields: 'name' }), [
    { text: 'Same ', filled: false }, { text: 'name', filled: true }, { text: ' found', filled: false },
  ]);
});

test('the language choice is remembered, and never breaks when storage is blocked', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const m = await import('../components/onboarding/onboardingLangStore.ts');
  m.resetOnboardingLangForTest();
  assert.equal(m.getOnboardingLang(), 'en');
  let heard = 0;
  const off = m.subscribeOnboardingLang(() => heard++);
  m.setOnboardingLang('ta');
  assert.equal(store.get(LANG_STORAGE_KEY), 'ta');
  assert.equal(heard, 1);
  off();
  m.resetOnboardingLangForTest();
  assert.equal(m.getOnboardingLang(), 'ta', 'a saved choice is read back');
  store.set(LANG_STORAGE_KEY, 'xx');
  m.resetOnboardingLangForTest();
  assert.equal(m.getOnboardingLang(), 'en', 'a bad saved value falls back to English');
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  m.resetOnboardingLangForTest();
  assert.equal(m.getOnboardingLang(), 'en');
  assert.doesNotThrow(() => m.setOnboardingLang('hi'));
  assert.equal(m.getOnboardingLang(), 'hi');
  delete globalThis.localStorage;
  assert.doesNotThrow(() => m.setOnboardingLang('en'));
});
