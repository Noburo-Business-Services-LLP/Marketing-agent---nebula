/**
 * Adds Quarks to ONE account in the DEVELOPMENT database, for local testing. Refuses any other database.
 *   node scripts/add-dev-quarks.js <email> <quarks>
 */
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  const [email, amountRaw] = process.argv.slice(2);
  const amount = Number(amountRaw);
  if (!email || !Number.isInteger(amount) || amount < 1 || amount > 20000) throw new Error('Usage: node scripts/add-dev-quarks.js <email> <whole number 1-20000>');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  if (mongoose.connection.name !== 'nebulaa_dev') throw new Error(`Refusing: database is ${mongoose.connection.name}, not nebulaa_dev`);
  const User = require('../models/User');
  const user = await User.findOne({ email: String(email).toLowerCase() }).select('email credits.balance');
  if (!user) throw new Error(`No account with that email in the development database`);
  const before = (user.credits && user.credits.balance) || 0;
  const updated = await User.findByIdAndUpdate(user._id, {
    $inc: { 'credits.balance': amount },
    $push: { 'credits.history': { action: 'staff_grant', amount, description: `Local test top-up of ${amount} Quarks`, createdAt: new Date() } }
  }, { new: true }).select('credits.balance').lean();
  console.log(`${email}: ${before} -> ${updated.credits.balance} Quarks (development database)`);
  process.exit(0);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
