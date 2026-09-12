/**
 * One-off: rescale every credit balance for the Quark denomination change
 * ($0.08 -> $0.02 per Quark, so every PRICE was multiplied by 4).
 *
 * Without this, balances keep their old numbers against 4x prices and every
 * user silently loses 75% of their purchasing power.
 *
 * Idempotent by marker: writes credits.denominationVersion = 2 and skips any
 * user already carrying it, so re-running cannot double-scale anyone.
 *
 *   node scripts/migrateQuarkDenomination.js --dry-run
 *   node scripts/migrateQuarkDenomination.js --commit
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const FACTOR = 4;
const TARGET_VERSION = 2;
const commit = process.argv.includes('--commit');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const users = await User.find({
    'credits.denominationVersion': { $ne: TARGET_VERSION }
  }).select('email credits');

  console.log(`${users.length} user(s) to rescale by ${FACTOR}x  [${commit ? 'COMMIT' : 'DRY RUN'}]\n`);
  let totalBefore = 0, totalAfter = 0;

  for (const u of users) {
    const before = u.credits?.balance || 0;
    const after = Math.round(before * FACTOR);
    totalBefore += before; totalAfter += after;
    console.log(`  ${(u.email || u._id).padEnd(34)} ${String(before).padStart(7)} -> ${String(after).padStart(8)}`);
    if (commit) {
      u.credits.balance = after;
      // History is a ledger of past events priced in the OLD denomination.
      // Rescaling it would rewrite history; leaving it means old rows read in
      // old Quarks, which is why the version marker exists to date them.
      u.credits.denominationVersion = TARGET_VERSION;
      await u.save();
    }
  }

  console.log(`\n  total ${totalBefore} -> ${totalAfter}`);
  if (!commit) console.log('\nDry run only. Re-run with --commit to apply.');
  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
