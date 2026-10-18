/** Throwaway verified user in nebulaa_dev for looking at the Videos flow. Refuses any other database. setup | cleanup */
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  if (mongoose.connection.name !== 'nebulaa_dev') throw new Error(`Refusing: database is ${mongoose.connection.name}`);
  const User = require('../models/User');
  if (process.argv[2] === 'cleanup') {
    const r = await User.deleteMany({ email: /^uicheck6-.*@example\.test$/ });
    console.log('deleted', r.deletedCount); return process.exit(0);
  }
  const { generateToken } = require('../middleware/auth');
  const legal = require('../config/legalVersions');
  const u = await User.create({ email: `uicheck6-${Date.now()}@example.test`, password: 'Check-only-1', firstName: 'Check', isVerified: true, onboardingCompleted: true,
    plan: { tier: 'starter' }, consent: { termsVersion: legal.TERMS_VERSION, privacyVersion: legal.PRIVACY_VERSION, acceptedAt: new Date(), source: 'ui-check' },
    credits: { balance: 250, planBalance: 250, planExpiresAt: new Date(Date.now() + 20 * 864e5) } });
  console.log('TOKEN', generateToken(u._id)); process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
