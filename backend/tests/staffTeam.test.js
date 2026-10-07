// backend/tests/staffTeam.test.js
const test = require('node:test');
const assert = require('node:assert');
const { grantableRoles, buildTeam } = require('../services/staff/team');
const { addMember, changeRole, removeMember } = require('../services/staff/teamActions');

const owner = { _id: 'o1', staffRole: 'owner', email: 'o@x.com' };
const owner2 = { _id: 'o2', staffRole: 'owner', email: 'o2@x.com', firstName: 'Second' };
const admin = { _id: 'a1', staffRole: 'admin', email: 'a@x.com', firstName: 'Ann' };
const csm = { _id: 'c1', staffRole: 'csm', isCsm: true, email: 'c@x.com', firstName: 'Cy', lastName: 'Lee', lastLoginAt: new Date('2026-10-06T10:00:00Z') };
const csm2 = { _id: 'c2', staffRole: 'csm', isCsm: true, email: 'c2@x.com', firstName: 'Di', isActive: false };

test('grantableRoles: the Owner can grant every role, an Admin only CSM, a CSM nothing', () => {
  assert.deepStrictEqual(grantableRoles(owner), ['owner', 'admin', 'csm']);
  assert.deepStrictEqual(grantableRoles(admin), ['csm']);
  assert.deepStrictEqual(grantableRoles(csm), []);
  assert.deepStrictEqual(grantableRoles({ _id: 'u' }), []);
});

test('buildTeam lists staff with role, status, last active and CSM workload', () => {
  const users = [
    { _id: 'x1', assignedCsm: 'c1', onboardingCompleted: true, credits: { balance: 500 }, lastLoginAt: new Date(), connectedSocials: [{ platform: 'instagram' }] },
    { _id: 'x2', assignedCsm: 'c1', onboardingCompleted: true, credits: { balance: 5 }, lastLoginAt: new Date(), connectedSocials: [] },
    { _id: 'x3', assignedCsm: 'c9', onboardingCompleted: true, credits: { balance: 500 }, lastLoginAt: new Date() }
  ];
  const extras = { x1: { draftCount: 3 }, x2: { draftCount: 2 } };
  const out = buildTeam({ staff: [csm, admin, owner, csm2], users, extras, now: Date.now() });
  assert.deepStrictEqual(out.rows.map((r) => r.role), ['owner', 'admin', 'csm', 'csm']); // seniority first
  const c = out.rows.find((r) => r.id === 'c1');
  assert.strictEqual(c.name, 'Cy Lee');
  assert.strictEqual(c.status, 'active');
  assert.strictEqual(c.clients, 2);
  assert.strictEqual(c.draftsWaiting, 5);
  assert.strictEqual(c.needAttention, 1); // x2: low Quarks and no social account
  assert.strictEqual(c.lastActiveAt, '2026-10-06T10:00:00.000Z');
  assert.strictEqual(out.rows.find((r) => r.id === 'c2').status, 'switched_off');
  assert.strictEqual(out.rows.find((r) => r.id === 'a1').clients, null); // only CSMs carry clients
  assert.strictEqual(out.maxClients, 2);
  assert.strictEqual(out.owners, 1);
});

// An in-memory stand-in for the database and the mailer.
function world(people) {
  const db = new Map(people.map((p) => [p._id, { ...p }]));
  const clients = [];
  const log = [];
  const mails = [];
  let nextId = 100;
  const repo = {
    findByEmail: async (email) => [...db.values()].find((p) => p.email === email) || null,
    findById: async (id) => db.get(String(id)) || null,
    countOwners: async () => [...db.values()].filter((p) => p.staffRole === 'owner').length,
    createUser: async (doc) => { const d = { _id: `n${nextId++}`, ...doc }; db.set(d._id, d); return d; },
    updateUser: async (id, set) => { Object.assign(db.get(String(id)), set); },
    unassignClients: async (csmId) => {
      const mine = clients.filter((c) => c.assignedCsm === csmId);
      mine.forEach((c) => { c.assignedCsm = null; });
      return { count: mine.length, clients: mine.slice(0, 50).map((c) => ({ id: c._id, name: c.name })) };
    }
  };
  const record = async (entry) => { log.push(entry); };
  const invite = async (args) => { mails.push(args); return true; };
  return { db, clients, log, mails, repo, record, invite };
}

