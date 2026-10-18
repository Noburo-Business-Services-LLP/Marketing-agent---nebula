/**
 * A demo AGENCY account in the DEVELOPMENT database, for the owner to click through.
 *
 *   node scripts/seed-demo-agency.js create [--email=demo-agency@example.test] [--password-file=<path>]
 *   node scripts/seed-demo-agency.js remove [--email=demo-agency@example.test]
 *
 * SAFETY
 *  - Refuses to run without MONGODB_URI, and refuses any database except `nebulaa_dev`, exactly.
 *  - Reads the environment through dotenv like the other scripts, and never prints any value from it.
 *  - The email must be an @example.test address starting with demo-agency, so it can never be a real person.
 *  - `create` is idempotent: running it again adds nothing (it only fills in anything missing).
 *  - `remove` deletes exactly what `create` made: the demo owner, the client workspaces it owns, and what those hold.
 *  - The login password is generated here, printed once, and (only when asked) written to the file named by --password-file.
 *  - No payment, email, AI or image call is made. The "purchase" is a local record shaped like a real one.
 */
require('dotenv').config();
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const DEV_DB = 'nebulaa_dev';
const DEFAULT_EMAIL = 'demo-agency@example.test';
const FRONTEND_URL = 'http://localhost:3000';
const BACKEND_URL = 'http://localhost:5000';

// ---------------------------------------------------------------- pure parts

/** Throws a plain reason unless an address was given and the connected database is exactly nebulaa_dev. */
function assertDevTarget(uri, dbName) {
  if (!uri || typeof uri !== 'string' || !uri.trim()) throw new Error('MONGODB_URI is not set, so nothing was done.');
  if (dbName !== DEV_DB) throw new Error(`Refusing: this script only runs on the database named ${DEV_DB}. Nothing was changed.`);
}

const emailOk = (email) => typeof email === 'string' && /^demo-agency[a-z0-9.-]*@example\.test$/.test(email);

/** A readable random password: no look-alike characters (O 0 I l 1), grouped with dashes. */
function makePassword(bytes = crypto.randomBytes(15)) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return `${s.slice(0, 5)}-${s.slice(5, 10)}-${s.slice(10, 15)}`;
}

/** What to do next, in plain words. No password in it: the password is printed separately. */
function loginCard({ email }) {
  return [
    'How to log in and what to click',
    '',
    `The app runs on your computer: the website at ${FRONTEND_URL}, with the local server on port 5000 (${BACKEND_URL}).`,
    'If they are not running, start them from the Claude desktop app preview first.',
    '',
    `1. Open ${FRONTEND_URL} and sign in with the email ${email} and the password printed below.`,
    '2. Open Clients in the menu. You will see Demo Bakery and Demo Salon.',
    '3. Open one client. Notice the orange bar at the top that says Back to my clients.',
    '4. Try Review and approve. Demo Bakery has a few sample posts waiting.',
    '5. Click Back to my clients, then open the Plans page and look at the Agency card.',
    '6. Open Usage per client to see how the shared pool is used.',
  ].join('\n');
}

/** A few text posts for the first client, so Review and approve has something in it. No picture is made. */
function sampleDrafts() {
  const base = { status: 'draft', imageUrl: '', sourceType: 'post', contentType: 'post', platforms: ['instagram', 'facebook'] };
  return [
    { ...base, title: 'Fresh sourdough every Saturday', caption: 'Our Saturday sourdough comes out of the oven at 7 in the morning and is gone by noon. Reserve a loaf today and pick it up warm.', hashtags: ['#sourdough', '#freshbread', '#localbakery'], cta: 'Reserve a loaf' },
    { ...base, title: 'Meet the baker behind the counter', caption: 'Ravi has been baking for 14 years and still folds every croissant by hand. Come and say hello at the counter this weekend.', hashtags: ['#meetthebaker', '#handmade', '#bakerylife'], cta: 'Visit us this weekend' },
    { ...base, title: 'Birthday cakes made to order', caption: 'Tell us the flavour and the name, and we will make the cake. Orders placed two days ahead are ready on the day, boxed and decorated.', hashtags: ['#birthdaycake', '#cakestomorrow', '#customcakes'], cta: 'Order a cake' },
    { ...base, title: 'Tea time box for four', caption: 'Four puffs, four cookies and two small cakes in one box. It is the easiest way to bring something good to a family evening.', hashtags: ['#teatime', '#snackbox', '#bakeryfinds'], cta: 'Order a box' },
  ];
}

