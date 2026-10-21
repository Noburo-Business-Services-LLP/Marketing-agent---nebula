// The demo brand seed (scripts/seed-demo-brand.js) and the demo-account guard (D101): pure parts only, no database.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const K = require('../scripts/demo-brand/constants');
const safety = require('../scripts/demo-brand/safety');
const account = require('../scripts/demo-brand/account');
const assets = require('../scripts/demo-brand/assets');
const products = require('../scripts/demo-brand/products');
const socials = require('../scripts/demo-brand/socials');
const images = require('../scripts/demo-brand/images');
const demo = require('../services/demoProfile');
const Q = require('../config/businessQuestions');
const { PLANS, chargePaise } = require('../config/apiCosts');

const NOW = new Date('2026-10-20T06:00:00Z');
const UID = '65f000000000000000000001';

// ---------------------------------------------------------------- constants
test('constants: the brand, palette, 8 products, 5 competitors and 4 socials are complete', () => {
  assert.strictEqual(K.BRAND.name, 'Nilaa Botanics');
  assert.ok(K.BRAND.tagline.length > 10);
  assert.deepStrictEqual(K.PALETTE, { plum: '#3B1F3A', roseGold: '#C98B7B', cream: '#FBF3EA', sage: '#8AA17D' });
  assert.strictEqual(K.PRODUCTS.length, 8);
  for (const p of K.PRODUCTS) {
    assert.ok(p.name && p.slug && p.size && p.category, p.slug);
    assert.ok(Number.isInteger(p.price) && p.price > 0, p.slug);
    assert.ok(p.ingredients.length >= 3 && p.benefits.length >= 3 && p.description.length > 40, p.slug);
    assert.ok(/^[a-z0-9-]+$/.test(p.slug), p.slug);
  }
  assert.deepStrictEqual(K.PRODUCTS.map((p) => p.price), [1299, 749, 549, 449, 1099, 699, 599, 399]);
  assert.strictEqual(new Set(K.PRODUCTS.map((p) => p.slug)).size, 8);
  assert.deepStrictEqual(K.COMPETITORS.map((c) => c.name), ['Kaya Veda', 'Pure Petal Co', 'Ritu Organics', 'Glow Ghar', 'Amla and Ash']);
  assert.strictEqual(K.CHARACTERS.length, 3);
  assert.strictEqual(K.PLACES.length, 2);
  assert.deepStrictEqual(K.SOCIALS.map((s) => s.platform), ['instagram', 'facebook', 'youtube', 'linkedin']);
  assert.ok(K.SOCIALS[0].analytics.followersCount > 30000 && K.SOCIALS[0].analytics.followersCount < 40000, 'about 34k on Instagram');
  assert.ok(/\.example$/.test(new URL(K.BRAND.website).hostname), 'the website is a reserved example domain');
});

test('constants: the questionnaire answers are values the app accepts (new shape)', () => {
  const a = K.PROFILE_ANSWERS;
  assert.ok(Q.INDUSTRIES.includes(a.industry));
  assert.ok(Q.SELLS_TO.includes(a.businessType) && a.businessType === 'B2C');
  assert.ok(a.reachAreas.every((r) => Q.REACH_AREAS.includes(r)) && a.reachAreas.includes('state') && a.reachAreas.includes('india'));
  assert.ok(a.ageGroups.every((g) => Q.AGE_GROUPS.includes(g)));
  assert.ok(Q.GENDERS.includes(a.targetGender));
  assert.ok(a.marketingGoals.length && a.marketingGoals.every((g) => Q.GOALS.includes(g)));
  assert.ok(a.brandVoice.every((v) => Q.VOICES.includes(v)));
  assert.ok(Q.OFFERED_CONTENT_LANGUAGES.includes(a.contentLanguage));
  assert.deepStrictEqual(a.additionalLanguages, ['tamil']);
  assert.strictEqual(a.accountKind, 'one');
});

