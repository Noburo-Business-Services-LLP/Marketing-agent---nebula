// A client workspace never gets the free first campaign batch: the agency's shared pool pays for client work.
// Accounts without an agency block keep today's behaviour exactly.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const a = require('../services/agency');
const w = require('../services/agencyWorkspaces');

test('a client workspace is never offered the free first batch, even when its flag is unset', () => {
  assert.strictEqual(a.freeFirstBatch({ agency: { ownerId: 'o1' } }), false);
  assert.strictEqual(a.freeFirstBatch({ agency: { ownerId: 'o1' }, initialCampaignsGenerated: false }), false);
});

test('an account without an agency block keeps the free first batch exactly as before', () => {
  assert.strictEqual(a.freeFirstBatch({}), true);
  assert.strictEqual(a.freeFirstBatch({ initialCampaignsGenerated: false }), true);
  assert.strictEqual(a.freeFirstBatch({ initialCampaignsGenerated: true }), false);
  assert.strictEqual(a.freeFirstBatch({ plan: { tier: 'agency' } }), true); // the agency's own account is not a client
});

test('a new client is created with the first batch already marked used', async () => {
  const docs = [{ _id: 'o1', plan: { tier: 'agency' }, agency: { clientCount: 0 } }];
  const User = {
    findOneAndUpdate: async () => docs[0],
    create: async (d) => { const x = { _id: 'w1', ...d }; docs.push(x); return x; }
  };
  const r = await w.createWorkspace({ owner: docs[0], name: 'Sweet Co', models: { User }, randomId: () => 'abc' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(docs[1].initialCampaignsGenerated, true);
});

test('both campaign routes decide the free batch through freeFirstBatch', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'dashboard.js'), 'utf8');
  assert.ok(!/!user\.initialCampaignsGenerated/.test(src), 'dashboard must not test initialCampaignsGenerated directly');
  assert.strictEqual((src.match(/freeFirstBatch\(user\)/g) || []).length, 2);
});
