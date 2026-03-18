require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const users = db.collection('users');

  const now = new Date();
  const cycleStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const cycleEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  // Restore users with balance=100 back to 1000 with monthly cycle
  const result = await users.updateMany(
    { 'credits.balance': 100 },
    {
      $set: {
        'credits.balance': 1000,
        'credits.monthlyAllowance': 1000,
        'credits.totalUsed': 0,
        'credits.cycleStart': cycleStart,
        'credits.cycleEnd': cycleEnd,
        'credits.lastLoginBonus': null
      }
    }
  );
  console.log('Restored', result.modifiedCount, 'users to 1000 credits');

  // Verify
  const all = await users.find({}, { projection: { email: 1, 'credits.balance': 1, 'credits.monthlyAllowance': 1 } }).toArray();
  all.forEach(u => {
    console.log(u.email, '- Balance:', u.credits?.balance, '- Monthly:', u.credits?.monthlyAllowance);
  });

  await mongoose.disconnect();
  console.log('Done');
})();
