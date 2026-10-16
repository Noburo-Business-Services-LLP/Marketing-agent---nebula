const test = require('node:test');
const assert = require('node:assert');
const p = require('../services/ayrshareProfileWatch');
const { AYRSHARE } = require('../config/vendorPlans');

const User = (n) => ({ countDocuments: async () => n });
const memStore = (level = 'ok') => { const s = { level, saves: 0 }; return { s, load: async () => s.level, save: async (l) => { s.level = l; s.saves++; } }; };

test('limit and alert level come from the vendor config', () => {
  assert.strictEqual(p.PROFILE_LIMIT, AYRSHARE.includedProfiles);
  assert.strictEqual(p.ALERT_AT, 25);
  assert.strictEqual(AYRSHARE.alertAtProfiles, 25);
});

test('below 25 is fine, 25 to 30 is a warning, past 30 costs extra', () => {
  assert.strictEqual(p.status(7).level, 'ok');
  assert.strictEqual(p.status(24).level, 'ok');
  assert.strictEqual(p.status(25).level, 'near');
  assert.strictEqual(p.status(30).level, 'near');
  assert.strictEqual(p.status(31).level, 'over');
  assert.match(p.status(26).message, /26 of 30/);
  assert.match(p.status(31).message, /extra/);
  assert.deepStrictEqual([p.status(7).limit, p.status(7).alertAt], [30, 25]);
});

test('only accounts with a real profile key are counted, workspaces included', async () => {
  let seen;
  await p.countProfiles({ User: { countDocuments: async (q) => { seen = q; return 3; } } });
  assert.deepStrictEqual(seen, { 'ayrshare.profileKey': { $exists: true, $nin: [null, ''] } });
});

test('the alert fires once per episode, not every hour, and re-arms only below the level', async () => {
  const sent = []; const store = memStore();
  const alert = async (m) => { sent.push(m); return true; };
  const run = (n) => p.check({ User: User(n), alert, store });
  await run(10); await run(24);
  assert.strictEqual(sent.length, 0);
  await run(25); await run(25); await run(26);
  assert.strictEqual(sent.length, 1, 'near once');
  await run(31); await run(31);
  assert.strictEqual(sent.length, 2, 'over once');
  await run(30); await run(31); await run(28);
  assert.strictEqual(sent.length, 2, 'flapping around 30 and 31 does not repeat');
  await run(24);
  assert.strictEqual(store.s.level, 'ok', 're-armed');
  await run(25);
  assert.strictEqual(sent.length, 3, 'a new episode alerts again');
});

test('the dedupe survives a restart because it lives in the store', async () => {
  const sent = []; const store = memStore();
  const alert = async (m) => { sent.push(m); return true; };
  await p.check({ User: User(26), alert, store });
  await p.check({ User: User(26), alert, store }); // a fresh process reads the same store
  assert.strictEqual(sent.length, 1);
});

test('an alert that could not be sent is retried next run, and a failing alert never throws', async () => {
  const store = memStore(); let calls = 0;
  await p.check({ User: User(26), alert: async () => { calls++; return false; }, store });
  await p.check({ User: User(26), alert: async () => { calls++; throw new Error('mail down'); }, store });
  assert.strictEqual(calls, 2);
  assert.strictEqual(store.s.level, 'ok');
  const sent = [];
  await p.check({ User: User(26), alert: async (m) => { sent.push(m); return true; }, store });
  assert.strictEqual(sent.length, 1);
});

test('a plain state object still works for callers without a store', async () => {
  const sent = []; const state = {};
  const alert = (m) => sent.push(m);
  await p.check({ User: User(25), alert, state });
  await p.check({ User: User(25), alert, state });
  assert.strictEqual(sent.length, 1);
});

test('the alert wording names the vendor for staff and goes through the shared ops alerter', async () => {
  const sent = [];
  const { createAlerter } = require('../services/opsAlerts');
  const a = createAlerter({ env: { ALERT_EMAILS: 'o@x.com' }, send: async (m) => { sent.push(m); } });
  const alert = p.opsAlert(a);
  await p.check({ User: User(25), alert, store: memStore() });
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0].subject, /social profiles/i);
  assert.match(sent[0].text, /25 of 30/);
});

test('the real store reads and writes one durable record', async () => {
  const docs = {};
  const Model = {
    findOne: (q) => ({ lean: async () => docs[q.key] || null }),
    updateOne: async (q, u) => { docs[q.key] = { key: q.key, ...u.$set }; }
  };
  const s = p.modelStore(Model);
  assert.strictEqual(await s.load(), 'ok');
  await s.save('near');
  assert.strictEqual(await s.load(), 'near');
});
