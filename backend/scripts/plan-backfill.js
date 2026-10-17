/**
 * Starts the first plan for existing paying and managed accounts, one at a time and throttled.
 * The runs happen inside this process, so it waits for each one to finish (10 minutes at most) before the next
 * and exits only at the end.
 *   node scripts/plan-backfill.js [--limit 20] [--per-minute 3] [--yes]
 * Without --yes it is a DRY RUN and writes nothing. Outside nebulaa_dev it also needs CONFIRM_PROD=yes.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { selectForBackfill, throttleDelayMs, waitForRun, HARD_MAX, PLAN_RUN_INR_ESTIMATE } = require('../services/plan/backfill');

function argValue(args, name, fallback) {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const n = Number(args[i + 1]);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} needs a positive number`);
  return n;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ageDays = (d) => Math.floor((Date.now() - new Date(d).getTime()) / 86400000);

(async () => {
  const args = process.argv.slice(2);
  const yes = args.includes('--yes');
  const asked = argValue(args, '--limit', 20);
  const perMinute = argValue(args, '--per-minute', 3);
  const limit = Math.min(Math.floor(asked), HARD_MAX);
  if (asked > HARD_MAX) console.log(`Limit ${asked} is above the hard maximum; using ${HARD_MAX}.`);

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const dbName = mongoose.connection.name;
  console.log(`Database: ${dbName}`);
  if (yes && dbName !== 'nebulaa_dev' && process.env.CONFIRM_PROD !== 'yes') {
    console.log(`Refusing: ${dbName} is not the development database. Set CONFIRM_PROD=yes to run this against it on purpose.`);
    process.exit(1);
  }

  const User = require('../models/User');
  const Blueprint = require('../models/Blueprint');
  const users = await User.find({ staffRole: null, isCsm: { $ne: true }, isActive: { $ne: false }, onboardingCompleted: true }).lean();
  // A queued or processing run whose heartbeat stopped was lost by a restart: it is not a plan, so that account is picked again.
  const liveSince = new Date(Date.now() - require('../config/blueprint').LIMITS.STALE_MS);
  const have = await Blueprint.find({ kind: 'plan', $or: [{ status: 'completed' }, { status: { $in: ['queued', 'processing'] }, heartbeatAt: { $gte: liveSince } }] }).select('userId').lean();
  const hasPlanIds = new Set(have.map((b) => String(b.userId)));
  const blockedIds = new Set((await require('../services/backgroundGate').blockedAccountIdsSafe()).map(String));
  const { chosen, skipped } = selectForBackfill({ users, hasPlanIds, blockedIds, limit });
  const byId = new Map(users.map((u) => [String(u._id), u]));

  console.log(`${yes ? 'LIVE RUN' : 'DRY RUN (nothing is written)'}: ${chosen.length} to start, ${skipped.length} skipped, limit ${limit}, ${perMinute} per minute`);
  chosen.forEach((u) => console.log(`  would plan: ${u.email} | ${(u.plan && u.plan.tier) || 'n/a'} | ${ageDays(u.createdAt)} days old`));
  skipped.forEach((s) => { const u = byId.get(String(s.id)); console.log(`  skipped: ${u ? u.email : s.id} | ${s.why}`); });
  console.log(`Estimated cost: about Rs ${chosen.length * PLAN_RUN_INR_ESTIMATE} (${chosen.length} x Rs ${PLAN_RUN_INR_ESTIMATE})`);
  if (!yes) { console.log('Dry run only. Add --yes to start the runs.'); process.exit(0); }

  const { createPlanService } = require('../services/plan/planService');
  const planService = createPlanService();
  const delay = throttleDelayMs(perMinute);
  let started = 0; let finished = 0;
  for (let i = 0; i < chosen.length; i++) {
    const u = chosen[i];
    const r = await planService.startPlan({ userId: String(u._id), reason: 'backfill' });
    console.log(`  ${u.email}: ${r.ok ? (r.alreadyRunning ? 'already running' : `started ${r.id}`) : `not started (${r.reason})`}`);
    if (!r.ok && (r.reason === 'busy' || r.reason === 'daily_cap')) { console.log(`Stopping: the system is ${r.reason === 'busy' ? 'busy or switched off' : 'at its daily plan limit'}. Run it again later.`); break; }
    if (r.ok && !r.alreadyRunning) {
      started++;
      // The run is in this process: wait for it to end, so only one runs at a time and nothing is killed by the exit.
      const out = await waitForRun({ id: r.id, findRun: (id) => Blueprint.findOne({ blueprintId: id }).select('status stop error').lean(), sleep });
      if (out.status === 'completed') finished++;
      console.log(`    -> ${out.status}${out.stop && out.stop.message ? `: ${out.stop.message}` : ''}`);
    }
    if (i < chosen.length - 1) await sleep(delay);
  }
  console.log(`Done: ${started} started, ${finished} completed, out of ${chosen.length}.`);
  process.exit(0);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
