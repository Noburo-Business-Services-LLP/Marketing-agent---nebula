const test = require('node:test');
const assert = require('node:assert');
const { bulkClients, createClient, parseOperation, parseIds, TIERS } = require('../services/staff/clientBulk');
const { canonicalEmail } = require('../services/signupGuard');
const { canUse, resolveTier } = require('../config/entitlements');

const hex = (c) => c.repeat(24);
const owner = { _id: hex('a'), staffRole: 'owner' };
const admin = { _id: hex('b'), staffRole: 'admin' };
const csm = { _id: hex('c'), staffRole: 'csm', isCsm: true };
const clients = () => [
  { _id: hex('1'), email: 'one@x.test', plan: { tier: 'free' } },
  { _id: hex('2'), email: 'two@x.test', plan: { tier: 'free' } },
  { _id: hex('3'), email: 'paid@x.test', plan: { tier: 'starter' }, subscription: { plan: 'pro', status: 'active' } },
  { _id: hex('4'), email: 'staff@x.test', staffRole: 'csm', isCsm: true },
];
function fake(extra = {}) {
  const calls = { updates: [], records: [], created: [] };
  const db = clients();
  const repo = {
    findCustomers: async (ids) => db.filter((d) => ids.includes(d._id)),
    findCsm: async (id) => (id === csm._id ? { ...csm, isActive: true } : id === 'off'.padEnd(24, '0') ? { ...csm, isActive: false } : null),
    applyUpdate: async (ids, update) => { calls.updates.push({ ids, update }); },
    findByEmail: async (email) => db.find((d) => d.email === email) || null,
    findByEmailKey: async () => null,
    createUser: async (doc) => { calls.created.push(doc); return { _id: hex('9'), ...doc }; },
    ...extra,
  };
  return { repo, calls, record: async (row) => { calls.records.push(row); }, invite: async () => true };
}

test('ids: unique, well-formed, 1 to 200', () => {
  assert.deepEqual(parseIds([hex('1'), hex('1'), 'bad', hex('2')]).ids, [hex('1'), hex('2')]);
  assert.equal(parseIds([]).ok, false);
  assert.equal(parseIds(Array.from({ length: 201 }, (_, i) => String(i).padStart(24, '0'))).ok, false);
});

test('each action is validated', () => {
  assert.equal(parseOperation({ op: 'nope' }).ok, false);
  assert.equal(parseOperation({ op: 'set_active' }).ok, false);
  assert.equal(parseOperation({ op: 'set_active', active: false }).ok, true);
  assert.equal(parseOperation({ op: 'add_quarks', amount: 0 }).ok, false);
  assert.equal(parseOperation({ op: 'add_quarks', amount: 500000 }).ok, false);
  assert.equal(parseOperation({ op: 'set_plan', tier: 'platinum' }).ok, false);
  assert.deepEqual(TIERS, ['managed', 'free', 'starter', 'professional']);
  assert.equal(parseOperation({ op: 'set_features', mode: 'add', addons: ['hack'] }).ok, false);
  assert.equal(parseOperation({ op: 'set_features', mode: 'merge', addons: ['inbox'] }).ok, false);
  assert.deepEqual(parseOperation({ op: 'set_features', mode: 'add', addons: ['inbox', 'x'] }).update, { $addToSet: { 'plan.addons': { $each: ['inbox'] } } });
  assert.deepEqual(parseOperation({ op: 'set_features', mode: 'remove', addons: ['publish'] }).update, { $pull: { 'plan.addons': { $in: ['publish'] } } });
});

test('Owner and Admin may set the plan to Managed on many clients; staff accounts are skipped and never changed', async () => {
  for (const actor of [owner, admin]) {
    const f = fake();
    const out = await bulkClients({ actor, input: { ids: [hex('1'), hex('2'), hex('4'), hex('f')], op: 'set_plan', tier: 'managed' }, ...f });
    assert.equal(out.status, 200);
    assert.equal(out.body.updated, 2);
    assert.deepEqual(out.body.skipped.map((s) => s.id).sort(), [hex('4'), hex('f')].sort());
    assert.deepEqual(f.calls.updates[0].ids, [hex('1'), hex('2')]);
    assert.deepEqual(f.calls.updates[0].update, { $set: { 'plan.tier': 'managed' } });
    assert.equal(f.calls.records.length, 2);
    assert.equal(f.calls.records[0].action, 'bulk_set_plan');
  }
});

test('a Managed account is never blocked from any feature (the point of activating it)', () => {
  const user = { plan: { tier: 'managed' } };
  assert.equal(resolveTier(user), 'managed');
  for (const f of ['video', 'publish', 'schedule', 'inbox', 'competitors', 'social_connect', 'auto_reply']) assert.equal(canUse(user, f).allowed, true, f);
});

test('a CSM cannot run any bulk action', async () => {
  for (const op of [{ op: 'set_active', active: true }, { op: 'add_quarks', amount: 10 }, { op: 'set_plan', tier: 'managed' }, { op: 'assign_csm', csmId: csm._id }, { op: 'set_hidden', hidden: true }]) {
    const f = fake();
    const out = await bulkClients({ actor: csm, input: { ids: [hex('1')], ...op }, ...f });
    assert.equal(out.status, 403, JSON.stringify(op));
    assert.equal(f.calls.updates.length, 0);
  }
});