// ---------------------------------------------------------------- safety
test('safety: refuses any database except nebulaa_dev, before connecting', () => {
  assert.throws(() => safety.assertDevUri(''), /MONGODB_URI is not set/);
  assert.throws(() => safety.assertDevUri(undefined), /not set/);
  for (const uri of ['mongodb+srv://u:p@cluster.example.net/nebulaa?retryWrites=true', 'mongodb://localhost:27017/nebulaa_prod',
    'mongodb://localhost:27017/', 'mongodb://localhost:27017', 'mongodb://localhost/nebulaa_dev_copy', 'postgres://x/nebulaa_dev']) {
    assert.throws(() => safety.assertDevUri(uri), /only runs on the database named nebulaa_dev/, uri);
  }
  safety.assertDevUri('mongodb+srv://u:p@cluster.example.net/nebulaa_dev?retryWrites=true&w=majority');
  safety.assertDevUri('mongodb://h1:1,h2:2/nebulaa_dev');
  assert.throws(() => safety.assertDevTarget('nebulaa'), /nebulaa_dev/);
  safety.assertDevTarget('nebulaa_dev');
});

test('safety: password file outside the repo only, local picture links only, fixed fake email', () => {
  assert.ok(safety.passwordFileOk(path.join(os.tmpdir(), 'demo-login.txt')));
  assert.ok(!safety.passwordFileOk(path.join(safety.REPO_ROOT, 'backend', 'login.txt')));
  assert.ok(!safety.passwordFileOk(path.join(safety.REPO_ROOT, 'login.txt')));
  assert.ok(!safety.passwordFileOk('relative/login.txt'));
  assert.ok(!safety.passwordFileOk(''));
  assert.ok(safety.assetBaseOk('http://localhost:5000') && safety.assetBaseOk('http://127.0.0.1:5001'));
  assert.ok(!safety.assetBaseOk('https://gravity.nebulaa.ai') && !safety.assetBaseOk('http://localhost:5000/'));
  assert.ok(safety.emailOk('demo-nilaa@example.test') && !safety.emailOk('someone@gmail.com'));
  assert.match(safety.makePassword(), /^[A-HJ-NP-Za-km-z2-9]{5}-[A-HJ-NP-Za-km-z2-9]{5}-[A-HJ-NP-Za-km-z2-9]{5}$/);
  assert.ok(safety.PROFILE_KEY.startsWith('demo-'));
});

test('safety: the generated password always passes the app password rule (letter, number, 10+ characters, not common)', () => {
  const { checkPassword } = require('../utils/passwordPolicy');
  for (let i = 0; i < 300; i += 1) assert.strictEqual(checkPassword(safety.makePassword(), { email: safety.DEMO_EMAIL }), '');
  // worst cases: all bytes map to letters, or all to digits
  assert.strictEqual(checkPassword(safety.makePassword(Buffer.alloc(15, 0)), {}), '');
  assert.strictEqual(checkPassword(safety.makePassword(Buffer.alloc(15, 50)), {}), '');
  assert.ok(safety.makePassword().length >= 12);
});

test('safety: arguments in both forms', () => {
  assert.deepStrictEqual(safety.parseArgs(['create', '--password-file', '/tmp/a.txt']), { mode: 'create', passwordFile: '/tmp/a.txt', assetBase: 'http://localhost:5000' });
  assert.deepStrictEqual(safety.parseArgs(['create', '--password-file=/tmp/b.txt', '--asset-base=http://localhost:5001']), { mode: 'create', passwordFile: '/tmp/b.txt', assetBase: 'http://localhost:5001' });
  assert.strictEqual(safety.parseArgs(['status']).mode, 'status');
});

// ---------------------------------------------------------------- markers
test('markers: every row the seed builds carries its collection marker, and the filters name the demo user', () => {
  const t = account.timeline(NOW);
  const base = 'http://localhost:5000';
  for (const spec of assets.assetSpecs()) {
    const row = assets.assetRow(spec, { userId: UID, base, buffer: Buffer.from('x'.repeat(30)), createdAt: NOW });
    assert.ok(safety.hasMarker('BrandAsset', row), spec.rel);
    assert.ok(row.url.startsWith(`${base}/demo-assets/nilaa/`));
  }
  for (const row of products.productRows({ userId: UID, base, createdAt: t.createdAt })) assert.ok(safety.hasMarker('Product', row), row.name);
  for (const row of account.ledgerRows(t, UID)) assert.ok(safety.hasMarker('QuarkLedger', row), row.ref);
  assert.ok(!safety.hasMarker('Product', { imageUrl: 'https://res.cloudinary.com/x/products/a.jpg' }));
  assert.ok(!safety.hasMarker('QuarkLedger', { ref: 'pay_real123' }));
  for (const name of Object.keys(safety.MARKERS)) {
    const f = safety.markerFilter(name, UID);
    assert.strictEqual(String(f.user || f.userId), UID, name);
  }
  assert.throws(() => safety.markerFilter('Draft', UID), /No demo marker/);
  assert.ok(safety.isDemoUser({ email: 'demo-nilaa@example.test', ayrshare: { profileKey: 'demo-nilaa-botanics' } }));
  assert.ok(!safety.isDemoUser({ email: 'demo-nilaa@example.test', ayrshare: { profileKey: 'real-key' } }));
});

