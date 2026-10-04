const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { requireFeature } = require('../middleware/requireFeature');
const { FEATURES, newAccountPlan } = require('../config/entitlements');
const hero = require('../services/heroVideoService');

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

async function run(feature, user, opts) {
  const mw = requireFeature(feature, { loadUser: async () => user, ...(opts || {}) });
  const res = fakeRes();
  let nexted = false;
  await mw({ user: { id: 'u1' } }, res, () => { nexted = true; });
  return { res, nexted };
}

const OUTSIDE = FEATURES.filter((f) => f !== 'create' && f !== 'video');

test('free user is blocked from every outside-service feature with the plain upgrade body', async () => {
  for (const f of OUTSIDE) {
    const { res, nexted } = await run(f, { plan: { tier: 'free' } });
    assert.equal(nexted, false, f);
    assert.equal(res.statusCode, 403, f);
    assert.equal(res.body.success, false);
    assert.equal(res.body.upgradeRequired, true);
    assert.equal(res.body.reason, 'upgrade');
    assert.equal(res.body.feature, f);
    assert.match(res.body.message, /upgrade your plan/);
  }
});

test('free user may still use create and video', async () => {
  for (const f of ['create', 'video']) {
    assert.equal((await run(f, { plan: { tier: 'free' } })).nexted, true);
  }
});

test('starter without add-on gets reason addon; with publish add-on passes publish only', async () => {
  const bare = { plan: { tier: 'starter', addons: [] } };
  for (const f of OUTSIDE) {
    const { res } = await run(f, bare);
    assert.equal(res.statusCode, 403, f);
    assert.equal(res.body.reason, 'addon');
    assert.equal(res.body.upgradeRequired, true);
  }
  const withPublish = { plan: { tier: 'starter', addons: ['publish'] } };
  for (const f of ['social_connect', 'publish', 'schedule']) assert.equal((await run(f, withPublish)).nexted, true, f);
  for (const f of ['inbox', 'auto_reply', 'competitors']) assert.equal((await run(f, withPublish)).res.statusCode, 403, f);
});

test('managed passes every feature', async () => {
  for (const f of FEATURES) assert.equal((await run(f, { plan: { tier: 'managed' } })).nexted, true, f);
});

test('an account object without plan (every existing account) passes every gate', async () => {
  for (const f of FEATURES) assert.equal((await run(f, { email: 'old@x.com', credits: { balance: 3 } })).nexted, true, f);
});

test('user lookup failure -> 500 with a generic message, never allowed', async () => {
  const mw = requireFeature('publish', { loadUser: async () => { throw new Error('db down: secret detail'); } });
  const res = fakeRes();
  let nexted = false;
  const origErr = console.error; console.error = () => {};
  try { await mw({ user: { id: 'u1' } }, res, () => { nexted = true; }); } finally { console.error = origErr; }
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 500);
  assert.doesNotMatch(JSON.stringify(res.body), /secret detail/);
});

test('missing user id or missing user -> 401, never allowed', async () => {
  const mw = requireFeature('publish', { loadUser: async () => null });
  const res = fakeRes();
  let nexted = false;
  await mw({ user: { id: 'u1' } }, res, () => { nexted = true; });
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 401);
  const res2 = fakeRes();
  await requireFeature('publish', { loadUser: async () => ({}) })({}, res2, () => { nexted = true; });
  assert.equal(nexted, false);
  assert.equal(res2.statusCode, 401);
});

// ---- Quark guard: no time lock ----
const Module = require('module');
function loadTrialGuardWith(fakeUser) {
  const userPath = require.resolve('../models/User');
  const original = require.cache[userPath];
  require.cache[userPath] = { id: userPath, filename: userPath, loaded: true, exports: { findById: async () => fakeUser } };
  const guardPath = require.resolve('../middleware/trialGuard');
  delete require.cache[guardPath];
  const guard = require('../middleware/trialGuard');
  delete require.cache[guardPath];
  if (original) require.cache[userPath] = original; else delete require.cache[userPath];
  return guard;
}

async function runCheckTrial(user) {
  const guard = loadTrialGuardWith(user);
  const res = fakeRes();
  let nexted = false;
  await guard.checkTrial({ user: { id: 'u1' } }, res, () => { nexted = true; });
  return { res, nexted };
}

test('expired trial date with Quarks left is NOT blocked', async () => {
  const user = { credits: { balance: 40 }, trial: { expiresAt: new Date('2020-01-01'), isExpired: true } };
  const { res, nexted } = await runCheckTrial(user);
  assert.equal(nexted, true);
  assert.equal(res.statusCode, 200);
});

