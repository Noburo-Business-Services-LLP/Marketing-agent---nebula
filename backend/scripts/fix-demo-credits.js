require('dotenv').config();
const mongoose = require('mongoose');

const DEMO_URI = process.env.MONGODB_URI.replace('/nebulaa?', '/nebulaa_demo?');

(async () => {
  console.log('Connecting to nebulaa_demo...');
  await mongoose.connect(DEMO_URI);
  const db = mongoose.connection.db;
  const users = db.collection('users');

  const trialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // Reset ALL users: balance to 100, remove old monthly fields, set trial
  const result = await users.updateMany(
    {},
    {
      $set: {
        'credits.balance': 100,
        'credits.totalUsed': 0,
        'trial.startDate': new Date(),
        'trial.expiresAt': trialEnd,
        'trial.isExpired': false
      },
      $unset: {
        'credits.monthlyAllowance': '',
        'credits.cycleStart': '',
        'credits.cycleEnd': '',
        'credits.lastLoginBonus': ''
      }
    }
  );
  console.log('Reset', result.modifiedCount, 'users to 100 credits + 7-day trial');

  // Verify
  const sample = await users.find({}, { projection: { email: 1, 'credits.balance': 1, 'credits.monthlyAllowance': 1, 'trial.expiresAt': 1 } }).toArray();
  sample.forEach(u => {
    console.log(u.email, '- Balance:', u.credits?.balance, '- Monthly:', u.credits?.monthlyAllowance || 'removed', '- Trial:', u.trial?.expiresAt ? 'set' : 'none');
  });

  await mongoose.disconnect();
  console.log('Done');
})();