// ---------------------------------------------------------------- account, payments and wallet
test('account: Growth plan with the bundle, consent, tour, new-shape profile, reminder already claimed', () => {
  const t = account.timeline(NOW);
  const f = account.buildUserFields(t, { logoUrl: 'http://localhost:5000/demo-assets/nilaa/brand/logo.png' });
  assert.strictEqual(f.email, 'demo-nilaa@example.test');
  assert.ok(f.isVerified && f.onboardingCompleted && f.tour.completedAt);
  assert.strictEqual(f.consent.termsVersion, require('../config/legalVersions').TERMS_VERSION);
  assert.strictEqual(f.plan.tier, 'professional');
  assert.deepStrictEqual([...f.plan.addons].sort(), ['bundle', 'competitors', 'inbox', 'publish']);
  const ent = require('../config/entitlements');
  for (const feature of ['publish', 'schedule', 'inbox', 'auto_reply', 'competitors', 'photoshoot']) assert.ok(ent.canUse(f, feature).allowed, feature);
  assert.strictEqual(f.subscription.status, 'active');
  assert.strictEqual(+f.subscription.reminderForBillingAt, +f.subscription.nextBillingAt, 'the reminder email is never sent');
  assert.ok(f.subscription.nextBillingAt > NOW && f.createdAt < NOW);
  assert.strictEqual(f.businessProfile.businessType, 'B2C');
  assert.deepStrictEqual(f.businessProfile.reachAreas, ['state', 'india']);
  assert.strictEqual(f.businessProfile.accountKind, 'one');
  assert.strictEqual(f.businessProfile.brandAssets.brandColors.length, 4);
  const rr = require('../services/renewalReminders');
  assert.strictEqual(rr.isDue({ ...f, subscription: f.subscription }, f.subscription.nextBillingAt.getTime() - 3 * 86400000), false);
});

test('account: 6 plan charges (first + 5 renewals), 5 bundle charges and 1 top-up, shaped like real payments', () => {
  const t = account.timeline(NOW);
  const pays = account.buildPayments(t);
  const plan = pays.filter((p) => p.razorpayOrderId === account.SUB_PLAN);
  assert.strictEqual(plan.length, 6);
  assert.strictEqual(pays.filter((p) => p.razorpayOrderId === account.SUB_ADDON).length, 5);
  const topups = pays.filter((p) => p.item === 'Nebulaa Quarks');
  assert.strictEqual(topups.length, 1);
  assert.strictEqual(plan[0].amount, chargePaise(PLANS.professional.inr) / 100);
  assert.strictEqual(plan[0].credits, PLANS.professional.quarks);
  assert.ok(pays.every((p) => p.status === 'paid' && p.paidAt <= NOW && p.razorpayPaymentId.startsWith('pay_demoNilaa')));
  assert.strictEqual(new Set(pays.map((p) => p.razorpayPaymentId)).size, pays.length);
  for (let i = 1; i < pays.length; i += 1) assert.ok(pays[i].paidAt >= pays[i - 1].paidAt, 'oldest first');
});