test('zero Quarks gets the friendly message and keeps the keys the frontend reads', async () => {
  const user = { credits: { balance: 0 }, trial: { expiresAt: new Date('2099-01-01') } };
  const { res, nexted } = await runCheckTrial(user);
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.creditsExhausted, true);
  assert.equal(res.body.upgradeRequired, true);
  assert.equal(res.body.reason, 'quarks');
  assert.equal(res.body.creditsRemaining, 0);
  assert.equal(res.body.message, 'You do not have enough Quarks for this. Please upgrade your plan, or buy an add-on pack or Quarks.');
  assert.doesNotMatch(res.body.message, /credit/i);
});

test('the 100 Quark grant is made once, not again on the next call', async () => {
  const { ensureCreditCycle, TRIAL_CREDITS } = require('../middleware/creditGuard');
  assert.equal(TRIAL_CREDITS, 100);
  let saves = 0;
  const user = { save: async () => { saves += 1; } };
  await ensureCreditCycle(user);
  assert.equal(user.credits.balance, 100);
  assert.equal(saves, 1);
  user.credits.balance = 37;
  await ensureCreditCycle(user);
  assert.equal(user.credits.balance, 37);
  assert.equal(saves, 1);
});

// ---- registration ----
test('new accounts are created on the free tier; login and verify never write a plan', () => {
  assert.deepEqual(newAccountPlan(), { tier: 'free' });
  const src = fs.readFileSync(path.join(__dirname, '../routes/auth.js'), 'utf8');
  const create = src.indexOf('User.create({');
  assert.ok(create > 0);
  const block = src.slice(create, src.indexOf('});', create));
  assert.match(block, /plan:\s*newAccountPlan\(\)/);
  assert.equal((src.match(/newAccountPlan\(\)/g) || []).length, 1);
  assert.doesNotMatch(src, /\.plan\s*=|'plan\.tier'|plan\.tier\s*=/);
});