test('only the Owner can add Quarks in bulk, and Admin can still do the other actions', async () => {
  const a = fake(); assert.equal((await bulkClients({ actor: admin, input: { ids: [hex('1')], op: 'add_quarks', amount: 500 }, ...a })).status, 403);
  const o = fake(); const out = await bulkClients({ actor: owner, input: { ids: [hex('1'), hex('2')], op: 'add_quarks', amount: 500 }, ...o });
  assert.equal(out.body.updated, 2);
  assert.equal(o.calls.updates[0].update.$inc['credits.balance'], 500);
  assert.equal(o.calls.updates[0].update.$push['credits.history'].action, 'staff_grant');
  const s = fake(); assert.equal((await bulkClients({ actor: admin, input: { ids: [hex('1')], op: 'set_active', active: false }, ...s })).body.updated, 1);
  assert.equal(s.calls.records[0].action, 'disable_client');
});

test('changing the CSM checks the CSM; clearing it is allowed', async () => {
  const f = fake();
  assert.equal((await bulkClients({ actor: admin, input: { ids: [hex('1')], op: 'assign_csm', csmId: hex('7') }, ...f })).status, 400);
  assert.equal((await bulkClients({ actor: admin, input: { ids: [hex('1')], op: 'assign_csm', csmId: 'off'.padEnd(24, '0') }, ...f })).status, 400);
  assert.equal((await bulkClients({ actor: admin, input: { ids: [hex('1'), hex('2')], op: 'assign_csm', csmId: csm._id }, ...f })).body.updated, 2);
  assert.equal((await bulkClients({ actor: admin, input: { ids: [hex('1')], op: 'assign_csm', csmId: null }, ...f })).body.updated, 1);
});

test('a client with a live paid subscription is not moved back to Free', async () => {
  const f = fake();
  const out = await bulkClients({ actor: owner, input: { ids: [hex('1'), hex('3')], op: 'set_plan', tier: 'free' }, ...f });
  assert.equal(out.body.updated, 1);
  assert.deepEqual(out.body.skipped, [{ id: hex('3'), reason: 'Has an active paid subscription.' }]);
});

test('create a managed client: Owner and Admin, no payment, welcome email, unknown password', async () => {
  for (const actor of [owner, admin]) {
    const f = fake();
    const out = await createClient({ actor, input: { email: ' New.Client@Acme.test ', firstName: 'Priya', lastName: 'S', companyName: 'Acme', csmId: csm._id }, ...f, canonicalEmail });
    assert.equal(out.status, 201);
    const doc = f.calls.created[0];
    assert.equal(doc.email, 'new.client@acme.test');
    assert.equal(doc.plan.tier, 'managed');
    assert.equal(doc.isVerified, true); assert.equal(doc.isActive, true); assert.equal(doc.onboardingCompleted, false);
    assert.equal(doc.assignedCsm, csm._id);
    assert.ok(doc.password.length >= 20 && /\d/.test(doc.password) && /[a-zA-Z]/.test(doc.password));
    assert.equal(doc.staffRole, undefined); assert.equal(doc.isCsm, undefined);
    assert.equal(out.body.emailed, true);
    assert.equal(f.calls.records[0].action, 'create_client');
    assert.ok(!JSON.stringify(f.calls.records[0]).includes(doc.password));
  }
});

test('create: a CSM is refused; bad input is refused; an existing account is never overwritten', async () => {
  assert.equal((await createClient({ actor: csm, input: { email: 'a@b.co', firstName: 'A' }, ...fake(), canonicalEmail })).status, 403);
  assert.equal((await createClient({ actor: owner, input: { email: 'nope', firstName: 'A' }, ...fake(), canonicalEmail })).status, 400);
  assert.equal((await createClient({ actor: owner, input: { email: 'a@b.co', firstName: '' }, ...fake(), canonicalEmail })).status, 400);
  assert.equal((await createClient({ actor: owner, input: { email: 'a@b.co', firstName: 'A', tier: 'platinum' }, ...fake(), canonicalEmail })).status, 400);
  const f = fake();
  const dup = await createClient({ actor: owner, input: { email: 'ONE@x.test', firstName: 'A' }, ...f, canonicalEmail });
  assert.equal(dup.status, 409); assert.equal(dup.body.existingId, hex('1')); assert.equal(f.calls.created.length, 0);
  const staffDup = await createClient({ actor: owner, input: { email: 'staff@x.test', firstName: 'A' }, ...fake(), canonicalEmail });
  assert.equal(staffDup.status, 409); assert.equal(staffDup.body.existingId, null);
});

test('create: starting Quarks are the Owner only and limited', async () => {
  assert.equal((await createClient({ actor: admin, input: { email: 'q@b.co', firstName: 'A', quarks: 500 }, ...fake(), canonicalEmail })).status, 403);
  assert.equal((await createClient({ actor: owner, input: { email: 'q@b.co', firstName: 'A', quarks: -5 }, ...fake(), canonicalEmail })).status, 400);
  const f = fake(); await createClient({ actor: owner, input: { email: 'q@b.co', firstName: 'A', quarks: 5000 }, ...f, canonicalEmail });
  assert.deepEqual(f.calls.created[0].credits, { balance: 5000, totalUsed: 0 });
});

test('a failed welcome email does not undo adding the client', async () => {
  const f = fake(); f.invite = async () => { throw new Error('mail down'); };
  const out = await createClient({ actor: owner, input: { email: 'm@b.co', firstName: 'A' }, ...f, canonicalEmail });
  assert.equal(out.status, 201); assert.equal(out.body.emailed, false);
});