test('wallet: the ledger adds up, never goes below zero, and the balance is healthy but not full', () => {
  const t = account.timeline(NOW);
  const { rows, credits } = account.buildWallet(t);
  let bal = 0;
  for (const r of rows) { bal += r.quarks; assert.strictEqual(r.balanceAfter, bal, r.ref); assert.ok(bal >= 0); }
  assert.strictEqual(credits.balance, bal);
  assert.strictEqual(credits.balance, credits.planBalance + credits.topupBalance);
  assert.ok(credits.balance > 500 && credits.planBalance < PLANS.professional.quarks, `balance ${credits.balance}`);
  assert.strictEqual(credits.totalUsed, K.TIMELINE.monthSpends.reduce((a, b) => a + b, 0));
  assert.strictEqual(-rows.filter((r) => r.type === 'spend').reduce((s, r) => s + r.quarks, 0), credits.totalUsed);
  assert.strictEqual(rows.filter((r) => r.type === 'grant').length, 6);
  assert.strictEqual(rows.filter((r) => r.type === 'purchase').length, 1);
  assert.ok(credits.planExpiresAt > NOW && credits.topupExpiresAt > NOW, 'nothing expires on the next read');
  const buckets = require('../services/quarkBuckets');
  const s = buckets.summarise({ credits }, NOW);
  assert.deepStrictEqual([s.plan, s.topup, s.kept], [credits.planBalance, credits.topupBalance, 0]);
  assert.ok(credits.history.length > 0 && credits.history.length <= 100);
});

test('wallet: the same numbers whatever day create runs (the demo never goes stale)', () => {
  for (const day of ['2026-11-30T23:00:00Z', '2027-03-01T00:30:00Z', '2026-12-31T12:00:00Z']) {
    const now = new Date(day);
    const t = account.timeline(now);
    const { credits } = account.buildWallet(t);
    assert.strictEqual(credits.balance, 1355, day);
    assert.ok(t.charges.every((c, i) => i === 0 || c > t.charges[i - 1]));
    assert.ok(t.nextCharge > now && t.charges[5] < now, day);
  }
});

// ---------------------------------------------------------------- socials and the demo guard (D101)
test('socials: stored in the real fields with a demo key; reads come from the stored record', () => {
  const ay = socials.buildAyrshare({ connectedAt: NOW, avatarUrl: 'http://localhost:5000/demo-assets/nilaa/brand/logo.png', now: NOW });
  assert.ok(demo.isDemoProfile({ ayrshare: ay }));
  assert.deepStrictEqual(ay.activeSocialAccounts, ['instagram', 'facebook', 'youtube', 'linkedin']);
  assert.ok(ay.displayNames.every((d) => !d.profileUrl), 'no link to a real profile');
  const prof = demo.profileFromUser({ ayrshare: ay });
  assert.deepStrictEqual(prof.data.activeSocialAccounts, ay.activeSocialAccounts);
  // The list is returned as stored: /social/status saves it back as its cache, so nothing may be dropped.
  assert.deepStrictEqual(prof.data.displayNames, ay.displayNames);
  const an = demo.analyticsFromUser({ ayrshare: ay }, ['instagram', 'linkedin']);
  assert.deepStrictEqual(Object.keys(an.data), ['instagram', 'linkedin']);
  assert.strictEqual(an.data.instagram.analytics.followersCount, 34280);
  assert.strictEqual(an.data.linkedin.analytics.followers.totalFollowerCount, 1460);
});

test('isDemoProfile: only keys that start with demo-', () => {
  assert.ok(demo.isDemoProfile({ ayrshare: { profileKey: 'demo-nilaa-botanics' } }));
  assert.ok(demo.isDemoProfile({ ayrshare: { profileKey: '  demo-x' } }));
  for (const u of [{}, null, { ayrshare: {} }, { ayrshare: { profileKey: '' } }, { ayrshare: { profileKey: 'A1B2-demo-C3' } }, { ayrshare: { profileKey: 'DEMO-x' } }]) {
    assert.ok(!demo.isDemoProfile(u), JSON.stringify(u));
  }
  assert.ok(demo.requestUsesDemoKey({ headers: { 'Profile-Key': 'demo-a' } }));
  assert.ok(demo.requestUsesDemoKey({ headers: { 'X-Profile-Key': 'demo-a' } }));
  assert.ok(demo.requestUsesDemoKey({ body: { profileKey: 'demo-a' } }));
  assert.ok(demo.requestUsesDemoKey({ body: JSON.stringify({ profileKey: 'demo-a' }) }));
  assert.ok(!demo.requestUsesDemoKey({ headers: { 'Profile-Key': 'REALKEY' }, body: { post: 'demo-a' } }));
  const reply = demo.blockedReply();
  assert.strictEqual(reply.status, 400);
  assert.ok(!/suspend|rate limit/i.test(reply.data.message), 'never trips the suspension circuit breaker');
});

