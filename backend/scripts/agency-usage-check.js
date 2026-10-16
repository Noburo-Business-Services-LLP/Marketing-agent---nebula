/**
 * Real check of the agency usage report against the DEVELOPMENT database. Refuses any other database.
 *   node scripts/agency-usage-check.js
 * Makes throwaway agencies and clients, spends and refunds through the real guards, reads /api/agency/usage and
 * /usage.csv through the real routes (private in-process server on a random local port), then deletes everything it
 * made. No external service is called.
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
  const QuarkLedger = require('../models/QuarkLedger');
  const ws = require('../services/agencyWorkspaces');
  const guard = require('../middleware/trialGuard');
  const { QUARK_COSTS } = require('../config/apiCosts');
  const { generateToken } = require('../middleware/auth');
  const Spend = require('../models/AiSpendDay');
  const day = new Date().toISOString().slice(0, 10);
  const spendBefore = await Spend.findOne({ day }).lean();
  const tag = `agency-usage-${Date.now()}`;
  const made = [];
  let server;
  const IMG = QUARK_COSTS.image_generated;
  const VID = QUARK_COSTS.studio_video;
  const settle = () => new Promise((r) => setTimeout(r, 500));
  try {
    const mk = (suffix, extra) => User.create({ email: `${tag}-${suffix}@example.test`, password: 'Check-only-1', firstName: 'Check', isVerified: true, onboardingCompleted: true, ...extra });
    const future = new Date(Date.now() + 20 * 864e5);
    const pool = { balance: 5000, totalUsed: 0, planBalance: 5000, planExpiresAt: future };
    const owner = await mk('agency', { plan: { tier: 'agency', addons: [] }, credits: pool });
    const rival = await mk('rival', { plan: { tier: 'agency', addons: [] }, credits: pool });
    made.push(owner._id, rival._id);
    const models = { User };
    const mkWs = async (o, name) => { const w = (await ws.createWorkspace({ owner: o, name, models })).workspace; made.push(w._id); return w; };
    const a = await mkWs(owner, 'Sweet Co'); const b = await mkWs(owner, 'Tea House'); const c = await mkWs(owner, 'Quiet'); const x = await mkWs(rival, 'Rival client');

    await guard.deductCredits(a._id, 'image_generated', 1, 'check'); await guard.deductCredits(a._id, 'image_generated', 1, 'check');
    await guard.deductCredits(a._id, 'campaign_full', 3, 'check three posts');
    await guard.refundCredits(a._id, 'image_generated', 1, 'check refund');
    await guard.deductCredits(b._id, 'image_generated', 1, 'check');
    await require('../services/quarkBuckets').spend(b._id, VID, { action: 'studio_video', description: 'check video' }); // a video charge (no external service)
    await guard.deductCredits(owner._id, 'image_generated', 1, 'the agency\'s own use');
    await guard.deductCredits(x._id, 'image_generated', 1, 'rival client');
    await settle();

    const app = express(); app.use(express.json()); app.use('/api/agency', require('../routes/agency'));
    server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const H = { Authorization: `Bearer ${generateToken(owner._id)}` };
    const get = (p, h = H) => fetch(`${base}${p}`, { headers: h });

    let j = await (await get('/api/agency/usage')).json();
    const by = Object.fromEntries(j.clients.map((k) => [k.name, k]));
    assert.deepStrictEqual(Object.keys(by).sort(), ['Quiet', 'Sweet Co', 'Tea House']);
    assert.strictEqual(by['Sweet Co'].quarksSpent, IMG + 3 * QUARK_COSTS.campaign_full);
    assert.strictEqual(by['Sweet Co'].posts, 1 + 3);
    assert.strictEqual(by['Tea House'].videos, 1); assert.strictEqual(by['Tea House'].posts, 1);
    assert.strictEqual(by.Quiet.lastActive, null);
    console.log('report: per client posts, videos and Quarks match what was spent, refund taken off, other agency absent');

    // the report adds up to the pool: pool drop = clients + the agency's own use
    const now = await User.findById(owner._id).select('credits.balance').lean();
    const used = 5000 - now.credits.balance;
    const clientsTotal = j.clients.reduce((s, k) => s + k.total.quarksSpent, 0);
    assert.strictEqual(clientsTotal + IMG, used, 'clients + own use = what left the pool');
    assert.strictEqual(j.poolLeft, now.credits.balance);
    console.log(`reconciles: clients ${clientsTotal} + own use ${IMG} = pool drop ${used}`);

    // removed client keeps its spend under a plain label
    await User.deleteOne({ _id: b._id });
    j = await (await get('/api/agency/usage')).json();
    const gone = j.clients.find((k) => k.removed);
    assert.ok(gone && gone.name === 'Removed client' && gone.total.quarksSpent === IMG + VID);
    assert.strictEqual(j.clients.reduce((s, k) => s + k.total.quarksSpent, 0) + IMG, used);
    assert.ok(!JSON.stringify(j).includes(String(b._id)), 'removed id not shown');
    console.log('removed client: spend kept under Removed client, totals unchanged');

    // CSV, paging, month
    const csv = await get('/api/agency/usage.csv?month=2000-01');
    assert.strictEqual(csv.status, 200); const txt = await csv.text();
    assert.ok(txt.startsWith('Client,Posts,Videos\n') && !/quark/i.test(txt));
    const p = await (await get('/api/agency/usage?limit=1&page=2')).json();
    assert.strictEqual(p.clients.length, 1); assert.strictEqual(p.total, 3);
    console.log('csv ok, paging ok');

    // access
    const pass = require('jsonwebtoken').sign({ id: String(a._id), actingAgency: String(owner._id) }, process.env.JWT_SECRET, { expiresIn: '1h' });
    assert.strictEqual((await get('/api/agency/usage', { Authorization: `Bearer ${pass}` })).status, 403);
    assert.strictEqual((await get('/api/agency/usage', { Authorization: `Bearer ${generateToken(a._id)}` })).status, 403);
    assert.strictEqual((await get('/api/agency/usage', {})).status, 401);
    const other = await (await get('/api/agency/usage', { Authorization: `Bearer ${generateToken(rival._id)}` })).json();
    assert.deepStrictEqual(other.clients.map((k) => k.name), ['Rival client']);
    console.log('access: client pass refused, client login refused, no login refused, rival sees only its own');
    console.log('ALL CHECKS PASSED');
  } finally {
    if (server) server.close();
    const ids = made;
    const l = await QuarkLedger.deleteMany({ $or: [{ user: { $in: ids } }, { workspace: { $in: ids } }] });
    const u = await User.deleteMany({ $or: [{ _id: { $in: ids } }, { email: new RegExp(`^${tag}`) }, { 'agency.ownerId': { $in: ids } }] });
    await new Promise((r) => setTimeout(r, 500));
    const l2 = await QuarkLedger.deleteMany({ $or: [{ user: { $in: ids } }, { workspace: { $in: ids } }] });
    const left = await User.countDocuments({ $or: [{ _id: { $in: ids } }, { email: new RegExp(`^${tag}`) }] }) + await QuarkLedger.countDocuments({ $or: [{ user: { $in: ids } }, { workspace: { $in: ids } }] });
    if (spendBefore) await Spend.updateOne({ day }, { $set: { totalUsd: spendBefore.totalUsd, byProvider: spendBefore.byProvider } });
    else await Spend.deleteOne({ day });
    console.log(`cleanup: removed ${u.deletedCount} users and ${l.deletedCount + l2.deletedCount} ledger rows; left over: ${left}`);
  }
  process.exit(0);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