test('addMember: the Owner creates an Admin, the account is hidden staff, the invite is sent and the action is logged', async () => {
  const w = world([owner]);
  const out = await addMember({ actor: owner, input: { email: ' New@X.com ', firstName: 'Nia', lastName: 'K', role: 'admin' }, ...w });
  assert.strictEqual(out.status, 200);
  const made = [...w.db.values()].find((p) => p.email === 'new@x.com');
  assert.ok(made);
  assert.strictEqual(made.staffRole, 'admin');
  assert.strictEqual(made.isHidden, true);
  assert.strictEqual(made.isVerified, true);
  assert.strictEqual(made.isCsm, false);
  assert.strictEqual(w.mails.length, 1);
  assert.strictEqual(w.mails[0].role, 'admin');
  assert.strictEqual(out.body.emailed, true);
  assert.strictEqual(out.body.converted, false);
  assert.strictEqual(w.log.length, 1);
  assert.strictEqual(w.log[0].action, 'team_add');
  assert.strictEqual(w.log[0].details.role, 'admin');
  assert.ok(!JSON.stringify(out.body).includes('password'));
});

test('addMember: an Admin may add a CSM but never an Admin or Owner, and nothing is created or emailed', async () => {
  const w = world([admin]);
  for (const role of ['admin', 'owner']) {
    const out = await addMember({ actor: admin, input: { email: 'n@x.com', firstName: 'N', role }, ...w });
    assert.strictEqual(out.status, 403, role);
    assert.match(out.body.message, /Only the Owner/);
  }
  assert.strictEqual(w.db.size, 1);
  assert.strictEqual(w.mails.length, 0);
  const ok = await addMember({ actor: admin, input: { email: 'n@x.com', firstName: 'N', role: 'csm' }, ...w });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual([...w.db.values()].find((p) => p.email === 'n@x.com').isCsm, true);
});

test('addMember: a CSM or a customer cannot add anyone', async () => {
  const w = world([csm]);
  assert.strictEqual((await addMember({ actor: csm, input: { email: 'n@x.com', firstName: 'N', role: 'csm' }, ...w })).status, 403);
  assert.strictEqual((await addMember({ actor: { _id: 'u' }, input: { email: 'n@x.com', firstName: 'N', role: 'csm' }, ...w })).status, 403);
  assert.strictEqual(w.db.size, 1);
});

test('addMember: bad email, missing name and unknown role are refused with plain messages', async () => {
  const w = world([owner]);
  assert.strictEqual((await addMember({ actor: owner, input: { email: 'nope', firstName: 'N', role: 'csm' }, ...w })).status, 400);
  assert.strictEqual((await addMember({ actor: owner, input: { email: 'n@x.com', firstName: ' ', role: 'csm' }, ...w })).status, 400);
  const bad = await addMember({ actor: owner, input: { email: 'n@x.com', firstName: 'N', role: 'king' }, ...w });
  assert.strictEqual(bad.status, 400);
  assert.match(bad.body.message, /role/i);
  assert.strictEqual((await addMember({ actor: owner, input: { email: 'n@x.com', firstName: 'N' }, ...w })).status, 400);
  assert.strictEqual(w.db.size, 1);
});

