/**
 * Shows what deleting ONE account would erase. Changes nothing, in any database.
 *   node scripts/account-purge-dryrun.js <email>
 */
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  const email = String(process.argv[2] || '').toLowerCase();
  if (!email) throw new Error('Usage: node scripts/account-purge-dryrun.js <email>');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const del = require('../services/accountDeletion');
  const { erasable, filterFor } = require('../services/dataRegistry');
  const { extractAssets } = require('../services/cloudinaryCleanup');
  const models = del.defaultModels();
  const user = await models.User.findOne({ email }).lean();
  if (!user) throw new Error('No account with that email in this database');
  console.log(`Database: ${mongoose.connection.name}\nAccount: ${email} (${user._id})\n`);
  const files = new Map();
  const add = (t) => extractAssets(t).forEach((a) => files.set(`${a.resourceType}:${a.publicId}`, a));
  add(JSON.stringify(user));
  let total = 0;
  for (const rule of erasable()) {
    const Model = models[rule.model];
    const filter = filterFor(rule, user._id);
    const n = await Model.countDocuments(filter);
    if (!n) continue;
    total += n;
    console.log(`  ${rule.model.padEnd(28)} ${n} would be erased`);
    for await (const doc of Model.find(filter).lean().cursor()) add(JSON.stringify(doc));
  }
  console.log(`\nRecords to erase: ${total}\nFiles in Cloudinary to erase: ${files.size}`);
  console.log(`Payments kept for tax: ${(user.payments || []).length}`);
  console.log(`Connected social profile: ${user.ayrshare && user.ayrshare.profileKey ? 'yes, would be deleted' : 'none'}`);
  const e = del.eligibility(user, { isStaff: require('../services/staff/permissions').isStaff, resolveTier: require('../config/entitlements').resolveTier });
  console.log(`Allowed to self-delete: ${e.ok ? 'yes' : 'no - ' + e.message}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
