const test = require('node:test');
const assert = require('node:assert');
const Q = require('../config/businessQuestions');
const BP = require('../services/businessProfile');
const User = require('../models/User');
const { learnFromCustomers } = require('../services/brandMemory/fromCustomers');
const { inputFromProfile } = require('../services/plan/profileInput');
const { normaliseInput } = require('../services/blueprint/input');

// Every industry value sign-up or Settings ever saved (onboarding list of 2026-10-07 plus the Settings additions of 2026-10-08).
const OLD_INDUSTRIES = [
  'Technology / SaaS', 'E-commerce / Retail', 'Food & Beverage', 'Restaurants / Cafes / Bars', 'Salon & Spa', 'Gym & Fitness',
  'Grocery & Supermarket', 'Electronics & Mobile', 'Fashion & Apparel', 'Beauty & Wellness', 'Healthcare', 'Education',
  'Finance / Fintech', 'Real Estate', 'Travel & Hospitality', 'Media & Entertainment', 'Professional Services', 'Manufacturing',
  'Automotive', 'Jewellery', 'Home & Furniture', 'Non-profit', 'Other', 'Agency / Marketing', 'IT Services',
  'Construction & Interiors', 'Logistics & Transport', 'Legal & Accounting', 'Events & Weddings', 'Agriculture', 'Wholesale & Distribution',
];

test('definition: every old industry is still offered, Other last, groups not mostly shops', () => {
  for (const v of OLD_INDUSTRIES) assert.ok(Q.INDUSTRIES.includes(v), v);
  for (const [old, now] of Object.entries(Q.INDUSTRY_ALIASES)) assert.ok(Q.INDUSTRIES.includes(now), old);
  assert.strictEqual(Q.INDUSTRIES[Q.INDUSTRIES.length - 1], 'Other');
  assert.strictEqual(new Set(Q.INDUSTRIES).size, Q.INDUSTRIES.length);
  const shops = Q.INDUSTRY_GROUPS.find((g) => g.id === 'shops').values.length;
  assert.ok(shops / (Q.INDUSTRIES.length - 1) < 0.3, 'shops are less than a third of the list');
  for (const id of ['services', 'health', 'community', 'technology', 'industry', 'food']) assert.ok(Q.INDUSTRY_GROUPS.some((g) => g.id === id), id);
});

test('definition: every old reach answer maps to a new area; the six writer languages and their mixes', () => {
  for (const v of ['hyperlocal', 'local_city', 'regional', 'state', 'national', 'international']) assert.ok(Q.REACH_AREAS.includes(Q.OLD_REACH[v]), v);
  assert.deepStrictEqual(Q.LANGUAGES, ['english', 'hindi', 'tamil', 'telugu', 'kannada', 'malayalam']);
  assert.strictEqual(Q.OFFERED_CONTENT_LANGUAGES.length, 11);
  const enumValues = User.schema.path('businessProfile.contentLanguage').enumValues;
  for (const l of Q.OFFERED_CONTENT_LANGUAGES) assert.ok(enumValues.includes(l), l);
});

test('definition: the schema enums match the question lists', () => {
  const e = (path) => User.schema.path(`businessProfile.${path}`).enumValues || User.schema.path(`businessProfile.${path}`).caster.enumValues;
  assert.deepStrictEqual(User.schema.path('businessProfile.ageGroups').caster.enumValues, Q.AGE_GROUPS);
  assert.deepStrictEqual(User.schema.path('businessProfile.b2b.customerIndustries').caster.enumValues, Q.BUYER_INDUSTRIES);
  assert.deepStrictEqual(e('reachAreas'), Q.REACH_AREAS);
  for (const g of Q.GENDERS) assert.ok(e('targetGender').includes(g));
  assert.ok(e('targetGender').includes('both_equally'), 'old value still accepted');
  for (const s of Q.SELLS_TO) assert.ok(e('businessType').includes(s));
  for (const s of Q.COMPANY_SIZES) assert.ok(e('b2b.companySize').includes(s));
  for (const s of Q.SALES_CYCLES) assert.ok(e('b2b.salesCycle').includes(s));
});

