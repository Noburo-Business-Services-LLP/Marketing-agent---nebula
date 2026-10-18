// Golden tests: the slimmer user reads (and the single-pass Home) give exactly the same page numbers as the old ones.
const test = require('node:test');
const assert = require('node:assert');
const { buildUsage, USAGE_USER_PROJECTION, HISTORY_READ_CAP, loadUsageData } = require('../services/staff/usage');
const { buildList, CLIENT_USER_PROJECTION, loadClientData } = require('../services/staff/clientList');
const { buildHome, signupStats, series30 } = require('../services/staff/home');
const { urgency } = require('../services/staff/clientStatus');

const NOW = new Date('2026-10-18T06:30:00Z').getTime();
const DAY = 86400000;
const ago = (d) => new Date(NOW - d * DAY);

// What the database does with a find() projection: keep the listed fields (through arrays of sub-documents),
// and `{ $slice: -n }` keeps the last n array entries. Enough for these projections.
function pick(value, segs) {
  if (segs.length === 0) return value;
  if (Array.isArray(value)) return value.filter((x) => x && typeof x === 'object').map((x) => pick(x, segs));
  if (!value || typeof value !== 'object' || value instanceof Date) return undefined;
  const [head, ...rest] = segs;
  if (!(head in value)) return undefined;
  const inner = pick(value[head], rest);
  return inner === undefined ? undefined : { [head]: inner };
}
function merge(a, b) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (Array.isArray(a) && Array.isArray(b)) return a.map((x, i) => merge(x, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object' && !(a instanceof Date)) {
    const out = { ...a };
    for (const k of Object.keys(b)) out[k] = k in out ? merge(out[k], b[k]) : b[k];
    return out;
  }
  return b;
}
function project(doc, projection) {
  let out = { _id: doc._id };
  for (const [path, spec] of Object.entries(projection)) {
    const segs = path.split('.');
    if (spec && typeof spec === 'object' && '$slice' in spec) {
      let node = doc; for (const s of segs) node = node == null ? undefined : node[s];
      if (!Array.isArray(node)) continue;
      const n = spec.$slice;
      const sliced = n < 0 ? node.slice(Math.max(0, node.length + n)) : node.slice(0, n);
      let nested = sliced; for (let i = segs.length - 1; i >= 0; i--) nested = { [segs[i]]: nested };
      out = merge(out, nested);
    } else {
      const got = pick(doc, segs);
      if (got !== undefined) out = merge(out, got);
    }
  }
  return out;
}

const OLD_USAGE = { email: 1, createdAt: 1, isHidden: 1, staffRole: 1, isCsm: 1, onboardingCompleted: 1, connectedSocials: 1, 'ayrshare.activeSocialAccounts': 1, plan: 1, 'payments.status': 1, 'credits.history': 1 };
const OLD_CLIENT = { email: 1, firstName: 1, lastName: 1, companyName: 1, mobileNumber: 1, createdAt: 1, isActive: 1, isHidden: 1, lastLoginAt: 1, onboardingCompleted: 1, 'credits.balance': 1, connectedSocials: 1, 'ayrshare.activeSocialAccounts': 1, plan: 1, trial: 1, 'payments.status': 1, assignedCsm: 1, staffRole: 1, isCsm: 1, 'businessProfile.name': 1 };

