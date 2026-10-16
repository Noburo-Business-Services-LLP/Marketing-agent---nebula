'use strict';
/**
 * "Download my data": everything we hold about one account, in one readable file. Built from the same list that deletion uses,
 * so what can be erased is exactly what can be downloaded. Secrets (the password hash, login and social access tokens, one time
 * codes) are never included.
 */
const { erasable, filterFor } = require('./dataRegistry');

const SECRET = /password|token|secret|otp|privatekey|profilekey|apikey|refreshkey|passcode/i;
const MAX_PER_COLLECTION = 5000;

/** A copy of a value with every secret-looking field removed, however deep. */
function stripSecrets(value) {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (value && typeof value === 'object' && !(value instanceof Date) && !(value._bsontype)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET.test(k)) continue;
      if (k === '__v') continue;
      const clean = stripSecrets(v);
      // An object that held nothing but secrets leaves nothing behind.
      if (clean && typeof clean === 'object' && !Array.isArray(clean) && !(clean instanceof Date) && Object.keys(clean).length === 0 && v && Object.keys(v).length > 0) continue;
      out[k] = clean;
    }
    return out;
  }
  if (value && value._bsontype === 'ObjectId') return String(value);
  return value;
}

const README = [
  'This file is a copy of the data Nebulaa holds about your account.',
  'It was made for you at your request and is for you only.',
  'account: your sign-up details, business profile, plan, Quark balance and consent record.',
  'payments: the payments you made, with the invoice link for each.',
  'collections: everything you made or saved, one list per kind (posts, campaigns, videos, brand assets, inbox and so on).',
  'Pictures and videos are shown as links to the files, not copied in here.',
  'Not included: your password, login tokens, and the access keys for your connected social accounts.',
  'Invoices and payment records are kept by us for the period tax law requires, even if you later delete your account.',
  'Questions: support@nebulaa.ai'
];

/** `models` is a map of model name to mongoose model (injectable for tests). */
async function buildExport(userId, { User, models, now = new Date() } = {}) {
  const user = await User.findById(userId).lean();
  if (!user) return null;
  const { password, ...rest } = user;
  const account = stripSecrets({ ...rest, emailKey: undefined });
  const collections = {};
  const truncated = [];
  for (const rule of erasable()) {
    const Model = models[rule.model];
    if (!Model) continue;
    const docs = await Model.find(filterFor(rule, user._id)).limit(MAX_PER_COLLECTION + 1).lean();
    if (docs.length > MAX_PER_COLLECTION) { truncated.push(rule.model); docs.length = MAX_PER_COLLECTION; }
    if (docs.length) collections[rule.model] = docs.map(stripSecrets);
  }
  return {
    about: README,
    generatedAt: now.toISOString(),
    account,
    payments: stripSecrets(user.payments || []),
    collections,
    ...(truncated.length ? { note: `These lists were cut at ${MAX_PER_COLLECTION} items: ${truncated.join(', ')}. Write to support@nebulaa.ai for the rest.` } : {})
  };
}

module.exports = { buildExport, stripSecrets, MAX_PER_COLLECTION };
