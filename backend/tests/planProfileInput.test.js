// backend/tests/planProfileInput.test.js
const test = require('node:test');
const assert = require('node:assert');
const { profileComplete, inputFromProfile } = require('../services/plan/profileInput');
const { normaliseInput } = require('../services/blueprint/input');

const full = () => ({ companyName: 'Sweet Co', businessProfile: { name: 'Sweet Co', website: 'sweetco.in', description: 'Custom cakes baked to order for birthdays', targetAudience: 'Families in Chennai', marketingGoals: ['Get more enquiries'], competitors: ['Cake House', 'Bake Lab', 'Third', 'Fourth'] }, connectedSocials: [] });

test('a full profile is complete and its input passes the Blueprint validator', () => {
  assert.deepStrictEqual(profileComplete(full()), { complete: true, missing: [] });
  const input = inputFromProfile(full());
  assert.strictEqual(input.goal, 'enquiries');
  assert.strictEqual(input.competitors.length, 3);
  const n = normaliseInput(input, { allowGuided: true });
  assert.strictEqual(n.ok, true, JSON.stringify(n.errors));
});

test('missing pieces are named in plain words', () => {
  const u = full(); u.businessProfile.website = ''; u.businessProfile.description = 'short'; u.businessProfile.heroProduct = '';
  const r = profileComplete(u);
  assert.strictEqual(r.complete, false);
  assert.deepStrictEqual(r.missing, ['website or Instagram page', 'what you sell']);
});

test('an Instagram account can stand in for the website', () => {
  const u = full(); u.businessProfile.website = ''; u.connectedSocials = [{ platform: 'instagram', username: 'sweetco.in' }];
  assert.strictEqual(profileComplete(u).complete, true);
  assert.strictEqual(inputFromProfile(u).instagram, 'sweetco.in');
});

test('goals map to the four Blueprint goals', () => {
  for (const [text, goal] of [['Increase sales', 'sales'], ['More followers', 'followers'], ['Launch our new range', 'launch'], ['Something else', 'enquiries']]) {
    const u = full(); u.businessProfile.marketingGoals = [text];
    assert.strictEqual(inputFromProfile(u).goal, goal, text);
  }
});

test('an empty or missing user is incomplete and never throws', () => {
  assert.strictEqual(profileComplete(null).complete, false);
  assert.strictEqual(profileComplete({}).complete, false);
  assert.ok(inputFromProfile({}));
});
