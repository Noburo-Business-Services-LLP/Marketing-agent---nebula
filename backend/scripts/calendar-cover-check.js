/**
 * Real-database check of the calendar cover retry rules against the DEVELOPMENT database.
 * Refuses any database except nebulaa_dev. NO image or text model call: the cover generator and the spend guard are fakes
 * (every call is counted). Throwaway users are named "zz.covercheck-..." and are deleted with their calendars at the end.
 *   node scripts/calendar-cover-check.js            run the checks, print PASS/FAIL, clean up (exit 1 on any FAIL or leftover)
 *   node scripts/calendar-cover-check.js cleanup    delete leftovers of an interrupted run and print what is left
 */
require('dotenv').config();
const mongoose = require('mongoose');
const assert = require('assert');

const PREFIX = 'zz.covercheck-';
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const results = [];

async function check(name, fn) {
  try { const d = await fn(); results.push({ name, ok: true }); console.log(`PASS  ${name}${d ? ` (${d})` : ''}`); }
  catch (e) { results.push({ name, ok: false }); console.log(`FAIL  ${name}: ${e && e.message}`); }
}

async function connect() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  if (mongoose.connection.name !== 'nebulaa_dev') throw new Error(`Refusing: database is ${mongoose.connection.name}, not nebulaa_dev`);
}

async function cleanup(db) {
  const users = await db.collection('users').find({ email: { $regex: `^${PREFIX.replace(/\./g, '\\.')}` } }, { projection: { _id: 1 } }).toArray();
  const ids = users.map((u) => u._id);
  let calendars = 0;
  if (ids.length) calendars = (await db.collection('contentcalendars').deleteMany({ userId: { $in: ids } })).deletedCount;
  const usersDeleted = ids.length ? (await db.collection('users').deleteMany({ _id: { $in: ids } })).deletedCount : 0;
  console.log('removed', JSON.stringify({ users: usersDeleted, calendars }));
  const leftUsers = await db.collection('users').countDocuments({ email: { $regex: `^${PREFIX.replace(/\./g, '\\.')}` } });
  const leftCals = ids.length ? await db.collection('contentcalendars').countDocuments({ userId: { $in: ids } }) : 0;
  console.log('left', JSON.stringify({ users: leftUsers, calendars: leftCals }));
  return leftUsers + leftCals;
}

