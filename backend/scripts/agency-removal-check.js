/**
 * Real check of removing a client, deleting an agency and the staff and scheduler exclusions, against the DEVELOPMENT
 * database. Refuses any other database.
 *   node scripts/agency-removal-check.js
 * Makes throwaway users, runs the real routes (private in-process server on a random 127.0.0.1 port), the real erase
 * steps and the real staff loaders, with FAKE Cloudinary, Ayrshare, Razorpay and email injected. Deletes everything it
 * made. No external service is called and no other account in the database is touched.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const http = require('http');
const express = require('express');
const assert = require('assert');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  if (mongoose.connection.name !== 'nebulaa_dev') throw new Error(`Refusing: database is ${mongoose.connection.name}, not nebulaa_dev`);
  const del = require('../services/accountDeletion');
  const ws = require('../services/agencyWorkspaces');
  const guard = require('../middleware/trialGuard');
  const { erasable, filterFor } = require('../services/dataRegistry');
  const { generateToken } = require('../middleware/auth');
  const models = del.defaultModels();
  const { User, QuarkLedger, AccountDeletion, RetainedPayment, DeletedAccount } = models;
  const Spend = require('../models/AiSpendDay');
  const day = new Date().toISOString().slice(0, 10);
  const spendBefore = await Spend.findOne({ day }).lean();
  const tag = `agency-removal-${Date.now()}`;
  const made = [];
  const oid = (id) => new mongoose.Types.ObjectId(String(id));
  const cloud = []; const profiles = []; const mails = []; const cancelled = [];
  del.defaultDeps = () => ({
    deleteAssets: async (assets) => { cloud.push(...assets); return { requested: assets.length, failedBatches: 0 }; },
    deleteSocialProfile: async (key) => { profiles.push(key); return { success: true }; },
    mail: { sendDeleted: async (u) => mails.push(u.email) }
  });
  const fakeRazorpay = { subscriptions: { cancel: async (id, atEnd) => { cancelled.push([id, atEnd]); } } };
  let server;
  const settle = () => new Promise((r) => setTimeout(r, 500));
  const insert = (name, doc) => models[name].collection.insertOne(doc);
  const count = (name, filter) => models[name].countDocuments(filter);
  try {
    const mk = (suffix, extra) => User.create({ email: `${tag}-${suffix}@example.test`, password: 'Check-only-1', firstName: 'Check', isVerified: true, onboardingCompleted: true, ...extra });
    const future = new Date(Date.now() + 20 * 864e5);
    const pool = { balance: 1000, totalUsed: 0, planBalance: 1000, planExpiresAt: future };
    const owner = await mk('agency', {
      plan: { tier: 'agency', addons: [], subscriptions: [{ subscriptionId: 'sub_fake_agency', kind: 'plan', key: 'agency', active: true }, { subscriptionId: 'sub_fake_slot', kind: 'slot', key: 'slot', active: true }] },
      credits: pool, agency: { extraSlots: 0 },
      payments: [{ razorpayPaymentId: `pay_${tag}`, amount: 8258.82, item: 'Agency plan', paidAt: new Date(), status: 'paid' }]
    });
    const rival = await mk('rival', { plan: { tier: 'agency', addons: [] }, credits: pool });
    const plain = await mk('customer', { plan: { tier: 'starter', addons: [] }, credits: pool });
    made.push(owner._id, rival._id, plain._id);
    const mkWs = async (o, name, key) => { const w = (await ws.createWorkspace({ owner: o, name, models })).workspace; made.push(w._id); if (key) await User.updateOne({ _id: w._id }, { $set: { 'ayrshare.profileKey': key } }); return w; };
    const c1 = await mkWs(owner, 'Sweet Co', `PK-${tag}-1`);
    const c2 = await mkWs(owner, 'Tea House', `PK-${tag}-2`);
    const r1 = await mkWs(rival, 'Rival client', `PK-${tag}-R`);
    const clientNow = async () => (await User.findById(owner._id).select('agency').lean()).agency;
    assert.strictEqual((await clientNow()).clientCount, 2);
    // data for each client: a draft with a file, a scheduled post later in the week
    const farOff = new Date(Date.now() + 3 * 864e5);
    for (const [w, n] of [[c1, 'one'], [c2, 'two'], [r1, 'rival']]) {
      await insert('Draft', { userId: oid(w._id), status: 'draft', imageUrl: `https://res.cloudinary.com/x/image/upload/v1/nebula-campaign-posts/${tag}-${n}.jpg`, createdAt: new Date(), updatedAt: new Date() });
      await insert('Campaign', { userId: oid(w._id), name: `${tag}-${n}`, status: 'scheduled', scheduling: { startDate: farOff }, platforms: ['instagram'], createdAt: new Date(), updatedAt: new Date() });
    }
    // the agency spends for c1 and c2 (ledger rows are the usage history)
    await guard.deductCredits(c1._id, 'image_generated', 2, 'removal check');
    await guard.deductCredits(c2._id, 'image_generated', 1, 'removal check');
    await settle();
    const ledgerFor = (id) => QuarkLedger.countDocuments({ user: owner._id, workspace: id });
    const l1 = await ledgerFor(c1._id); const l2 = await ledgerFor(c2._id);
    assert.ok(l1 >= 1 && l2 >= 1);
    const poolBefore = (await User.findById(owner._id).select('credits.balance').lean()).credits.balance;

    const app = express(); app.use(express.json());
    app.use('/api/agency', require('../routes/agency')); app.use('/api/account', require('../routes/account'));
    server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const auth = (id) => ({ Authorization: `Bearer ${generateToken(id)}`, 'Content-Type': 'application/json' });
    const H = auth(owner._id);
    const remove = (id, body, headers = H) => fetch(`${base}/api/agency/clients/${id}`, { method: 'DELETE', headers, body: JSON.stringify(body) });
    const GOOD = { password: 'Check-only-1', confirm: 'REMOVE' };

    // ---- 1. refused: no confirmation, wrong password, from inside a client, someone else's client
    assert.strictEqual((await remove(c1._id, { password: 'Check-only-1' })).status, 400);
    assert.strictEqual((await remove(c1._id, { password: 'nope', confirm: 'REMOVE' })).status, 403);
    const pass = require('jsonwebtoken').sign({ id: String(c1._id), actingAgency: String(owner._id) }, process.env.JWT_SECRET, { expiresIn: '1h' });
    assert.strictEqual((await remove(c2._id, GOOD, { Authorization: `Bearer ${pass}`, 'Content-Type': 'application/json' })).status, 403);
    assert.strictEqual((await remove(c1._id, GOOD, auth(rival._id))).status, 404);
    assert.strictEqual((await remove(c1._id, GOOD, auth(c1._id))).status, 403, 'a client login (it has none) is refused');
    assert.ok(await User.exists({ _id: c1._id }));
    console.log('refused: no REMOVE, wrong password, from inside a client, another agency, a client login; nothing erased');

    // ---- 2. refused while work runs: each kind of running work, one at a time
    const kinds = [
      ['AI video jobs', 'VideoJob', { jobId: `${tag}-v`, userId: oid(c1._id), status: 'processing' }],
      ['Hero videos', 'HeroVideoJob', { jobId: `${tag}-h`, userId: oid(c1._id), status: 'queued' }],
      ['Blueprints', 'Blueprint', { blueprintId: `${tag}-b`, userId: oid(c1._id), status: 'queued' }],
      ['Blueprints', 'Blueprint', { blueprintId: `${tag}-bd`, userId: oid(c1._id), status: 'completed', designed: { status: 'processing' } }],
      ['studio videos', 'StudioVideo', { user: oid(c1._id), status: 'processing' }],
      ['pictures and carousels', 'Draft', { userId: oid(c1._id), status: 'processing', createdAt: new Date(), updatedAt: new Date() }],
      ['posts going out', 'Campaign', { userId: oid(c1._id), name: `${tag}-due`, status: 'scheduled', scheduling: { startDate: new Date(Date.now() - 60000) }, createdAt: new Date(), updatedAt: new Date() }],
      ['posts being sent', 'SocialPostAttempt', { userId: oid(c1._id), status: 'queued', createdAt: new Date() }]
    ];
    assert.deepStrictEqual(await ws.runningWork(c1._id, models), [], 'idle before');
    for (const [label, model, doc] of kinds) {
      const ins = await insert(model, doc);
      assert.deepStrictEqual(await ws.runningWork(c1._id, models), [label], `${model} should block`);
      const res = await remove(c1._id, GOOD);
      const body = await res.json();
      assert.strictEqual(res.status, 409, model); assert.strictEqual(body.message, "Wait until this client's videos and jobs finish, then try again.");
      assert.ok(await User.exists({ _id: c1._id }), 'client still there');
      assert.strictEqual((await clientNow()).clientCount, 2, 'slot still used');
      assert.ok(!(await User.findById(c1._id).select('agency.frozen').lean()).agency.frozen, 'client not left paused');
      await models[model].collection.deleteOne({ _id: ins.insertedId });
      console.log(`  refused while ${model} is running (${label})`);
    }
    assert.deepStrictEqual(await ws.runningWork(c1._id, models), [], 'idle after');
    assert.strictEqual(await count('Draft', { userId: c1._id }), 1);
    assert.strictEqual(await ledgerFor(c1._id), l1);

    // a finished job does not block
    await insert('VideoJob', { jobId: `${tag}-done`, userId: oid(c1._id), status: 'completed' });
    await insert('HeroVideoJob', { jobId: `${tag}-hdone`, userId: oid(c1._id), status: 'failed' });
    assert.deepStrictEqual(await ws.runningWork(c1._id, models), []);

    // ---- 3. removal succeeds when idle
    const res = await remove(c1._id, GOOD);
    assert.strictEqual(res.status, 200, JSON.stringify(await res.clone().json()));
    assert.strictEqual(await User.exists({ _id: c1._id }), null, 'the client record is gone');
    for (const rule of erasable()) assert.strictEqual(await models[rule.model].countDocuments(filterFor(rule, c1._id)), 0, `${rule.model} erased`);
    assert.strictEqual(await count('Draft', { userId: c2._id }), 1, 'the other client keeps its data');
    assert.strictEqual(await count('Draft', { userId: r1._id }), 1, 'another agency keeps its data');
    assert.ok(await User.exists({ _id: owner._id }) && await User.exists({ _id: c2._id }));
    assert.deepStrictEqual(profiles, [`PK-${tag}-1`], 'the connected accounts profile was released');
    assert.ok(cloud.some((a) => a.publicId === `nebula-campaign-posts/${tag}-one`), 'its files were deleted');
    assert.ok(!cloud.some((a) => String(a.publicId).includes('-two')), 'the other client\'s files were not');
    assert.deepStrictEqual(mails, [], 'no email sent');
    console.log('removed: client record, data and files erased; profile released; no email; other client and other agency untouched');

    // ledger kept, pool unchanged
    assert.strictEqual(await ledgerFor(c1._id), l1, 'ledger rows for the removed client are kept');
    assert.strictEqual((await User.findById(owner._id).select('credits.balance').lean()).credits.balance, poolBefore, 'removal does not change the pool');
    const usage = await (await fetch(`${base}/api/agency/usage`, { headers: H })).json();
    const removedRow = usage.clients.find((k) => k.removed);
    assert.ok(removedRow && removedRow.name === 'Removed client' && removedRow.total.quarksSpent > 0, JSON.stringify(usage.clients));
    assert.ok(!JSON.stringify(usage).includes(String(c1._id)));
    console.log(`ledger kept: ${l1} rows still tagged with the removed client; usage report shows "Removed client" (${removedRow.total.quarksSpent} Quarks)`);

    // the old pass is refused on the next request
    const old = await fetch(`${base}/api/agency/clients`, { headers: { Authorization: `Bearer ${pass}` } });
    assert.strictEqual(old.status, 401);
    console.log('the removed client\'s pass is refused (401)');

    // ---- 4. the agency's count and slots behave
    assert.strictEqual((await clientNow()).clientCount, 1);
    const list = await (await fetch(`${base}/api/agency/clients`, { headers: H })).json();
    assert.strictEqual(list.used, 1); assert.strictEqual(list.limit, 5);
    for (const n of ['A', 'B', 'C', 'D']) { const r = await ws.createWorkspace({ owner: await User.findById(owner._id), name: `Filler ${n}`, models }); assert.strictEqual(r.ok, true); made.push(r.workspace._id); }
    const sixth = await ws.createWorkspace({ owner: await User.findById(owner._id), name: 'Too many', models });
    assert.strictEqual(sixth.ok, false); assert.match(sixth.message, /all of them are in use/);
    assert.strictEqual((await clientNow()).clientCount, 5);
    for (const w of await User.find({ 'agency.ownerId': owner._id, firstName: /^Filler/ }).select('_id').lean()) assert.strictEqual((await remove(w._id, GOOD)).status, 200);
    assert.strictEqual((await clientNow()).clientCount, 1, 'removing frees slots again');
    assert.strictEqual((await clientNow()).extraSlots, 0);
    console.log('slots: 1 of 5 after removal, filled to 5, sixth refused, removing the fillers frees them');

    // ---- 5. exclusions
    const hidden = (await User.findById(c2._id).select('isHidden').lean()).isHidden;
    assert.strictEqual(hidden, true, 'a new client is a hidden account');
    const staff = require('../services/staff/clientList'); const money = require('../services/staff/money'); const usageSvc = require('../services/staff/usage');
    const onlyMine = (U) => ({ find: (q, p) => U.find({ $and: [q, { _id: { $in: made } }] }, p), countDocuments: (q) => U.countDocuments({ $and: [q || {}, { _id: { $in: made } }] }) });
    const scoped = onlyMine(User);
    const cl = await staff.loadClientData({ viewer: { _id: oid(owner._id), staffRole: 'owner' }, models: { User: scoped, FeatureEvent: models.FeatureEvent, Draft: models.Draft } });
    const seen = cl.users.map((u) => String(u._id)).sort();
    assert.deepStrictEqual(seen, [owner._id, rival._id, plain._id].map(String).sort(), 'staff client list: the three real customers, no client workspace');
    const mn = await money.loadMoneyData({ models: { User: scoped, ClientInvoice: models.ClientInvoice } });
    assert.ok(!mn.users.some((u) => String(u._id) === String(c2._id)) && mn.users.length === 3);
    const us = await usageSvc.loadUsageData({ models: { User: scoped, Draft: models.Draft, Campaign: models.Campaign, VideoJob: models.VideoJob, HeroVideoJob: models.HeroVideoJob, Blueprint: models.Blueprint, SocialInboxMessage: models.SocialInboxMessage } });
    assert.ok(!us.users.some((u) => String(u._id) === String(c2._id)) && us.users.length === 3);
    console.log('staff: client list, money and usage loaders return the 3 real customers and no client workspace');

    // renewal reminders and billing run: make a workspace LOOK like a payer and show it is still skipped
    const soon = new Date(Date.now() + 3 * 864e5);
    await User.updateOne({ _id: c2._id }, { $set: { 'subscription.status': 'active', 'subscription.nextBillingAt': soon, 'plan.tier': 'starter', 'managedBilling.autoInvoice': true } });
    await User.updateOne({ _id: plain._id }, { $set: { 'subscription.status': 'active', 'subscription.nextBillingAt': soon, 'subscription.cancelAtPeriodEnd': false, 'plan.subscriptions': [{ subscriptionId: 'sub_fake_plain', kind: 'plan', key: 'starter', active: true }] } });
    const sent = [];
    const rr = await require('../services/renewalReminders').runRenewalRemindersOnce({
      deps: { User: { find: (q) => User.find({ $and: [q, { _id: { $in: made } }] }), findOneAndUpdate: (...a) => User.findOneAndUpdate(...a), updateOne: (...a) => User.updateOne(...a) },
        transport: async (m) => { sent.push(m.to); return { sent: true }; }, env: {}, logger: { log() {}, error() {} } }
    });
    assert.deepStrictEqual(sent, [`${tag}-customer@example.test`], 'the reminder goes to the paying customer only');
    assert.strictEqual(rr.considered, 1);
    await User.updateOne({ _id: c2._id }, { $set: { 'plan.tier': 'managed' } });
    let touched = 0;
    await require('../services/billingScheduler').runBillingOnce({ deps: { User: { find: (q) => User.find({ $and: [q, { _id: { $in: made } }] }) }, ClientInvoice: { find: () => { touched += 1; return { lean: async () => [] }; }, findOne: () => { touched += 1; return { lean: async () => null }; }, updateOne: async () => { touched += 1; } }, zoho: {}, alert: () => { touched += 1; }, logger: { log() {}, warn() {}, error() {} } } });
    assert.strictEqual(touched, 0, 'the billing run did not consider the workspace');
    await User.updateOne({ _id: c2._id }, { $unset: { subscription: '', managedBilling: '' }, $set: { 'plan.tier': 'agency' } });
    console.log('schedulers: renewal reminder only to the real payer; billing run did not consider a workspace made to look managed');

    // ---- 6. deleting the agency purges every client and the agency, cancels billing, keeps only the agency's payment record
    const eligible = await (await fetch(`${base}/api/account/status`, { headers: H })).json();
    assert.strictEqual(eligible.canDelete, true); assert.strictEqual(eligible.clients, 1);
    const fresh = await User.findById(owner._id);
    const out = await del.requestDeletion({ user: fresh, models, razorpay: fakeRazorpay, mail: { sendDeletionRequested: async () => {} } });
    assert.strictEqual(out.ok, true);
    assert.deepStrictEqual(cancelled, [['sub_fake_agency', 0], ['sub_fake_slot', 0]], 'plan and slot cancelled at once');
    assert.strictEqual((await Campaign_status(c2._id)), 'paused', 'a client\'s scheduled post is held');
    const refused = await fetch(`${base}/api/agency/clients`, { headers: { Authorization: `Bearer ${require('jsonwebtoken').sign({ id: String(c2._id), actingAgency: String(owner._id) }, process.env.JWT_SECRET, { expiresIn: '1h' })}` } });
    assert.strictEqual(refused.status, 401, 'a client cannot be opened while the agency is being deleted');
    async function Campaign_status(id) { return (await models.Campaign.findOne({ userId: id }).lean()).status; }
    profiles.length = 0; cloud.length = 0; mails.length = 0;
    await AccountDeletion.updateMany({ user: owner._id }, { $set: { purgeAfter: new Date(Date.now() - 1000) } });
    const request = await AccountDeletion.findOne({ user: owner._id }).lean();
    const done = await del.purgeOne(request, { models, deps: del.defaultDeps(), now: new Date() });
    assert.strictEqual(done.status, 'completed', JSON.stringify(done));
    assert.strictEqual(await User.countDocuments({ $or: [{ _id: owner._id }, { 'agency.ownerId': owner._id }] }), 0, 'agency and every client gone');
    for (const rule of erasable()) assert.strictEqual(await models[rule.model].countDocuments(filterFor(rule, { $in: [owner._id, c2._id] })), 0, `${rule.model} erased`);
    assert.ok(profiles.includes(`PK-${tag}-2`), 'the surviving client\'s profile was released');
    assert.deepStrictEqual(mails, [`${tag}-agency@example.test`], 'one deleted email, to the agency only');
    assert.strictEqual(await RetainedPayment.countDocuments({ razorpayPaymentId: `pay_${tag}` }), 1, 'the agency\'s payment record is kept');
    assert.strictEqual(await QuarkLedger.countDocuments({ $or: [{ user: owner._id }, { workspace: { $in: [owner._id, c2._id] } }] }), 0, 'the agency\'s ledger goes with the agency');
    assert.ok(await User.exists({ _id: rival._id }) && await User.exists({ _id: r1._id }) && await User.exists({ _id: plain._id }), 'other accounts untouched');
    assert.strictEqual(await count('Draft', { userId: r1._id }), 1);
    const steps = (await AccountDeletion.findOne({ _id: request._id }).lean()).steps.map((s) => `${s.name}:${s.status}`);
    console.log(`agency deleted: clients first, then the agency; steps ${steps.join(', ')}; billing cancelled at once; payment record kept; others untouched`);
    console.log('ALL CHECKS PASSED');
  } finally {
    if (server) server.close();
    const ids = made;
    for (const rule of erasable()) { try { await models[rule.model].deleteMany(filterFor(rule, { $in: ids })); } catch (_) { /* collection may not exist */ } }
    await QuarkLedger.deleteMany({ $or: [{ user: { $in: ids } }, { workspace: { $in: ids } }] });
    await AccountDeletion.deleteMany({ user: { $in: ids } });
    await RetainedPayment.deleteMany({ razorpayPaymentId: new RegExp(`${tag}`) });
    await DeletedAccount.deleteMany({ emailHash: { $in: [`${tag}-agency@example.test`, `${tag}-customer@example.test`, `${tag}-rival@example.test`].map((e) => del.emailHash(e)) } });
    const u = await User.deleteMany({ $or: [{ _id: { $in: ids } }, { email: new RegExp(`^${tag}`) }, { 'agency.ownerId': { $in: ids } }] });
    await settleLate();
    await QuarkLedger.deleteMany({ $or: [{ user: { $in: ids } }, { workspace: { $in: ids } }] });
    let left = await User.countDocuments({ $or: [{ _id: { $in: ids } }, { email: new RegExp(`^${tag}`) }] }) + await QuarkLedger.countDocuments({ $or: [{ user: { $in: ids } }, { workspace: { $in: ids } }] });
    for (const rule of erasable()) { try { left += await models[rule.model].countDocuments(filterFor(rule, { $in: ids })); } catch (_) { /* ignore */ } }
    left += await RetainedPayment.countDocuments({ razorpayPaymentId: new RegExp(`${tag}`) }) + await AccountDeletion.countDocuments({ user: { $in: ids } });
    if (spendBefore) await Spend.updateOne({ day }, { $set: { totalUsd: spendBefore.totalUsd, byProvider: spendBefore.byProvider } });
    else await Spend.deleteOne({ day });
    console.log(`cleanup: removed ${u.deletedCount} users; left over: ${left}`);
    function settleLate() { return new Promise((r) => setTimeout(r, 500)); }
  }
  process.exit(0);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