test('addMember: an existing customer account is converted, keeps its sign-in and is cleared of its CSM', async () => {
  const w = world([owner, { _id: 'u7', email: 'test@x.com', firstName: 'Tess', assignedCsm: 'c1', isHidden: false, payments: [] }]);
  const out = await addMember({ actor: owner, input: { email: 'TEST@x.com', firstName: 'Other', role: 'csm' }, ...w });
  assert.strictEqual(out.status, 200);
  assert.strictEqual(out.body.converted, true);
  const u = w.db.get('u7');
  assert.strictEqual(u.staffRole, 'csm');
  assert.strictEqual(u.isCsm, true);
  assert.strictEqual(u.isHidden, true);
  assert.strictEqual(u.assignedCsm, null);
  assert.strictEqual(u.firstName, 'Tess');
  assert.strictEqual(w.db.size, 2);
  assert.strictEqual(w.log[0].details.converted, true);
});

test('addMember: someone already on the team, a paying customer, or a switched-off account is refused', async () => {
  const w = world([owner, csm, { _id: 'p1', email: 'pay@x.com', payments: [{ status: 'paid' }] }, { _id: 'p2', email: 'sub@x.com', plan: { subscriptions: [{ active: true }] } }, { _id: 'p3', email: 'off@x.com', isActive: false }]);
  const dup = await addMember({ actor: owner, input: { email: 'c@x.com', firstName: 'C', role: 'csm' }, ...w });
  assert.strictEqual(dup.status, 409);
  assert.match(dup.body.message, /already on the team/);
  for (const email of ['pay@x.com', 'sub@x.com', 'off@x.com']) {
    const out = await addMember({ actor: owner, input: { email, firstName: 'X', role: 'csm' }, ...w });
    assert.strictEqual(out.status, 400, email);
  }
  assert.strictEqual(w.mails.length, 0);
  assert.strictEqual(w.log.length, 0);
});

test('addMember: if the invite email fails the person is still added and the screen is told', async () => {
  const w = world([owner]);
  w.invite = async () => { throw new Error('mail down'); };
  const out = await addMember({ actor: owner, input: { email: 'n@x.com', firstName: 'N', role: 'csm' }, ...w });
  assert.strictEqual(out.status, 200);
  assert.strictEqual(out.body.emailed, false);
  assert.strictEqual(w.log.length, 1);
});

test('changeRole: the Owner promotes a CSM to Admin; their clients are released and the change is logged', async () => {
  const w = world([owner, csm]);
  w.clients.push({ _id: 'x1', name: 'Acme', assignedCsm: 'c1' }, { _id: 'x2', name: 'Bolt', assignedCsm: 'c1' });
  const out = await changeRole({ actor: owner, targetId: 'c1', role: 'admin', ...w });
  assert.strictEqual(out.status, 200);
  assert.strictEqual(w.db.get('c1').staffRole, 'admin');
  assert.strictEqual(w.db.get('c1').isCsm, false);
  assert.strictEqual(out.body.unassigned.count, 2);
  assert.deepStrictEqual(w.clients.map((c) => c.assignedCsm), [null, null]);
  assert.deepStrictEqual(w.log[0].details, { from: 'csm', to: 'admin', unassigned: 2 });
});

test('changeRole: an Admin cannot change an Admin, an Owner, or make one', async () => {
  const w = world([admin, { _id: 'a2', staffRole: 'admin', email: 'a2@x.com' }, owner, csm]);
  assert.strictEqual((await changeRole({ actor: admin, targetId: 'a2', role: 'csm', ...w })).status, 403);
  assert.strictEqual((await changeRole({ actor: admin, targetId: 'o1', role: 'csm', ...w })).status, 403);
  assert.strictEqual((await changeRole({ actor: admin, targetId: 'c1', role: 'admin', ...w })).status, 403);
  assert.strictEqual(w.db.get('c1').staffRole, 'csm');
  assert.strictEqual(w.log.length, 0);
});

