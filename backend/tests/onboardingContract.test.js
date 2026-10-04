const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const User = require('../models/User');

const ROOT = path.join(__dirname, '..', '..', 'frontend');
const onboarding = fs.readFileSync(path.join(ROOT, 'pages', 'Onboarding.tsx'), 'utf8');
const languages = fs.readFileSync(path.join(ROOT, 'constants', 'languages.ts'), 'utf8');

// The shortened sign-up asks 8 required questions and fills the rest with defaults.
// The backend must accept exactly that payload, and must not demand the dropped fields.
function shortPayload(overrides = {}) {
  return {
    name: 'Sample Traders',
    website: '',
    gstNumber: '',
    industry: 'Retail',
    problemSolved: '',
    niche: 'Silk sarees',
    businessType: 'Both',
    businessLocation: 'Chennai',
    targetAudience: 'Women who shop for weddings',
    brandVoice: ['Professional'],
    marketingGoals: ['Lead Generation'],
    description: 'Silk sarees for Women who shop for weddings',
    competitors: [],
    brandMaturity: '',
    heroProduct: 'Silk sarees',
    targetCustomerProfile: 'Women who shop for weddings',
    targetGender: 'both_equally',
    geographicReach: 'local_city',
    customerType: 'mix_new_repeat',
    pricePositioning: '',
    keyDifferentiator: '',
    brandStory: '',
    contentLanguage: 'english',
    contentRestrictions: '',
    firstMonthContentAngles: '',
    ...overrides,
  };
}

test('sign-up asks exactly 8 required questions', () => {
  const block = onboarding.slice(onboarding.indexOf('const validateStep'), onboarding.indexOf('const handleNext'));
  // Messages live in frontend/components/onboarding/onboardingStrings.ts (English, Tamil, Hindi); each required answer returns one.
  const required = block.match(/return t\.err\w+;/g) || [];
  assert.strictEqual(required.length, 8);
});

test('the shortened sign-up payload is valid for the User schema', () => {
  const user = new User({ name: 'x', email: 'a@b.co', password: 'x', businessProfile: shortPayload() });
  const err = user.validateSync();
  const bpErrors = err ? Object.keys(err.errors).filter((k) => k.startsWith('businessProfile')) : [];
  assert.deepStrictEqual(bpErrors, []);
});

test('a payload with only the 8 required answers and no tone is valid', () => {
  const minimal = {
    name: 'Sample Traders', industry: 'Retail', businessLocation: 'Chennai',
    heroProduct: 'Silk sarees', targetCustomerProfile: 'Wedding shoppers',
    marketingGoals: ['More sales'], contentLanguage: 'tamil',
  };
  const user = new User({ name: 'x', email: 'a@b.co', password: 'x', businessProfile: minimal });
  const err = user.validateSync();
  const bpErrors = err ? Object.keys(err.errors).filter((k) => k.startsWith('businessProfile')) : [];
  assert.deepStrictEqual(bpErrors, []);
});

test('every language offered at sign-up is accepted by the schema', () => {
  const offered = [...languages.matchAll(/value: '([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(offered.length >= 20);
  for (const value of offered) {
    const user = new User({ name: 'x', email: 'a@b.co', password: 'x', businessProfile: shortPayload({ contentLanguage: value }) });
    const err = user.validateSync();
    assert.ok(!err || !err.errors['businessProfile.contentLanguage'], `language ${value} rejected`);
  }
});

test('existing accounts with the long profile still validate', () => {
  const long = shortPayload({ yearsInBusiness: 5, brandMaturity: 'established', pricePositioning: 'premium', keyDifferentiator: 'Hand woven', brandStory: 'Since 1990', competitors: ['A', 'B'] });
  const user = new User({ name: 'x', email: 'a@b.co', password: 'x', businessProfile: long });
  const err = user.validateSync();
  const bpErrors = err ? Object.keys(err.errors).filter((k) => k.startsWith('businessProfile')) : [];
  assert.deepStrictEqual(bpErrors, []);
});
