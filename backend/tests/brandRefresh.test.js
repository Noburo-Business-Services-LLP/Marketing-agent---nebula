const test = require('node:test');
const assert = require('node:assert');
const { alignProfileToSettings } = require('../services/brandRefresh');

const stale = () => ({ brandName: 'StratSchool', brandDescription: 'An old school', detectedProfile: { tone: 'academic' } });

test('refresh replaces a stale scan with the Settings details', () => {
  const p = stale();
  const changed = alignProfileToSettings(p, { bp: { name: 'Nebulaa', description: 'AI marketing', brandVoice: ['Bold', 'Warm'] } });
  assert.equal(p.brandName, 'Nebulaa');
  assert.equal(p.brandDescription, 'AI marketing');
  assert.equal(p.detectedProfile.tone, 'Bold, Warm');
  assert.deepEqual(changed, ['name', 'description', 'tone']);
});

test('website text only fills an empty description, and a second run changes nothing', () => {
  const p = stale();
  alignProfileToSettings(p, { bp: { name: 'Nebulaa' } }, { description: 'From the site' });
  assert.equal(p.brandDescription, 'From the site');
  const p2 = stale();
  alignProfileToSettings(p2, { bp: { name: 'Nebulaa', description: 'Mine' } }, { description: 'From the site' });
  assert.equal(p2.brandDescription, 'Mine');
  assert.deepEqual(alignProfileToSettings(p2, { bp: { name: 'Nebulaa', description: 'Mine' } }), []);
});
