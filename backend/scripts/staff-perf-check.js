/**
 * Times the slow staff pages (Home, Clients, Team, Usage; Money as a control) on production-sized made-up data.
 *
 * SAFETY: refuses any host except localhost / 127.0.0.1 / [::1] and any database whose name does not start with
 * `nebulaa_seed_`. It EMPTIES that database when seeding. Never point it at a shared or real database.
 *
 *   # 1. a throwaway local mongod (see docs/superpowers/ops/staff-pages-performance.md), then:
 *   MONGODB_URI=mongodb://127.0.0.1:27111/nebulaa_seed_perf node scripts/staff-perf-check.js --seed
 *   MONGODB_URI=... node scripts/staff-perf-check.js                # measure with the indexes the database has
 *   MONGODB_URI=... node scripts/staff-perf-check.js --create-indexes   # run create-staff-indexes.js for real, then measure
 *   MONGODB_URI=... node scripts/staff-perf-check.js --golden           # old projections vs new projections, same output
 *
 * Flags: --explain (documents examined and time per read, from the database's own explain), --seed (empty + fill + build only the indexes production already has), --scale full|small (default full;
 * small is one fifth), --create-indexes, --golden, --out <file> (also write the numbers as JSON).
 * Prints seconds per page. Nothing here reads a secret or touches any other database.
 */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const DAY = 86400000;
const SCALES = {
  full: { users: 20000, drafts: 200000, campaigns: 60000, videos: 20000, heroes: 5000, blueprints: 5000, inbox: 300000, events: 400000 },
  small: { users: 4000, drafts: 40000, campaigns: 12000, videos: 4000, heroes: 1000, blueprints: 1000, inbox: 60000, events: 80000 }
};

// ---- guards (same rule as the staff demo seed) --------------------------------------------------
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const DB_PREFIX = 'nebulaa_seed_';
function assertSafeTarget(uri) {
  if (!uri || typeof uri !== 'string') throw new Error('Set MONGODB_URI to a local throwaway database, for example mongodb://127.0.0.1:27111/nebulaa_seed_perf');
  const m = /^mongodb:\/\/(?:[^@/]*@)?([^/?]+)(?:\/([^?]*))?(?:\?.*)?$/.exec(uri.trim());
  if (!m) throw new Error('MONGODB_URI is not a plain mongodb:// address; this check only runs against one local host');
  if (m[1].includes(',')) throw new Error('MONGODB_URI lists more than one host; this check only runs against one local host');
  const host = m[1].startsWith('[') ? m[1].replace(/\]:\d+$/, ']') : m[1].replace(/:\d+$/, '');
  if (!LOCAL_HOSTS.includes(host)) throw new Error(`Host "${host}" is not local; this check only runs against localhost or 127.0.0.1`);
  const db = decodeURIComponent(m[2] || '');
  if (!db.startsWith(DB_PREFIX)) throw new Error(`The database name must start with ${DB_PREFIX} (got "${db}")`);
  return { host, db };
}

// ---- deterministic random numbers ----------------------------------------------------------------
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

const sec = (ms) => Math.round(ms) / 1000;
async function timed(fn) {
  const t = Date.now();
  let value; let error = null;
  try { value = await fn(); } catch (e) { error = e; }
  return { seconds: sec(Date.now() - t), value, error };
}

