// backend/tests/agencyWorkspaces.test.js
const test = require('node:test');
const assert = require('node:assert');
const w = require('../services/agencyWorkspaces');
const { AGENCY } = require('../config/apiCosts');

// A small in-memory User collection that applies the same filter rules the service relies on.
function fakeUsers(seed = []) {
  const docs = seed.map((d) => ({ ...d }));
  const get = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
  const set = (o, p, v) => { const ks = p.split('.'); let c = o; ks.slice(0, -1).forEach((k) => { c[k] = c[k] || {}; c = c[k]; }); c[ks.at(-1)] = v; };
  const limitOf = (d) => Math.min(AGENCY.maxClients, AGENCY.includedClients + (get(d, 'agency.extraSlots') || 0));
  const User = {
    docs,
    findOneAndUpdate: async (f, u) => {
      const d = docs.find((x) => String(x._id) === String(f._id) && (!f['plan.tier'] || get(x, 'plan.tier') === f['plan.tier']));
      if (!d) return null;
      if (f.$expr && !((get(d, 'agency.clientCount') || 0) < limitOf(d))) return null; // the atomic limit check
      for (const [k, v] of Object.entries(u.$inc || {})) set(d, k, (get(d, k) || 0) + v);
      return d;
    },
    updateOne: async (f, u) => { const d = docs.find((x) => String(x._id) === String(f._id)); if (d) for (const [k, v] of Object.entries(u.$set || {})) set(d, k, v); for (const [k, v] of Object.entries(u.$inc || {})) if (d) set(d, k, (get(d, k) || 0) + v); },
    updateMany: async (f, u) => { docs.filter((x) => String(get(x, 'agency.ownerId')) === String(f['agency.ownerId'])).forEach((d) => { for (const [k, v] of Object.entries(u.$set || {})) set(d, k, v); }); },
    create: async (d) => { const x = { _id: d._id || `w${docs.length + 1}`, createdAt: new Date(docs.length), ...d }; docs.push(x); return x; },
    find: (f) => ({ sort: () => ({ lean: async () => docs.filter((x) => String(get(x, 'agency.ownerId')) === String(f['agency.ownerId'])) }), lean: async () => docs.filter((x) => String(get(x, 'agency.ownerId')) === String(f['agency.ownerId'])) })
  };
  return User;
}
const agency = (over = {}) => ({ _id: 'o1', plan: { tier: 'agency' }, agency: { clientCount: 0, extraSlots: 0 }, ...over });

test('creating a client makes a hidden account with no login that mirrors the agency plan', async () => {
  const User = fakeUsers([agency()]);
  const r = await w.createWorkspace({ owner: User.docs[0], name: 'Sweet Co', industry: 'Food', models: { User }, randomId: () => 'abc' });
  assert.strictEqual(r.ok, true);
  const ws = User.docs.find((d) => d.agency && d.agency.ownerId);
  assert.strictEqual(ws.email, 'ws-abc@workspace.invalid');
  assert.strictEqual(ws.plan.tier, 'agency');
  assert.strictEqual(ws.onboardingCompleted, true);
  assert.strictEqual(ws.isVerified, true);
  assert.ok(ws.password && ws.password.length >= 32);
  assert.strictEqual(User.docs[0].agency.clientCount, 1);
});

test('the sixth client is refused until a slot is bought', async () => {
  const User = fakeUsers([agency({ agency: { clientCount: 5, extraSlots: 0 } })]);
  const r = await w.createWorkspace({ owner: User.docs[0], name: 'Six', models: { User }, randomId: () => 'x' });
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /5 clients/);
  assert.strictEqual(User.docs.length, 1);
});

test('two requests for the last slot: exactly one wins', async () => {
  const User = fakeUsers([agency({ agency: { clientCount: 4, extraSlots: 0 } })]);
  let n = 0;
  const go = () => w.createWorkspace({ owner: User.docs[0], name: 'Last', models: { User }, randomId: () => `r${n++}` });
  const [a, b] = await Promise.all([go(), go()]);
  assert.strictEqual([a, b].filter((r) => r.ok).length, 1);
  assert.strictEqual(User.docs[0].agency.clientCount, 5);
});

test('a non-agency account cannot create clients, and a blank name is refused', async () => {
  const User = fakeUsers([{ _id: 'u1', plan: { tier: 'professional' }, agency: {} }, agency({ _id: 'o2' })]);
  assert.strictEqual((await w.createWorkspace({ owner: User.docs[0], name: 'X', models: { User } })).ok, false);
  const r = await w.createWorkspace({ owner: User.docs[1], name: '   ', models: { User } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(User.docs[1].agency.clientCount, 0, 'the slot is not used up by a refused request');
});

test('after a downgrade, clients beyond the limit are frozen, oldest first kept, and nothing is deleted', async () => {
  const seeded = [agency({ plan: { tier: 'agency' }, agency: { clientCount: 7, extraSlots: 2 } })];
  for (let i = 1; i <= 7; i += 1) seeded.push({ _id: `w${i}`, agency: { ownerId: 'o1' }, createdAt: new Date(i) });
  const User = fakeUsers(seeded);
  User.docs[0].agency.extraSlots = 0; // the extra slots ended
  await w.syncWorkspacePlans({ owner: User.docs[0], models: { User } });
  const frozen = User.docs.filter((d) => d.agency && d.agency.frozen).map((d) => d._id);
  assert.deepStrictEqual(frozen, ['w6', 'w7']);
  assert.strictEqual(User.docs.length, 8);
});