test('the provider client never opens a connection for a demo key (and answers reads from stored data)', async () => {
  const https = require('https'); const http = require('http');
  const real = { h: https.request, p: http.request, key: process.env.AYRSHARE_API_KEY };
  let opened = 0;
  https.request = () => { opened += 1; throw new Error('no network in this test'); };
  http.request = () => { opened += 1; throw new Error('no network in this test'); };
  process.env.AYRSHARE_API_KEY = 'test-key-not-real';
  const modPath = require.resolve('../services/socialMediaAPI');
  delete require.cache[modPath];
  const log = console.log; console.log = () => {};
  try {
    const api = require('../services/socialMediaAPI');
    const st = await api.getPostStatus('post123', { profileKey: 'demo-nilaa-botanics' });
    assert.strictEqual(st.success, false);
    const del = await api.retryPost('post123', { profileKey: 'demo-nilaa-botanics' });
    assert.strictEqual(del.success, false);
    const post = await api.postToSocialMedia(['instagram'], 'hello', { profileKey: 'demo-nilaa-botanics' });
    assert.strictEqual(post.success, false); assert.strictEqual(post.demo, true);
    // Reads use the stored record (a fake model here).
    const stored = { ayrshare: socials.buildAyrshare({ connectedAt: NOW, now: NOW }) };
    const User = { findOne: () => ({ select: () => ({ lean: async () => stored }) }) };
    const prof = await demo.storedProfile('demo-nilaa-botanics', { User });
    assert.strictEqual(prof.success, true);
    assert.strictEqual(prof.activeSocialAccounts.length, 4);
    const an = await demo.storedAnalytics('demo-nilaa-botanics', ['instagram'], { User });
    assert.strictEqual(an.data.instagram.analytics.followersCount, 34280);
    assert.strictEqual(opened, 0, 'no connection was opened');
  } finally {
    console.log = log;
    https.request = real.h; http.request = real.p;
    if (real.key === undefined) delete process.env.AYRSHARE_API_KEY; else process.env.AYRSHARE_API_KEY = real.key;
    delete require.cache[modPath];
  }
});

test('background jobs leave demo accounts alone (the shared gate lists them)', async () => {
  const gate = require('../services/backgroundGate');
  const chain = (rows) => ({ select: () => ({ lean: async () => rows }) });
  const User = {
    find: (f) => (f && f['ayrshare.profileKey'] && f['ayrshare.profileKey'].$regex === '^demo-' ? chain([{ _id: 'demoUser' }]) : chain([])),
    distinct: async () => []
  };
  assert.deepStrictEqual((await gate.blockedAccountIds({ User })).map(String), ['demoUser']);
  assert.deepStrictEqual(demo.DEMO_PROFILE_QUERY, { 'ayrshare.profileKey': { $regex: '^demo-' } });
});

test('no renewal reminder email for a demo account, even when due', async () => {
  const rr = require('../services/renewalReminders');
  const now = Date.parse('2026-11-10T06:00:00Z');
  const u = { _id: 'd1', email: 'demo-nilaa@example.test', firstName: 'Nila', isActive: true, ayrshare: { profileKey: 'demo-nilaa-botanics' },
    subscription: { status: 'active', nextBillingAt: new Date(now + 3 * 86400000), cancelAtPeriodEnd: false },
    plan: { tier: 'professional', subscriptions: [{ subscriptionId: 's1', kind: 'plan', key: 'professional', active: true }] } };
  let asked = null; const sent = [];
  const User = { find: (q) => ({ select: (s) => { asked = s; return { limit: () => ({ lean: async () => [u] }) }; } }), findOneAndUpdate: async () => u, updateOne: async () => ({}) };
  const r = await rr.runRenewalRemindersOnce({ now, deps: { User, transport: async (m) => { sent.push(m); return { sent: true }; }, env: {}, logger: { log() {}, error() {} } } });
  assert.strictEqual(sent.length, 0);
  assert.strictEqual(r.sent, 0);
  assert.match(asked, /ayrshare\.profileKey/);
});