test('definition: every question names a known field, branches are people or business', () => {
  const ids = Q.QUESTIONS.map((q) => q.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  for (const q of Q.QUESTIONS) {
    assert.ok(User.schema.path(`businessProfile.${q.field}`), q.field);
    if (q.branch) assert.ok(['people', 'business'].includes(q.branch), q.id);
  }
});

test('cleaning: old values are mapped, unknown choices dropped, nothing else touched', () => {
  const c = BP.cleanBusinessProfile({
    name: 'Kept', industry: ' Technology/SaaS ', geographicReach: 'local_city', reachAreas: [], targetGender: 'both_equally',
    businessType: 'b2b', ageGroups: ['25_34', 'old', '25_34'], b2b: { customerIndustries: ['health', 'mars'], companySize: 'huge', decisionMaker: '  Owner or founder  ', salesCycle: 'weeks' },
    brandVoice: 'Professional, Witty, professional', marketingGoals: ['Direct Sales', 'Direct Sales', ''], contentLanguage: 'Tamil_English_Mix',
    pricePositioning: 'cheap', customerType: 'mostly_new',
  });
  assert.strictEqual(c.name, 'Kept');
  assert.strictEqual(c.industry, 'Technology / SaaS');
  assert.deepStrictEqual(c.reachAreas, ['city']);
  assert.strictEqual(c.geographicReach, 'local_city', 'the old answer is never cleared');
  assert.strictEqual(c.targetGender, '');
  assert.strictEqual(c.businessType, '');
  assert.deepStrictEqual(c.ageGroups, ['25_34']);
  assert.deepStrictEqual(c.b2b, { customerIndustries: ['health'], companySize: '', decisionMaker: 'Owner or founder', salesCycle: 'weeks' });
  assert.deepStrictEqual(c.brandVoice, ['Professional', 'Witty']);
  assert.deepStrictEqual(c.marketingGoals, ['Direct Sales']);
  assert.strictEqual(c.contentLanguage, 'tamil_english_mix');
  assert.strictEqual(c.pricePositioning, '');
  assert.strictEqual(c.customerType, 'mostly_new');
  // Only fields that were sent are touched.
  assert.deepStrictEqual(BP.cleanBusinessProfile({ name: 'x' }), { name: 'x' });
  assert.strictEqual(BP.cleanBusinessProfile(null), null);
});

test('cleaning: an old language outside the six is kept; free text is capped', () => {
  assert.strictEqual(BP.cleanBusinessProfile({ contentLanguage: 'marathi' }).contentLanguage, 'marathi');
  assert.strictEqual(BP.cleanBusinessProfile({ contentLanguage: 'klingon' }).contentLanguage, '');
  assert.strictEqual(BP.cleanBusinessProfile({ industry: 'x'.repeat(300) }).industry.length, Q.LIMITS.industry);
  assert.strictEqual(BP.cleanBusinessProfile({ b2b: { decisionMaker: 'y'.repeat(300) } }).b2b.decisionMaker.length, Q.LIMITS.decisionMaker);
  assert.deepStrictEqual(BP.cleanBusinessProfile({ b2b: 'nonsense' }).b2b, { customerIndustries: [], companySize: '', decisionMaker: '', salesCycle: '' });
});

test('a cleaned new-shape and old-shape profile both validate against the schema', () => {
  for (const bp of [
    { name: 'New', businessType: 'B2B', industry: 'IT Services', reachAreas: ['state', 'india'], b2b: { customerIndustries: ['shops'], companySize: 'small', decisionMaker: 'Purchase team', salesCycle: 'months' } },
    { name: 'Old', businessType: 'Both', industry: 'Retail', geographicReach: 'regional', targetGender: 'both_equally', customerType: 'mix_new_repeat' },
    { name: 'People', businessType: 'B2C', industry: 'Pet grooming', reachAreas: ['neighbourhood'], ageGroups: ['18_24', '25_34'], targetGender: 'mostly_women' },
  ]) {
    const user = new User({ name: 'x', email: 'a@b.co', password: 'x', businessProfile: BP.cleanBusinessProfile(bp) });
    const err = user.validateSync();
    assert.deepStrictEqual(err ? Object.keys(err.errors).filter((k) => k.startsWith('businessProfile')) : [], [], bp.name);
  }
});

test('readers: industry Other alone is not set; gender never for B2B; reach falls back to the old answer', () => {
  assert.strictEqual(BP.industryOf({ industry: 'Other' }), '');
  assert.strictEqual(BP.industryOf({ industry: 'Finance/Fintech' }), 'Finance / Fintech');
  assert.strictEqual(BP.industryOf({ industry: 'Pet grooming' }), 'Pet grooming');
  assert.strictEqual(BP.genderOf({ businessType: 'B2B', targetGender: 'mostly_men' }), '');
  assert.strictEqual(BP.genderOf({ businessType: 'Both', targetGender: 'mostly_men' }), 'mostly_men');
  assert.strictEqual(BP.genderOf({ targetGender: 'both_equally' }), '');
  assert.deepStrictEqual(BP.reachAreasOf({ geographicReach: 'national' }), ['india']);
  assert.deepStrictEqual(BP.reachAreasOf({ reachAreas: ['city', 'city', 'moon'] }), ['city']);
  assert.strictEqual(BP.listWords(['a', 'b', 'c']), 'a, b and c');
});

test('readers: no fact for an empty or odd profile, never "undefined"', () => {
  for (const bp of [{}, null, undefined, { businessType: 'B2B' }, { b2b: null, businessType: 'Both' }, { ageGroups: 'x' }]) {
    const facts = BP.audienceFacts(bp);
    assert.ok(!JSON.stringify(facts).includes('undefined'));
  }
  assert.deepStrictEqual(BP.audienceFacts({}), []);
});

test('What Nebulaa learned: B2B market line with buyers, no gender; consumer line with ages', () => {
  const b2b = learnFromCustomers({ user: { businessProfile: { businessType: 'B2B', targetGender: 'mostly_men', reachAreas: ['state', 'india'], b2b: { customerIndustries: ['health'], companySize: 'medium', salesCycle: 'months' }, industry: 'IT Services' } } });
  const m = b2b.items.find((i) => i.key === 'customers-market');
  assert.strictEqual(m.text, 'Your market (IT Services): you sell to other businesses, your customers are in the state and all of India.');
  const buyers = b2b.items.find((i) => i.key === 'customers-buyers');
  assert.strictEqual(buyers.text, 'Your business customers: clinics, salons and gyms; usually mid-size companies; a sale usually takes several months.');
  assert.match(buyers.promptLine, /^The business customers: its business customers are clinics/);
  assert.ok(!JSON.stringify(b2b).includes('men'));
  const b2c = learnFromCustomers({ user: { businessProfile: { businessType: 'B2C', ageGroups: ['55_plus'], industry: 'Other' } } });
  const m2 = b2c.items.find((i) => i.key === 'customers-market');
  assert.strictEqual(m2.text, 'Your market: you sell to individual customers, your customers are mostly aged 55 and over.');
});

test('plan and Blueprint input: ages and business buyers reach the planner as typed facts; old reach maps', () => {
  const user = { companyName: 'Zed', businessProfile: { name: 'Zed Labs', website: 'zedlabs.in', description: 'Software for clinics and labs', targetAudience: 'Clinic owners', businessType: 'B2B', geographicReach: 'national', industry: 'Other', b2b: { companySize: 'small', decisionMaker: 'Owner or founder' }, marketingGoals: ['Lead Generation'] } };
  const raw = inputFromProfile(user);
  assert.deepStrictEqual(raw.reachAreas, ['india']);
  assert.ok(!('industry' in raw), 'Other alone is not sent');
  assert.deepStrictEqual(raw.audience, ['business customers are usually small companies', 'the person who decides to buy is usually the owner or founder']);
  const n = normaliseInput(raw, { allowGuided: true });
  assert.ok(n.ok);
  assert.deepStrictEqual(n.input.audience, raw.audience);
  const consumer = inputFromProfile({ businessProfile: { name: 'Shop', businessType: 'B2C', reachAreas: ['city'] } });
  assert.ok(!('audience' in consumer));
});
