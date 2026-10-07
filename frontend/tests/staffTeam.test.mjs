import test from 'node:test';
import assert from 'node:assert/strict';
import { roleLabel, workloadShare, workloadText, changeableRoles, removalCheck, removeConfirmText, validateAddForm, unassignedNote, statusLabel } from '../utils/staffTeam.ts';

const csmRow = (o = {}) => ({ id: 'c1', name: 'Cleo Rao', email: 'cleo@x.com', role: 'csm', status: 'active', clients: 4, draftsWaiting: 6, needAttention: 1, lastActiveAt: null, ...o });
const adminRow = { id: 'a1', name: 'Adam', email: 'a@x.com', role: 'admin', status: 'active', clients: null, draftsWaiting: null, needAttention: null, lastActiveAt: null };
const ownerRow = { ...adminRow, id: 'o1', name: 'Olga', role: 'owner' };

test('roleLabel and statusLabel use plain words', () => {
  assert.equal(roleLabel('owner'), 'Owner');
  assert.equal(roleLabel('admin'), 'Admin');
  assert.equal(roleLabel('csm'), 'CSM');
  assert.equal(roleLabel('weird'), 'Team member');
  assert.equal(statusLabel('active'), 'Active');
  assert.equal(statusLabel('switched_off'), 'Switched off');
});

test('workloadShare is the share of the busiest CSM, never zero when someone has clients', () => {
  assert.equal(workloadShare(4, 8), 50);
  assert.equal(workloadShare(8, 8), 100);
  assert.equal(workloadShare(0, 8), 0);
  assert.equal(workloadShare(1, 200), 4); // visible sliver rather than nothing
  assert.equal(workloadShare(0, 0), 0);
  assert.equal(workloadShare(null, 8), 0);
  assert.equal(workloadShare(12, 8), 100);
});

test('workloadText says what the numbers are, and nothing for Owners and Admins', () => {
  assert.equal(workloadText(csmRow()), '4 clients, 6 drafts waiting, 1 needs attention');
  assert.equal(workloadText(csmRow({ clients: 1, draftsWaiting: 1, needAttention: 0 })), '1 client, 1 draft waiting, none need attention');
  assert.equal(workloadText(csmRow({ clients: 0, draftsWaiting: 0, needAttention: 0 })), 'No clients yet');
  assert.equal(workloadText(adminRow), '');
});

test('changeableRoles: the Owner may set any other role, an Admin only CSM on a CSM, nobody on themselves', () => {
  const all = ['owner', 'admin', 'csm'];
  assert.deepEqual(changeableRoles({ meId: 'o9', grantable: all, target: csmRow() }), ['owner', 'admin']);
  assert.deepEqual(changeableRoles({ meId: 'o9', grantable: all, target: adminRow }), ['owner', 'csm']);
  assert.deepEqual(changeableRoles({ meId: 'o9', grantable: all, target: ownerRow }), ['admin', 'csm']);
  assert.deepEqual(changeableRoles({ meId: 'a9', grantable: ['csm'], target: csmRow() }), []); // already a CSM
  assert.deepEqual(changeableRoles({ meId: 'a9', grantable: ['csm'], target: adminRow }), []); // Admins are the Owner's to change
  assert.deepEqual(changeableRoles({ meId: 'o1', grantable: all, target: ownerRow }), []); // not yourself
  assert.deepEqual(changeableRoles({ meId: 'x', grantable: [], target: csmRow() }), []);
});

test('removalCheck: not yourself, Owners and Admins only by the Owner, and never the last Owner', () => {
  const all = ['owner', 'admin', 'csm'];
  assert.deepEqual(removalCheck({ meId: 'o9', grantable: all, target: csmRow(), owners: 1 }), { ok: true });
  assert.equal(removalCheck({ meId: 'c1', grantable: all, target: csmRow(), owners: 1 }).ok, false);
  assert.equal(removalCheck({ meId: 'a9', grantable: ['csm'], target: adminRow, owners: 1 }).ok, false);
  assert.deepEqual(removalCheck({ meId: 'a9', grantable: ['csm'], target: csmRow(), owners: 1 }), { ok: true });
  const last = removalCheck({ meId: 'o9', grantable: all, target: ownerRow, owners: 1 });
  assert.equal(last.ok, false);
  assert.match(last.reason, /last Owner/);
  assert.deepEqual(removalCheck({ meId: 'o9', grantable: all, target: ownerRow, owners: 2 }), { ok: true });
});

test('removeConfirmText names the person and what happens to a CSM\'s clients', () => {
  assert.match(removeConfirmText(csmRow()), /Remove Cleo Rao from the team\?/);
  assert.match(removeConfirmText(csmRow()), /4 clients will have no CSM/);
  assert.match(removeConfirmText(csmRow({ clients: 1 })), /1 client will have no CSM/);
  assert.doesNotMatch(removeConfirmText(csmRow({ clients: 0 })), /no CSM/);
  assert.doesNotMatch(removeConfirmText(adminRow), /no CSM/);
  assert.match(removeConfirmText(adminRow), /sign in/i);
});

test('validateAddForm asks for a valid email, a first name and a role this person may grant', () => {
  const ok = { email: 'n@x.com', firstName: 'Nia', role: 'csm' };
  assert.equal(validateAddForm(ok, ['csm']), '');
  assert.match(validateAddForm({ ...ok, email: 'nope' }, ['csm']), /email/i);
  assert.match(validateAddForm({ ...ok, firstName: ' ' }, ['csm']), /first name/i);
  assert.match(validateAddForm({ ...ok, role: 'admin' }, ['csm']), /role/i);
  assert.match(validateAddForm({ ...ok, role: '' }, ['csm']), /role/i);
});

test('unassignedNote lists a few names and counts the rest', () => {
  assert.equal(unassignedNote({ count: 0, clients: [] }), '');
  assert.equal(unassignedNote(null), '');
  assert.equal(unassignedNote({ count: 1, clients: [{ id: '1', name: 'Acme' }] }), '1 client now has no CSM: Acme. Assign them from the Clients page.');
  assert.equal(unassignedNote({ count: 5, clients: ['A', 'B', 'C', 'D', 'E'].map((n) => ({ id: n, name: n })) }), '5 clients now have no CSM: A, B, C and 2 more. Assign them from the Clients page.');
});
