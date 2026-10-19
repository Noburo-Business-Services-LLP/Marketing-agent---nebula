const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const path = require('path');
const { assertDevDatabase, planRow } = require('../scripts/backfill-performance-metrics');

const raw = { status: 'success', instagram: { analytics: { likeCount: 40, commentsCount: 5, reachCount: 900 } } };
const zeros = { likes: 0, comments: 0, shares: 0, reach: 0, spend: 4, conversions: 2 };

test('only nebulaa_dev is accepted', () => {
  assert.doesNotThrow(() => assertDevDatabase('nebulaa_dev'));
  assert.throws(() => assertDevDatabase('nebulaa_prod'), /Refusing/);
  assert.throws(() => assertDevDatabase(''), /Refusing/);
});

test('a row with zeros and a real answer gets new metrics, keeping fields the answer cannot give', () => {
  const p = planRow({ platform: 'instagram', metrics: zeros, rawAnalytics: raw, learning: { score: 0, tier: 'low' } });
  assert.strictEqual(p.change, true);
  assert.strictEqual(p.metrics.likes, 40);
  assert.strictEqual(p.metrics.reach, 900);
  assert.strictEqual(p.metrics.spend, 4);
  assert.strictEqual(p.metrics.conversions, 2);
  assert.ok(p.score > 0);
});

test('rows with nothing to read, already right, or without a platform answer are left alone', () => {
  assert.strictEqual(planRow({ platform: 'instagram', metrics: zeros, rawAnalytics: {} }).change, false);
  assert.strictEqual(planRow({ platform: 'instagram', metrics: zeros, rawAnalytics: { status: 'success', instagram: { analytics: {} } } }).change, false);
  assert.strictEqual(planRow({ platform: 'instagram', metrics: zeros, rawAnalytics: null }).change, false);
  const first = planRow({ platform: 'instagram', metrics: zeros, rawAnalytics: raw });
  assert.strictEqual(planRow({ platform: 'instagram', metrics: first.metrics, rawAnalytics: raw }).change, false);
});

test('a stored figure is never lowered to zero by a platform answer that lacks it', () => {
  const p = planRow({ platform: 'instagram', metrics: { ...zeros, shares: 9 }, rawAnalytics: raw });
  assert.strictEqual(p.metrics.shares, 9);
});

test('without CONFIRM_BACKFILL the run is a dry run, and a real address is refused before connecting', () => {
  const uri = 'mongodb+srv://theuser:Sup3rSecretPw@cluster0.abcde.mongodb.net/nebulaa_prod';
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'backfill-performance-metrics.js')], { env: { PATH: process.env.PATH, MONGODB_URI: uri, CONFIRM_BACKFILL: 'yes' }, encoding: 'utf8', timeout: 20000, cwd: path.join(__dirname, '..') });
  assert.notStrictEqual(r.status, 0);
  assert.ok(!(r.stdout + r.stderr).includes('Sup3rSecretPw'));
});
