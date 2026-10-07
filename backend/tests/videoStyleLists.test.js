const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { HERO_STYLES, getBuiltInStyleBlock, hintForLabel, GROUP_BLOCKS } = require('../services/heroVideoStyles');

const wizard = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'pages', 'ReelGenerator.tsx'), 'utf8');
const wizardSlugs = [...wizard.matchAll(/\{ value: '[^']+', slug: '([a-z-]+)'/g)].map((m) => m[1]);

test('the step-by-step wizard and the Hero flow offer the same styles', () => {
  assert.deepStrictEqual([...wizardSlugs].sort(), HERO_STYLES.map((s) => s.slug).sort());
});

test('every style has a cover image and fits the planner style budget', () => {
  for (const s of HERO_STYLES) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', '..', 'frontend', 'public', 'assets', 'video-styles', `${s.slug}.svg`)), s.slug);
    assert.ok(GROUP_BLOCKS[s.group], s.slug);
    assert.ok(getBuiltInStyleBlock(s.slug).length <= 1400, `${s.slug} block too long`);
  }
});

test('new styles carry a direction hint and old ones are unchanged', () => {
  assert.match(hintForLabel('Fashion Lookbook'), /garments/i);
  assert.equal(hintForLabel('Cinematic Commercial'), '');
  assert.equal(hintForLabel('nope'), '');
});
