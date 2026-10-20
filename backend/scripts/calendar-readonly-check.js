/**
 * Real-database check that GET /api/content-calendar and /history only read (load-test week 1), against the
 * DEVELOPMENT database. Refuses any database except nebulaa_dev. NO AI call, nothing charged: POST /prepare (which
 * would make a calendar with the model) is never called here; the routes run inside this process on a random
 * 127.0.0.1 port with a real token for a throwaway user (email starts with "zz.calchk-"), deleted at the end.
 *   node scripts/calendar-readonly-check.js          run, print PASS/FAIL, clean up
 *   node scripts/calendar-readonly-check.js cleanup  delete leftovers of an interrupted run
 */
require('dotenv').config();
const mongoose = require('mongoose');
const express = require('express');
const assert = require('assert');

const PREFIX = 'zz.calchk-';
const DEV_DB = 'nebulaa_dev';
const results = [];
async function check(name, fn) {
  try { const d = await fn(); results.push(true); console.log(`PASS  ${name}${d ? ` (${d})` : ''}`); } catch (e) { results.push(false); console.log(`FAIL  ${name}: ${e && e.message}`); }
}

async function cleanup(db) {
  const ids = (await db.collection('users').find({ email: { $regex: `^${PREFIX.replace(/\./g, '\\.')}` } }, { projection: { _id: 1 } }).toArray()).map((u) => u._id);
  if (ids.length) {
    await db.collection('contentcalendars').deleteMany({ userId: { $in: ids } });
    await db.collection('users').deleteMany({ _id: { $in: ids } });
  }
  return ids.length;
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set (run from the backend folder so .env is found).');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  if (mongoose.connection.name !== DEV_DB) throw new Error(`Refusing: database is ${mongoose.connection.name}, not ${DEV_DB}`);
  const db = mongoose.connection.db;
  if (process.argv.includes('cleanup')) { console.log(`removed ${await cleanup(db)} account(s)`); return; }
  await cleanup(db);

  const User = require('../models/User');
  const { generateToken } = require('../middleware/auth');
  const { calendarMonth } = require('../services/contentCalendarService');
  const app = express();
  app.use(express.json());
  app.use('/api/content-calendar', require('../routes/contentCalendar'));
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const port = server.address().port;
  if ([3000, 3200, 5000].includes(port)) throw new Error('reserved port');

  try {
    const user = await User.create({ email: `${PREFIX}${Date.now()}@example.test`, password: 'Check-only-1', firstName: 'Cal', isVerified: true, onboardingCompleted: true, businessProfile: { name: 'Cal Check Bakery' } });
    const token = generateToken(user._id);
    const get = async (p) => { const r = await fetch(`http://127.0.0.1:${port}/api/content-calendar${p}`, { headers: { Authorization: `Bearer ${token}` } }); return { status: r.status, body: await r.json() }; };
    const count = () => db.collection('contentcalendars').countDocuments({ userId: user._id });

    await check('no calendar: GET answers "not prepared yet" quickly and creates nothing', async () => {
      const t0 = Date.now();
      const r = await get('');
      const ms = Date.now() - t0;
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.status, 'not_prepared');
      assert.strictEqual(r.body.calendar, null);
      assert.strictEqual(await count(), 0);
      assert.ok(ms < 3000, `${ms} ms`);
      return `${ms} ms`;
    });

    const old = new Date(Date.now() - 3 * 864e5);
    const inserted = await db.collection('contentcalendars').insertOne({
      userId: user._id, month: calendarMonth(), businessName: 'Cal Check Bakery', coverStatus: 'failed', autoCoverRetries: 0,
      lastCoverAttemptAt: old, lastCoverRetryAt: null, createdAt: old, updatedAt: old,
      weeks: [{ _id: new mongoose.Types.ObjectId(), weekNumber: 1, items: [{ _id: new mongoose.Types.ObjectId(), day: 1, format: 'post', headline: 'Fresh bread', status: 'draft' }] }]
    });
    const before = await db.collection('contentcalendars').findOne({ _id: inserted.insertedId });

    await check('calendar with a failed cover: GET returns it as ready and changes nothing (no cover retry)', async () => {
      const r = await get('');
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.status, 'ready');
      assert.strictEqual(String(r.body.calendar._id), String(inserted.insertedId));
      assert.strictEqual(r.body.calendar.weeks[0].items[0].headline, 'Fresh bread');
      await new Promise((ok) => setTimeout(ok, 300));
      const after = await db.collection('contentcalendars').findOne({ _id: inserted.insertedId });
      assert.deepStrictEqual(after, before);
    });

    await check('history only reads', async () => {
      const r = await get('/history');
      assert.strictEqual(r.body.calendars.length, 1);
      await new Promise((ok) => setTimeout(ok, 300));
      assert.deepStrictEqual(await db.collection('contentcalendars').findOne({ _id: inserted.insertedId }), before);
      assert.strictEqual(await count(), 1);
    });
  } finally {
    server.close();
    console.log(`cleanup: removed ${await cleanup(db)} throwaway account(s) and their calendars`);
    await mongoose.disconnect();
  }
  const failed = results.filter((ok) => !ok).length;
  console.log(`${results.length - failed} of ${results.length} PASS`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error('FAILED:', e && e.message); process.exitCode = 1; });