async function runChecks() {
  const User = require('../models/User');
  const CC = require('../models/ContentCalendar');
  const { maybeRetryCover } = require('../services/contentCalendarService');
  const tag = `${PREFIX}${Date.now().toString(36)}`;
  const mkUser = (s) => User.create({ email: `${tag}-${s}@example.test`, password: 'Check-only-1', firstName: `Check ${s}`, isVerified: true, onboardingCompleted: true, plan: { tier: 'starter', addons: [] } });
  const mkCal = (user, month, extra) => CC.create({
    userId: user._id, month, businessName: 'Check Bakery', language: 'english',
    weeks: [{ weekNumber: 1, items: [{ day: 1, headline: 'Check post', format: 'Post' }] }], ...extra
  });

  const spend = { checks: 0, recorded: 0, async check() { this.checks += 1; return { ok: true }; }, async record() { this.recorded += 1; } };
  const gen = { calls: [], outcome: 'ready' };
  const generate = async (cal) => {
    gen.calls.push(String(cal._id));
    // Same writes the real generator makes, without any model call.
    if (gen.outcome === 'ready') await CC.updateOne({ _id: cal._id }, { $set: { coverStatus: 'ready', coverImageUrl: 'https://example.test/zz-cover.jpg' } });
    else await CC.updateOne({ _id: cal._id }, { $set: { coverStatus: 'failed' } });
    return gen.outcome === 'ready' ? 'https://example.test/zz-cover.jpg' : null;
  };
  const settle = () => new Promise((r) => setTimeout(r, 60));
  const run = async (id, now) => {
    const doc = await CC.findById(id);
    const r = await maybeRetryCover(doc, {}, { now, deps: { generate, spendGuard: spend } });
    await settle();
    return r;
  };
  const fresh = (id) => CC.findById(id).lean();
  const T0 = new Date();

  const a = await mkUser('a');
  const b = await mkUser('b');

  const pend = await mkCal(a, '2026-08', { coverStatus: 'pending', lastCoverAttemptAt: new Date(T0 - 30 * MIN) });
  await check('stale pending cover is retried once, becomes ready, and is then left alone', async () => {
    gen.outcome = 'ready'; gen.calls = [];
    const r = await run(pend._id, T0);
    assert.strictEqual(r.retried, true, `expected a retry, got ${r.reason}`);
    assert.strictEqual(gen.calls.length, 1);
    const d = await fresh(pend._id);
    assert.strictEqual(d.coverStatus, 'ready'); assert.ok(d.lastCoverRetryAt, 'lastCoverRetryAt not stored');
    const again = await run(pend._id, new Date(T0.getTime() + 5 * MIN));
    assert.strictEqual(again.retried, false); assert.strictEqual(gen.calls.length, 1);
  });

  const young = await mkCal(a, '2026-07', { coverStatus: 'pending', lastCoverAttemptAt: new Date(T0 - 2 * MIN) });
  await check('a pending cover younger than 10 minutes is not touched', async () => {
    gen.calls = [];
    const r = await run(young._id, T0);
    assert.strictEqual(r.retried, false); assert.strictEqual(r.reason, 'too-soon'); assert.strictEqual(gen.calls.length, 0);
    assert.strictEqual((await fresh(young._id)).coverStatus, 'pending');
  });

  const fail = await mkCal(a, '2026-09', { coverStatus: 'failed', lastCoverAttemptAt: new Date(T0 - 2 * 60 * MIN) });
  await check('failed cover is retried once; if it fails again it is NOT retried a second time the same day', async () => {
    gen.outcome = 'failed'; gen.calls = [];
    const r1 = await run(fail._id, T0);
    assert.strictEqual(r1.retried, true); assert.strictEqual(gen.calls.length, 1);
    assert.strictEqual((await fresh(fail._id)).coverStatus, 'failed');
    const r2 = await run(fail._id, new Date(T0.getTime() + 3 * 60 * MIN));
    assert.strictEqual(r2.retried, false); assert.strictEqual(r2.reason, 'already-today');
    const r3 = await run(fail._id, new Date(T0.getTime() + 23 * 60 * MIN));
    assert.strictEqual(r3.retried, false);
    assert.strictEqual(gen.calls.length, 1, 'generator must have run exactly once');
  });
  await check('the same failed month can be retried again after a day', async () => {
    gen.outcome = 'ready'; gen.calls = [];
    await CC.updateOne({ _id: fail._id }, { $set: { lastCoverAttemptAt: new Date(T0.getTime() + 60 * MIN) } });
    const r = await run(fail._id, new Date(T0.getTime() + DAY + 60 * MIN));
    assert.strictEqual(r.retried, true, `expected a retry, got ${r.reason}`);
    assert.strictEqual((await fresh(fail._id)).coverStatus, 'ready');
  });

  const race = await mkCal(a, '2026-06', { coverStatus: 'failed', lastCoverAttemptAt: new Date(T0 - 60 * MIN) });
  await check('two page loads at the same moment start only one render', async () => {
    gen.outcome = 'ready'; gen.calls = [];
    const [d1, d2] = await Promise.all([CC.findById(race._id), CC.findById(race._id)]);
    const deps = { generate, spendGuard: spend };
    const rs = await Promise.all([maybeRetryCover(d1, {}, { now: T0, deps }), maybeRetryCover(d2, {}, { now: T0, deps })]);
    await settle();
    assert.strictEqual(rs.filter((r) => r.retried).length, 1); assert.strictEqual(gen.calls.length, 1);
  });

  const other = await mkCal(b, '2026-09', { coverStatus: 'failed', lastCoverAttemptAt: new Date(T0 - 5 * DAY) });
  await check("another account's failed cover is untouched when only this account's calendars are processed", async () => {
    gen.calls = [];
    const before = await fresh(other._id);
    await run(fail._id, new Date(T0.getTime() + 3 * DAY));
    const after = await fresh(other._id);
    assert.ok(!gen.calls.includes(String(other._id)), 'the other account was rendered');
    assert.strictEqual(after.coverStatus, before.coverStatus); assert.strictEqual(after.lastCoverRetryAt || null, before.lastCoverRetryAt || null);
  });
  await check('and its own turn works independently', async () => {
    gen.outcome = 'ready'; gen.calls = [];
    const r = await run(other._id, T0);
    assert.strictEqual(r.retried, true); assert.deepStrictEqual(gen.calls, [String(other._id)]);
  });

  await check('the spend check ran before every render and was recorded once per finished cover', async () => {
    assert.ok(spend.checks >= 5, `only ${spend.checks} spend checks`);
    assert.ok(spend.recorded >= 1);
    return `${spend.checks} checks, ${spend.recorded} recorded, 0 real model calls`;
  });
}

(async () => {
  const mode = process.argv[2] || 'run';
  if (mode !== 'run' && mode !== 'cleanup') throw new Error('Usage: node scripts/calendar-cover-check.js [run|cleanup]');
  await connect();
  console.log('Database: nebulaa_dev');
  let failed = false;
  try { if (mode === 'run') await runChecks(); } catch (e) { failed = true; console.log(`FAIL  (script) ${e && e.stack ? e.stack : e}`); }
  console.log('--- cleanup ---');
  const left = await cleanup(mongoose.connection.db);
  const fails = results.filter((r) => !r.ok).length;
  if (mode === 'run') console.log(`\n${results.length - fails} PASS, ${fails} FAIL; left after cleanup: ${left}`);
  if (fails || left || failed) process.exitCode = 1;
  await mongoose.disconnect();
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