test('the profile count and the reviews, disconnect, billing and scheduler paths all honour the demo guard', async () => {
  const watch = require('../services/ayrshareProfileWatch');
  assert.ok(watch.PROFILE_FILTER['ayrshare.profileKey'].$not.test('demo-nilaa-botanics'));
  const reviews = require('../services/googleReviews');
  let fetched = 0;
  const r = await reviews.fetchReviews({ profileKey: 'demo-nilaa-botanics', apiKey: 'k', fetchImpl: async () => { fetched += 1; return { ok: true, json: async () => ({}) }; } });
  assert.strictEqual(fetched, 0); assert.strictEqual(r.success, false);
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert.match(read('routes/social.js'), /profileKey && !require\('\.\.\/services\/demoProfile'\)\.isDemoProfile\(user\)/);
  assert.match(read('routes/payment.js'), /!isDemo && !payment\.invoiceUrl/);
  assert.match(read('services/performanceTracker.js'), /blockedAccountIdsSafe/);
  assert.match(read('services/memoryDistillation.js'), /paused\.has\(String\(acct\.userId\)\)/);
});

test('memory distillation skips accounts the gate lists', async () => {
  const { runDistillationOnce } = require('../services/memoryDistillation');
  const Memory = { find: () => ({ select: () => ({ sort: () => ({ limit: () => ({ lean: async () => [{ userId: 'demoUser', organizationId: 'o' }] }) }) }) }) };
  const out = await runDistillationOnce({ deps: { Memory, blockedIds: async () => ['demoUser'] } });
  assert.strictEqual(out.distilled, 0);
});