// ---- seeding --------------------------------------------------------------------------------------
async function seed({ mongoose, scale, log }) {
  const { ObjectId } = mongoose.Types;
  const db = mongoose.connection.db;
  const rand = rng(20261019);
  const now = Date.now();
  const ago = (days) => new Date(now - days * DAY);
  const ACTIONS = ['campaign_full', 'image_generated', 'campaign_text', 'video_generated', 'carousel_generated', 'image_edit', 'blueprint', 'chat_message', 'hero_video_clip', 'video_base'];
  const TIERS = ['managed', 'managed', 'starter', 'starter', 'professional', 'free', 'agency'];
  const PLATFORMS = ['instagram', 'facebook', 'linkedin', 'twitter', 'gmb'];
  const FEATURES = ['create_post', 'generate_image', 'schedule_post', 'video', 'blueprint', 'caption'];
  const filler = (n) => 'x'.repeat(n);

  for (const name of ['users', 'drafts', 'campaigns', 'video_jobs', 'hero_video_jobs', 'blueprints', 'socialinboxmessages', 'featureevents', 'staffactions', 'quarkledgers']) {
    try { await db.collection(name).drop(); } catch (_) { /* not there yet */ }
  }

  const insert = async (name, total, make) => {
    const col = db.collection(name);
    const BATCH = 5000;
    for (let i = 0; i < total; i += BATCH) {
      const docs = [];
      for (let j = i; j < Math.min(total, i + BATCH); j++) docs.push(make(j));
      await col.insertMany(docs, { ordered: false });
      if ((i / BATCH) % 10 === 0) log(`  ${name}: ${Math.min(total, i + BATCH)} / ${total}`);
    }
  };

  // staff first, then customers
  const staff = [
    { key: 'owner', staffRole: 'owner' }, { key: 'admin', staffRole: 'admin' },
    { key: 'csm1', staffRole: 'csm', isCsm: true }, { key: 'csm2', staffRole: 'csm', isCsm: true }, { key: 'csm3', staffRole: 'csm', isCsm: true }
  ].map((s, n) => ({ ...s, _id: new ObjectId(), email: `${s.key}@example.test`, firstName: s.key, lastName: 'Perf', password: 'x'.repeat(60), isActive: true, isHidden: true, isVerified: true, lastLoginAt: ago(n * 0.1), createdAt: ago(300), updatedAt: ago(1) }));
  await db.collection('users').insertMany(staff);
  const csmIds = staff.filter((s) => s.staffRole === 'csm').map((s) => s._id);

  const userIds = [];
  await insert('users', scale.users, (i) => {
    const _id = new ObjectId(); userIds.push(_id);
    const createdAt = ago(rand() * 120);
    const tier = TIERS[Math.floor(rand() * TIERS.length)];
    const inactive = rand() < 0.3;
    const history = [];
    for (let h = 0; h < 50; h++) {
      const at = ago(rand() * 60);
      history.push({ action: ACTIONS[Math.floor(rand() * ACTIONS.length)], amount: -Math.round(1 + rand() * 40), description: 'Made something for the business', balanceAfter: Math.round(rand() * 900), createdAt: at, timestamp: at });
    }
    history.sort((a, b) => a.createdAt - b.createdAt);
    const nSocial = Math.floor(rand() * 4);
    return {
      _id, email: `client${i}@example.test`, firstName: `Client${i}`, lastName: 'Perf', companyName: `Perf Business ${i}`, mobileNumber: `90000${String(i).padStart(5, '0')}`,
      password: 'x'.repeat(60), isActive: rand() > 0.02, isVerified: true, staffRole: null, isHidden: rand() < 0.01, onboardingCompleted: rand() < 0.8,
      createdAt, updatedAt: ago(rand() * 5), lastLoginAt: inactive ? new Date(createdAt.getTime() + rand() * 3 * DAY) : ago(rand() * 6),
      assignedCsm: rand() < 0.3 ? csmIds[Math.floor(rand() * 3)] : null,
      credits: { balance: Math.round(rand() * 900), totalUsed: Math.round(rand() * 5000), planBalance: 0, topupBalance: 0, history },
      plan: { tier, addons: rand() < 0.4 ? ['publish', 'inbox'] : [], paidManually: rand() < 0.1, subscriptions: rand() < 0.3 ? [{ subscriptionId: `sub_${i}`, kind: 'plan', key: tier, active: rand() < 0.7, createdAt }] : [] },
      payments: rand() < 0.4 ? [{ razorpayOrderId: `order_${i}`, razorpayPaymentId: `pay_${i}`, amount: 999, currency: 'INR', status: rand() < 0.9 ? 'paid' : 'failed', paidAt: createdAt }] : [],
      trial: { isExpired: rand() < 0.3 },
      connectedSocials: Array.from({ length: nSocial }, (_, k) => ({ platform: PLATFORMS[k % PLATFORMS.length], accountId: `acct_${i}_${k}`, accountName: `Perf ${i} ${k}`, accessToken: filler(220), connectedAt: createdAt })),
      ayrshare: { profileKey: `PROFILE-${i}`, title: `Perf Business ${i}`, activeSocialAccounts: PLATFORMS.slice(0, nSocial), displayNames: [] },
      businessProfile: { name: `Perf Business ${i}`, industry: 'Retail', website: `https://example.test/${i}`, description: filler(900) },
      icpStrategy: { icp: { demographics: filler(800), psychographics: filler(800), painPoints: [filler(300), filler(300)], buyingBehavior: filler(600) } }
    };
  });

  // activity is uneven: a few clients make most of it
  const pickUser = () => userIds[Math.floor(Math.pow(rand(), 1.6) * userIds.length)];
  const STATUS = ['draft', 'draft', 'published', 'published', 'published', 'completed', 'completed', 'scheduled', 'failed', 'archived'];

  await insert('drafts', scale.drafts, (i) => {
    const createdAt = ago(rand() * 120);
    const slides = rand() < 0.1 ? Array.from({ length: 3 + Math.floor(rand() * 3) }, (_, k) => ({ imageUrl: `https://cdn.example.test/${i}/${k}.jpg`, text: filler(80) })) : undefined;
    return {
      userId: pickUser(), title: `Post ${i}`, content: filler(500), status: STATUS[Math.floor(rand() * STATUS.length)], contentType: 'post',
      imageUrl: rand() < 0.8 ? `https://cdn.example.test/${i}.jpg` : '', ...(slides ? { carouselSlides: slides } : {}),
      languageVariantOf: rand() < 0.05 ? new ObjectId() : null, language: 'en', createdAt, updatedAt: new Date(createdAt.getTime() + rand() * 2 * DAY)
    };
  });
  await insert('campaigns', scale.campaigns, (i) => {
    const createdAt = ago(rand() * 120);
    return { userId: pickUser(), title: `Campaign ${i}`, caption: filler(300), status: rand() < 0.7 ? 'posted' : 'scheduled', ...(rand() < 0.7 ? { publishedAt: new Date(createdAt.getTime() + DAY / 2) } : {}), createdAt, updatedAt: createdAt };
  });
  await insert('video_jobs', scale.videos, (i) => {
    const createdAt = ago(rand() * 120);
    return { jobId: `vj_${i}`, userId: pickUser(), status: rand() < 0.7 ? 'completed' : (rand() < 0.5 ? 'failed' : 'cancelled'), progress: 100, payload: { prompt: filler(300) }, result: { url: `https://cdn.example.test/v${i}.mp4` }, logs: [], attempts: 1, createdAt, updatedAt: createdAt };
  });
  await insert('hero_video_jobs', scale.heroes, (i) => {
    const createdAt = ago(rand() * 120);
    return { jobId: `hj_${i}`, userId: pickUser(), status: rand() < 0.8 ? 'completed' : 'failed', createdAt, updatedAt: createdAt };
  });
  await insert('blueprints', scale.blueprints, (i) => {
    const createdAt = ago(rand() * 120);
    return { blueprintId: `bp_${i}`, userId: pickUser(), status: rand() < 0.8 ? 'completed' : 'failed', kind: rand() < 0.2 ? 'plan' : 'blueprint', createdAt, updatedAt: createdAt };
  });
  await insert('socialinboxmessages', scale.inbox, (i) => {
    const createdAt = ago(rand() * 120);
    const hasAi = rand() < 0.3;
    return {
      userId: pickUser(), platform: PLATFORMS[i % PLATFORMS.length], providerMessageId: `pm_${i}`, conversationId: `conv_${Math.floor(i / 4)}`, messageType: 'comment',
      direction: rand() < 0.8 ? 'inbound' : 'outbound', senderType: 'customer', text: filler(160), rawPayload: { note: filler(200) }, createdAt, updatedAt: createdAt,
      ai: hasAi ? { generatedAt: new Date(createdAt.getTime() + 60000), suggestedReplies: rand() < 0.7 ? [filler(100)] : [], autoReplyCandidate: rand() < 0.3 ? filler(60) : '' } : {}
    };
  });
  await insert('featureevents', scale.events, () => ({ userId: pickUser(), feature: FEATURES[Math.floor(rand() * FEATURES.length)], timestamp: ago(rand() * 120) }));
  return { staff, userIds };
}

