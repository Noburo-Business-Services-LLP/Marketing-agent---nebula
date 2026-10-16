/**
 * Real check of the agency shared Quark pool against the DEVELOPMENT database. Refuses any other database.
 *   node scripts/agency-pool-check.js
 * Makes throwaway users, spends and refunds through the real guards and the real credits route (private in-process
 * server on a random local port), then deletes everything it made. No external service is called.
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
  const qb = require('../services/quarkBuckets');
  const { QUARK_COSTS } = require('../config/apiCosts');
  const { generateToken, protect } = require('../middleware/auth');
  // Spending records today's estimated provider cost in a shared counter; put it back exactly as it was when done.
  const Spend = require('../models/AiSpendDay');
  const day = new Date().toISOString().slice(0, 10);
  const spendBefore = await Spend.findOne({ day }).lean();
  const tag = `agency-pool-${Date.now()}`;
  const made = [];
  let server;
  const A = 'image_generated';
  const cost = QUARK_COSTS[A];
  const bal = async (id) => (await User.findById(id).select('credits.balance').lean()).credits.balance;
  const rows = async (ids) => { await new Promise((r) => setTimeout(r, 400)); return QuarkLedger.find({ $or: [{ user: { $in: ids } }, { workspace: { $in: ids } }] }).sort({ createdAt: 1 }).lean(); };
  try {
    const mk = (suffix, extra) => User.create({ email: `${tag}-${suffix}@example.test`, password: 'Check-only-1', firstName: 'Check', isVerified: true, onboardingCompleted: true, ...extra });
    const future = new Date(Date.now() + 20 * 864e5);
    const owner = await mk('agency', { plan: { tier: 'agency', addons: [] }, credits: { balance: 100, totalUsed: 0, planBalance: 100, planExpiresAt: future } });
    const managed = await mk('managed', { credits: { balance: 100, totalUsed: 0, planBalance: 100, planExpiresAt: future } });
    made.push(owner._id, managed._id);
    const models = { User };
    const a = (await ws.createWorkspace({ owner, name: 'Client A', models })).workspace;
    const b = (await ws.createWorkspace({ owner, name: 'Client B', models })).workspace;
    made.push(a._id, b._id);
    await User.updateOne({ _id: a._id }, { $set: { 'credits.balance': 777 } }); // a client record's own balance must never be touched

    // 1. spend as a client
    const d = await guard.deductCredits(a._id, A, 1, 'pool check');
    assert.strictEqual(d.success, true);
    assert.strictEqual(await bal(owner._id), 100 - cost, 'agency pool drops');
    assert.strictEqual(await bal(a._id), 777, 'client own balance untouched');
    let r = await rows(made);
    assert.strictEqual(r.length, 1);
    assert.strictEqual(String(r[0].user), String(owner._id)); assert.strictEqual(String(r[0].workspace), String(a._id)); assert.strictEqual(r[0].type, 'spend');
    console.log(`spend: pool 100 -> ${100 - cost}, client record still 777, ledger user=agency workspace=client`);

    // 2. the credits route as the client pass shows the pool
    const app = express(); app.use(express.json()); app.use('/api/credits', require('../routes/credits'));
    server = http.createServer(app); await new Promise((x) => server.listen(0, '127.0.0.1', x));
    const base = `http://127.0.0.1:${server.address().port}`;
    const ownerToken = generateToken(owner._id);
    const open = async (id) => { const j = require('jsonwebtoken'); return j.sign({ id: String(id), actingAgency: String(owner._id) }, process.env.JWT_SECRET, { expiresIn: '1h' }); };
    const passA = await open(a._id);
    const credits = await (await fetch(`${base}/api/credits`, { headers: { Authorization: `Bearer ${passA}` } })).json();
    assert.strictEqual(credits.credits.balance, 100 - cost, 'client sees the pool balance');
    console.log(`route: GET /api/credits with the client pass shows ${credits.credits.balance}`);

    // 3. refund as the client
    const rf = await guard.refundCredits(a._id, A, 1, 'pool check refund');
    assert.strictEqual(rf.success, true);
    assert.strictEqual(await bal(owner._id), 100); assert.strictEqual(await bal(a._id), 777);
    r = await rows(made);
    assert.strictEqual(r[1].type, 'refund'); assert.strictEqual(String(r[1].workspace), String(a._id));
    console.log('refund: pool back to 100, client record still 777, refund row names the client');

    // 4. concurrency across two clients on a pool that covers exactly 3
    await User.updateOne({ _id: owner._id }, { $set: { 'credits.balance': cost * 3, 'credits.planBalance': cost * 3 } });
    const res = await Promise.all([a, b, a, b, a, b, a, b].map((w) => guard.deductCredits(w._id, A, 1, 'race')));
    assert.strictEqual(res.filter((x) => x.success).length, 3, 'exactly 3 succeed');
    assert.strictEqual(await bal(owner._id), 0, 'pool is zero, never negative');
    console.log('race: 8 spends from two clients on a 3-spend pool: 3 succeeded, pool 0');

    // 5. too few Quarks: refused, client record untouched
    const poor = await guard.deductCredits(b._id, A, 1, 'empty');
    assert.strictEqual(poor.success, false); assert.match(poor.error, /Insufficient Quarks/);
    assert.strictEqual(await bal(b._id), 0);
    assert.strictEqual(await bal(a._id), 777);
    console.log('empty pool: refused with the not enough Quarks message, client record untouched');

    // 6. agency plan ended: refused even with Quarks in the pool; refund still reaches the agency
    await User.updateOne({ _id: owner._id }, { $set: { 'credits.balance': 50, 'credits.planBalance': 50, 'plan.tier': 'free' } });
    const ended = await guard.deductCredits(a._id, A, 1, 'ended');
    assert.strictEqual(ended.success, false);
    assert.strictEqual(await bal(owner._id), 50); assert.strictEqual(await bal(a._id), 777);
    const lateRefund = await guard.refundCredits(a._id, A, 1, 'late refund');
    assert.strictEqual(lateRefund.success, true); assert.strictEqual(await bal(owner._id), 50 + cost);
    await User.updateOne({ _id: owner._id }, { $set: { 'plan.tier': 'agency' } });
    console.log('plan ended: spend refused, nothing charged anywhere; a late refund still reaches the agency');

    // 7. refund with the payer recorded at charge time after the client was removed
    const recordedPayer = String(owner._id);
    await User.deleteOne({ _id: b._id });
    const afterRemoval = await guard.refundCredits(b._id, A, 1, 'refund after removal', { payerId: recordedPayer });
    assert.strictEqual(afterRemoval.success, true);
    const noPayer = await guard.refundCredits(b._id, A, 1, 'refund after removal, no record');
    assert.strictEqual(noPayer.success, false);
    console.log('removed client: refund with the recorded payer lands on the agency; without it nothing is credited');

    // 8. orphaned workspace: delete the agency, spend fails and charges nothing
    await User.deleteOne({ _id: owner._id });
    const orphan = await guard.deductCredits(a._id, A, 1, 'orphan');
    assert.strictEqual(orphan.success, false);
    assert.strictEqual(await bal(a._id), 777);
    assert.deepStrictEqual(await qb.spend(a._id, cost, { action: A }), { success: false, balance: null, spent: 0 });
    console.log('agency deleted: orphaned client cannot spend, its own record is not charged');

    // 9. an account with no agency block behaves as before
    const m1 = await guard.deductCredits(managed._id, A, 1, 'managed');
    assert.strictEqual(m1.success, true); assert.strictEqual(await bal(managed._id), 100 - cost);
    const m2 = await guard.refundCredits(managed._id, A, 1, 'managed refund');
    assert.strictEqual(m2.success, true); assert.strictEqual(await bal(managed._id), 100);
    const mrows = (await rows([managed._id])).filter((x) => String(x.user) === String(managed._id));
    assert.strictEqual(mrows.length, 1); assert.ok(!mrows[0].workspace); assert.strictEqual(mrows[0].type, 'spend');
    console.log('managed account: spend and refund as before, ledger row has no workspace, no refund row (as before)');
    console.log('ALL CHECKS PASSED');
  } finally {
    if (server) server.close();
    const ids = made;
    const l = await QuarkLedger.deleteMany({ $or: [{ user: { $in: ids } }, { workspace: { $in: ids } }] });
    const u = await User.deleteMany({ $or: [{ _id: { $in: ids } }, { email: new RegExp(`^${tag}`) }, { 'agency.ownerId': { $in: ids } }] });
    const left = await User.countDocuments({ $or: [{ _id: { $in: ids } }, { email: new RegExp(`^${tag}`) }] }) + await QuarkLedger.countDocuments({ $or: [{ user: { $in: ids } }, { workspace: { $in: ids } }] });
    await new Promise((r) => setTimeout(r, 400));
    if (spendBefore) await Spend.updateOne({ day }, { $set: { totalUsd: spendBefore.totalUsd, byProvider: spendBefore.byProvider } });
    else await Spend.deleteOne({ day });
    console.log(`cleanup: removed ${u.deletedCount} users and ${l.deletedCount} ledger rows; left over: ${left}`);
  }
  process.exit(0);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