// ---------------------------------------------------------------- pictures
test('images: valid PNG and JPEG of the right size, drawn the same way every time', () => {
  const logo = images.logoPng(512);
  assert.deepStrictEqual(logo.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  assert.deepStrictEqual(images.imageSize(logo), { type: 'png', width: 512, height: 512 });
  assert.ok(images.logoPng(256).length < 60000 && images.imageSize(images.logoPng(256)).width === 256);
  const shot = images.packshotJpg(K.PRODUCTS[0], 1);
  assert.deepStrictEqual(images.imageSize(shot), { type: 'jpeg', width: 800, height: 800 });
  assert.ok(shot.length < 150000, 'small file');
  assert.ok(shot.equals(images.packshotJpg(K.PRODUCTS[0], 1)), 'deterministic');
  assert.deepStrictEqual(images.imageSize(images.posterJpg(K.PRODUCTS[6], 'The Sunday oil bath, made easy')), { type: 'jpeg', width: 1080, height: 1350 });
  assert.deepStrictEqual(images.imageSize(images.portraitJpg(K.CHARACTERS[0])), { type: 'jpeg', width: 640, height: 800 });
  assert.deepStrictEqual(images.imageSize(images.placeJpg(K.PLACES[1], K.PRODUCTS)), { type: 'jpeg', width: 960, height: 600 });
  assert.strictEqual(images.imageSize(Buffer.from('not an image at all, really')), null);
});

test('products: 8 rows, 2 or 3 local pictures each, description within the model limit', () => {
  const rows = products.productRows({ userId: UID, base: 'http://localhost:5000', createdAt: NOW });
  assert.strictEqual(rows.length, 8);
  for (const r of rows) {
    assert.ok(r.images.length >= 2 && r.images.length <= 3 && r.imageUrl === r.images[0]);
    assert.ok(r.description.length <= 500 && /Key ingredients:/.test(r.description));
    assert.ok(r.keyFeatures.length >= 3 && r.price > 0 && r.currency === 'INR');
  }
  assert.strictEqual(products.productPictureSpecs().length, rows.reduce((s, r) => s + r.images.length, 0));
});

// ---------------------------------------------------------------- the script's run (fakes only)
function fakeDeps(over = {}) {
  const calls = { connect: 0, created: null, written: [] };
  return {
    calls,
    deps: {
      connect: async () => { calls.connect += 1; return { dbName: 'nebulaa_dev' }; },
      disconnect: async () => {},
      exists: async () => false,
      create: async (a) => { calls.created = a; return { added: { account: 1 } }; },
      verify: async () => ({ ok: true, lines: ['fine'] }),
      writeFile: (p, text) => calls.written.push({ p, text }),
      status: async () => ({ exists: true, counts: { User: 1 }, files: 3 }),
      remove: async () => ({ removed: { account: 1 }, left: 0 }),
      ...over
    }
  };
}
const DEV = { MONGODB_URI: 'mongodb+srv://u:p@c.example.net/nebulaa_dev?x=1' };
const PWFILE = path.join(os.tmpdir(), 'demo-nilaa-test-login.txt');

test('script: refuses another database before connecting, and refuses after connecting to the wrong one', async () => {
  const { deps, calls } = fakeDeps();
  await assert.rejects(main(['create', '--password-file', PWFILE], { MONGODB_URI: 'mongodb+srv://u:p@c.example.net/nebulaa?x=1' }, deps), /nebulaa_dev/);
  await assert.rejects(main(['status'], {}, deps), /not set/);
  assert.strictEqual(calls.connect, 0, 'never connected');
  const wrong = fakeDeps({ connect: async () => ({ dbName: 'nebulaa' }) });
  await assert.rejects(main(['remove'], DEV, wrong.deps), /nebulaa_dev/);
});

test('script: the password goes only to the file, never to the log', async () => {
  const { deps, calls } = fakeDeps();
  const lines = [];
  await main(['create', '--password-file', PWFILE], DEV, deps, (l) => lines.push(String(l)));
  assert.strictEqual(calls.written.length, 1);
  const pw = /Password: (\S+)/.exec(calls.written[0].text)[1];
  assert.strictEqual(calls.created.password, pw);
  assert.ok(!lines.join('\n').includes(pw), 'the password is not printed');
  assert.ok(lines.some((l) => l.includes(PWFILE)));
});

test('script: create needs a safe password file for a new account; an existing one is left alone', async () => {
  const { deps } = fakeDeps();
  await assert.rejects(main(['create'], DEV, deps), /password-file/);
  await assert.rejects(main(['create', '--password-file', path.join(safety.REPO_ROOT, 'pw.txt')], DEV, deps), /outside this repository/);
  await assert.rejects(main(['create', '--password-file', PWFILE, '--asset-base', 'https://example.com'], DEV, deps), /asset-base/);
  const again = fakeDeps({ exists: async () => true });
  await main(['create'], DEV, again.deps, () => {});
  assert.strictEqual(again.calls.created.password, null);
  assert.strictEqual(again.calls.written.length, 0);
  await assert.rejects(main(['explode'], DEV, deps), /Usage/);
});

test('script: remove fails loudly when anything is left; status prints counts', async () => {
  const left = fakeDeps({ remove: async () => ({ removed: {}, left: 2 }) });
  await assert.rejects(main(['remove'], DEV, left.deps, () => {}), /still there/);
  const lines = [];
  await main(['status'], DEV, fakeDeps().deps, (l) => lines.push(l));
  assert.ok(lines.some((l) => /User: 1/.test(l)) && lines.some((l) => /picture files: 3/.test(l)));
});

const { main: runMain } = require('../scripts/seed-demo-brand');
function main(argv, env, deps, log = () => {}) { return runMain({ argv, env, deps, log }); }

// ---------------------------------------------------------------- the dev-only picture route
test('demo pictures are served by a development server only', async () => {
  const express = require('express');
  const { mountDemoAssets } = require('../routes/demoAssets');
  const used = [];
  assert.strictEqual(mountDemoAssets({ use: (...a) => used.push(a) }, { env: { NODE_ENV: 'production' } }), false);
  assert.strictEqual(used.length, 0);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-assets-'));
  fs.mkdirSync(path.join(dir, 'nilaa'));
  fs.writeFileSync(path.join(dir, 'nilaa', 'a.png'), images.logoPng(64));
  const app = express();
  assert.strictEqual(mountDemoAssets(app, { env: { NODE_ENV: 'development' }, dir }), true);
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const ok = await fetch(`http://127.0.0.1:${port}/demo-assets/nilaa/a.png`);
    assert.strictEqual(ok.status, 200);
    assert.deepStrictEqual(images.imageSize(Buffer.from(await ok.arrayBuffer())), { type: 'png', width: 64, height: 64 });
    assert.strictEqual((await fetch(`http://127.0.0.1:${port}/demo-assets/nilaa/missing.png`)).status, 404);
  } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  const src = fs.readFileSync(path.join(__dirname, '..', 'server-main.js'), 'utf8');
  assert.match(src, /require\('\.\/routes\/demoAssets'\)\.mountDemoAssets\(app\)/);
  const ignore = fs.readFileSync(path.join(safety.REPO_ROOT, '.gitignore'), 'utf8');
  assert.match(ignore, /^backend\/demo-assets\/$/m);
  assert.match(fs.readFileSync(path.join(safety.REPO_ROOT, '.dockerignore'), 'utf8'), /^backend\/demo-assets$/m);
});
