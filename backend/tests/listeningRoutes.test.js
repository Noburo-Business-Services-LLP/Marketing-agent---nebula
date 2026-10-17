const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cfg = require('../config/listening');
const router = require('../routes/listening');
const { createListeningRouter } = router;
const { runScorerOnce } = require('../services/listening/scorer');
const { createBatchLedger } = require('../services/listening/ledger');
const { can } = require('../services/staff/permissions');
const { isBlockedWhileActing } = require('../services/csmAccess');
const { isBlockedInsideClient } = require('../services/agencyWorkspaces');

const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };
const routesOf = (r) => r.stack.filter((l) => l.route).map((l) => ({ path: l.route.path, method: Object.keys(l.route.methods)[0], handlers: l.route.stack.map((s) => s.handle) }));
const mkRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });

const NOW = new Date('2026-10-17T06:00:00Z');
const DAY = 864e5;
const ON = { ENABLE_LISTENING: 'on', LISTENING_MODEL: 'fake-small' };
const owner = (extra = {}) => ({ _id: 'u1', isActive: true, plan: { tier: 'agency' }, ...extra });
let seq = 0;
const ago = (days, hours = 0) => new Date(NOW.getTime() - days * DAY - hours * 36e5);
const POS = 'Delivery was quick and the packaging was lovely, thank you';
const NEG = 'The fabric quality is poor and it tore after one wash';

// One inbox item plus its score. `label` pos|neu|neg, `reason` a code.
function pair(userId, { label = 'neu', reason = 'other', type = 'comment', body, days = 1, author, conv, spam = 0, scoredAt = ago(0, 2) } = {}) {
  const id = `i${++seq}`;
  const createdAt = ago(days, seq % 5);
  return {
    msg: { _id: id, userId, conversationId: conv || `c${seq}`, platform: 'instagram', messageType: type, direction: 'inbound', senderType: 'customer', spamScore: spam, body: body || `plain text number ${seq} about the shop`, authorId: author || `a${seq}`, authorName: 'Real Person', rawPayload: { secret: 1 }, createdAt },
    score: { userId, inboxItemId: id, platform: 'instagram', kind: type === 'dm' || type === 'message' ? 'private' : 'public', label, reason, itemAt: createdAt, scoredAt, modelVersion: 'listen-1' }
  };
}

function world({ pairs = [], env = ON } = {}) {
  const asked = { inbox: [], scores: [] };
  const msgs = new Map(pairs.map((p) => [p.msg._id, p.msg]));
  const scores = pairs.map((p) => p.score);
  const deps = {
    env,
    store: { async scoresSince(userId, since) { asked.scores.push(String(userId)); return scores.filter((s) => String(s.userId) === String(userId) && s.itemAt >= since); } },
    // Like the real query: answers only for the user it is given.
    async inboxByIds(userId, ids) { asked.inbox.push({ userId, ids }); return ids.map((i) => msgs.get(i)).filter((m) => m && String(m.userId) === String(userId)); },
    async eligibleInbox(userId) { return [...msgs.values()].filter((m) => String(m.userId) === String(userId)); },
    async batchesSince() { return 3; }
  };
  return { deps, asked, msgs, scores };
}

async function call({ deps, user, loadUser, req = {} }) {
  const r = routesOf(createListeningRouter({ deps, now: () => NOW, loadUser: loadUser || (async () => user) })).find((x) => x.method === 'get' && x.path === '/');
  assert.strictEqual(r.handlers.length, 4, 'protect, limiter, entitlement, handler');
  const res = mkRes();
  const rq = { user, ...req };
  const chain = r.handlers.slice(2);
  let i = 0;
  const next = async () => { const h = chain[i++]; if (h) await h(rq, res, next); };
  await next();
  return res;
}
// n scored items spread over the last 20 days: a mix of labels, all public.
const spread = (userId, n, labelFor = (i) => (i % 3 === 0 ? 'neg' : i % 3 === 1 ? 'pos' : 'neu'), extra = () => ({})) =>
  Array.from({ length: n }, (_, i) => pair(userId, { label: labelFor(i), reason: labelFor(i) === 'neg' ? 'quality' : 'other', days: 1 + (i % 20), ...extra(i) }));

test('no signed-in user id is a 401', async () => {
  const res = await call({ deps: world().deps, user: {}, loadUser: async () => owner() });
  assert.strictEqual(res.code, 401);
});

