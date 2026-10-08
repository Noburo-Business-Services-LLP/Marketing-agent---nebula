const test = require('node:test');
const assert = require('node:assert');
const { describeAudience } = require('../services/brandMemory');

test('a B2C shop: reach from the new areas, price level, optional audience gender', () => {
  const l = describeAudience({ businessType: 'B2C', reachAreas: ['neighbourhood', 'city'], pricePositioning: 'mid_range', targetGender: 'families' });
  assert.deepEqual(l, ['- Sells to: individual customers', '- Customers are in: the neighbourhood, the city', '- Price level: mid range', '- Customers are families']);
});

test('B2B: no gender line even if one was saved, and the business-buyer lines appear', () => {
  const l = describeAudience({ businessType: 'B2B', targetGender: 'mostly_men', reachAreas: ['india'], b2b: { companySize: 'small', decisionMaker: 'Owner or operations head', salesCycle: 'weeks' } });
  assert.ok(!l.some((x) => /mostly men/.test(x)));
  assert.ok(l.includes('- Business customers are small companies'));
  assert.ok(l.includes('- The buyer is usually: Owner or operations head'));
  assert.ok(l.includes('- A sale usually takes a few weeks'));
});

test('an old saved profile still reads: the single reach answer is used when no areas are set', () => {
  assert.deepEqual(describeAudience({ geographicReach: 'local_city' }), ['- Customers are in: the city']);
  assert.deepEqual(describeAudience({}), []);
  assert.deepEqual(describeAudience({ geographicReach: 'galaxy', targetGender: 'both_equally' }), []);
});

test('nothing is written for blank answers and long text is cut', () => {
  const l = describeAudience({ keyDifferentiator: 'x'.repeat(500) });
  assert.equal(l.length, 1); assert.ok(l[0].length < 260);
});