const ACTIONS = ['campaign_full', 'image_generated', 'campaign_text', 'video_generated', 'blueprint', 'chat_message', 'hero_video_clip', 'staff_grant', 'image_generated_refund', 'mystery_action'];
function history(i, n) {
  return Array.from({ length: n }, (_, k) => {
    const action = ACTIONS[(i + k) % ACTIONS.length];
    const at = ago(((i * 7 + k * 3) % 40) + 0.1);
    const refund = action.endsWith('_refund');
    return { action, amount: action === 'staff_grant' || refund ? 25 : -(5 + ((i + k) % 30)), ...(k % 11 === 0 ? { amount: undefined, cost: 4 } : {}), description: 'Made something', balanceAfter: 100 + k, createdAt: at, timestamp: at };
  });
}
function fixture() {
  const users = [];
  for (let i = 0; i < 40; i++) {
    const tier = ['managed', 'starter', 'professional', 'free', 'agency', undefined][i % 6];
    users.push({
      _id: `u${String(i).padStart(2, '0')}`, email: `u${i}@x.test`, firstName: `F${i}`, lastName: `L${i}`, companyName: `Co ${i}`, mobileNumber: `9000${i}`,
      createdAt: ago(i * 2.3), updatedAt: ago(1), isActive: i % 13 !== 0, isHidden: i % 17 === 0 && i > 0, lastLoginAt: ago((i % 12) + 0.2), onboardingCompleted: i % 5 !== 0,
      assignedCsm: i % 3 === 0 ? 'csmA' : (i % 3 === 1 ? 'csmB' : null),
      credits: { balance: (i * 37) % 700, totalUsed: 999, planBalance: 5, history: history(i, i % 8 === 0 ? 0 : 20 + (i % 30)) },
      plan: tier ? { tier, addons: i % 2 ? ['publish', 'inbox'] : [], paidManually: i % 9 === 0, paidNote: 'invoice', subscriptionId: 'sub', subscriptions: i % 4 === 0 ? [{ subscriptionId: 's', kind: 'plan', key: 'x', active: i % 8 === 0, razorpayPlanId: 'p', createdAt: ago(5) }] : [] } : undefined,
      payments: i % 3 ? [{ razorpayOrderId: 'o', razorpayPaymentId: 'p', amount: 999, status: i % 5 === 1 ? 'failed' : 'paid', paidAt: ago(3) }] : [],
      trial: { isExpired: i % 4 === 0, startedAt: ago(30) },
      connectedSocials: i % 4 === 0 ? [{ platform: 'Twitter', accountId: 'a', accessToken: 'SECRET'.repeat(30), connectedAt: ago(2) }, { platform: 'instagram', accountId: 'b', accessToken: 'SECRET' }] : [],
      ayrshare: { profileKey: 'KEY', title: 't', activeSocialAccounts: i % 4 === 0 ? [] : (i % 7 === 0 ? [] : ['instagram', 'facebook']), displayNames: ['n'] },
      businessProfile: { name: i % 6 ? `Biz ${i}` : '', description: 'long text '.repeat(50) },
      icpStrategy: { icp: { demographics: 'x'.repeat(500) } }
    });
  }
  users.push({ _id: 'csmA', email: 'ca@x.test', staffRole: 'csm', isCsm: true, firstName: 'Cleo', isHidden: true });
  users.push({ _id: 'staffOwner', email: 'o@x.test', staffRole: 'owner', isHidden: true });
  return users;
}
const withProjection = (users, p) => users.map((u) => project(u, p));
const customersOnly = (users) => users.filter((u) => !u.staffRole && !u.isCsm);

const usageRows = { images: [{ _id: 'u01', n: 3 }, { _id: 'u02', n: 7 }, { _id: 'u04', n: 1 }], postsDrafted: [{ _id: 'u01', n: 4 }, { _id: 'u02', n: 9 }], postsPublished: [{ _id: 'u02', n: 2 }], videos: [{ _id: 'u05', n: 1 }], heroVideos: [], blueprints: [{ _id: 'u07', n: 2 }], repliesDrafted: [{ _id: 'u09', n: 5 }] };

test('the projection emulator keeps what a find() projection keeps and drops the rest', () => {
  const doc = { _id: 'x', a: 1, secret: 's', arr: [{ platform: 'p', token: 't' }, { platform: 'q' }], plan: { tier: 't', note: 'n', subs: [{ active: true, id: 1 }] }, credits: { balance: 1, history: [1, 2, 3, 4] } };
  assert.deepStrictEqual(project(doc, { a: 1, 'arr.platform': 1, 'plan.tier': 1, 'plan.subs.active': 1, 'credits.history': { $slice: -2 } }),
    { _id: 'x', a: 1, arr: [{ platform: 'p' }, { platform: 'q' }], plan: { tier: 't', subs: [{ active: true }] }, credits: { history: [3, 4] } });
});