test('free and Starter accounts without the Inbox add-on get the standard add-on 403', async () => {
  for (const plan of [{ tier: 'starter', addons: [] }, { tier: 'professional' }, { tier: 'professional', addons: ['publish'] }, { tier: 'starter', addons: ['inbox'] }]) {
    const res = await call({ deps: world().deps, user: owner({ plan }) });
    assert.strictEqual(res.code, 403, JSON.stringify(plan));
    assert.strictEqual(res.body.upgradeRequired, true);
    assert.strictEqual(res.body.feature, 'inbox');
    assert.strictEqual(res.body.message, 'This needs an add-on. Please add it to your plan or upgrade.');
  }
  const free = await call({ deps: world().deps, user: owner({ plan: { tier: 'free' } }) });
  assert.strictEqual(free.code, 403);
  assert.strictEqual(free.body.upgradeRequired, true);
  assert.strictEqual(free.body.message, 'This is not included in the free plan. Please upgrade your plan, or buy an add-on pack.');
});

test('Agency, managed and Starter with the Inbox add-on get 200', async () => {
  for (const plan of [{ tier: 'agency' }, { tier: 'managed' }, undefined, { tier: 'starter', addons: ['publish', 'inbox'] }]) {
    const res = await call({ deps: world().deps, user: owner({ plan }) });
    assert.strictEqual(res.code, 200, JSON.stringify(plan));
    assert.strictEqual(res.body.success, true);
  }
});

test('a client workspace opened through an agency pass is not blocked, like the Inbox', () => {
  assert.strictEqual(isBlockedWhileActing('/api/listening', 'GET'), false);
  assert.strictEqual(isBlockedInsideClient('/api/listening', 'GET'), false);
  assert.strictEqual(isBlockedInsideClient('/api/social/inbox/summary', 'GET'), false);
});

test('19 scored items: not enough, with no numbers at all and the exact message', async () => {
  const w = world({ pairs: [...spread('u1', 19), ...spread('u1', 3, () => 'neg', () => ({ type: 'dm' })).slice(0, 0)] });
  const res = await call({ deps: w.deps, user: owner() });
  assert.strictEqual(res.body.state, 'not_enough');
  assert.strictEqual(res.body.message, 'Not enough comments yet to show a score.');
  assert.strictEqual(res.body.total, 0);
  assert.deepStrictEqual(res.body.counts, { positive: 0, neutral: 0, negative: 0 });
  assert.deepStrictEqual(res.body.percentages, { positive: 0, neutral: 0, negative: 0 });
  assert.strictEqual(res.body.trend, null);
  assert.strictEqual(res.body.topReason, null);
  assert.deepStrictEqual(res.body.quotes, []);
  assert.deepStrictEqual(res.body.recentNegative, []);
  assert.strictEqual(w.asked.inbox.length, 0, 'the inbox is not even read');
});

test('20 scored items: ready, counts sum to the total, and the period dates match', async () => {
  const w = world({ pairs: spread('u1', 20) });
  const res = await call({ deps: w.deps, user: owner() });
  const b = res.body;
  assert.strictEqual(b.state, 'ready');
  assert.strictEqual(b.message, null);
  assert.strictEqual(b.total, 20);
  assert.strictEqual(b.counts.positive + b.counts.neutral + b.counts.negative, 20);
  assert.deepStrictEqual(b.counts, { positive: 7, neutral: 6, negative: 7 });
  assert.strictEqual(b.percentages.positive + b.percentages.neutral + b.percentages.negative, 100);
  assert.deepStrictEqual(b.period, { from: '2026-09-20', to: '2026-10-17' });
  assert.strictEqual(b.asOf, '2026-10-17');
  assert.strictEqual(b.enabled, true);
  assert.ok(b.lastScoredAt && b.lastScoredOn === '2026-10-17');
});

test('the trend sentence appears only above the thresholds', async () => {
  const small = world({ pairs: spread('u1', 20) }); // recent week has fewer than 8 items
  assert.strictEqual((await call({ deps: small.deps, user: owner() })).body.trend, null);
  const lots = [
    ...Array.from({ length: 10 }, () => pair('u1', { label: 'neg', reason: 'delivery', days: 1 })),
    ...Array.from({ length: 24 }, (_, i) => pair('u1', { label: i < 2 ? 'neg' : 'pos', reason: 'delivery', days: 9 + (i % 18) }))
  ];
  const res = await call({ deps: world({ pairs: lots }).deps, user: owner() });
  assert.match(res.body.trend, /^More negative comments than usual this week: 10 of 10, against 8% over the four weeks before\./);
  assert.strictEqual(res.body.topReason, 'delivery');
});

