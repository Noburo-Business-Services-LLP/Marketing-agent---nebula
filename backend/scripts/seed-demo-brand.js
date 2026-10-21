/**
 * The demo BRAND account "Zaya Naturals" in the DEVELOPMENT database, for the demo video (plan:
 * docs/superpowers/ops/demo-brand-plan.md, how-to: docs/superpowers/ops/demo-brand.md).
 *
 *   node scripts/seed-demo-brand.js create --password-file /absolute/path/outside/the/repo.txt [--asset-base http://localhost:5000]
 *   node scripts/seed-demo-brand.js status
 *   node scripts/seed-demo-brand.js remove
 *
 * SAFETY
 *  - Refuses to run unless MONGODB_URI names the database `nebulaa_dev` (checked before connecting, and again after).
 *  - Reads the environment through dotenv like the other scripts, and never prints any value from it.
 *  - Only the fake address demo-zaya@example.test; the social profile key starts with `demo-`, so the app never calls
 *    the social provider for this account (services/demoProfile.js, decision D112).
 *  - The password is generated here and written ONLY to the --password-file (mode 0600, outside the repository). It is
 *    never printed or logged.
 *  - `create` is idempotent: running it again adds only what is missing. `remove` deletes exactly what `create` made
 *    (every row carries a marker, see demo-brand/safety.js), anything the app later made for this account, the
 *    account, and the picture folder backend/demo-assets/zaya, then checks that nothing is left.
 *  - No payment, email, AI, image-service or social call is made: every picture is drawn on this computer.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const safety = require('./demo-brand/safety');
const { BRAND, PRODUCTS, SOCIALS } = require('./demo-brand/constants');

const DEMO_DIR = path.join(__dirname, '..', 'demo-assets', 'zaya');
const FRONTEND_URL = 'http://localhost:3200';
const USAGE = 'Usage: node scripts/seed-demo-brand.js create --password-file <absolute path outside the repo> | status | remove';

/** What to do next, in plain words. Never contains the password. */
function loginCard({ passwordFile }) {
  return [
    'How to sign in',
    `1. Use the DEVELOPMENT app: ${FRONTEND_URL} with the local server on port 5000 (never production, never the old app on port 3000).`,
    `2. Email: ${safety.DEMO_EMAIL}. Password: in the file ${passwordFile || '(the file named when the demo was first created)'}.`,
    '3. Look at Home, Settings (Business profile, Billing, Connected accounts), Brand assets and Products.',
    'To start again from scratch: run remove, then create.',
  ].join('\n');
}

/** The whole run, with every outside thing passed in so it can be tested with fakes. */
async function main({ argv, env, deps, log = console.log }) {
  const { mode, passwordFile, assetBase } = safety.parseArgs(argv || []);
  if (!['create', 'remove', 'status'].includes(mode)) throw new Error(USAGE);
  safety.assertDevUri(env && env.MONGODB_URI); // before any connection
  if (mode === 'create') {
    if (passwordFile && !safety.passwordFileOk(passwordFile)) throw new Error('The password file must be an absolute path outside this repository, so it can never be committed.');
    if (!safety.assetBaseOk(assetBase)) throw new Error('--asset-base must look like http://localhost:5000 (pictures are only served on this computer).');
  }
  const { dbName } = await deps.connect(env.MONGODB_URI);
  try {
    safety.assertDevTarget(dbName);
    if (mode === 'create') {
      const existed = await deps.exists();
      if (!existed && !passwordFile) throw new Error('Name a --password-file for the new demo account (the password is written only there). Nothing was changed.');
      const password = existed ? null : safety.makePassword();
      // The password file is written BEFORE the account exists, so a crash can never leave an account nobody can sign in to.
      if (password) deps.writeFile(passwordFile, `Email: ${safety.DEMO_EMAIL}\nPassword: ${password}\n`);
      const r = await deps.create({ password, assetBase, now: new Date() });
      log(existed ? `The demo account ${safety.DEMO_EMAIL} already exists: only missing parts were added.` : `Created the demo account ${safety.DEMO_EMAIL} (${BRAND.name}).`);
      log(`Added now: ${Object.entries(r.added).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ') || 'nothing'}.`);
      if (password) {
        log(`The password was written to ${passwordFile} (readable only by you). It is not printed.`);
      }
      const v = await deps.verify({ password });
      for (const line of v.lines) log(`Checked: ${line}`);
      if (!v.ok) throw new Error('The read-back check failed, see the lines above.');
      log('');
      log(loginCard({ passwordFile }));
    } else if (mode === 'status') {
      const s = await deps.status();
      if (!s.exists) log(`The demo account ${safety.DEMO_EMAIL} does not exist.`);
      else log(`The demo account ${safety.DEMO_EMAIL} exists (${BRAND.name}).`);
      for (const [k, n] of Object.entries(s.counts)) log(`  ${k}: ${n}`);
      log(`  picture files: ${s.files}`);
    } else {
      const r = await deps.remove();
      log(`Removed: ${Object.entries(r.removed).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ') || 'nothing'}.`);
      log(`Left: ${r.left}`);
      if (r.left !== 0) throw new Error(`${r.left} records or files of the demo are still there. Run remove again.`);
    }
  } finally {
    if (deps.disconnect) await deps.disconnect();
  }
}

