/**
 * The ESTABLISHED demo agency "Brightwave Media" in the DEVELOPMENT database: an Agency plan five months old, six fictional clients
 * with months of posts, pictures, short videos, results and follower numbers, a Quark wallet whose ledger adds up per client, and a
 * billing history. For recording the Agency demo. Plan and how-to: docs/superpowers/ops/demo-agency-established.md.
 *
 *   node scripts/seed-established-agency.js create --password-file /absolute/path/outside/the/repo.txt [--asset-base http://localhost:5000]
 *   node scripts/seed-established-agency.js status
 *   node scripts/seed-established-agency.js remove
 *
 * SAFETY
 *  - Refuses to run unless MONGODB_URI names the database `nebulaa_dev` (checked before connecting and again after).
 *  - Never prints any value from the environment. The address is the reserved demo-agency-pro@example.test.
 *  - The password is generated here and written ONLY to the --password-file (mode 0600, outside the repository); never printed.
 *  - Every client's social profile key starts with `demo-`, so the app never calls the social provider for it (services/demoProfile.js).
 *  - No payment, email, AI, image-service or social call is made: pictures and clips are drawn on this computer into backend/demo-assets/agency
 *    (git-ignored, served by development servers only).
 *  - `create` is idempotent: when the account exists it keeps the account and password and rebuilds the clients' rows from today's date.
 *    `remove` deletes exactly the agency, its clients and what they hold, the picture folder, then checks nothing is left.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const safety = require('./demo-brand/safety');
const { AGENCY, AGENCY_AS_CLIENT, CLIENTS } = require('./demo-agency/constants');
const build = require('./demo-agency/build');
const posters = require('./demo-agency/posters');
const vids = require('./demo-agency/videos');
const planMod = require('./demo-agency/plan');

const DIR = path.join(__dirname, '..', 'demo-assets', 'agency');
const USAGE = 'Usage: node scripts/seed-established-agency.js create --password-file <absolute path outside the repo> | status | remove';
const ID_FILE = path.join(require('os').tmpdir(), 'nebulaa-demo-agency-pro.json');

function args(argv) {
  const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : ''; };
  return { mode: argv[0], passwordFile: flag('password-file'), base: flag('asset-base') || 'http://localhost:5000' };
}

async function main(argv) {
  const { mode, passwordFile, base } = args(argv);
  if (!['create', 'status', 'remove'].includes(mode)) throw new Error(USAGE);
  safety.assertDevUri(process.env.MONGODB_URI);
  if (mode === 'create' && passwordFile && !safety.passwordFileOk(passwordFile)) throw new Error('The password file must be an absolute path outside this repository.');
  if (!safety.assetBaseOk(base)) throw new Error('--asset-base must look like http://localhost:5000.');
  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  try {
    safety.assertDevTarget(mongoose.connection.name);
    const M = {
      User: require('../models/User'), Draft: require('../models/Draft'), Campaign: require('../models/Campaign'), StudioVideo: require('../models/StudioVideo'),
      SocialSnapshot: require('../models/SocialSnapshot'), Blueprint: require('../models/Blueprint'), AIContentPerformance: require('../models/AIContentPerformance'), QuarkLedger: require('../models/QuarkLedger')
    };
    if (mode === 'status') return await status(M);
    if (mode === 'remove') return await remove(M);
    return await create(M, { passwordFile, base });
  } finally { await mongoose.disconnect(); }
}

async function create(M, { passwordFile, base }) {
  const mongoose = require('mongoose');
  const ws = require('../services/agencyWorkspaces');
  const { consentRecord } = require('../services/consent');
  const { PLANS, chargePaise } = require('../config/apiCosts');
  const t = build.timeline(new Date());
  let owner = await M.User.findOne({ email: AGENCY.email });
  const existed = !!owner;
  if (!existed && !passwordFile) throw new Error('Name a --password-file for the new account (the password is written only there). Nothing was changed.');
  let password = null;
  if (!owner) {
    password = safety.makePassword();
    const planSub = 'sub_demo_agency_pro_plan'; const slotSub = 'sub_demo_agency_pro_slot';
    owner = await M.User.create({
      email: AGENCY.email, password, firstName: AGENCY.owner.firstName, lastName: AGENCY.owner.lastName, companyName: AGENCY.name,
      isVerified: true, onboardingCompleted: true, initialCampaignsGenerated: true, isActive: true,
      businessProfile: { name: AGENCY.name, industry: 'Marketing or design agency', accountKind: 'several', description: AGENCY.description, niche: AGENCY.niche, heroProduct: AGENCY.heroProduct, website: 'https://brightwavemedia.example',
        businessLocation: AGENCY.city, targetAudience: AGENCY.targetAudience, targetCustomerProfile: 'Owners of local businesses who have no time to post', brandVoice: ['Professional', 'Friendly'], marketingGoals: ['More enquiries and calls'], contentLanguage: 'english' },
      consent: consentRecord(t.createdAt, 'demo'), tour: { completedAt: new Date(t.createdAt.getTime() + 30 * 60000), step: 'done', replays: 0 },
      setup: { planOpenedAt: new Date(t.createdAt.getTime() + 3600000), firstWeekApprovedAt: new Date(t.createdAt.getTime() + 2 * 86400000) },
      lastLoginAt: t.now, createdAt: t.createdAt,
      agency: { extraSlots: 1 },
      subscription: { plan: 'free', status: 'active', razorpaySubscriptionId: planSub, razorpayPlanId: 'plan_demo_agency_pro', currentPeriodEnd: t.nextCharge, nextBillingAt: t.nextCharge, cancelAtPeriodEnd: false, reminderForBillingAt: t.nextCharge },
      plan: { tier: 'agency', addons: [], subscriptionId: planSub, welcomeEmailSentAt: t.charges[0], subscriptions: [
        { subscriptionId: planSub, kind: 'plan', key: 'agency', razorpayPlanId: 'plan_demo_agency_pro', expectedPaise: chargePaise(PLANS.agency.inr), active: true, createdAt: t.charges[0] },
        { subscriptionId: slotSub, kind: 'slot', key: 'slot', razorpayPlanId: 'plan_demo_agency_pro_slot', expectedPaise: chargePaise(require('../config/apiCosts').AGENCY.slot.inr), active: true, createdAt: t.charges[build.slotsAt(0) || 2] }
      ] }
    });
  }
  // clients
  const have = new Map((await M.User.find({ 'agency.ownerId': owner._id }).select('_id agency.workspaceName').lean()).map((u) => [u.agency.workspaceName, u._id]));
  for (const c of CLIENTS) {
    if (have.has(c.name)) continue;
    const r = await ws.createWorkspace({ owner, name: c.name, industry: c.industry, models: { User: M.User } });
    if (!r.ok) throw new Error(`Could not add ${c.name}: ${r.message}`);
    have.set(c.name, r.workspace._id);
  }
  const ids = [owner._id, ...have.values()];
  // wipe what this script builds for the clients, then rebuild it
  const clientIds = CLIENTS.map((c) => have.get(c.name));
  await Promise.all([M.Draft, M.Campaign, M.SocialSnapshot, M.AIContentPerformance].map((m) => m.deleteMany({ userId: { $in: clientIds } })));
  await M.StudioVideo.deleteMany({ user: { $in: clientIds } });
  await M.Blueprint.deleteMany({ userId: { $in: [owner._id, ...clientIds] } });
  await M.User.updateOne({ _id: owner._id }, { $set: { 'businessProfile.website': 'https://brightwavemedia.example' } });
  await M.Blueprint.create(planMod.planRow({ client: AGENCY_AS_CLIENT, userId: owner._id, email: AGENCY.email, now: t.now, logoUrl: '' }));
  await M.QuarkLedger.deleteMany({ user: owner._id });
  fs.rmSync(DIR, { recursive: true, force: true });
  const built = [];
  let pictures = 0; let clips = 0; const skipped = [];
  for (let i = 0; i < CLIENTS.length; i += 1) {
    const c = CLIENTS[i]; const id = have.get(c.name); const dir = path.join(DIR, c.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'logo.png'), posters.logoPng(c));
    const logoUrl = build.assetUrl(base, c.slug, 'logo.png');
    const posts = build.buildClientPosts({ client: c, index: i, userId: id, t, base });
    for (const [rel, make] of posts.files) { fs.writeFileSync(path.join(dir, rel), make()); pictures += 1; }
    const plan = vids.videoPlan({ t, client: c, index: i });
    for (const v of plan) { const why = vids.makeVideo({ dir, client: c, video: v }); if (why) skipped.push(`${c.name} ${v.key}: ${why}`); else clips += 1; }
    const okVideos = plan.filter((v) => fs.existsSync(path.join(dir, vids.mp4Rel(v))));
    await M.Draft.insertMany(posts.drafts); await M.Campaign.insertMany(posts.campaigns);
    await M.StudioVideo.insertMany(okVideos.map((v) => vids.videoRow({ userId: id, owner: owner._id, video: v, c, base })));
    await M.SocialSnapshot.insertMany(build.snapshotRows({ client: c, userId: id, t }));
    const perf = require('./demo-brand/performance').performanceRows({ userId: id, items: posts.performance, now: t.now });
    await M.AIContentPerformance.insertMany(perf);
    const kid = await M.User.findById(id).select('email').lean();
    await M.Blueprint.create(planMod.planRow({ client: c, userId: id, email: kid.email, now: t.now, logoUrl }));
    const joined = build.joinedAt(t, c);
    await M.User.collection.updateOne({ _id: id }, { $set: {
      businessProfile: build.businessProfileFor(c, logoUrl), ayrshare: build.ayrshareFor(c, t, logoUrl), onboardingCompleted: true, initialCampaignsGenerated: true, isVerified: true,
      tour: { skippedAt: joined }, createdAt: joined, updatedAt: t.now, lastLoginAt: t.now,
      'agency.workspaceName': c.name, companyName: c.name, firstName: c.name
    } });
    built.push({ def: c, id, published: posts.published, videos: okVideos.map((v) => ({ createdAt: v.at })), counts: { posts: posts.drafts.length, published: posts.published.length } });
  }
  const wallet = build.buildWallet({ t, ownerId: owner._id, clients: built });
  await M.QuarkLedger.insertMany(wallet.rows);
  await M.User.collection.updateOne({ _id: owner._id }, { $set: { credits: wallet.credits, payments: build.buildPayments(t), 'agency.extraSlots': 1, 'agency.clientCount': CLIENTS.length, updatedAt: t.now } });
  fs.writeFileSync(ID_FILE, JSON.stringify({ owner: String(owner._id), clients: clientIds.map(String) }), { mode: 0o600 });
  if (!existed) fs.writeFileSync(passwordFile, `${AGENCY.email}\n${password}\n`, { mode: 0o600 });
  console.log(existed ? `The demo agency ${AGENCY.email} already existed: kept the account and password, rebuilt the clients' rows.` : `Created the demo agency ${AGENCY.email}. Password saved to ${passwordFile} (not printed).`);
  console.log(`Clients: ${CLIENTS.map((c) => c.name).join(', ')}.`);
  console.log(`Pictures drawn: ${pictures}. Videos made: ${clips}.${skipped.length ? ` Skipped: ${skipped.join('; ')}` : ''}`);
  console.log(`Pool now ${wallet.credits.balance} Quarks, used ${wallet.credits.totalUsed} in all. Billing rows: ${build.buildPayments(t).length}.`);
  await status(M);
}

async function status(M) {
  const owner = await M.User.findOne({ email: AGENCY.email }).lean();
  if (!owner) { console.log('The established demo agency does not exist.'); return; }
  const kids = await M.User.find({ 'agency.ownerId': owner._id }).select('_id agency.workspaceName').lean();
  console.log(`Agency ${AGENCY.email}: plan ${owner.plan && owner.plan.tier}, pool ${owner.credits && owner.credits.balance} Quarks, extra slots ${owner.agency && owner.agency.extraSlots}, clients ${kids.length}.`);
  for (const k of kids) {
    const [d, p, v, s] = await Promise.all([M.Draft.countDocuments({ userId: k._id }), M.Draft.countDocuments({ userId: k._id, status: 'published' }), M.StudioVideo.countDocuments({ user: k._id }), M.SocialSnapshot.countDocuments({ userId: k._id })]);
    console.log(`  ${k.agency.workspaceName}: ${d} posts (${p} published), ${v} videos, ${s} daily follower rows`);
  }
}

async function remove(M) {
  const mongoose = require('mongoose');
  const { defaultModels } = require('../services/accountDeletion');
  const { erasable, filterFor } = require('../services/dataRegistry');
  const owner = await M.User.findOne({ email: AGENCY.email }).select('_id').lean();
  const ownerIds = owner ? [owner._id] : [];
  const kids = ownerIds.length ? await M.User.find({ 'agency.ownerId': { $in: ownerIds } }).select('_id').lean() : [];
  const ids = [...ownerIds, ...kids.map((k) => k._id)];
  const models = defaultModels(); const removed = {};
  for (const rule of erasable()) {
    const m = models[rule.model]; if (!m || !ids.length) continue;
    const r = await m.deleteMany(filterFor(rule, { $in: ids })); if (r.deletedCount) removed[rule.model] = r.deletedCount;
  }
  if (ids.length) await M.QuarkLedger.deleteMany({ $or: [{ workspace: { $in: ids } }, { user: { $in: ids } }] });
  const u = ids.length ? await M.User.deleteMany({ _id: { $in: ids } }) : { deletedCount: 0 };
  removed.users = u.deletedCount;
  fs.rmSync(DIR, { recursive: true, force: true });
  try { fs.unlinkSync(ID_FILE); } catch (_) { /* nothing to delete */ }
  let left = await M.User.countDocuments({ $or: [{ email: AGENCY.email }, { 'agency.ownerId': { $in: ownerIds } }] });
  for (const rule of erasable()) { const m = models[rule.model]; if (m && ids.length) left += await m.countDocuments(filterFor(rule, { $in: ids })); }
  console.log(`Removed: ${JSON.stringify(removed)}. Left: ${left}.`);
  void mongoose;
}

main(process.argv.slice(2)).then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