test('User schema declares an optional plan and leaves trial in place', () => {
  const src = fs.readFileSync(path.join(__dirname, '../models/User.js'), 'utf8');
  assert.match(src, /plan:\s*\{\s*tier:\s*\{\s*type:\s*String\s*\}/);
  assert.match(src, /addons:\s*\[\{?\s*type:\s*String|addons:\s*\[String\]/);
  assert.match(src, /subscriptionId:\s*\{\s*type:\s*String\s*\}/);
  assert.match(src, /trial:\s*\{/);
});

// ---- route coverage: every gated route must carry requireFeature in its chain ----
const GATED = [
  ['routes/social.js', 'get', '/:platform/auth', 'social_connect'],
  ['routes/social.js', 'get', '/youtube/auth', 'social_connect'],
  ['routes/social.js', 'get', '/connect/:platform', 'social_connect'],
  ['routes/social.js', 'post', '/connect/:platform', 'social_connect'],
  ['routes/social.js', 'get', '/ayrshare/connect-url/:platform', 'social_connect'],
  ['routes/social.js', 'post', '/post', 'publish'],
  ['routes/social.js', 'get', '/inbox/summary', 'inbox'],
  ['routes/social.js', 'get', '/inbox/conversations', 'inbox'],
  ['routes/social.js', 'get', '/inbox/conversations/:id/messages', 'inbox'],
  ['routes/social.js', 'post', '/inbox/conversations/:id/reply', 'inbox'],
  ['routes/social.js', 'patch', '/inbox/conversations/:id/status', 'inbox'],
  ['routes/social.js', 'patch', '/inbox/conversations/:id/meta', 'inbox'],
  ['routes/social.js', 'post', '/inbox/sync/:platform', 'inbox'],
  ['routes/social.js', 'post', '/inbox/webhooks/register', 'inbox'],
  ['routes/socialInboxRoutes.js', 'get', '/summary', 'inbox'],
  ['routes/socialInboxRoutes.js', 'get', '/settings', 'inbox'],
  ['routes/socialInboxRoutes.js', 'put', '/settings', 'inbox'],
  ['routes/socialInboxRoutes.js', 'post', '/auto-reply/toggle', 'auto_reply'],
  ['routes/socialInboxRoutes.js', 'get', '/conversations', 'inbox'],
  ['routes/socialInboxRoutes.js', 'get', '/conversations/:id/messages', 'inbox'],
  ['routes/socialInboxRoutes.js', 'post', '/conversations/:id/reply', 'inbox'],
  ['routes/socialInboxRoutes.js', 'patch', '/conversations/:id/status', 'inbox'],
  ['routes/socialInboxRoutes.js', 'patch', '/conversations/:id/meta', 'inbox'],
  ['routes/socialInboxRoutes.js', 'post', '/sync/:platform', 'inbox'],
  ['routes/socialInboxRoutes.js', 'post', '/dev/ingest', 'inbox'],
  ['routes/socialInboxRoutes.js', 'post', '/dev/test', 'inbox'],
  ['routes/competitors.js', 'post', '/auto-discover', 'competitors'],
  ['routes/competitors.js', 'post', '/add-manual', 'competitors'],
  ['routes/competitors.js', 'post', '/scrape-by-type', 'competitors'],
  ['routes/dashboard.js', 'post', '/refresh-competitor-posts', 'competitors'],
  ['routes/seoRoutes.js', 'post', '/competitor-analysis', 'competitors'],
  ['routes/drafts.js', 'post', '/:id/schedule', 'schedule'],
  ['routes/drafts.js', 'post', '/:id/publish', 'publish'],
  ['routes/campaigns.js', 'post', '/:id/publish', 'publish']
];

function routeLine(src, method, p) {
  const needle = `router.${method}('${p}'`;
  return src.split('\n').find((l) => l.startsWith(needle));
}

test('every listed outside-service route has requireFeature(<feature>) in its chain', () => {
  for (const [file, method, p, feature] of GATED) {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const line = routeLine(src, method, p);
    assert.ok(line, `route not found: ${method} ${p} in ${file}`);
    assert.ok(line.includes(`requireFeature('${feature}')`), `${method.toUpperCase()} ${p} in ${file} must use requireFeature('${feature}')`);
  }
});

test('the video schedulePost route (Kling file stays untouched) is gated at the mount in server-main', () => {
  const src = fs.readFileSync(path.join(__dirname, '../server-main.js'), 'utf8');
  const gate = src.indexOf("app.post('/api/video-generation/schedulePost', protect, requireFeature('schedule'))");
  const mount = src.indexOf("app.use('/api/video-generation'");
  assert.ok(gate > 0 && gate < mount);
});

test('callbacks, webhooks, Hero, billing, auth and admin routes carry no requireFeature', () => {
  for (const f of ['routes/heroVideo.js', 'routes/payment.js', 'routes/auth.js', 'routes/admin.js', 'routes/credits.js', 'routes/brandAssets.js', 'routes/aiMemory.js', 'routes/contentCalendar.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.ok(!src.includes('requireFeature'), f);
  }
  const social = fs.readFileSync(path.join(__dirname, '../routes/social.js'), 'utf8');
  for (const l of social.split('\n').filter((x) => /callback'|webhooks\/:platform'/.test(x))) assert.ok(!l.includes('requireFeature'), l);
  const inbox = fs.readFileSync(path.join(__dirname, '../routes/socialInboxRoutes.js'), 'utf8');
  for (const l of inbox.split('\n').filter((x) => /webhooks|'\/stream'/.test(x))) assert.ok(!l.includes('requireFeature'), l);
});

// ---- Hero quota ----
test('getHeroQuota takes its limit from heroLimitForUser (tier-aware, managed 2, env wins)', async () => {
  const fake = { countDocuments: async () => 0 };
  const users = (plan) => ({ findById: () => ({ select: () => ({ lean: async () => ({ plan }) }) }) });
  const now = new Date('2026-10-10T10:00:00Z');
  delete process.env.HERO_VIDEO_MONTHLY_LIMIT;
  assert.equal((await hero.getHeroQuota('u1', now, fake)).limit, 2);
  assert.equal((await hero.getHeroQuota('u1', now, fake, users(undefined))).limit, 2);
  assert.equal((await hero.getHeroQuota('u1', now, fake, users({ tier: 'managed' }))).limit, 2);
  assert.equal((await hero.getHeroQuota('u1', now, fake, users({ tier: 'starter' }))).limit, 1);
  assert.equal((await hero.getHeroQuota('u1', now, fake, users({ tier: 'free' }))).limit, 1);
  process.env.HERO_VIDEO_MONTHLY_LIMIT = '5';
  try { assert.equal((await hero.getHeroQuota('u1', now, fake, users({ tier: 'free' }))).limit, 5); } finally { delete process.env.HERO_VIDEO_MONTHLY_LIMIT; }
  const broken = { findById: () => { throw new Error('x'); } };
  assert.equal((await hero.getHeroQuota('u1', now, fake, broken)).limit, 2);
});