test('changeRole: nobody changes their own role, so nobody can escalate themselves', async () => {
  const w = world([owner, owner2, admin, csm]);
  for (const [actor, role] of [[admin, 'owner'], [admin, 'csm'], [owner, 'admin'], [csm, 'admin']]) {
    const out = await changeRole({ actor, targetId: actor._id, role, ...w });
    assert.ok(out.status === 403, `${actor._id}->${role} got ${out.status}`);
  }
  assert.strictEqual(w.db.get('a1').staffRole, 'admin');
  assert.strictEqual(w.db.get('o1').staffRole, 'owner');
  assert.strictEqual(w.log.length, 0);
});

test('changeRole: the last Owner cannot be demoted by another Owner path either; with two Owners one may demote the other', async () => {
  const w = world([owner, owner2]);
  const ok = await changeRole({ actor: owner, targetId: 'o2', role: 'admin', ...w });
  assert.strictEqual(ok.status, 200);
  const refused = await changeRole({ actor: { ...owner, _id: 'o2', staffRole: 'owner' }, targetId: 'o1', role: 'admin', ...w });
  assert.strictEqual(refused.status, 403);
  assert.match(refused.body.message, /last Owner/);
  assert.strictEqual(w.db.get('o1').staffRole, 'owner');
});

test('changeRole: unknown person, a customer, an unknown role, and the same role all get plain refusals', async () => {
  const w = world([owner, csm, { _id: 'u1', email: 'u@x.com' }]);
  assert.strictEqual((await changeRole({ actor: owner, targetId: 'zzz', role: 'csm', ...w })).status, 404);
  assert.strictEqual((await changeRole({ actor: owner, targetId: 'u1', role: 'csm', ...w })).status, 404); // customers are not team members
  assert.strictEqual((await changeRole({ actor: owner, targetId: 'c1', role: 'king', ...w })).status, 400);
  assert.strictEqual((await changeRole({ actor: owner, targetId: 'c1', role: null, ...w })).status, 400); // removing is DELETE
  assert.strictEqual((await changeRole({ actor: owner, targetId: 'c1', role: 'csm', ...w })).status, 400);
});

test('removeMember: removing a CSM takes staff access away, unassigns and lists their clients, and logs it', async () => {
  const w = world([owner, csm]);
  w.clients.push({ _id: 'x1', name: 'Acme', assignedCsm: 'c1' }, { _id: 'x2', name: 'Bolt', assignedCsm: 'c9' });
  const out = await removeMember({ actor: owner, targetId: 'c1', ...w });
  assert.strictEqual(out.status, 200);
  const c = w.db.get('c1');
  assert.strictEqual(c.staffRole, null);
  assert.strictEqual(c.isCsm, false);
  assert.deepStrictEqual(out.body.unassigned, { count: 1, clients: [{ id: 'x1', name: 'Acme' }] });
  assert.strictEqual(w.clients[0].assignedCsm, null);
  assert.strictEqual(w.clients[1].assignedCsm, 'c9');
  assert.strictEqual(w.log[0].action, 'team_remove');
  assert.deepStrictEqual(w.log[0].details, { from: 'csm', unassigned: 1 });
});

test('removeMember: only the Owner removes Admins and Owners, the last Owner and yourself are protected', async () => {
  const w = world([owner, owner2, admin, csm]);
  assert.strictEqual((await removeMember({ actor: admin, targetId: 'o1', ...w })).status, 403);
  assert.strictEqual((await removeMember({ actor: owner, targetId: 'o1', ...w })).status, 403); // self
  assert.strictEqual((await removeMember({ actor: admin, targetId: 'c1', ...w })).status, 200); // Admin may remove a CSM
  const solo = world([owner]);
  const lone = await removeMember({ actor: { _id: 'o9', staffRole: 'owner' }, targetId: 'o1', ...solo });
  assert.strictEqual(lone.status, 403);
  assert.match(lone.body.message, /last Owner/);
  assert.strictEqual(solo.db.get('o1').staffRole, 'owner');
  assert.strictEqual((await removeMember({ actor: csm, targetId: 'a1', ...w })).status, 403);
});
