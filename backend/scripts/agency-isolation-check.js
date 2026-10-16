/**
 * Real check of agency client passes against the DEVELOPMENT database. Refuses any other database.
 *   node scripts/agency-isolation-check.js
 * Makes throwaway users, runs the real auth middleware, the real agency routes and the real drafts routes in a
 * private in-process server on a random local port, then deletes everything it made.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const http = require('http');
const express = require('express');
const assert = require('assert');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  if (mongoose.connection.name !== 'nebulaa_dev') throw new Error(`Refusing: database is ${mongoose.connection.name}, not nebulaa_dev`);
  const User = require('../models/User');
  const Draft = require('../models/Draft');
  const ws = require('../services/agencyWorkspaces');
  const { generateToken, protect } = require('../middleware/auth');
  const tag = `agency-check-${Date.now()}`;
  const made = { users: [], drafts: [] };
  let server;
  try {
    const owner = await User.create({ email: `${tag}@example.test`, password: 'Check-only-1', firstName: 'Check', isVerified: true, onboardingCompleted: true, plan: { tier: 'agency', addons: [] } });
    made.users.push(owner._id);
    const other = await User.create({ email: `${tag}-other@example.test`, password: 'Check-only-1', firstName: 'Other', isVerified: true, onboardingCompleted: true, plan: { tier: 'agency', addons: [] } });
    made.users.push(other._id);
    const models = { User };
    const a = (await ws.createWorkspace({ owner, name: 'Client A', models })).workspace;
    const b = (await ws.createWorkspace({ owner, name: 'Client B', models })).workspace;
    const foreign = (await ws.createWorkspace({ owner: other, name: 'Foreign', models })).workspace;
    made.users.push(a._id, b._id, foreign._id);
    const draft = await Draft.create({ userId: a._id, title: `${tag} draft in A`, sourceType: 'post' });
    made.drafts.push(draft._id);

    const app = express();
    app.use(express.json());
    app.use('/api/agency', require('../routes/agency'));
    app.use('/api/drafts', require('../routes/drafts'));
    app.all('/api/payment/probe', protect, (req, res) => res.json({ success: true }));
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (method, path, token, body) => {
      const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
    const ownerToken = generateToken(owner._id);
    const passFor = async (id, token = ownerToken) => (await call('POST', `/api/agency/clients/${id}/open`, token)).body.token;
    const titles = (r) => (r.body.drafts || []).map((d) => d.title);

    const list = await call('GET', '/api/agency/clients', ownerToken);
    assert.strictEqual(list.body.clients.length, 2); assert.strictEqual(list.body.limit, 5); assert.strictEqual(list.body.used, 2);
    const passA = await passFor(a._id), passB = await passFor(b._id);
    assert.ok(passA && passB);
    const inA = await call('GET', '/api/drafts', passA);
    assert.deepStrictEqual(titles(inA), [`${tag} draft in A`], 'A sees its own draft');
    assert.deepStrictEqual(titles(await call('GET', '/api/drafts', passB)), [], 'B must not see the draft made in A');
    assert.deepStrictEqual(titles(await call('GET', '/api/drafts', ownerToken)), [], 'the agency own account must not see it');
    console.log('isolation: A sees 1, B sees 0, agency own account sees 0');

    assert.strictEqual((await call('POST', `/api/agency/clients/${foreign._id}/open`, ownerToken)).status, 404, 'cannot open another agency client');
    assert.strictEqual((await call('POST', '/api/payment/probe', passA)).status, 403, 'payments blocked inside a client');
    assert.strictEqual((await call('POST', '/api/payment/probe', ownerToken)).status, 200, 'payments reachable on the agency itself');
    assert.strictEqual((await call('POST', '/api/agency/clients', passA, { name: 'Sneaky' })).status, 403, 'cannot add a client from inside one');
    assert.strictEqual((await call('GET', '/api/agency/clients', passA)).body.clients.length, 2, 'list readable from inside');
    assert.ok((await call('POST', `/api/agency/clients/${b._id}/open`, passA)).body.token, 'switch client from inside');
    // forged pass naming an agency that does not own the client
    const jwt = require('jsonwebtoken');
    const forged = jwt.sign({ id: String(foreign._id), actingAgency: String(owner._id) }, process.env.JWT_SECRET, { expiresIn: '1h' });
    assert.strictEqual((await call('GET', '/api/drafts', forged)).status, 401, 'pass for a client the agency does not own');
    console.log('pass rules: foreign open 404, payment blocked 403, add-client blocked 403, forged pass 401');

    // plan ends: the old pass stops working
    await User.updateOne({ _id: owner._id }, { $set: { 'plan.tier': 'free' } });
    assert.strictEqual((await call('GET', '/api/drafts', passA)).status, 401, 'pass dies when the agency plan ends');
    await User.updateOne({ _id: owner._id }, { $set: { 'plan.tier': 'agency' } });
    assert.strictEqual((await call('GET', '/api/drafts', passA)).status, 200);
    // frozen
    await User.updateOne({ _id: a._id }, { $set: { 'agency.frozen': true } });
    assert.strictEqual((await call('GET', '/api/drafts', passA)).status, 401, 'frozen client cannot be used');
    assert.strictEqual((await call('POST', `/api/agency/clients/${a._id}/open`, ownerToken)).status, 403, 'frozen client cannot be opened');
    await User.updateOne({ _id: a._id }, { $set: { 'agency.frozen': false } });
    // removed
    await User.deleteOne({ _id: b._id });
    assert.strictEqual((await call('GET', '/api/drafts', passB)).status, 401, 'removed client pass is rejected');
    console.log('lifecycle: plan ended 401, frozen 401/403, removed 401');
    console.log('ALL CHECKS PASSED');
  } finally {
    if (server) server.close();
    const del1 = await Draft.deleteMany({ _id: { $in: made.drafts } });
    const del2 = await User.deleteMany({ $or: [{ _id: { $in: made.users } }, { email: new RegExp(`^${tag}`) }, { 'agency.ownerId': { $in: made.users } }] });
    const left = await User.countDocuments({ $or: [{ _id: { $in: made.users } }, { email: new RegExp(`^${tag}`) }] }) + await Draft.countDocuments({ title: new RegExp(tag) });
    console.log(`cleanup: removed ${del2.deletedCount} users and ${del1.deletedCount} drafts; left over: ${left}`);
  }
  process.exit(0);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