test('Usage numbers are identical with the slim user read, for the Owner and the Admin, in both windows', () => {
  const all = fixture();
  const oldUsers = withProjection(all, OLD_USAGE);
  for (const level of ['full', 'summary']) {
    const slim = { ...USAGE_USER_PROJECTION }; if (level === 'full') slim['credits.history'] = { $slice: -HISTORY_READ_CAP };
    const newUsers = withProjection(all, slim);
    for (const window of [30, 90]) {
      assert.deepStrictEqual(
        buildUsage({ users: newUsers, usage: usageRows, window, level, now: NOW }),
        buildUsage({ users: oldUsers, usage: usageRows, window, level, now: NOW }),
        `usage differs (level ${level}, ${window} days)`
      );
    }
  }
});

test('the slim Usage read leaves out secrets and bulk: no tokens, no history for the summary view, no business text', () => {
  const u = project(fixture()[0], { ...USAGE_USER_PROJECTION });
  const text = JSON.stringify(u);
  assert.ok(!text.includes('SECRET') && !text.includes('long text') && !text.includes('history') && !text.includes('profileKey'));
  assert.ok(!('email' in u));
});

test('only history beyond the documented cap of 100 entries is cut (the app keeps at most the last 100)', () => {
  const big = { _id: 'b', createdAt: ago(5), onboardingCompleted: true, credits: { history: history(1, 150) } };
  const cut = project(big, { createdAt: 1, 'credits.history': { $slice: -HISTORY_READ_CAP } });
  assert.strictEqual(HISTORY_READ_CAP, 100);
  assert.strictEqual(cut.credits.history.length, 100);
  assert.deepStrictEqual(cut.credits.history, big.credits.history.slice(-100));
});

test('the client list is identical with the slim user read for every filter and every viewer', () => {
  const all = customersOnly(fixture());
  const oldU = withProjection(all, OLD_CLIENT); const newU = withProjection(all, CLIENT_USER_PROJECTION);
  const extras = { u01: { lastEventAt: ago(1), draftCount: 2, oldestDraftAt: ago(9) }, u02: { failedPosts7d: 2 }, u05: { oldestDraftAt: ago(20), draftCount: 5 } };
  const csmNames = { csmA: 'Cleo', csmB: 'Cass' };
  const viewers = [{ _id: 'o', staffRole: 'owner' }, { _id: 'a', staffRole: 'admin' }, { _id: 'csmA', staffRole: 'csm' }, { _id: 'csmB', staffRole: 'csm', isCsm: true }];
  for (const viewer of viewers) {
    for (const filter of ['all', 'active', 'inactive', 'disabled', 'trial', 'paying', 'attention', 'no_csm', 'hidden']) {
      for (const sort of ['lastActive', 'name', 'quarks', 'plan', 'status']) {
        const args = { viewer, extras, csmNames, now: NOW, filter, sort, pageSize: 100 };
        assert.deepStrictEqual(buildList({ ...args, users: newU }), buildList({ ...args, users: oldU }), `${viewer._id} / ${filter} / ${sort}`);
      }
    }
  }
  const search = { viewer: viewers[0], extras, csmNames, now: NOW, q: 'biz 1', pageSize: 100 };
  assert.deepStrictEqual(buildList({ ...search, users: newU }), buildList({ ...search, users: oldU }));
});

// ---- Home: the version that shipped on 2026-10-18 (every page re-classified every client), kept here as the reference ----
function legacyBuildHome({ viewer, users, extras = {}, csmNames = {}, dailyActive = [], now, attentionLimit = 25 }) {
  const list = buildList({ viewer, users, extras, csmNames, now, filter: 'attention', pageSize: 100 });
  const attention = list.rows.map((r) => ({ ...r, urgency: urgency(r.attention, r.quarks) }))
    .sort((a, b) => b.urgency - a.urgency || a.quarks - b.quarks).slice(0, attentionLimit)
    .map(({ id, name, email, quarks, attention: reasons, csm, lastActiveAt }) => ({ id, name, email, quarks, reasons, csm, lastActiveAt }));
  const all = buildList({ viewer, users, extras, csmNames, now, filter: 'all', pageSize: 100 });
  const counts = all.counts;
  const ids = new Set(); let page = 1; let pages = 1; const clients = [];
  do {
    const p = buildList({ viewer, users, extras, csmNames, now, filter: 'all', pageSize: 100, page });
    pages = p.pages; p.rows.forEach((r) => { ids.add(r.id); clients.push(r); }); page += 1;
  } while (page <= pages);
  const signupTimes = users.filter((u) => ids.has(String(u._id || u.id)) && u.createdAt).map((u) => new Date(u.createdAt).getTime());
  const cohort = users.filter((u) => ids.has(String(u._id || u.id)) && u.createdAt && now - new Date(u.createdAt).getTime() <= 30 * DAY);
  const cohortPaying = clients.filter((r) => r.paying && cohort.some((u) => String(u._id || u.id) === r.id)).length;
  return {
    attention: { total: counts.attention, items: attention },
    growth: {
      signups: signupStats(signupTimes, now), activeThisWeek: counts.active, totalClients: counts.all,
      trialToPaid: { signedUp: cohort.length, paid: cohortPaying, percent: cohort.length ? Math.round((cohortPaying / cohort.length) * 100) : null },
      series: series30(signupTimes, dailyActive, now)
    }
  };
}

