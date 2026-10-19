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

  const spend = { checks: 0, recorded: 0, text: 0, image: 0, rendered: 0, async check() { this.checks += 1; return { ok: true }; }, async record(a) { this.recorded += 1; if (a === 'campaign_text') this.text += 1; if (a === 'image_generated') this.image += 1; } };
  const gen = { calls: [], outcome: 'ready' };
  const generate = async (cal) => {
    gen.calls.push(String(cal._id)); spend.rendered += 1;
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
  // A fixed moment (15 Oct 2026, India time) so "this month" and "next month" are known: 2026-10 and 2026-11.
  const T0 = new Date('2026-10-15T06:00:00Z');
  const M0 = '2026-10'; const M1 = '2026-11'; const OLD = '2026-09';
  // The unique key is userId+month, so each scenario that needs its own current month gets its own throwaway user.
  const users = {};
  const U = async (s) => (users[s] = users[s] || await mkUser(s));

  const pend = await mkCal(await U('pend'), M0, { coverStatus: 'pending', lastCoverAttemptAt: new Date(T0 - 30 * MIN) });
  await check('stale pending cover is retried once, becomes ready, and is then left alone', async () => {
    gen.outcome = 'ready'; gen.calls = [];
    const r = await run(pend._id, T0);
    assert.strictEqual(r.retried, true, `expected a retry, got ${r.reason}`);
    assert.strictEqual(gen.calls.length, 1);
    const d = await fresh(pend._id);
    assert.strictEqual(d.coverStatus, 'ready'); assert.ok(d.lastCoverRetryAt, 'lastCoverRetryAt not stored');
    assert.strictEqual(d.autoCoverRetries, 1);
    const again = await run(pend._id, new Date(T0.getTime() + 5 * MIN));
    assert.strictEqual(again.retried, false); assert.strictEqual(gen.calls.length, 1);
  });

  const young = await mkCal(await U('young'), M0, { coverStatus: 'pending', lastCoverAttemptAt: new Date(T0 - 2 * MIN) });
  await check('a pending cover younger than 10 minutes is not touched', async () => {
    gen.calls = [];
    const r = await run(young._id, T0);
    assert.strictEqual(r.retried, false); assert.strictEqual(r.reason, 'too-soon'); assert.strictEqual(gen.calls.length, 0);
    assert.strictEqual((await fresh(young._id)).coverStatus, 'pending');
  });

  const failUser = await U('fail');
  const fail = await mkCal(failUser, M0, { coverStatus: 'failed', lastCoverAttemptAt: new Date(T0 - 2 * 60 * MIN) });
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

  const race = await mkCal(await U('race'), M0, { coverStatus: 'failed', lastCoverAttemptAt: new Date(T0 - 60 * MIN) });
  await check('two page loads at the same moment start only one render', async () => {
    gen.outcome = 'ready'; gen.calls = [];
    const [d1, d2] = await Promise.all([CC.findById(race._id), CC.findById(race._id)]);
    const deps = { generate, spendGuard: spend };
    const rs = await Promise.all([maybeRetryCover(d1, {}, { now: T0, deps }), maybeRetryCover(d2, {}, { now: T0, deps })]);
    await settle();
    assert.strictEqual(rs.filter((r) => r.retried).length, 1); assert.strictEqual(gen.calls.length, 1);
  });

  const other = await mkCal(await U('b'), M0, { coverStatus: 'failed', lastCoverAttemptAt: new Date(T0 - 5 * DAY) });
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

  const nextM = await mkCal(await U('next'), M1, { coverStatus: 'failed', lastCoverAttemptAt: new Date(T0 - 2 * 60 * MIN) });
  await check('next month (India time) is retried too', async () => {
    gen.outcome = 'ready'; gen.calls = [];
    const r = await run(nextM._id, T0);
    assert.strictEqual(r.retried, true, `expected a retry, got ${r.reason}`);
  });

  const oldU = await U('old');
  const old1 = await mkCal(oldU, OLD, { coverStatus: 'failed', lastCoverAttemptAt: new Date(T0 - 5 * DAY) });
  const old2 = await mkCal(oldU, '2026-08', { coverStatus: 'pending', lastCoverAttemptAt: new Date(T0 - 5 * DAY) });
  await check('an old month is never retried, failed or stuck pending, and nothing is written', async () => {
    gen.calls = [];
    for (const c of [old1, old2]) {
      const r = await run(c._id, T0);
      assert.strictEqual(r.retried, false); assert.strictEqual(r.reason, 'old-month');
      const d = await fresh(c._id);
      assert.strictEqual(d.coverStatus, c.coverStatus); assert.ok(!d.autoCoverRetries);
    }
    assert.strictEqual(gen.calls.length, 0);
  });
  await check('the month is judged in India time: 20:00 UTC on 30 Sep is already October there, 17:00 UTC is not', async () => {
    const edge = await mkCal(await U('edge'), '2026-10', { coverStatus: 'failed', lastCoverAttemptAt: new Date('2026-09-20T00:00:00Z') });
    gen.calls = [];
    const r = await run(edge._id, new Date('2026-09-30T20:00:00Z'));
    assert.strictEqual(r.retried, true, `got ${r.reason}`); // IST 1 Oct: this month
    const lateSep = await mkCal(await U('edge2'), '2026-08', { coverStatus: 'failed', lastCoverAttemptAt: new Date('2026-09-01T00:00:00Z') });
    const r2 = await run(lateSep._id, new Date('2026-09-30T17:00:00Z')); // IST 30 Sep: Aug is old
    assert.strictEqual(r2.reason, 'old-month');
  });

  const cap = await mkCal(await U('cap'), M0, { coverStatus: 'failed', lastCoverAttemptAt: new Date(T0 - 5 * DAY), autoCoverRetries: 2 });
  await check('lifetime cap: 3 automatic retries per calendar, then never again, however many days pass', async () => {
    gen.outcome = 'failed'; gen.calls = [];
    const r3 = await run(cap._id, T0);
    assert.strictEqual(r3.retried, true, `third retry should run, got ${r3.reason}`);
    assert.strictEqual((await fresh(cap._id)).autoCoverRetries, 3);
    for (let i = 2; i <= 6; i++) {
      const r = await run(cap._id, new Date(T0.getTime() + i * 2 * DAY));
      assert.strictEqual(r.retried, false); assert.strictEqual(r.reason, 'retry-limit');
    }
    assert.strictEqual(gen.calls.length, 1); assert.strictEqual((await fresh(cap._id)).autoCoverRetries, 3);
  });

  await check('manual "Make a cover": 3 a day per account across months (real model, fake generator), a 4th is refused, a new day resets', async () => {
    const { startManualCover } = require('../services/contentCalendarService');
    const mu = await U('manual');
    const docs = [];
    for (const m of [M0, M1, OLD, '2026-08']) docs.push(await mkCal(mu, m, { coverStatus: 'ready', lastCoverAttemptAt: new Date(T0 - 60 * MIN) }));
    gen.outcome = 'ready'; gen.calls = [];
    const deps = { generate, spendGuard: spend };
    const go = async (d, now) => { const r = await startManualCover(await CC.findById(d._id), {}, { now, deps }); await settle(); return r; };
    for (const d of docs.slice(0, 3)) assert.strictEqual((await go(d, T0)).started, true);
    const fourth = await go(docs[3], T0);
    assert.strictEqual(fourth.started, false); assert.strictEqual(fourth.reason, 'daily-cap');
    assert.strictEqual(gen.calls.length, 3);
    const total = (await CC.find({ userId: mu._id }).lean()).reduce((n, c) => n + Number((c.manualCoverDays || {})['2026-10-15'] || 0), 0);
    assert.strictEqual(total, 3);
    const next = await go(docs[3], new Date(T0.getTime() + DAY));
    assert.strictEqual(next.started, true, `new day should reset, got ${next.reason}`);
  });

  await check('the spend check ran before every render and was recorded once per finished cover', async () => {
    assert.ok(spend.checks >= 5, `only ${spend.checks} spend checks`);
    assert.ok(spend.recorded >= 1);
    // Every render is recorded as one text call (campaign_text) plus one image when it produced a cover.
    assert.strictEqual(spend.text, spend.rendered, 'one campaign_text per render');
    assert.ok(spend.image >= 1 && spend.image <= spend.text, 'image recorded only for covers that were made');
    return `${spend.checks} checks, ${spend.text} text + ${spend.image} image recorded, 0 real model calls`;
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
