/**
 * Seeds made-up data so the staff screens (Home, Clients, client page, Team) can be tried against the
 * real routes. Every name is fake and every email ends in @example.test.
 *
 * SAFETY: refuses to run unless MONGODB_URI points at a LOCAL host and a database whose name starts
 * with `nebulaa_seed_`. It empties the users, drafts, featureevents and staffactions collections of
 * that database first. Never point it at a real database.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:27018/nebulaa_seed_staff node scripts/seed-staff-demo.js
 *
 * Sign-in for the seeded team: the emails and password printed at the end (password below, invented).
 * The data is deterministic (fixed random seed) except that dates are relative to the moment you run it.
 */
const SEED_PASSWORD = process.env.SEED_PASSWORD || 'SeedDemo-Staff-2026';
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const DB_PREFIX = 'nebulaa_seed_';

/** Throws (with a plain reason) unless the address is a single local host and a nebulaa_seed_ database. */
function assertSafeTarget(uri) {
  if (!uri || typeof uri !== 'string') throw new Error('Set MONGODB_URI to a local throwaway database, for example mongodb://127.0.0.1:27018/nebulaa_seed_staff');
  const m = /^mongodb:\/\/(?:[^@/]*@)?([^/?]+)(?:\/([^?]*))?(?:\?.*)?$/.exec(uri.trim());
  if (!m) throw new Error('MONGODB_URI is not a plain mongodb:// address; the seed only runs against a local host (no SRV, no lists)');
  const hostPort = m[1];
  if (hostPort.includes(',')) throw new Error('MONGODB_URI lists more than one host; the seed only runs against one local host');
  const host = hostPort.startsWith('[') ? hostPort.replace(/\]:\d+$/, ']') : hostPort.replace(/:\d+$/, '');
  if (!LOCAL_HOSTS.includes(host)) throw new Error(`Host "${host}" is not local; the seed only runs against localhost or 127.0.0.1`);
  const db = decodeURIComponent(m[2] || '');
  if (!db.startsWith(DB_PREFIX)) throw new Error(`The database name must start with ${DB_PREFIX} (got "${db}")`);
  return { host, db };
}

// ---- deterministic random numbers -------------------------------------------------------------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86400000;
const BUSINESS_WORDS = ['Annapurna', 'Lakshmi', 'Kaveri', 'Madurai', 'Saraswati', 'Gokul', 'Ganga', 'Vijaya', 'Chola', 'Meenakshi', 'Surya', 'Nandi', 'Hampi', 'Jaipur', 'Konark', 'Malabar', 'Ajanta', 'Rangoli', 'Tulsi', 'Bharat'];
const BUSINESS_TYPES = ['Sweets', 'Textiles', 'Bakery', 'Tutors', 'Clinic', 'Boutique', 'Salon', 'Hardware', 'Organics', 'Studio', 'Travels', 'Jewellers', 'Dental Care', 'Fitness', 'Florists'];
const FIRST = ['Arun', 'Bala', 'Charu', 'Deepa', 'Farhan', 'Gita', 'Hari', 'Indu', 'Jai', 'Kavya', 'Lata', 'Mohan', 'Nisha', 'Om', 'Preeti', 'Qadir', 'Ravi', 'Sana', 'Tara', 'Uday'];
const LAST = ['Demo', 'Sample', 'Test', 'Fake'];
const INDUSTRIES = ['Food and drink', 'Fashion', 'Health', 'Education', 'Retail', 'Travel', 'Beauty'];
const CITIES = ['Chennai', 'Pune', 'Jaipur', 'Kochi', 'Indore', 'Surat'];
const PLATFORMS = ['instagram', 'facebook', 'linkedin', 'twitter', 'gmb', 'youtube'];
const FEATURES = ['create_post', 'generate_image', 'schedule_post', 'video', 'blueprint', 'caption'];

const set = (...n) => new Set(n);
// Which of the 60 clients (index 0..59) have each trait. Kept explicit so counts are easy to reason about.
const TRAITS = {
  inactive: set(3, 6, 9, 12, 17, 19, 21, 23, 26, 28, 33, 36, 39, 42, 47, 50, 53, 56, 58),
  disabled: set(14, 28, 39, 56),
  lowQuarks: { 2: 0, 7: 45, 13: 80, 18: 99, 25: 12, 31: 60, 41: 99, 44: 5, 52: 0 },
  exactly100: set(40),
  draftsWaiting: set(1, 4, 8, 11, 16, 22, 27, 30, 35, 43, 45, 48),
  noSocial: set(5, 10, 20, 24, 29, 34, 43, 46, 49, 55, 57, 59),
  failedRecent: set(0, 2, 5, 9, 15, 21, 32, 38, 46, 51),
  failedOld: set(3, 12),
  unfinished: set(8, 13, 19, 26, 31, 37, 42, 48, 54),
  expiredTrial: set(20, 21, 22, 23, 24),
  failedPaymentOnly: set(15),
  refundedOnly: set(16)
};

