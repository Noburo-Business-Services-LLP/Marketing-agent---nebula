const test = require('node:test');
const assert = require('node:assert');
const { selectForBackfill, throttleDelayMs } = require('../services/plan/backfill');
const u = (id, extra = {}) => ({ _id: id, createdAt: new Date(`2026-0${id}-01`), isActive: true, onboardingCompleted: true, plan: { tier: 'managed' }, businessProfile: { name: 'Biz', website: 'b.in', description: 'We sell good things here', targetAudience: 'Everyone nearby' }, ...extra });

test('picks eligible accounts without a plan, oldest first, up to the limit, and explains every skip', () => {
  const users = [u('3'), u('1'), u('2', { staffRole: 'csm' }), u('4'), u('5', { plan: { tier: 'free' } })];
  const out = selectForBackfill({ users, hasPlanIds: new Set(['4']), limit: 1 });
  assert.deepStrictEqual(out.chosen.map((x) => x._id), ['1']);
  const why = Object.fromEntries(out.skipped.map((s) => [s.id, s.why]));
  assert.strictEqual(why['2'], 'not_eligible');
  assert.strictEqual(why['4'], 'has_plan');
  assert.strictEqual(why['5'], 'not_eligible');
  assert.strictEqual(why['3'], 'over_limit');
});

test('the throttle spaces runs evenly and never divides by zero', () => {
  assert.strictEqual(throttleDelayMs(3), 20000);
  assert.strictEqual(throttleDelayMs(60), 1000);
  assert.strictEqual(throttleDelayMs(0), 60000);
});

test('a hard maximum caps the limit whatever is asked', () => {
  const users = Array.from({ length: 300 }, (_, i) => u(String(i + 1)));
  const out = selectForBackfill({ users, hasPlanIds: new Set(), limit: 5000 });
  assert.strictEqual(out.chosen.length, 200);
});