test('quotes: at most three, never private, never contact details or an author field', async () => {
  const pairs = [
    ...spread('u1', 20),
    pair('u1', { label: 'pos', type: 'dm', body: 'Private message praising the shop so much', days: 0 }),
    pair('u1', { label: 'neg', body: 'Call me on 9876543210 about this awful order', days: 0, reason: 'service' }),
    pair('u1', { label: 'neg', body: 'write to me at buyer@example.com about this order', days: 0, reason: 'service' }),
    pair('u1', { label: 'pos', body: POS, days: 0, reason: 'praise', author: 'ap' }),
    pair('u1', { label: 'neg', body: NEG, days: 0, reason: 'quality', author: 'an' }),
    pair('u1', { label: 'neg', body: 'The courier left it outside and it got wet', days: 0, reason: 'delivery', author: 'an2' }),
    pair('u1', { label: 'neg', body: 'Sizes run small compared with the chart shown', days: 0, reason: 'product', author: 'an3' })
  ];
  const res = await call({ deps: world({ pairs }).deps, user: owner() });
  const q = res.body.quotes;
  assert.ok(q.length >= 2 && q.length <= 3);
  const text = q.map((x) => x.text).join(' | ');
  assert.ok(!/Private message/.test(text) && !/9876543210/.test(text) && !/example\.com/.test(text), text);
  for (const x of q) assert.deepStrictEqual(Object.keys(x).sort(), ['date', 'id', 'label', 'platform', 'text']);
  assert.ok(q.some((x) => x.text === POS && x.label === 'positive'));
  const priv = pairs.find((p) => p.msg.messageType === 'dm').msg._id;
  assert.ok(!q.some((x) => x.id === priv));
  assert.ok(!JSON.stringify(res.body).match(/authorName|authorId|rawPayload|Real Person/));
});

test('a private item is never quoted even when its stored kind says public', async () => {
  const bad = pair('u1', { label: 'pos', type: 'dm', body: POS, days: 0 });
  bad.score.kind = 'public';
  const res = await call({ deps: world({ pairs: [...spread('u1', 20), bad] }).deps, user: owner() });
  assert.ok(!res.body.quotes.some((x) => x.text === POS));
});

test('the safety filter runs again at read time on the live text: an edited comment is judged as it reads now', async () => {
  const p = pair('u1', { label: 'pos', body: POS, days: 0, reason: 'praise' });
  const w = world({ pairs: [...spread('u1', 20), p] });
  assert.ok((await call({ deps: w.deps, user: owner() })).body.quotes.some((x) => x.text === POS));
  w.msgs.get(p.msg._id).body = 'Lovely service, mail me at someone@example.com for more';
  const after = await call({ deps: w.deps, user: owner() });
  assert.ok(!JSON.stringify(after.body).includes('someone@example.com'));
  assert.ok(!after.body.quotes.some((x) => x.id === p.msg._id));
  w.msgs.get(p.msg._id).body = 'Honestly the best shop in town and so friendly too';
  assert.ok((await call({ deps: w.deps, user: owner() })).body.quotes.some((x) => x.text === 'Honestly the best shop in town and so friendly too'));
});

test('a deleted inbox item vanishes from quotes and from the recent negative list', async () => {
  const p = pair('u1', { label: 'neg', body: NEG, days: 0, reason: 'quality' });
  const w = world({ pairs: [...spread('u1', 20), p] });
  const before = await call({ deps: w.deps, user: owner() });
  assert.ok(before.body.quotes.some((x) => x.id === p.msg._id));
  assert.ok(before.body.recentNegative.some((x) => x.id === p.msg._id));
  w.msgs.delete(p.msg._id);
  const after = await call({ deps: w.deps, user: owner() });
  assert.ok(!after.body.quotes.some((x) => x.id === p.msg._id));
  assert.ok(!after.body.recentNegative.some((x) => x.id === p.msg._id));
  assert.ok(!JSON.stringify(after.body).includes('fabric'));
  assert.strictEqual(after.body.total, 21, 'the numbers still count the score; Task 7 erases it');
});

