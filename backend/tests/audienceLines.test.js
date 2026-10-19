const test = require('node:test');
const assert = require('node:assert');
const { describeAudience } = require('../services/brandMemory');

test('a B2C shop: reach from the new areas, price level, optional audience gender, in plain sentences', () => {
  const l = describeAudience({ businessType: 'B2C', reachAreas: ['neighbourhood', 'city'], pricePositioning: 'mid_range', targetGender: 'families', ageGroups: ['25_34', '35_44'] });
  assert.deepStrictEqual(l, [
    '- Sells to individual customers.',
    '- Customers are in the neighbourhood and the city.',
    '- Customers are mostly aged 25 to 34 or 35 to 44.',
    '- Customers are mostly families.',
    '- Prices are mid-range.',
  ]);
});

test('B2B: no gender or age line even if one was saved, and the business-buyer lines appear', () => {
  const l = describeAudience({ businessType: 'B2B', targetGender: 'mostly_men', ageGroups: ['18_24'], reachAreas: ['india', 'international'], b2b: { customerIndustries: ['health', 'shops'], companySize: 'small', decisionMaker: 'Owner or founder', salesCycle: 'weeks' } });
  assert.ok(!l.some((x) => /mostly men|aged/.test(x)));
  assert.ok(l.includes('- Customers are in all of India and other countries.'));
  assert.ok(l.includes('- Business customers are clinics, salons and gyms or shops and online stores.'));
  assert.ok(l.includes('- Business customers are usually small companies.'));
  assert.ok(l.includes('- The person who decides to buy is usually the owner or founder.'));
  assert.ok(l.includes('- A sale usually takes a few weeks.'));
});

test('the owner\'s own words for the buyer are quoted as typed', () => {
  const l = describeAudience({ businessType: 'Both', b2b: { decisionMaker: 'Hospital purchase committee' } });
  assert.ok(l.includes('- The person who decides to buy is usually: Hospital purchase committee.'));
});

test('an old saved profile still reads: the single reach answer is used when no areas are set', () => {
  assert.deepStrictEqual(describeAudience({ geographicReach: 'local_city' }), ['- Customers are in the city.']);
  assert.deepStrictEqual(describeAudience({ geographicReach: 'regional' }), ['- Customers are in the state.']);
  assert.deepStrictEqual(describeAudience({}), []);
  assert.deepStrictEqual(describeAudience({ geographicReach: 'galaxy', targetGender: 'both_equally' }), []);
});

test('nothing is written for blank answers and long text is cut', () => {
  const l = describeAudience({ keyDifferentiator: 'x'.repeat(500) });
  assert.strictEqual(l.length, 1); assert.ok(l[0].length < 260);
});