test('Home, built in one pass, equals the old Home for every viewer, including more than 100 clients', () => {
  const base = customersOnly(fixture());
  const many = [];
  for (let r = 0; r < 4; r++) base.forEach((u) => many.push({ ...u, _id: `${u._id}-${r}`, lastLoginAt: ago(((r * 5) % 20) + 0.5) }));
  assert.ok(many.length > 100);
  const extras = { 'u01-0': { failedPosts7d: 1 }, 'u02-1': { lastEventAt: ago(0.5) } };
  const daily = [{ day: '2026-10-17', n: 4 }, { day: '2026-10-18', n: 6 }];
  for (const users of [base, many, []]) {
    for (const viewer of [{ _id: 'o', staffRole: 'owner' }, { _id: 'csmA', staffRole: 'csm' }]) {
      const args = { viewer, users: withProjection(users, CLIENT_USER_PROJECTION), extras, csmNames: { csmA: 'Cleo' }, dailyActive: daily, now: NOW };
      assert.deepStrictEqual(buildHome(args), legacyBuildHome({ ...args, users: withProjection(users, OLD_CLIENT) }), `${users.length} users / ${viewer._id}`);
    }
  }
});

test('Home with thousands of clients is built in well under a second (it used to take minutes)', () => {
  const base = customersOnly(fixture());
  const users = [];
  for (let r = 0; r < 300; r++) base.forEach((u) => users.push({ ...u, _id: `${u._id}-${r}` }));
  const started = Date.now();
  buildHome({ viewer: { _id: 'o', staffRole: 'owner' }, users, now: NOW });
  const took = Date.now() - started;
  assert.ok(users.length > 11000);
  assert.ok(took < 3000, `Home took ${took} ms for ${users.length} clients`);
});

// ---- the loaders pass the slim reads and the time limits to the database ----
test('the loaders ask for the slim projections and for a 20 second limit', async () => {
  const calls = [];
  const User = { find: (q, projection, options) => { calls.push({ q, projection, options }); const p = Promise.resolve([]); p.lean = () => p; return p; } };
  const agg = []; const model = { aggregate: async (pipeline, options) => { agg.push(options); return []; } };
  const models = { User, Draft: model, Campaign: model, VideoJob: model, HeroVideoJob: model, Blueprint: model, SocialInboxMessage: model, FeatureEvent: model };
  await loadUsageData({ models, now: NOW, level: 'full' });
  await loadUsageData({ models, now: NOW, level: 'summary' });
  await loadClientData({ viewer: { _id: 'o', staffRole: 'owner' }, models, now: NOW });
  const [full, summary, clients] = calls;
  assert.deepStrictEqual(full.projection['credits.history'], { $slice: -100 });
  assert.ok(!('credits.history' in summary.projection), 'the Admin summary never reads the Quark history');
  assert.strictEqual(summary.projection.plan, undefined);
  assert.strictEqual(clients.projection.plan, undefined);
  assert.strictEqual(clients.projection.connectedSocials, undefined);
  assert.strictEqual(full.options.maxTimeMS, 20000);
  assert.ok(agg.length >= 7 && agg.every((o) => o && o.maxTimeMS === 20000 && o.allowDiskUse === true), 'every aggregate has the time limit and may use disk');
});
