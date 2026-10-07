const test = require('node:test');
const assert = require('node:assert');
const { resolveBrandIdentity } = require('../services/brandMemory');

const scan = { brandName: 'StratSchool', brandDescription: 'An old school', detectedProfile: { tone: 'academic' } };

test('Settings values beat a stored website scan', () => {
  const r = resolveBrandIdentity({
    bp: { name: 'Nebulaa', description: 'AI marketing platform', brandVoice: ['Bold'] },
    user: { companyName: 'Old Co' },
    brandProfile: scan
  });
  assert.equal(r.name, 'Nebulaa');
  assert.equal(r.description, 'AI marketing platform');
  assert.deepEqual(r.tone, ['Bold']);
});

test('the scan only fills gaps, and nothing set gives plain defaults', () => {
  const r = resolveBrandIdentity({ bp: {}, user: {}, brandProfile: scan });
  assert.equal(r.name, 'StratSchool');
  assert.equal(r.tone, 'academic');
  const empty = resolveBrandIdentity({});
  assert.equal(empty.name, 'Not set');
  assert.equal(empty.tone, 'professional');
});