const CLIENTS = [
  {
    name: 'Demo Bakery', industry: 'Food & Beverage', withDrafts: true,
    profile: { description: 'A neighbourhood bakery that bakes bread, cakes and snacks fresh every morning.', niche: 'Fresh bread and custom cakes', heroProduct: 'Sourdough bread and birthday cakes', businessLocation: 'Chennai, Tamil Nadu', targetAudience: 'Families and office workers nearby', targetCustomerProfile: 'Families and office workers within a few kilometres', brandVoice: ['Friendly', 'Professional'], marketingGoals: ['More sales'], contentLanguage: 'english' },
  },
  {
    name: 'Demo Salon', industry: 'Salon & Spa', withDrafts: false,
    profile: { description: 'A hair and skin salon with appointments through the day and evening.', niche: 'Haircuts, colour and skin care', heroProduct: 'Haircuts and hair colour', businessLocation: 'Coimbatore, Tamil Nadu', targetAudience: 'Women and men aged 20 to 45', targetCustomerProfile: 'Working people who book ahead', brandVoice: ['Friendly', 'Bold'], marketingGoals: ['More enquiries and calls'], contentLanguage: 'english' },
  },
];

const OWNER_PROFILE = {
  name: 'Demo Agency Studio', industry: 'Professional Services', accountKind: 'several',
  description: 'A small marketing studio that runs social media for local businesses.', niche: 'Social media for local businesses',
  heroProduct: 'Monthly social media management', businessLocation: 'Chennai, Tamil Nadu', targetAudience: 'Local shops, cafes and clinics',
  targetCustomerProfile: 'Owners of local businesses who have no time to post', brandVoice: ['Professional', 'Friendly'], marketingGoals: ['More enquiries and calls'], contentLanguage: 'english',
};

const idFilePath = (email) => path.join(os.tmpdir(), `nebulaa-demo-agency-${String(email).split('@')[0]}.json`);

function parseArgs(argv) {
  const mode = argv[0];
  const flag = (name) => { const a = argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : ''; };
  return { mode, email: flag('email') || DEFAULT_EMAIL, passwordFile: flag('password-file') };
}

/** The whole run, with every outside thing passed in so it can be tested with fakes. */
async function main({ argv, env, deps, log = console.log }) {
  const { mode, email, passwordFile } = parseArgs(argv || []);
  if (mode !== 'create' && mode !== 'remove') throw new Error('Usage: node scripts/seed-demo-agency.js create|remove [--email=demo-agency@example.test]');
  if (!emailOk(email)) throw new Error('The demo email must be an @example.test address that starts with demo-agency.');
  if (!env || !env.MONGODB_URI) assertDevTarget(undefined, undefined);
  const { dbName } = await deps.connect(env.MONGODB_URI);
  try {
    assertDevTarget(env.MONGODB_URI, dbName);
    if (mode === 'create') {
      const password = makePassword();
      const r = await deps.create({ email, password });
      log(r.existed ? `The demo agency ${email} already exists, so nothing was added.` : `Created the demo agency ${email}.`);
      log(`Clients: ${r.clients.join(', ')}. Sample posts waiting for approval: ${r.drafts}.`);
      const v = await deps.verify({ email, password: r.existed ? null : password });
      for (const line of v.lines) log(`Checked: ${line}`);
      if (!v.ok) throw new Error('The read-back check failed, see the lines above.');
      log('');
      log(loginCard({ email }));
      log('');
      if (!r.existed) {
        log(`Email: ${email}`);
        log(`Password: ${password}`);
        log('This password is shown once. It is not saved anywhere unless you asked for a file.');
        if (passwordFile) deps.writeFile(passwordFile, `Email: ${email}\nPassword: ${password}\n`);
      } else {
        log('The password was shown when the demo was first created. To get a new one, run remove and then create again.');
      }
      log('This demo stays in the development database until you run remove.');
    } else {
      const r = await deps.remove({ email });
      log(`Removed: ${Object.entries(r.removed).map(([k, n]) => `${n} ${k}`).join(', ') || 'nothing'}.`);
      log(`Left: ${r.left}`);
      if (r.left !== 0) throw new Error(`${r.left} records of the demo are still there. Run remove again.`);
    }
  } finally {
    if (deps.disconnect) await deps.disconnect();
  }
}