// ---------------------------------------------------------------- real parts (database and files)

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p)); else out.push(p);
  }
  return out;
}

function realDeps({ demoDir = DEMO_DIR } = {}) {
  const mongoose = require('mongoose');
  const models = () => require('../services/accountDeletion').defaultModels();
  const account = require('./demo-brand/account');
  const assets = require('./demo-brand/assets');
  const products = require('./demo-brand/products');
  const socials = require('./demo-brand/socials');
  const planMod = require('./demo-brand/plan');
  const contentMod = require('./demo-brand/content');
  const perfMod = require('./demo-brand/performance');
  const memoryMod = require('./demo-brand/memory');
  const images = require('./demo-brand/images');

  const findUser = async () => {
    const User = mongoose.model('User');
    const u = await User.findOne({ email: safety.DEMO_EMAIL }).select('+password');
    if (u && !safety.isDemoUser(u)) throw new Error(`${safety.DEMO_EMAIL} exists but is not the seeded demo account (no demo profile key). Nothing was changed.`);
    return u;
  };
  const writeAsset = (rel, draw) => {
    const file = path.join(demoDir, rel);
    if (fs.existsSync(file)) return { buffer: fs.readFileSync(file), made: false };
    const buffer = draw();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buffer);
    return { buffer, made: true };
  };

  return {
    async connect(uri) {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
      return { dbName: mongoose.connection.name };
    },
    async disconnect() { await mongoose.disconnect(); },
    writeFile: (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text, { mode: 0o600 }); fs.chmodSync(p, 0o600); },
    async exists() { models(); return Boolean(await findUser()); },

    async create({ password, assetBase, now }) {
      const m = models();
      const added = { 'picture files': 0, account: 0, 'Quark ledger rows': 0, 'brand assets': 0, 'brand profile': 0, products: 0 };
      // 1. pictures, drawn locally
      const logo = writeAsset(assets.LOGO_REL, assets.assetSpecs()[0].draw);
      if (logo.made) added['picture files'] += 1;
      const drawn = {};
      for (const spec of assets.assetSpecs().slice(1)) { const r = writeAsset(spec.rel, spec.draw); drawn[spec.rel] = r.buffer; if (r.made) added['picture files'] += 1; }
      for (const spec of products.productPictureSpecs()) { if (writeAsset(spec.rel, spec.draw).made) added['picture files'] += 1; }

      // 2. the account (with its payments, wallet and social accounts) and its Quark ledger, made together
      let user = await findUser();
      if (!user) {
        const t = account.timeline(now);
        const logoUrl = safety.assetUrl(assetBase, assets.LOGO_REL);
        const fields = account.buildUserFields(t, { logoUrl });
        user = await m.User.create({ ...fields, password, ayrshare: socials.buildAyrshare({ connectedAt: socials.connectedAtFor(t.createdAt), avatarUrl: logoUrl, now }) });
        // timestamps would stamp today: the account is months old.
        await m.User.collection.updateOne({ _id: user._id }, { $set: { createdAt: t.createdAt } });
        await m.QuarkLedger.insertMany(account.ledgerRows(t, user._id));
        added.account = 1; added['Quark ledger rows'] = await m.QuarkLedger.countDocuments(safety.markerFilter('QuarkLedger', user._id));
        user = await findUser();
      }
      const createdAt = new Date(user.createdAt);
      const base = (String(user.businessProfile.brandAssets.logoUrl || '').split(safety.ASSET_PATH)[0]) || assetBase;

      // 3. brand assets (logo, people, places) and the colours and fonts
      for (const spec of assets.assetSpecs()) {
        const tag = `${safety.DEMO_TAG}/${spec.rel}`;
        if (await m.BrandAsset.exists({ user: user._id, cloudinaryPublicId: tag })) continue;
        const buffer = spec.rel === assets.LOGO_REL ? logo.buffer : drawn[spec.rel];
        await m.BrandAsset.create(assets.assetRow(spec, { userId: user._id, base, buffer, createdAt: new Date(createdAt.getTime() + 30 * 60 * 1000) }));
        added['brand assets'] += 1;
      }
      if (!(await m.BrandIntelligenceProfile.exists({ userId: user._id }))) {
        await m.BrandIntelligenceProfile.create(assets.intelligenceProfile({ userId: user._id, logoUrl: safety.assetUrl(base, assets.LOGO_REL) }));
        added['brand profile'] = 1;
      }

      // 4. products
      for (const row of products.productRows({ userId: user._id, base, createdAt })) {
        if (await m.Product.exists({ ...safety.markerFilter('Product', user._id), name: row.name })) continue;
        await m.Product.create(row);
        added.products += 1;
      }
      // 5. the founder's name and story follow the constants (an older run used another name)
      if (user.firstName !== BRAND.founder.firstName || (user.businessProfile && user.businessProfile.brandStory !== BRAND.brandStory)) {
        await m.User.updateOne({ _id: user._id }, { $set: { firstName: BRAND.founder.firstName, lastName: BRAND.founder.lastName, 'businessProfile.brandStory': BRAND.brandStory } });
      }

      // 6. Stage 2: plan, Blueprint, calendars, posts, campaigns, results, daily numbers, brand memory.
      // These are rebuilt on every run (their own tagged rows only), so dates are always counted back from today.
      const rebuilt = await this.createContent({ user, base, createdAt, now, writeAsset: (rel, draw) => writeAsset(rel, draw) });
      Object.assign(added, rebuilt);
      return { added, userId: user._id };
    },

    /** Stage 2. Deletes the demo's own rows of these collections, then builds them fresh. */
    async createContent({ user, base, createdAt, now, writeAsset: write }) {
      const m = models();
      const uid = user._id;
      const out = {};
      const wipe = async (name) => (await m[name].deleteMany(safety.markerFilter(name, uid))).deletedCount;
      for (const name of ['Draft', 'Campaign', 'ContentCalendar', 'Blueprint', 'AIContentPerformance', 'SocialSnapshot', 'AIBrandMemory']) await wipe(name);

      // plan and Blueprint (the designed pages are drawn here)
      const logoUrl = safety.assetUrl(base, assets.LOGO_REL);
      const { plan, blueprint, deck } = planMod.planRows({ userId: uid, createdAt, now, logoUrl, designedBase: (n) => safety.assetUrl(base, `blueprint/page-${n}.jpg`) });
      deck.forEach((p, i) => write(`blueprint/page-${i + 1}.jpg`, () => images.deckPageJpg(p, i)));
      await m.Blueprint.insertMany([blueprint, plan]);
      out['plan and Blueprint'] = 2;

      // posts, campaigns, calendars
      const prods = await m.Product.find(safety.markerFilter('Product', uid)).select('name category imageUrl').lean();
      const productIds = {};
      for (const p of PRODUCTS) { const row = prods.find((x) => x.name === p.name); if (row) productIds[p.slug] = row._id; }
      const built = contentMod.build({ userId: uid, now, base, productIds });
      let files = 0;
      for (const [rel, draw] of built.posters) { if (write(rel, draw).made) files += 1; }
      out['picture files'] = (out['picture files'] || 0) + files + deck.length;
      await m.ContentCalendar.insertMany(built.calendars);
      await m.Campaign.insertMany(built.campaigns);
      await m.Draft.insertMany(built.drafts);
      out.calendars = built.calendars.length; out.campaigns = built.campaigns.length; out.posts = built.drafts.length;

      // results and daily numbers
      const rows = perfMod.performanceRows({ userId: uid, items: built.performanceItems, now });
      await m.AIContentPerformance.insertMany(rows);
      const snaps = perfMod.snapshotRows({ userId: uid, now });
      await m.SocialSnapshot.insertMany(snaps);
      out['measured post rows'] = rows.length; out['daily snapshots'] = snaps.length;

      // brand memory: the app's own runner learns from the rows above
      const learned = await memoryMod.learn(uid);
      if (!learned.ok) throw new Error(`Brand memory could not run (${learned.reason}).`);
      const doc = await m.AIBrandMemory.findOne({ userId: uid }).lean();
      out['brand memory items'] = memoryMod.summarise(doc).items;
      return out;
    },

    async verify({ password }) {
      const m = models();
      const lines = []; let ok = true;
      const check = (good, text) => { lines.push(`${good ? 'yes' : 'NO'}: ${text}`); if (!good) ok = false; };
      const u = await findUser();
      check(!!u, 'the demo account exists');
      if (!u) return { ok, lines };
      const { resolveTier, addonsOf, canUse } = require('../config/entitlements');
      check(u.isVerified && u.onboardingCompleted && !!(u.tour && u.tour.completedAt), 'verified, onboarding and tour done');
      check(u.consent.termsVersion === require('../config/legalVersions').TERMS_VERSION, 'consent to the current Terms and Privacy Policy');
      check(resolveTier(u) === 'professional' && ['publish', 'competitors', 'inbox'].every((a) => addonsOf(u).includes(a)), 'Growth plan with Publish, Competitors and Inbox');
      check(['publish', 'inbox', 'competitors', 'photoshoot'].every((f) => canUse(u, f).allowed), 'the app lets it publish, use the Inbox, competitors and photoshoots');
      const ledger = await m.QuarkLedger.find(safety.markerFilter('QuarkLedger', u._id)).sort({ createdAt: 1, _id: 1 }).lean();
      const sum = ledger.reduce((s, r) => s + r.quarks, 0);
      check(ledger.length > 0 && sum === u.credits.balance && ledger[ledger.length - 1].balanceAfter === u.credits.balance, `Quark ledger adds up to the balance (${u.credits.balance})`);
      check(u.credits.balance === u.credits.planBalance + u.credits.topupBalance && u.credits.planExpiresAt > new Date(), 'the balance is the live plan and top-up Quarks');
      check(u.payments.filter((p) => p.status === 'paid').length >= 7, `${u.payments.length} payments on record`);
      check(require('../services/demoProfile').isDemoProfile(u) && u.ayrshare.activeSocialAccounts.length === SOCIALS.length, `${SOCIALS.length} connected social accounts (demo, never sent to the provider)`);
      const assetsCount = await m.BrandAsset.countDocuments(safety.markerFilter('BrandAsset', u._id));
      check(assetsCount === assets.assetSpecs().length, `${assetsCount} brand assets`);
      const prods = await m.Product.find(safety.markerFilter('Product', u._id)).lean();
      check(prods.length === PRODUCTS.length && prods.every((p) => p.images.length >= 2), `${prods.length} products with 2 or 3 pictures each`);
      const missing = [...assets.assetSpecs().map((s) => s.rel), ...products.productPictureSpecs().map((s) => s.rel)].filter((rel) => !fs.existsSync(path.join(demoDir, rel)));
      check(missing.length === 0, `every picture file is on disk${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`);
      // Stage 2
      const S = require('../services/draftStatus');
      const draftsFor = (extra) => m.Draft.countDocuments({ userId: u._id, ...extra });
      const counts = {
        needsApproval: await m.Draft.countDocuments(S.needsApprovalFilter(u._id)),
        drafts: await m.Draft.countDocuments({ ...S.awaitingFilter(u._id), $and: [{ $nor: S.automationClauses() }] }),
        approved: await draftsFor({ status: 'approved' }), scheduled: await draftsFor({ status: 'scheduled' }), posted: await draftsFor({ status: 'published' }),
        archived: await draftsFor({ status: 'archived' }), binned: await draftsFor({ status: 'binned' })
      };
      const T = require('./demo-brand/content').TARGETS;
      check(Object.keys(T).every((k) => counts[k] === T[k]), `Library views: ${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ')}`);
      const future = await m.Draft.countDocuments({ userId: u._id, status: 'published', publishedAt: { $gt: new Date() } });
      check(future === 0, 'no posted post is dated in the future');
      const camps = await m.Campaign.find(safety.markerFilter('Campaign', u._id)).select('status').lean();
      check(camps.length === T.scheduled + T.posted && camps.filter((c) => c.status === 'posted').length === T.posted, `${camps.length} campaigns (scheduled and posted) with fake provider post ids`);
      const cals = await m.ContentCalendar.countDocuments(safety.markerFilter('ContentCalendar', u._id));
      check(cals === 5, `${cals} monthly calendars`);
      const bp = await m.Blueprint.find(safety.markerFilter('Blueprint', u._id)).select('kind status designed.status').lean();
      check(bp.some((b) => b.kind === 'plan' && b.status === 'completed') && bp.some((b) => b.kind === 'blueprint' && b.designed && b.designed.status === 'completed'), 'a finished plan and a finished Blueprint with its designed edition');
      const measured = await m.AIContentPerformance.countDocuments(safety.markerFilter('AIContentPerformance', u._id));
      const snaps = await m.SocialSnapshot.countDocuments({ userId: u._id });
      check(measured >= 50 && snaps >= 90, `${measured} measured post rows, ${snaps} daily snapshots`);
      const mem = require('./demo-brand/memory').summarise(await m.AIBrandMemory.findOne({ userId: u._id }).lean());
      check(mem.items > 0, `brand memory: ${mem.items} learned items (${Object.entries(mem.bySource).map(([k, n]) => `${k} ${n}`).join(', ')})`);
      const posterMissing = (await m.Draft.find({ userId: u._id }).select('imageUrl').lean()).filter((d) => !fs.existsSync(path.join(demoDir, String(d.imageUrl).split(safety.ASSET_PATH + '/')[1] || '__none__'))).length;
      check(posterMissing === 0, 'every post picture is on disk');
      if (password) check(await u.comparePassword(password), 'the new password signs in');
      return { ok, lines };
    },

    async status() {
      const m = models();
      const { erasable, filterFor } = require('../services/dataRegistry');
      const u = await m.User.findOne({ email: safety.DEMO_EMAIL }).lean();
      const counts = { User: u ? 1 : 0, 'User.payments': u ? (u.payments || []).length : 0 };
      for (const rule of erasable()) {
        const n = u && m[rule.model] ? await m[rule.model].countDocuments(filterFor(rule, u._id)) : 0;
        if (n || Object.keys(safety.MARKERS).includes(rule.model)) counts[rule.model] = n;
      }
      return { exists: !!u, counts, files: listFiles(demoDir).length };
    },

    async remove() {
      const m = models();
      const { erasable, filterFor } = require('../services/dataRegistry');
      const removed = {};
      const u = await findUser();
      if (u) {
        // 1. exactly what create made (each collection by its marker)
        for (const name of Object.keys(safety.MARKERS)) {
          const r = await m[name].deleteMany(safety.markerFilter(name, u._id));
          removed[`${name} rows`] = r.deletedCount;
        }
        // 2. anything the app made for this account while the demo was used (it belongs to the demo account only)
        let appMade = 0;
        for (const rule of erasable()) { if (m[rule.model]) appMade += (await m[rule.model].deleteMany(filterFor(rule, u._id))).deletedCount; }
        removed['rows the app made while the demo was used'] = appMade;
        removed.account = (await m.User.deleteOne({ _id: u._id, email: safety.DEMO_EMAIL })).deletedCount;
      }
      // 3. the pictures
      const files = listFiles(demoDir).length;
      fs.rmSync(demoDir, { recursive: true, force: true });
      const parent = path.dirname(demoDir);
      if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) fs.rmdirSync(parent);
      removed['picture files'] = files;
      // 4. nothing may be left
      let left = await m.User.countDocuments({ email: safety.DEMO_EMAIL });
      if (u) for (const rule of erasable()) { if (m[rule.model]) left += await m[rule.model].countDocuments(filterFor(rule, u._id)); }
      left += listFiles(demoDir).length;
      return { removed, left };
    },
  };
}

if (require.main === module) {
  main({ argv: process.argv.slice(2), env: process.env, deps: realDeps() })
    .then(() => process.exit(0))
    .catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
}

module.exports = { DEMO_DIR, USAGE, loginCard, main, realDeps, listFiles };