/** The indexes production already has: every index the models declare, except the ones marked as script-only. */
async function buildExistingIndexes(mongoose, log) {
  const names = ['User', 'Draft', 'Campaign', 'VideoJob', 'HeroVideoJob', 'Blueprint', 'SocialInboxMessage', 'FeatureEvent'];
  for (const n of names) {
    const t = Date.now();
    const Model = require(`../models/${n}`);
    await Model.ensureIndexes({ _automatic: true });
    log(`  indexes built for ${n} (${sec(Date.now() - t)}s)`);
  }
}

// ---- measuring --------------------------------------------------------------------------------------
function startServer(router) {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/staff', router);
  return new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve({ server: s, base: `http://127.0.0.1:${s.address().port}` })); });
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (n) => args.includes(n);
  const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const target = assertSafeTarget(process.env.MONGODB_URI);
  const scaleName = val('--scale') || 'full';
  if (!SCALES[scaleName]) throw new Error('--scale must be full or small');
  const scale = SCALES[scaleName];
  const log = (m) => console.log(m);
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'perf-check-not-a-secret';
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';
  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000, socketTimeoutMS: 900000 });
  log(`Database ${target.db} on ${target.host} (local). Scale: ${scaleName}`);

  const out = { scale: scaleName, counts: {}, pages: {}, indexes: null };
  try {
    if (flag('--seed')) {
      const t = Date.now();
      await seed({ mongoose, scale, log });
      log(`Seeded in ${sec(Date.now() - t)}s. Building the indexes production already has...`);
      await buildExistingIndexes(mongoose, log);
    }
    if (flag('--create-indexes')) {
      log('Running scripts/create-staff-indexes.js for real on this local database...');
      const r = spawnSync(process.execPath, [path.join(__dirname, 'create-staff-indexes.js')], { env: { ...process.env, CONFIRM_CREATE_INDEXES: 'yes' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      log(r.stdout + r.stderr);
      if (r.status !== 0) throw new Error('create-staff-indexes.js failed');
    }

    const db = mongoose.connection.db;
    for (const c of ['users', 'drafts', 'campaigns', 'video_jobs', 'hero_video_jobs', 'blueprints', 'socialinboxmessages', 'featureevents']) out.counts[c] = await db.collection(c).estimatedDocumentCount();
    log('Rows: ' + JSON.stringify(out.counts));
    const indexNames = {};
    for (const c of ['drafts', 'campaigns', 'video_jobs', 'hero_video_jobs', 'blueprints', 'socialinboxmessages', 'featureevents']) indexNames[c] = (await db.collection(c).indexes()).map((i) => i.name);
    out.indexes = indexNames;

    if (flag('--golden')) { await golden({ mongoose }); return; }
    if (flag('--explain')) { out.explain = await explainAll({ mongoose }); fs.writeFileSync(val('--out') || path.join(require('os').tmpdir(), 'staff-explain.json'), JSON.stringify(out, null, 2)); return; }

    const User = require('../models/User');
    const models = {
      User, Draft: require('../models/Draft'), FeatureEvent: require('../models/FeatureEvent'), Campaign: require('../models/Campaign'), VideoJob: require('../models/VideoJob'),
      HeroVideoJob: require('../models/HeroVideoJob'), Blueprint: require('../models/Blueprint'), SocialInboxMessage: require('../models/SocialInboxMessage'), ClientInvoice: require('../models/ClientInvoice')
    };
    const owner = await User.findOne({ email: 'owner@example.test' }).lean();
    const admin = await User.findOne({ email: 'admin@example.test' }).lean();
    const csm = await User.findOne({ email: 'csm1@example.test' }).lean();
    if (!owner) throw new Error('No staff users found: run with --seed first');
    const { generateToken } = require('../middleware/auth');

    // 1. the loaders and builders, called directly (no HTTP, no cache)
    const { loadClientData, buildList } = require('../services/staff/clientList');
    const { buildHome, loadDailyActive, activityIds } = require('../services/staff/home');
    const { buildTeam, loadTeamData } = require('../services/staff/team');
    const { buildUsage, loadUsageData } = require('../services/staff/usage');
    const { loadMoneyData, buildMoney } = require('../services/staff/money');
    const direct = {};
    let r = await timed(() => loadClientData({ viewer: owner, models }));
    direct.clientsLoad = r.seconds; if (r.error) throw r.error;
    const cd = r.value;
    r = await timed(async () => buildList({ viewer: owner, ...cd, page: 1 })); direct.clientsBuild = r.seconds;
    r = await timed(() => loadDailyActive({ FeatureEvent: models.FeatureEvent, ids: activityIds(cd.users) })); direct.homeDailyActive = r.seconds;
    const daily = r.value || [];
    r = await timed(async () => buildHome({ viewer: owner, ...cd, dailyActive: daily })); direct.homeBuild = r.seconds;
    r = await timed(() => loadTeamData({ models })); direct.teamLoad = r.seconds; if (r.error) throw r.error;
    const td = r.value;
    r = await timed(async () => buildTeam(td)); direct.teamBuild = r.seconds;
    r = await timed(() => loadUsageData({ models, window: 30 })); direct.usageLoad = r.seconds; if (r.error) throw r.error;
    const ud = r.value;
    r = await timed(async () => buildUsage({ ...ud, window: 30, level: 'full' })); direct.usageBuild = r.seconds;
    direct.usageUnavailable = Object.keys(ud.unavailable || {});
    direct.usageFunnelUnavailable = { content: Boolean(ud.funnelData.contentReason), published: Boolean(ud.funnelData.publishedReason) };
    r = await timed(() => loadMoneyData({ models })); direct.moneyLoad = r.seconds;
    log('Direct loader and builder seconds: ' + JSON.stringify(direct, null, 1));
    out.direct = direct;

    // 2. the real routes in-process with real tokens
    const router = require('../routes/staff');
    const { server, base } = await startServer(router);
    const hit = async (who, p) => {
      const t = Date.now();
      const res = await fetch(base + p, { headers: { Authorization: `Bearer ${generateToken(String(who._id))}` } });
      const body = await res.json().catch(() => ({}));
      return { seconds: sec(Date.now() - t), status: res.status, body };
    };
    const unavailableOf = (b) => {
      const lost = [];
      ((b.featureUse && b.featureUse.items) || []).forEach((i) => { if (i.available === false) lost.push(i.key); });
      ((b.funnel && b.funnel.steps) || []).forEach((s) => { if (s.available === false) lost.push('funnel:' + s.key); });
      return lost;
    };
    const pages = [
      ['home (owner)', owner, '/api/staff/home'], ['clients (owner)', owner, '/api/staff/clients'], ['team (owner)', owner, '/api/staff/team'],
      ['usage 30 (owner)', owner, '/api/staff/usage?window=30'], ['usage 90 (owner)', owner, '/api/staff/usage?window=90'], ['usage 30 (admin)', admin, '/api/staff/usage?window=30'],
      ['home (csm)', csm, '/api/staff/home'], ['clients (csm)', csm, '/api/staff/clients'], ['money (owner, control)', owner, '/api/staff/money']
    ];
    for (const [label, who, p] of pages) {
      const cold = await hit(who, p);
      const warm = await hit(who, p);
      out.pages[label] = { cold: cold.seconds, warm: warm.seconds, status: cold.status, unavailable: unavailableOf(cold.body), fromCache: Boolean(warm.body && warm.body.freshness && warm.body.freshness.fromCache) };
      log(`${label.padEnd(26)} cold ${String(cold.seconds).padStart(8)} s   second call ${String(warm.seconds).padStart(8)} s   HTTP ${cold.status}   unavailable: ${out.pages[label].unavailable.join(', ') || 'none'}   cache: ${out.pages[label].fromCache ? 'yes' : 'no'}`);
    }
    server.close();
  } finally {
    if (val('--out')) fs.writeFileSync(val('--out'), JSON.stringify(out, null, 2));
    await mongoose.disconnect();
  }
}

/** Walks an explain plan and returns the index names and whether a full collection scan is in it. */
function planOf(stage, acc = { indexes: [], collscan: false }) {
  if (!stage || typeof stage !== 'object') return acc;
  if (stage.stage === 'COLLSCAN') acc.collscan = true;
  if (stage.indexName) acc.indexes.push(stage.indexName);
  ['inputStage', 'queryPlan'].forEach((k) => planOf(stage[k], acc));
  (stage.inputStages || []).forEach((x) => planOf(x, acc));
  return acc;
}

/** Documents looked at and time spent by each Usage / client-list read, taken from the database's own explain. Works the same before and after the indexes. */
async function explainAll({ mongoose }) {
  const { usageSources } = require('../services/staff/usage');
  const db = mongoose.connection.db;
  const since = new Date(Date.now() - 30 * DAY);
  const User = require('../models/User');
  const cohort = (await User.find({ staffRole: null, createdAt: { $gte: since } }, { _id: 1 }).lean()).map((u) => u._id);
  const all = (await User.find({ staffRole: null }, { _id: 1 }).lean()).map((u) => u._id);
  const mine = { userId: { $in: cohort } };
  const group = (match, n = { $sum: 1 }) => [{ $match: match }, { $group: { _id: '$userId', n } }];
  const queries = [
    ...usageSources(since).map((x) => ({ key: x.key, model: x.model, pipeline: x.pipeline })),
    { key: 'funnel: drafts of new clients', model: 'Draft', pipeline: group(mine) },
    { key: 'funnel: campaigns of new clients', model: 'Campaign', pipeline: group(mine) },
    { key: 'funnel: videos of new clients', model: 'VideoJob', pipeline: group(mine) },
    { key: 'funnel: published (date set)', model: 'Campaign', pipeline: group({ ...mine, publishedAt: { $ne: null } }) },
    { key: 'funnel: published (status posted)', model: 'Campaign', pipeline: group({ ...mine, status: 'posted' }) },
    { key: 'funnel: published drafts', model: 'Draft', pipeline: group({ ...mine, status: 'published' }) },
    { key: 'clients: last activity', model: 'FeatureEvent', pipeline: [{ $match: { userId: { $in: all } } }, { $group: { _id: '$userId', last: { $max: '$timestamp' } } }] },
    { key: 'clients: waiting drafts', model: 'Draft', pipeline: [{ $match: { userId: { $in: all }, status: 'draft' } }, { $group: { _id: '$userId', oldest: { $min: '$createdAt' }, n: { $sum: 1 } } }] },
    { key: 'clients: failed posts', model: 'Draft', pipeline: group({ userId: { $in: all }, status: 'failed', updatedAt: { $gte: new Date(Date.now() - 7 * DAY) } }) },
    { key: 'home: daily active', model: 'FeatureEvent', pipeline: [{ $match: { userId: { $in: all }, timestamp: { $gte: since } } }, { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp', timezone: '+05:30' } }, user: '$userId' } } }, { $group: { _id: '$_id.day', n: { $sum: 1 } } }] }
  ];
  const result = [];
  for (const q of queries) {
    const coll = require(`../models/${q.model}`).collection.name;
    const t = Date.now();
    const exp = await db.command({ explain: { aggregate: coll, pipeline: q.pipeline, cursor: {}, allowDiskUse: true }, verbosity: 'executionStats' });
    const first = (exp.stages && exp.stages[0] && exp.stages[0].$cursor) || exp;
    const st = first.executionStats || {};
    const plan = planOf((first.queryPlanner || {}).winningPlan);
    const row = { query: q.key, collection: coll, docsExamined: st.totalDocsExamined, keysExamined: st.totalKeysExamined, returned: st.nReturned, millis: st.executionTimeMillis, plan: plan.collscan ? 'FULL COLLECTION SCAN' : plan.indexes.join(' + ') || '?' };
    result.push(row);
    console.log(`${q.key.padEnd(34)} ${coll.padEnd(20)} docs ${String(row.docsExamined).padStart(8)} keys ${String(row.keysExamined).padStart(8)} ${String(row.millis).padStart(6)} ms  ${row.plan}  (${Date.now() - t} ms wall)`);
  }
  return result;
}

/** Old projections (what shipped on 2026-10-18) against the new ones on the same data: the page numbers must match exactly. */
async function golden({ mongoose }) {
  const User = require('../models/User');
  const { NOT_A_WORKSPACE } = require('../services/agency');
  const assert = require('assert');
  const OLD_USAGE = { email: 1, createdAt: 1, isHidden: 1, staffRole: 1, isCsm: 1, onboardingCompleted: 1, connectedSocials: 1, 'ayrshare.activeSocialAccounts': 1, plan: 1, 'payments.status': 1, 'credits.history': 1 };
  const OLD_CLIENT = { email: 1, firstName: 1, lastName: 1, companyName: 1, mobileNumber: 1, createdAt: 1, isActive: 1, isHidden: 1, lastLoginAt: 1, onboardingCompleted: 1, 'credits.balance': 1, connectedSocials: 1, 'ayrshare.activeSocialAccounts': 1, plan: 1, trial: 1, 'payments.status': 1, assignedCsm: 1, staffRole: 1, isCsm: 1, 'businessProfile.name': 1 };
  const scope = { staffRole: null, isCsm: { $ne: true }, ...NOT_A_WORKSPACE };
  const { USAGE_USER_PROJECTION, HISTORY_READ_CAP, buildUsage } = require('../services/staff/usage');
  const { CLIENT_USER_PROJECTION } = require('../services/staff/clientList');
  const oldUsers = await User.find(scope, OLD_USAGE).lean();
  const now = Date.now();
  const usage = { images: oldUsers.slice(0, 50).map((u, i) => ({ _id: String(u._id), n: i + 1 })), postsDrafted: oldUsers.slice(0, 80).map((u) => ({ _id: String(u._id), n: 2 })) };
  for (const level of ['full', 'summary']) {
    const projection = level === 'full' ? { ...USAGE_USER_PROJECTION, 'credits.history': { $slice: -HISTORY_READ_CAP } } : USAGE_USER_PROJECTION;
    const newUsers = await User.find(scope, projection).lean();
    for (const window of [30, 90]) {
      const a = buildUsage({ users: oldUsers, usage, window, level, now });
      const b = buildUsage({ users: newUsers, usage, window, level, now });
      assert.deepStrictEqual(b, a, `usage output differs at level ${level}, ${window} days`);
    }
  }
  // The published-posts funnel step is now read as two lookups instead of one $or: same clients.
  {
    const { loadUsageData } = require('../services/staff/usage');
    const Campaign = require('../models/Campaign'); const Draft = require('../models/Draft');
    const models = { User, Draft, Campaign, VideoJob: require('../models/VideoJob'), HeroVideoJob: require('../models/HeroVideoJob'), Blueprint: require('../models/Blueprint'), SocialInboxMessage: require('../models/SocialInboxMessage') };
    const data = await loadUsageData({ models, window: 90, now, level: 'summary' });
    const cohort = oldUsers.filter((u) => !u.staffRole && !u.isCsm && !u.isHidden && u.createdAt && u.createdAt.getTime() >= now - 90 * DAY).map((u) => u._id);
    const mine = { userId: { $in: cohort } };
    const group = (match) => [{ $match: match }, { $group: { _id: '$userId', n: { $sum: 1 } } }];
    const old = new Set([
      ...(await Campaign.aggregate(group({ ...mine, $or: [{ publishedAt: { $ne: null } }, { status: 'posted' }] }))),
      ...(await Draft.aggregate(group({ ...mine, status: 'published' })))
    ].map((r) => String(r._id)));
    assert.deepStrictEqual([...data.funnelData.publishedIds].sort(), [...old].sort(), 'published funnel step differs');
    assert.ok(old.size > 0);
  }
  const { buildList } = require('../services/staff/clientList');
  const { buildHome } = require('../services/staff/home');
  const oldC = await User.find(scope, OLD_CLIENT).lean();
  const newC = await User.find(scope, CLIENT_USER_PROJECTION).lean();
  const owner = { _id: 'x', staffRole: 'owner' };
  for (const filter of ['all', 'attention', 'paying', 'active', 'trial']) {
    assert.deepStrictEqual(buildList({ viewer: owner, users: newC, filter, now }), buildList({ viewer: owner, users: oldC, filter, now }), `list differs for ${filter}`);
  }
  assert.deepStrictEqual(buildHome({ viewer: owner, users: newC, now }), buildHome({ viewer: owner, users: oldC, now }), 'home differs');
  console.log(`GOLDEN OK: ${oldUsers.length} customers read by the real database: usage (full and summary, 30 and 90 days), client list (5 filters) and Home are identical with the old and the new user projections.`);
}

if (require.main === module) {
  main().then(() => process.exit(0), (e) => { console.error('FAILED:', e.message); process.exit(1); });
}
module.exports = { assertSafeTarget, SCALES };
