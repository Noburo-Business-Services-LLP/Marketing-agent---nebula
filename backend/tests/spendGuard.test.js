const test = require('node:test');
const assert = require('node:assert');
const { createSpendGuard, providerOf } = require('../services/spendGuard');

// Small in-memory stand-ins for the two collections, with the few operations the guard uses.
function fakes() {
  const spend = { docs: new Map() };
  const switches = new Map();
  const Spend = () => ({
    findOne: ({ day }) => ({ lean: async () => spend.docs.get(day) || null }),
    findOneAndUpdate: async (q, u, o = {}) => {
      let d = spend.docs.get(q.day);
      if (q.alerted100 && q.alerted100.$ne === true && d && d.alerted100) return null;
      if (q.alerted70 && q.alerted70.$ne === true && d && d.alerted70) return null;
      if (!d && o.upsert) { d = { day: q.day, totalUsd: 0, byProvider: {}, alerted70: false, alerted100: false }; spend.docs.set(q.day, d); }
      if (!d) return null;
      if (u.$inc) for (const [k, v] of Object.entries(u.$inc)) { if (k === 'totalUsd') d.totalUsd += v; else { const p = k.split('.')[1]; d.byProvider[p] = (d.byProvider[p] || 0) + v; } }
      if (u.$set) Object.assign(d, u.$set);
      return d;
    }
  });
  const Switch = () => ({
    find: (q) => ({ lean: async () => [...switches.values()].filter((s) => !q || q.disabled === undefined || s.disabled === q.disabled) }),
    findOneAndUpdate: async (q, u) => { switches.set(q.provider, { provider: q.provider, ...u.$set }); return switches.get(q.provider); }
  });
  return { spend, switches, Spend, Switch };
}

test('actions map to the provider that bills for them', () => {
  assert.strictEqual(providerOf('image_generated'), 'openai_image');
  assert.strictEqual(providerOf('studio_video'), 'google_video');
  assert.strictEqual(providerOf('blueprint'), 'openai_text');
  assert.strictEqual(providerOf('competitor_scrape'), null);
});

test('work is allowed until the daily ceiling, then refused, with a warning at 70 percent and at the ceiling', async () => {
  const f = fakes(); const alerts = [];
  const g = createSpendGuard({ Spend: f.Spend, Switch: f.Switch, alert: async (a) => alerts.push(a.key), env: { AI_DAILY_SPEND_CAP_USD: '10' }, cacheMs: 0 });
  assert.strictEqual((await g.check('studio_video')).ok, true);
  for (let i = 0; i < 7; i += 1) await g.record('studio_video'); // about $1.005 each: 7.04 = over 70 percent
  assert.deepStrictEqual(alerts, ['ai_cap_70']);
  assert.strictEqual((await g.check('studio_video')).ok, true);
  for (let i = 0; i < 4; i += 1) await g.record('studio_video'); // over 10
  assert.deepStrictEqual(alerts, ['ai_cap_70', 'ai_cap_100']);
  const r = await g.check('image_generated');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'daily_cap');
  assert.match(r.message, /Nothing was charged/);
});

test('each warning is sent once per day however many more things are made', async () => {
  const f = fakes(); const alerts = [];
  const g = createSpendGuard({ Spend: f.Spend, Switch: f.Switch, alert: async (a) => alerts.push(a.key), env: { AI_DAILY_SPEND_CAP_USD: '1' }, cacheMs: 0 });
  for (let i = 0; i < 6; i += 1) await g.record('studio_video');
  assert.deepStrictEqual(alerts.filter((k) => k === 'ai_cap_100'), ['ai_cap_100']);
});

test('a ceiling of 0 turns the ceiling off', async () => {
  const f = fakes();
  const g = createSpendGuard({ Spend: f.Spend, Switch: f.Switch, alert: async () => {}, env: { AI_DAILY_SPEND_CAP_USD: '0' }, cacheMs: 0 });
  for (let i = 0; i < 5; i += 1) await g.record('studio_video');
  assert.strictEqual((await g.check('studio_video')).ok, true);
});

test('a provider switched off refuses its work and nothing else', async () => {
  const f = fakes();
  const g = createSpendGuard({ Spend: f.Spend, Switch: f.Switch, alert: async () => {}, env: {}, cacheMs: 0 });
  assert.strictEqual((await g.setSwitch('google_video', true, { by: 'owner@x' })).ok, true);
  assert.strictEqual((await g.check('studio_video')).reason, 'switched_off');
  assert.strictEqual((await g.check('image_generated')).ok, true);
  await g.setSwitch('google_video', false);
  assert.strictEqual((await g.check('studio_video')).ok, true);
  assert.strictEqual((await g.setSwitch('not_a_provider', true)).ok, false);
});

test('the AI_KILLED setting switches a provider off regardless of the database', async () => {
  const f = fakes();
  const g = createSpendGuard({ Spend: f.Spend, Switch: f.Switch, alert: async () => {}, env: { AI_KILLED: 'openai_image' }, cacheMs: 0 });
  assert.strictEqual((await g.check('image_generated')).reason, 'switched_off');
  const st = await g.status();
  assert.strictEqual(st.providers.find((p) => p.provider === 'openai_image').lockedByEnv, true);
});

test('if the checks themselves fail, work is allowed rather than blocked', async () => {
  const broken = () => ({ find: () => { throw new Error('db down'); }, findOne: () => { throw new Error('db down'); } });
  const g = createSpendGuard({ Spend: broken, Switch: broken, alert: async () => {}, env: {}, cacheMs: 0 });
  assert.strictEqual((await g.check('studio_video')).ok, true);
});