test('recent negative: previews are the first 80 characters of the live body, newest first, at most five', async () => {
  const long = `${'The fabric quality is poor and it tore. '.repeat(5)}tail words`;
  const pairs = [...spread('u1', 20), ...Array.from({ length: 7 }, (_, i) => pair('u1', { label: 'neg', body: i === 0 ? long : `Not happy with order number ${i} at all`, days: 0.1 + i / 100, type: i === 1 ? 'dm' : 'comment' }))];
  const res = await call({ deps: world({ pairs }).deps, user: owner() });
  const r = res.body.recentNegative;
  assert.strictEqual(r.length, cfg.RECENT_NEGATIVE_MAX);
  assert.ok(r.every((x) => x.preview.length <= 80));
  for (const x of r) assert.deepStrictEqual(Object.keys(x).sort(), ['conversationId', 'date', 'id', 'platform', 'preview']);
  const dates = r.map((x) => x.date);
  assert.deepStrictEqual([...dates].sort().reverse(), dates);
});

test('no other account\'s data: two accounts with the same inbox item id see only their own', async () => {
  const mine = spread('u1', 20);
  const theirs = spread('u2', 22, () => 'neg', () => ({ body: 'Their private shop complaint about wrong colour' }));
  // the other account has a score row and an inbox item with the very same id as one of mine
  const clash = pair('u2', { label: 'neg', body: 'Other account clashing complaint text here', days: 0 });
  clash.msg._id = mine[0].msg._id; clash.score.inboxItemId = mine[0].msg._id;
  const w = world({ pairs: [...mine, ...theirs] });
  w.scores.push(clash.score);
  const res = await call({ deps: w.deps, user: owner() });
  assert.strictEqual(res.body.total, 20);
  assert.ok(!JSON.stringify(res.body).match(/Their private|clashing|wrong colour/));
  assert.ok(w.asked.scores.every((u) => u === 'u1'));
  assert.ok(w.asked.inbox.every((a) => a.userId === 'u1'), 'inbox lookup is always by { _id, userId }');
  const other = await call({ deps: w.deps, user: owner({ _id: 'u2' }) });
  assert.strictEqual(other.body.total, 23);
  assert.ok(!JSON.stringify(other.body).includes('lovely'));
});

test('the account comes from the verified sign-in, never from the request', async () => {
  const w = world({ pairs: [...spread('u1', 20), ...spread('u2', 25)] });
  const res = await call({ deps: w.deps, user: owner(), req: { query: { userId: 'u2', id: 'u2' }, body: { userId: 'u2' }, params: { id: 'u2' }, headers: { 'x-user-id': 'u2' } } });
  assert.strictEqual(res.body.total, 20);
  assert.deepStrictEqual([...new Set(w.asked.scores)], ['u1']);
});

test('the response never exposes the model, vendor names or raw reason codes', async () => {
  const pairs = spread('u1', 30, (i) => (i % 2 ? 'neg' : 'pos'), () => ({ scoredAt: ago(0, 1) }));
  const res = await call({ deps: world({ pairs }).deps, user: owner() });
  const text = JSON.stringify(res.body);
  for (const leak of ['listen-1', 'modelVersion', 'fake-small', 'LISTENING_MODEL', 'gemini', 'openai', 'google', 'anthropic', 'claude', 'gpt', '"reason"', '"other"', 'rawPayload', 'authorName', 'authorId', 'userId', 'kind']) assert.ok(!text.toLowerCase().includes(leak.toLowerCase()), leak);
  assert.ok(!/[!—]/.test(text), 'no exclamation marks or em dashes');
  assert.ok(!/quark|credit|trial|7 days/i.test(text));
});

test('the switch off: enabled is false, and with nothing scored the message says so plainly', async () => {
  const res = await call({ deps: world({ env: {} }).deps, user: owner() });
  assert.strictEqual(res.body.enabled, false);
  assert.strictEqual(res.body.state, 'not_enough');
  assert.strictEqual(res.body.message, 'Nothing is scored yet.');
  assert.strictEqual(res.body.lastScoredAt, null);
  assert.strictEqual(res.body.lastScoredOn, null);
  assert.strictEqual(res.body.total, 0);
  const old = await call({ deps: world({ env: {}, pairs: spread('u1', 20) }).deps, user: owner() });
  assert.strictEqual(old.body.enabled, false);
  assert.strictEqual(old.body.state, 'ready');
  assert.ok(old.body.lastScoredOn, 'the date of the last scoring is shown so the numbers are not read as live');
});

test('waiting: enough comments in the inbox but nothing scored yet', async () => {
  const w = world();
  const items = Array.from({ length: 25 }, (_, i) => ({ _id: `e${i}`, userId: 'u1', direction: 'inbound', senderType: 'customer', messageType: 'comment', spamScore: 0, body: `a fine comment ${i} about stuff`, createdAt: ago(2) }));
  w.deps.eligibleInbox = async () => items;
  const res = await call({ deps: w.deps, user: owner() });
  assert.strictEqual(res.body.state, 'waiting');
  assert.strictEqual(res.body.total, 0);
  assert.deepStrictEqual(res.body.quotes, []);
});