function planFor(i) {
  if (i < 5) return { plan: undefined, tier: 'managed' }; // older accounts have no plan.tier
  if (i < 15) return { plan: { tier: 'managed', addons: [] }, tier: 'managed' };
  if (i < 30) return { plan: { tier: 'free', addons: [] }, tier: 'free' };
  if (i < 45) return { plan: { tier: 'starter', addons: i % 3 === 0 ? ['publish'] : i % 3 === 1 ? ['publish', 'inbox'] : [] }, tier: 'starter' };
  return { plan: { tier: 'professional', addons: i % 2 === 0 ? ['bundle'] : ['publish'] }, tier: 'professional' };
}

const PAYING = (i) => (i >= 0 && i <= 9) || (i >= 30 && i <= 37) || (i >= 45 && i <= 54);
const ACTIVE_SUB = (i) => (i >= 30 && i <= 34) || (i >= 45 && i <= 54);

/** Builds every document in memory (no database), so the plan can be inspected or tested. */
function buildData(now = Date.now(), passwordHash = 'x'.repeat(60)) {
  const rand = rng(20261007);
  const between = (a, b) => a + rand() * (b - a);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const ago = (days) => new Date(now - days * DAY);

  const staff = [
    { key: 'owner', email: 'aarav.owner@example.test', firstName: 'Aarav', lastName: 'Demo', staffRole: 'owner' },
    { key: 'admin', email: 'bhavna.admin@example.test', firstName: 'Bhavna', lastName: 'Demo', staffRole: 'admin' },
    { key: 'csm1', email: 'chitra.csm@example.test', firstName: 'Chitra', lastName: 'Demo', staffRole: 'csm', isCsm: true },
    { key: 'csm2', email: 'dev.csm@example.test', firstName: 'Dev', lastName: 'Demo', staffRole: 'csm', isCsm: true },
    { key: 'csm3', email: 'esha.csm@example.test', firstName: 'Esha', lastName: 'Demo', staffRole: 'csm', isCsm: true }
  ].map((s, n) => ({
    ...s, password: passwordHash, companyName: 'Nebulaa', isVerified: true, isActive: true, isHidden: true,
    onboardingCompleted: true, lastLoginAt: ago(n * 0.3), createdAt: ago(200), updatedAt: ago(1)
  }));

  // Who gets which CSM: a fixed shuffle so the loads are 18 / 9 / 3 and 30 clients have none.
  const order = Array.from({ length: 60 }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const csmOf = {};
  order.slice(0, 18).forEach((i) => { csmOf[i] = 'csm1'; });
  order.slice(18, 27).forEach((i) => { csmOf[i] = 'csm2'; });
  order.slice(27, 30).forEach((i) => { csmOf[i] = 'csm3'; });

  const clients = [];
  const events = []; // { client index, feature, at }
  const drafts = []; // { client index, status, createdAt, updatedAt }

  for (let i = 0; i < 62; i++) {
    const hiddenTest = i >= 60;
    const idx = hiddenTest ? i : i;
    const word = BUSINESS_WORDS[i % BUSINESS_WORDS.length];
    const type = BUSINESS_TYPES[(i * 7 + 3) % BUSINESS_TYPES.length];
    const business = hiddenTest ? `Demo Hidden Test ${i - 59}` : `Demo ${word} ${type}`;
    const inactive = TRAITS.inactive.has(i);

    // Sign-up date: most in the last 30 days (a few today and yesterday), some in the 30 days before.
    let ageDays;
    if (i % 20 === 4) ageDays = between(0.05, 0.9); // today
    else if (i % 20 === 11) ageDays = between(1.1, 1.9); // yesterday
    else if (i % 6 === 0 || inactive) ageDays = between(inactive ? 12 : 31, inactive ? 29 : 75);
    else ageDays = between(2, 29.5);
    const createdAt = ago(ageDays);

    // Last sign-in: active clients within 6 days, inactive ones 8+ days ago (after sign-up).
    const lastLoginAt = inactive
      ? new Date(createdAt.getTime() + rand() * Math.max(0, (now - 8 * DAY) - createdAt.getTime()))
      : new Date(Math.max(createdAt.getTime(), now - between(0.05, 6) * DAY));

    const { plan, tier } = planFor(i);
    const paid = PAYING(i);
    const payments = [];
    if (paid) {
      const n = 1 + (i % 3);
      for (let k = 0; k < n; k++) payments.push({ razorpayOrderId: `order_demo_${i}_${k}`, razorpayPaymentId: `pay_demo_${i}_${k}`, amount: tier === 'professional' ? 7999 : tier === 'starter' ? 2999 : 14999, currency: 'INR', status: 'paid', item: tier === 'managed' ? 'Managed plan' : `${tier[0].toUpperCase()}${tier.slice(1)} plan`, paidAt: new Date(Math.max(createdAt.getTime() + DAY / 2, now - (k * 30 + between(1, 20)) * DAY)) });
    }
    if (TRAITS.failedPaymentOnly.has(i)) payments.push({ razorpayOrderId: `order_demo_${i}_f`, amount: 2999, currency: 'INR', status: 'failed', item: 'Starter plan', paidAt: ago(Math.min(ageDays, 3)) });
    if (TRAITS.refundedOnly.has(i)) payments.push({ razorpayOrderId: `order_demo_${i}_r`, amount: 499, currency: 'INR', status: 'refunded', item: 'Quark pack', paidAt: ago(Math.min(ageDays, 5)) });

    const planDoc = plan ? { ...plan, subscriptions: ACTIVE_SUB(i) ? [{ subscriptionId: `sub_demo_${i}`, kind: 'plan', key: tier, active: true, createdAt: createdAt }] : [] } : undefined;
    const trial = tier === 'free' || (!paid && tier !== 'managed')
      ? { startDate: createdAt, expiresAt: new Date(createdAt.getTime() + 14 * DAY), isExpired: TRAITS.expiredTrial.has(i) }
      : undefined;

    const quarks = TRAITS.lowQuarks[i] !== undefined ? TRAITS.lowQuarks[i] : TRAITS.exactly100.has(i) ? 100 : Math.round(between(150, 4200));
    const connected = hiddenTest ? 1 : TRAITS.noSocial.has(i) ? 0 : 1 + Math.floor(rand() * 4);
    const platforms = Array.from(new Set(Array.from({ length: connected }, () => pick(PLATFORMS))));
    const viaDirect = i % 4 === 0; // some accounts store connections directly, most through the posting provider

    const first = FIRST[i % FIRST.length];
    clients.push({
      key: `c${i}`, index: i,
      email: hiddenTest ? `demo.hidden${i - 59}@example.test` : `demo.client${String(i + 1).padStart(2, '0')}@example.test`,
      password: passwordHash, firstName: first, lastName: LAST[i % LAST.length], companyName: business,
      mobileNumber: `+91 90000 ${String(10000 + i).slice(-5)}`,
      isVerified: true, isActive: !TRAITS.disabled.has(i), isHidden: hiddenTest,
      onboardingCompleted: !TRAITS.unfinished.has(i),
      businessProfile: { name: i % 2 === 0 ? business : '', industry: INDUSTRIES[i % INDUSTRIES.length], businessLocation: CITIES[i % CITIES.length], website: `https://demo-${word.toLowerCase()}.example.test` },
      credits: { balance: quarks, totalUsed: Math.round(between(0, 3000)), history: [] },
      payments, plan: planDoc, ...(trial ? { trial } : {}),
      connectedSocials: viaDirect ? platforms.map((p) => ({ platform: p, accountId: `acct_${i}_${p}`, accountName: `${business} ${p}`, connectedAt: createdAt })) : [],
      ayrshare: { activeSocialAccounts: viaDirect ? [] : platforms },
      assignedCsm: csmOf[i] || null, // replaced with the real id when inserted
      lastLoginAt, createdAt, updatedAt: lastLoginAt
    });
    if (csmOf[i]) clients[clients.length - 1].csmKey = csmOf[i];

    // Feature use: active clients used something in the last 7 days; inactive ones only before that.
    const first7 = Math.max(0, Math.min(ageDays, 7));
    const nEvents = 3 + Math.floor(rand() * 30);
    for (let k = 0; k < nEvents; k++) {
      let when;
      if (inactive) {
        const oldest = Math.max(8.5, ageDays - 0.05);
        if (ageDays < 8.5) break;
        when = between(8.5, Math.min(30, oldest));
      } else {
        when = k === 0 ? between(0.02, Math.max(0.03, Math.min(first7, 6.5))) : between(0.02, Math.min(30, Math.max(0.05, ageDays - 0.02)));
      }
      events.push({ index: i, feature: pick(FEATURES), at: ago(when) });
    }

    // Drafts: some waiting more than 3 days, fresh ones, published ones, failed ones.
    const make = (status, minDays, maxDays) => {
      const d = Math.min(between(minDays, maxDays), Math.max(0.02, ageDays - 0.02));
      const at = ago(d);
      drafts.push({ index: i, status, createdAt: at, updatedAt: status === 'draft' ? at : new Date(at.getTime() + DAY / 4 > now ? now : at.getTime() + DAY / 4) });
    };
    if (TRAITS.draftsWaiting.has(i)) { make('draft', 4.2, 12); make('draft', 0.1, 3); }
    else if (i % 3 !== 0) make('draft', 0.1, 2.5);
    const published = i % 4;
    for (let k = 0; k < published; k++) make('published', 0.5, 20);
    if (TRAITS.failedRecent.has(i)) {
      const n = 1 + (i % 3);
      for (let k = 0; k < n; k++) { const at = ago(between(0.1, 6.5)); drafts.push({ index: i, status: 'failed', createdAt: new Date(Math.min(at.getTime(), createdAt.getTime() + 1)), updatedAt: at }); }
    }
    if (TRAITS.failedOld.has(i)) { const at = ago(between(10, 20)); drafts.push({ index: i, status: 'failed', createdAt: at, updatedAt: at }); }
  }

  // A few Quark history lines so the client page has something to show.
  clients.slice(0, 12).forEach((c, n) => {
    c.credits.history = [
      { action: 'purchase', amount: 5000, description: 'Quark pack', balanceAfter: 5000, createdAt: new Date(c.createdAt.getTime() + 3600000), timestamp: new Date(c.createdAt.getTime() + 3600000) },
      { action: 'image', amount: -(10 + n), description: 'Image created', balanceAfter: c.credits.balance, createdAt: ago(1 + n * 0.2), timestamp: ago(1 + n * 0.2) }
    ];
  });

  return { staff, clients, events, drafts, csmOf };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const { host, db } = assertSafeTarget(uri);
  const mongoose = require('mongoose');
  const bcrypt = require('bcryptjs');
  const User = require('../models/User');
  const Draft = require('../models/Draft');
  const FeatureEvent = require('../models/FeatureEvent');
  const StaffAction = require('../models/StaffAction');

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  if (mongoose.connection.name !== db) throw new Error('Connected database does not match the checked name; stopping.');
  console.log(`Seeding ${db} on ${host}`);

  const now = Date.now();
  const hash = await bcrypt.hash(SEED_PASSWORD, 10);
  const data = buildData(now, hash);

  await Promise.all([User.deleteMany({}), Draft.deleteMany({}), FeatureEvent.deleteMany({}), StaffAction.deleteMany({})]);

  const staffDocs = await User.insertMany(data.staff);
  const byKey = Object.fromEntries(data.staff.map((s, n) => [s.key, staffDocs[n]._id]));
  const clientDocs = await User.insertMany(data.clients.map(({ key, index, csmKey, ...doc }) => ({ ...doc, assignedCsm: csmKey ? byKey[csmKey] : null })));
  const idOf = (index) => clientDocs[index]._id;

  await FeatureEvent.insertMany(data.events.map((e) => ({ userId: idOf(e.index), feature: e.feature, feature_module: 'content', timestamp: e.at })));
  await Draft.insertMany(data.drafts.map((d, n) => ({ userId: idOf(d.index), title: `Demo post ${n + 1}`, caption: 'Made-up caption for the staff demo.', sourceType: 'post', contentType: 'post', status: d.status, createdAt: d.createdAt, updatedAt: d.updatedAt })), { lean: false });

  await StaffAction.insertMany([
    { actor: byKey.owner, actorRole: 'owner', action: 'add_quarks', client: idOf(10), details: { amount: 500, balanceAfter: 1500 }, at: new Date(now - 2 * DAY) },
    { actor: byKey.owner, actorRole: 'owner', action: 'assign_csm', client: idOf(3), details: { csm: String(byKey.csm1) }, at: new Date(now - 3 * DAY) },
    { actor: byKey.admin, actorRole: 'admin', action: 'disable_client', client: idOf(14), details: {}, at: new Date(now - 4 * DAY) },
    { actor: byKey.admin, actorRole: 'admin', action: 'bulk_assign_csm', details: { clients: 6, csm: String(byKey.csm2) }, at: new Date(now - 5 * DAY) },
    { actor: byKey.csm1, actorRole: 'csm', action: 'open_client', client: idOf(1), details: {}, at: new Date(now - 1 * DAY) },
    { actor: byKey.owner, actorRole: 'owner', action: 'team_add', client: byKey.csm3, details: { role: 'csm', converted: false, emailed: false }, at: new Date(now - 9 * DAY) }
  ]);

  const counts = { users: await User.countDocuments(), drafts: await Draft.countDocuments(), events: await FeatureEvent.countDocuments(), actions: await StaffAction.countDocuments() };
  console.log('Done:', JSON.stringify(counts));
  console.log('Team sign-in emails: aarav.owner@example.test (Owner), bhavna.admin@example.test (Admin), chitra.csm@example.test, dev.csm@example.test, esha.csm@example.test (CSMs). Password: see SEED_PASSWORD in this script.');
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((error) => { console.error('Seed stopped:', error.message); process.exit(1); });
}

module.exports = { assertSafeTarget, buildData, SEED_PASSWORD };