// ---------------------------------------------------------------- real parts (database)

function realDeps() {
  const mongoose = require('mongoose');
  return {
    async connect(uri) {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
      return { dbName: mongoose.connection.name };
    },
    async disconnect() { await mongoose.disconnect(); },
    writeFile: (p, text) => fs.writeFileSync(p, text, { mode: 0o600 }),

    async create({ email, password }) {
      const User = require('../models/User');
      const Draft = require('../models/Draft');
      const ws = require('../services/agencyWorkspaces');
      const bp = require('../services/billingPlans');
      const { consentRecord } = require('../services/consent');
      const { PLANS, chargePaise } = require('../config/apiCosts');

      let owner = await User.findOne({ email });
      const existed = !!owner;
      if (!owner) {
        const expectedPaise = chargePaise(PLANS.agency.inr);
        const subId = `sub_demo_${crypto.randomBytes(6).toString('hex')}`;
        owner = await User.create({
          email, password, firstName: 'Demo', lastName: 'Agency', companyName: OWNER_PROFILE.name,
          isVerified: true, onboardingCompleted: true, initialCampaignsGenerated: true,
          businessProfile: OWNER_PROFILE, consent: consentRecord(new Date(), 'demo'), tour: { skippedAt: new Date() },
          plan: { tier: 'agency', addons: [], subscriptions: [{ subscriptionId: subId, kind: 'plan', key: 'agency', razorpayPlanId: 'plan_demo', expectedPaise, active: false, createdAt: new Date() }] },
        });
        // The same update a real first payment makes: the plan, an active subscription, the payment record and the monthly pool.
        const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
        const record = owner.plan.subscriptions.find((s) => s.subscriptionId === subId);
        const built = bp.buildChargeUpdate(record, {
          paymentId: `pay_demo_${crypto.randomBytes(6).toString('hex')}`, paidPaise: expectedPaise,
          subscription: { current_end: periodEnd, charge_at: periodEnd }, extraSlots: 0,
        });
        owner = await User.findOneAndUpdate({ _id: owner._id }, built.update, { new: true, arrayFilters: built.arrayFilters });
      }
      const existing = await ws.listWorkspaces({ owner, models: { User } });
      const have = new Set(existing.map((c) => c.name));
      const madeIds = [];
      for (const c of CLIENTS) {
        if (have.has(c.name)) continue;
        const r = await ws.createWorkspace({ owner, name: c.name, industry: c.industry, models: { User } });
        if (!r.ok) throw new Error(`Could not add ${c.name}: ${r.message}`);
        await User.updateOne({ _id: r.workspace._id }, { $set: Object.fromEntries(Object.entries(c.profile).map(([k, v]) => [`businessProfile.${k}`, v])) });
        madeIds.push(r.workspace._id);
      }
      const clients = await User.find({ 'agency.ownerId': owner._id }).sort({ createdAt: 1 }).select('_id agency.workspaceName').lean();
      const bakery = clients.find((c) => c.agency.workspaceName === 'Demo Bakery');
      if (bakery && (await Draft.countDocuments({ userId: bakery._id })) === 0) {
        await Draft.insertMany(sampleDrafts().map((d, i) => ({ ...d, userId: bakery._id, scheduledDate: null, createdAt: new Date(Date.now() - i * 3600 * 1000) })));
      }
      const drafts = bakery ? await Draft.countDocuments({ userId: bakery._id }) : 0;
      fs.writeFileSync(idFilePath(email), JSON.stringify({ owner: String(owner._id), clients: clients.map((c) => String(c._id)) }), { mode: 0o600 });
      return { existed, clients: clients.map((c) => c.agency.workspaceName), drafts };
    },

    async verify({ email, password }) {
      const User = require('../models/User');
      const Draft = require('../models/Draft');
      const { PLANS } = require('../config/apiCosts');
      const lines = []; let ok = true;
      const check = (good, text) => { lines.push(`${good ? 'yes' : 'NO'}: ${text}`); if (!good) ok = false; };
      const owner = await User.findOne({ email }).select('+password');
      check(!!owner, 'the demo agency account exists');
      if (!owner) return { ok, lines };
      check(owner.plan && owner.plan.tier === 'agency', 'plan is Agency');
      check(owner.subscription && owner.subscription.status === 'active' && !!owner.plan.subscriptionId, 'the plan shows as active');
      check(Number(owner.credits && owner.credits.balance) === PLANS.agency.quarks, 'the shared pool holds the Agency allowance');
      check(owner.onboardingCompleted === true && owner.businessProfile.accountKind === 'several', 'onboarding is complete');
      const kids = await User.find({ 'agency.ownerId': owner._id }).select('_id agency.workspaceName plan').lean();
      check(kids.length === CLIENTS.length && Number(owner.agency.clientCount) === CLIENTS.length, `${kids.length} client workspaces, counted on the agency`);
      check(kids.every((k) => k.plan && k.plan.tier === 'agency'), 'each client carries the agency plan');
      const bakery = kids.find((k) => k.agency.workspaceName === 'Demo Bakery');
      check(!!bakery && (await Draft.countDocuments({ userId: bakery._id, status: 'draft' })) >= 3, 'Demo Bakery has sample posts to review');
      if (password) check(await owner.comparePassword(password), 'the printed password signs in');
      return { ok, lines };
    },

    async remove({ email }) {
      const mongoose = require('mongoose');
      const User = require('../models/User');
      const { defaultModels } = require('../services/accountDeletion');
      const { erasable, filterFor } = require('../services/dataRegistry');
      let saved = { owner: null, clients: [] };
      try { saved = JSON.parse(fs.readFileSync(idFilePath(email), 'utf8')); } catch (_) { /* no id file: the email is enough */ }
      const ownerDocs = await User.find({ $or: [{ email }, ...(saved.owner && mongoose.isValidObjectId(saved.owner) ? [{ _id: saved.owner, email }] : [])] }).select('_id').lean();
      const ownerIds = ownerDocs.map((d) => d._id);
      const kidFilter = { 'agency.ownerId': { $in: ownerIds } };
      const kids = ownerIds.length ? await User.find(kidFilter).select('_id').lean() : [];
      const ids = [...ownerIds, ...kids.map((k) => k._id)];
      const models = defaultModels();
      const removed = {};
      for (const rule of erasable()) {
        const m = models[rule.model];
        if (!m || !ids.length) continue;
        const r = await m.deleteMany(filterFor(rule, { $in: ids }));
        if (r.deletedCount) removed[rule.model.toLowerCase() === 'draft' ? 'drafts' : `${rule.model} rows`] = r.deletedCount;
      }
      const ledger = models.QuarkLedger;
      if (ledger && ids.length) await ledger.deleteMany({ workspace: { $in: ids } });
      const u = ids.length ? await User.deleteMany({ _id: { $in: ids } }) : { deletedCount: 0 };
      removed.users = u.deletedCount;
      let left = ids.length ? await User.countDocuments({ _id: { $in: ids } }) : 0;
      left += await User.countDocuments({ $or: [{ email }, { 'agency.ownerId': { $in: ownerIds } }] });
      for (const rule of erasable()) { const m = models[rule.model]; if (m && ids.length) left += await m.countDocuments(filterFor(rule, { $in: ids })); }
      try { fs.unlinkSync(idFilePath(email)); } catch (_) { /* nothing to delete */ }
      return { removed, left };
    },
  };
}

if (require.main === module) {
  main({ argv: process.argv.slice(2), env: process.env, deps: realDeps() })
    .then(() => process.exit(0))
    .catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
}

module.exports = { DEV_DB, DEFAULT_EMAIL, assertDevTarget, emailOk, makePassword, loginCard, sampleDrafts, parseArgs, main, idFilePath };