test('a store failure is a generic 500 that never leaks the error text', async () => {
  const deps = { ...world().deps, store: { scoresSince: async () => { throw new Error('mongo secret detail'); } } };
  const res = await quiet(() => call({ deps, user: owner() }));
  assert.strictEqual(res.code, 500);
  assert.strictEqual(res.body.message, 'We could not complete that request. Please try again.');
  assert.ok(!JSON.stringify(res.body).includes('secret'));
});

test('route wiring: protect, the read limiter at 600 per 15 minutes, requireFeature(inbox); mounted in the server', () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/listening.js'), 'utf8');
  assert.match(src, /router\.get\('\/', protect, readLimiter, gate, handler\)/);
  assert.match(src, /requireFeature\('inbox'/);
  assert.match(src, /makeLimiter\(600,/);
  assert.match(src, /makeLimiter\(20,/);
  const main = fs.readFileSync(path.join(__dirname, '../server-main.js'), 'utf8');
  assert.ok(main.includes("app.use('/api/listening', require('./routes/listening'))"));
});

// ---------- staff ----------
test('staff: routes use the client-access check, the permissions, the limiter and the log', () => {
  const client = { _id: 'c1', assignedCsm: 'csmA' };
  assert.strictEqual(can({ _id: 'csmB', isCsm: true }, 'view_clients', client), false, 'another CSM\'s client is refused');
  assert.strictEqual(can({ _id: 'csmB', isCsm: true }, 'open_client', client), false);
  assert.strictEqual(can({ _id: 'csmA', isCsm: true }, 'open_client', client), true);
  const src = fs.readFileSync(path.join(__dirname, '../routes/staff.js'), 'utf8');
  const view = src.match(/router\.get\('\/clients\/:id\/listening'[\s\S]*?\n\}\);/)[0];
  const score = src.match(/router\.post\('\/clients\/:id\/listening\/score'[\s\S]*?\n\}\);/)[0];
  assert.match(view, /requireStaff\('view_clients'\)/);
  assert.match(view, /clientFor\(req, res\)/);
  assert.match(score, /requireStaff\('open_client'\)/);
  assert.match(score, /listening'\)\.checkLimiter/);
  assert.match(score, /clientFor\(req, res, 'open_client'\)/);
  assert.match(score, /record: recordStaffAction/);
  assert.ok(src.indexOf('router.use(protect)') < src.indexOf("'/clients/:id/listening/score'"));
});

test('staff view is the same body for that client plus the ledger counts', async () => {
  const w = world({ pairs: spread('c1', 20) });
  const body = await router.staffViewFor({ _id: 'c1', listeningFailures: 3, listeningRunAt: ago(1) }, { deps: w.deps, now: NOW });
  assert.strictEqual(body.state, 'ready');
  assert.strictEqual(body.total, 20);
  assert.deepStrictEqual(body.ledger, { batches: 3, scoredItems: 20, failures: 3, paused: true, lastRunAt: ago(1).toISOString() });
  const fresh = await router.staffViewFor({ _id: 'c1' }, { deps: w.deps, now: NOW });
  assert.strictEqual(fresh.ledger.paused, false);
  assert.strictEqual(fresh.ledger.lastRunAt, null);
});

const staffUser = { _id: 's1', staffRole: 'admin' };
const okReply = (prompt) => {
  const n = (prompt.match(/<<<COMMENT \d+>>>/g) || []).length;
  return JSON.stringify({ r: Array.from({ length: n }, (_, k) => ({ i: k + 1, l: 'pos', c: 'praise' })) });
};
function scorerWorld({ env = ON, spendOk = true, leaseHeld = false, seedBatches = 0 } = {}) {
  const calls = { prompts: [], saved: [], checked: [] };
  const ledger = createBatchLedger({ Model: null });
  let held = leaseHeld;
  const items = Array.from({ length: 25 }, (_, i) => ({ _id: `m${i}`, userId: 'client1', direction: 'inbound', senderType: 'customer', messageType: 'comment', platform: 'instagram', spamScore: 0, body: `lovely thing number ${i}`, createdAt: new Date(NOW.getTime() - 60000 - i * 1000) }));
  const deps = {
    caps: { ...cfg }, env, ledger, memory: new Map(),
    store: { async saveScores(u, rows) { calls.saved.push(...rows); }, async scoredIds() { return new Set(); }, async scoresSince() { return []; }, async rebuildWeeks() {} },
    callText: async (prompt) => { calls.prompts.push(prompt); return okReply(prompt); },
    spend: { check: async (a) => { calls.checked.push(a); return spendOk ? { ok: true } : { ok: false }; }, record: async () => {} },
    lease: { claim: async () => (held ? null : ((held = true), { value: 'x' })), renew: async (t) => t, release: async () => { held = false; } },
    gate: async () => [], erase: { sweepOrphans: async () => 0 }, alert: async () => {}, sleep: async () => {},
    accounts: async () => [{ _id: 'client1', isActive: true, onboardingCompleted: true, staffRole: null, isCsm: false, plan: { tier: 'agency' }, listeningRunAt: new Date(NOW.getTime() - DAY) }, { _id: 'other', isActive: true, onboardingCompleted: true, plan: { tier: 'agency' } }],
    items: async ({ userId }) => items.filter((i) => String(i.userId) === String(userId)).map((i) => ({ ...i })),
    markRun: async () => {}
  };
  const ready = (async () => { for (let i = 0; i < seedBatches; i++) await ledger.record({ userId: `seed${i}`, itemIds: [`s${i}`], at: NOW, source: 'scorer' }); })();
  return { deps, calls, ledger, ready };
}
const client = { _id: 'client1' };
const run = (w) => (a) => runScorerOnce({ ...a, deps: w.deps });

test('staff score: forces one run for that client only, though it ran yesterday, counts the batch and logs score_listening', async () => {
  const w = scorerWorld(); await w.ready;
  const logged = [];
  const out = await router.staffScore({ client, staff: staffUser, record: async (r) => logged.push(r), now: NOW, runScorer: run(w) });
  assert.deepStrictEqual(out, { success: true, scored: 25, skipped: 0, busy: false, disabled: false });
  assert.strictEqual(w.calls.prompts.length, 1);
  assert.strictEqual(await w.ledger.countBatchesToday(NOW), 1, 'counted like any batch');
  assert.deepStrictEqual(logged, [{ actor: staffUser, action: 'score_listening', client: 'client1', details: { scored: 25 } }]);
  // without force the same account is not due again yet
  const again = scorerWorld();
  assert.strictEqual((await runScorerOnce({ deps: again.deps, now: NOW })).accounts, 0);
});

test('staff score still respects the switch, the daily batch ceiling, the spend guard and the lease', async () => {
  const off = await router.staffScore({ client, staff: staffUser, record: async () => {}, now: NOW, runScorer: run(scorerWorld({ env: {} })) });
  assert.deepStrictEqual(off, { success: true, scored: 0, skipped: 1, busy: false, disabled: true });
  const full = scorerWorld({ seedBatches: cfg.MAX_BATCHES_PER_DAY }); await full.ready;
  const capped = await router.staffScore({ client, staff: staffUser, record: async () => {}, now: NOW, runScorer: run(full) });
  assert.strictEqual(capped.scored, 0); assert.strictEqual(capped.skipped, 1); assert.deepStrictEqual(full.calls.prompts, []);
  const guarded = scorerWorld({ spendOk: false });
  const g = await router.staffScore({ client, staff: staffUser, record: async () => {}, now: NOW, runScorer: run(guarded) });
  assert.strictEqual(g.scored, 0); assert.deepStrictEqual(guarded.calls.prompts, []);
  const busy = scorerWorld({ leaseHeld: true });
  const b = await router.staffScore({ client, staff: staffUser, record: async () => {}, now: NOW, runScorer: run(busy) });
  assert.strictEqual(b.busy, true); assert.strictEqual(b.scored, 0); assert.strictEqual(b.skipped, 1);
});

test('staff score for one client never reads another account\'s items', async () => {
  const w = scorerWorld();
  const seen = [];
  const orig = w.deps.items;
  w.deps.items = async (a) => { seen.push(String(a.userId)); return orig(a); };
  await router.staffScore({ client, staff: staffUser, record: async () => {}, now: NOW, runScorer: run(w) });
  assert.deepStrictEqual([...new Set(seen)], ['client1']);
});

test('rows of another account are dropped even if the store hands them back', async () => {
  const w = world({ pairs: [...spread('u1', 20), ...spread('u2', 30)] });
  w.deps.store.scoresSince = async () => w.scores;
  const res = await call({ deps: w.deps, user: owner() });
  assert.strictEqual(res.body.total, 20);
});
