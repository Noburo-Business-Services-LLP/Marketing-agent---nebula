const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { listeningStore } = require('../services/listening/store');
const erase = require('../services/listening/erase');
const { scoreAccount } = require('../services/listening/scorer');
const { ruleFor, erasable, filterFor } = require('../services/dataRegistry');
const d = require('../services/accountDeletion');
const { buildExport } = require('../services/accountExport');

const NOW = new Date('2026-10-17T06:00:00Z');
const NAMES = ['ListeningBatchLog', 'ListeningScore', 'ListeningWeekly'];

// ---- fake Score and Weekly collections, enough for the real store
const eq = (a, b) => String(a) === String(b);
function fakeModels() {
  const scores = [];
  const weeks = [];
  let n = 0;
  const matchS = (r, f) => Object.entries(f).every(([k, v]) => {
    if (k === 'inboxItemId' && v && v.$in) return v.$in.map(String).includes(String(r.inboxItemId));
    if (k === '_id' && v && v.$lt) return r._id < v.$lt;
    if (k === 'itemAt' && v && v.$gte) return r.itemAt >= v.$gte;
    return eq(r[k], v);
  });
  const Score = {
    add: (userId, inboxItemId, itemAt, label = 'neg') => scores.push({ _id: ++n, userId, inboxItemId, itemAt: new Date(itemAt), label, reason: 'quality' }),
    all: () => scores,
    find: (f) => {
      let rows = scores.filter((r) => matchS(r, f));
      const q = { sort: () => { rows = [...rows].sort((a, b) => b._id - a._id); return q; }, limit: (k) => { rows = rows.slice(0, k); return q; }, select: () => q, lean: async () => rows.map((r) => ({ ...r })) };
      return q;
    },
    deleteMany: async (f) => { const before = scores.length; const keep = scores.filter((r) => !matchS(r, f)); scores.length = 0; scores.push(...keep); return { deletedCount: before - scores.length }; }
  };
  const Weekly = {
    all: () => weeks,
    updateOne: async (f, u) => { const i = weeks.findIndex((w) => eq(w.userId, f.userId) && w.weekStart === f.weekStart); const row = { userId: f.userId, weekStart: f.weekStart, ...u.$set }; if (i < 0) weeks.push(row); else weeks[i] = row; },
    deleteMany: async (f) => { const keep = weeks.filter((w) => !(eq(w.userId, f.userId) && !f.weekStart.$nin.includes(w.weekStart))); weeks.length = 0; weeks.push(...keep); }
  };
  return { Score, Weekly };
}
const D1 = '2026-10-14T05:00:00Z'; // week of Mon 2026-10-12
const D0 = '2026-10-07T05:00:00Z'; // week of Mon 2026-10-05

test('registry: the three listening collections are deleted with the account, by userId, and export reads them too', () => {
  for (const name of NAMES) {
    const r = ruleFor(name);
    assert.ok(r, `${name} must be on the data list`);
    assert.strictEqual(r.action, 'delete');
    assert.deepStrictEqual(filterFor(r, 'u1'), { userId: 'u1' });
    assert.ok(erasable().some((x) => x.model === name), `${name} must be erasable (and so exported)`);
  }
  for (const name of NAMES) assert.ok(require(`../models/${name}`).schema.path('userId'), name);
});

// ---- account deletion, client removal and agency deletion all run the registry's delete rules
function worldWith(users) {
  const docs = {};
  const models = {
    User: { findById: (id) => ({ select: () => ({ lean: async () => users.find((u) => u._id === id) || null }) }), find: () => ({ sort: () => ({ select: () => ({ lean: async () => users.filter((u) => u.agency && u.agency.ownerId) }), lean: async () => users.filter((u) => u.agency && u.agency.ownerId) }), select: () => ({ sort: () => ({ lean: async () => users.filter((u) => u.agency && u.agency.ownerId) }), lean: async () => users.filter((u) => u.agency && u.agency.ownerId) }), lean: async () => users.filter((u) => u.agency && u.agency.ownerId) }), deleteOne: async (f) => { const i = users.findIndex((u) => u._id === f._id); if (i >= 0) users.splice(i, 1); } },
    StaffAction: { updateMany: async () => {} }, DeletedAccount: { updateOne: async () => {} }, RetainedPayment: { updateOne: async () => {} }
  };
  for (const r of erasable()) {
    docs[r.model] = [];
    models[r.model] = {
      find: () => ({ lean: () => ({ cursor: async function* () {} }) }),
      deleteMany: async (f) => { const before = docs[r.model].length; docs[r.model] = docs[r.model].filter((x) => String(x[r.field]) !== String(f[r.field])); return { deletedCount: before - docs[r.model].length }; }
    };
  }
  return { docs, models };
}
const deps = { deleteAssets: async () => ({ requested: 0, failedBatches: 0 }), deleteSocialProfile: async () => ({ success: true }), mail: { sendDeleted: async () => {} } };
const seed = (docs) => { for (const n of NAMES) docs[n].push({ userId: 'x1' }, { userId: 'w1' }, { userId: 'o1' }); };

test('account deletion erases the three listening collections for that account only', async () => {
  const users = [{ _id: 'x1', email: 'a@example.com', agency: {} }, { _id: 'y2', email: 'b@example.com', agency: {} }];
  const { docs, models } = worldWith(users);
  for (const n of NAMES) docs[n].push({ userId: 'x1' }, { userId: 'y2' });
  const steps = d.stepsFor({ user: users[0], models, deps, now: NOW });
  await steps.find((s) => s.name === 'data').run();
  for (const n of NAMES) assert.deepStrictEqual(docs[n], [{ userId: 'y2' }], `${n} of the other account must stay`);
});

test('removing an agency client erases that client\'s listening rows and leaves the agency\'s and other clients\'', async () => {
  const users = [{ _id: 'o1', agency: {} }, { _id: 'w1', email: 'ws-w1@workspace.invalid', agency: { ownerId: 'o1', workspaceName: 'Sweet' } }, { _id: 'w2', email: 'ws-w2@workspace.invalid', agency: { ownerId: 'o1', workspaceName: 'Tea' } }];
  const { docs, models } = worldWith(users);
  for (const n of NAMES) docs[n].push({ userId: 'o1' }, { userId: 'w1' }, { userId: 'w2' });
  const out = await d.purgeWorkspace('w1', { models, deps, now: NOW });
  assert.strictEqual(out.ok, true);
  for (const n of NAMES) assert.deepStrictEqual(docs[n].map((x) => x.userId).sort(), ['o1', 'w2'], n);
});

test('deleting an agency erases the listening rows of every client and of the agency', async () => {
  const users = [{ _id: 'o1', email: 'boss@agency.example', plan: { tier: 'agency' }, agency: { clientCount: 2 } }, { _id: 'w1', email: 'ws-w1@workspace.invalid', agency: { ownerId: 'o1', workspaceName: 'Sweet' } }, { _id: 'w2', email: 'ws-w2@workspace.invalid', agency: { ownerId: 'o1', workspaceName: 'Tea' } }, { _id: 'u9', email: 'asha@example.com', agency: {} }];
  const { docs, models } = worldWith(users);
  for (const n of NAMES) docs[n].push({ userId: 'o1' }, { userId: 'w1' }, { userId: 'w2' }, { userId: 'u9' });
  const steps = d.stepsFor({ user: users[0], models, deps, now: NOW, clientCount: 2 });
  assert.ok(steps.some((s) => s.name === 'clients'));
  await steps.find((s) => s.name === 'clients').run();
  await steps.find((s) => s.name === 'data').run();
  for (const n of NAMES) assert.deepStrictEqual(docs[n], [{ userId: 'u9' }], n);
});

// ---- export
test('the export includes the customer\'s own labelled scores and weekly totals, never any comment text', async () => {
  const { Score, Weekly } = fakeModels();
  Score.add('u1', 'i1', D1); Weekly.all().push({ userId: 'u1', weekStart: '2026-10-12', total: 1 });
  const asked = [];
  const mk = (name, rows) => ({ find: (q) => { asked.push([name, q]); return { limit: () => ({ lean: async () => rows }) }; } });
  const models = {
    ListeningScore: mk('ListeningScore', [{ _id: 's1', userId: 'u1', inboxItemId: 'i1', platform: 'instagram', kind: 'private', label: 'neg', reason: 'quality' }]),
    ListeningWeekly: mk('ListeningWeekly', [{ _id: 'w1', userId: 'u1', weekStart: '2026-10-12', counts: { positive: 0, neutral: 0, negative: 1 }, total: 1 }])
  };
  const out = await buildExport('u1', { User: { findById: () => ({ lean: async () => ({ _id: 'u1', payments: [] }) }) }, models, now: NOW });
  assert.deepStrictEqual(Object.keys(out.collections).sort(), ['ListeningScore', 'ListeningWeekly']);
  assert.strictEqual(out.collections.ListeningScore[0].label, 'neg');
  assert.deepStrictEqual(asked.find((a) => a[0] === 'ListeningScore')[1], { userId: 'u1' });
  // the stored shapes have no field that could hold text or an author
  for (const name of NAMES) {
    const paths = Object.keys(require(`../models/${name}`).schema.paths);
    assert.ok(!paths.some((p) => /body|text|content|message|author|name|handle|quote/i.test(p)), `${name} must hold no text: ${paths.join(',')}`);
  }
});

// ---- erase + sweep on the real store with fake collections
test('eraseForInboxItems removes only that account\'s scores for those ids, even when another account has the same item id', async () => {
  const m = fakeModels(); const store = listeningStore(m);
  m.Score.add('u1', 'i1', D1); m.Score.add('u1', 'i2', D1); m.Score.add('u2', 'i1', D1);
  const r = await erase.eraseForInboxItems({ userId: 'u1', itemIds: ['i1'], now: NOW, store });
  assert.deepStrictEqual(r, { removed: 1 });
  assert.deepStrictEqual(m.Score.all().map((x) => `${x.userId}|${x.inboxItemId}`).sort(), ['u1|i2', 'u2|i1']);
});

test('weeks are rebuilt after an erase and a week with no scores left is removed', async () => {
  const m = fakeModels(); const store = listeningStore(m);
  m.Score.add('u1', 'a', D0); m.Score.add('u1', 'b', D1); m.Score.add('u1', 'c', D1, 'pos');
  m.Score.add('u2', 'a', D0);
  await store.rebuildWeeks('u1', NOW); await store.rebuildWeeks('u2', NOW);
  assert.deepStrictEqual(m.Weekly.all().filter((w) => w.userId === 'u1').map((w) => [w.weekStart, w.total]).sort(), [['2026-10-05', 1], ['2026-10-12', 2]]);
  await erase.eraseForInboxItems({ userId: 'u1', itemIds: ['a', 'b'], now: NOW, store });
  const u1 = m.Weekly.all().filter((w) => w.userId === 'u1');
  assert.deepStrictEqual(u1.map((w) => [w.weekStart, w.total, w.counts.negative]), [['2026-10-12', 1, 0]], 'deleted comments stop counting and the empty week is gone');
  assert.strictEqual(m.Weekly.all().filter((w) => w.userId === 'u2').length, 1, 'another account\'s weeks are untouched');
});

const sweepDeps = (m, alive) => ({ store: listeningStore(m), existingIds: async (userId, ids) => new Set(ids.filter((i) => (alive[userId] || []).includes(i))) });

test('sweepOrphans removes scores whose inbox item is gone, keeps the rest, repeats safely, and never touches another account', async () => {
  const m = fakeModels();
  m.Score.add('u1', 'keep', D1); m.Score.add('u1', 'gone', D1); m.Score.add('u2', 'gone', D1);
  const deps = sweepDeps(m, { u1: ['keep'], u2: ['gone'] });
  await deps.store.rebuildWeeks('u1', NOW);
  assert.deepStrictEqual(await erase.sweepOrphans({ userId: 'u1', now: NOW, deps }), { removed: 1 });
  assert.deepStrictEqual(await erase.sweepOrphans({ userId: 'u1', now: NOW, deps }), { removed: 0 }, 'second run does nothing');
  assert.deepStrictEqual(m.Score.all().map((x) => `${x.userId}|${x.inboxItemId}`).sort(), ['u1|keep', 'u2|gone']);
  assert.strictEqual(m.Weekly.all().find((w) => w.userId === 'u1').total, 1);
});

test('the existence check is made with this account\'s id (the real query is { _id: { $in }, userId })', async () => {
  const seen = [];
  const Message = { find: (q) => { seen.push(q); return { select: () => ({ lean: async () => [{ _id: 'keep' }] }) }; } };
  const m = fakeModels(); m.Score.add('u1', 'keep', D1); m.Score.add('u1', 'gone', D1);
  const r = await erase.sweepOrphans({ userId: 'u1', now: NOW, deps: { store: listeningStore(m), Message } });
  assert.deepStrictEqual(r, { removed: 1 });
  assert.deepStrictEqual(m.Score.all().map((x) => x.inboxItemId), ['keep']);
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0].userId, 'u1');
  assert.deepStrictEqual([...seen[0]._id.$in].sort(), ['gone', 'keep']);
});

test('the sweep is bounded: pages of 500, at most MAX_PAGES pages and MAX_REMOVE removals a run', async () => {
  const m = fakeModels();
  for (let i = 0; i < 3400; i++) m.Score.add('u1', `i${i}`, D1);
  let pages = 0;
  const deps = { store: { ...listeningStore(m), scoredPage: (...a) => { pages++; return listeningStore(m).scoredPage(...a); } }, existingIds: async () => new Set() };
  const r = await erase.sweepOrphans({ userId: 'u1', now: NOW, deps });
  assert.strictEqual(r.removed, erase.MAX_REMOVE);
  assert.ok(pages <= erase.MAX_PAGES);
  assert.strictEqual(m.Score.all().length, 3400 - erase.MAX_REMOVE);
  const r2 = await erase.sweepOrphans({ userId: 'u1', now: NOW, deps });
  assert.ok(r2.removed > 0 && r2.removed <= erase.MAX_REMOVE, 'the rest goes on the next pass');
});

test('the sweep and the erase never throw, and a failed inbox lookup removes nothing', async () => {
  const m = fakeModels(); m.Score.add('u1', 'x', D1);
  const quiet = console.error; console.error = () => {};
  try {
    assert.deepStrictEqual(await erase.sweepOrphans({ userId: 'u1', now: NOW, deps: { store: listeningStore(m), existingIds: async () => { throw new Error('db down'); } } }), { removed: 0 });
    assert.strictEqual(m.Score.all().length, 1, 'a doubt never deletes');
    assert.deepStrictEqual(await erase.sweepOrphans({}), { removed: 0 });
    assert.deepStrictEqual(await erase.eraseForInboxItems({ userId: 'u1', itemIds: ['x'], store: { deleteScores: async () => { throw new Error('boom'); } } }), { removed: 0 });
    assert.deepStrictEqual(await erase.eraseForInboxItems({ userId: 'u1', itemIds: [], store: {} }), { removed: 0 });
    const r = await erase.sweepOrphans({ userId: 'u1', now: NOW, deps: { store: { scoredPage: async () => { throw new Error('x'); } } } });
    assert.deepStrictEqual(r, { removed: 0 });
  } finally { console.error = quiet; }
});

test('a scorer pass sweeps the account first, so a deleted comment does not count toward the minimum', async () => {
  const calls = [];
  const deps = {
    env: { ENABLE_LISTENING: 'on', LISTENING_MODEL: 'fake' },
    erase: { sweepOrphans: async (a) => { calls.push(['sweep', String(a.userId)]); return { removed: 1 }; } },
    ledger: { lastRunAt: async () => null, attempted: async () => new Set(), countItemsUserToday: async () => 0 }, memory: new Map(),
    items: async () => { calls.push(['items']); return []; },
    store: { scoredIds: async () => new Set(), scoresSince: async () => [], rebuildWeeks: async () => {} },
    caps: require('../config/listening')
  };
  const first = await scoreAccount({ user: { _id: 'u1' }, now: NOW, deps });
  assert.strictEqual(first.skipped, 'too_few');
  assert.deepStrictEqual(calls.slice(0, 2), [['sweep', 'u1'], ['items']]);
  // a sweep that throws is swallowed
  deps.erase = { sweepOrphans: async () => { throw new Error('nope'); } };
  const quiet = console.error; console.error = () => {};
  try { const r = await scoreAccount({ user: { _id: 'u1' }, now: NOW, deps }); assert.strictEqual(r.skipped, 'too_few'); } finally { console.error = quiet; }
});

test('the scorer stamps its batches with a source the log model accepts', () => {
  const allowed = require('../models/ListeningBatchLog').schema.path('source').enumValues;
  assert.ok(allowed.includes('scorer') && allowed.includes('staff') && allowed.includes('tracker'));
});

// ---- the Inbox has no delete path; adding one must call the erase
test('a delete route added to the Inbox without a call to eraseForInboxItems fails this test', () => {
  const root = path.join(__dirname, '..');
  const routes = fs.readFileSync(path.join(root, 'routes/socialInboxRoutes.js'), 'utf8');
  const code = [routes, fs.readFileSync(path.join(root, 'controllers/socialInboxController.js'), 'utf8'), fs.readFileSync(path.join(root, 'services/socialInboxService.js'), 'utf8')].join('\n');
  const deletes = /router\.delete\(|router\.(?:post|put|patch)\(\s*['"`][^'"`]*(?:delete|remove)|controller\.(?:delete|remove)\w*|SocialInboxMessage\.(?:deleteOne|deleteMany|findOneAndDelete|findByIdAndDelete|remove)\b/i.test(code);
  if (deletes) assert.ok(/eraseForInboxItems/.test(code), 'an Inbox delete path exists; it must call eraseForInboxItems from services/listening/erase');
  assert.ok(/eraseForInboxItems/.test(fs.readFileSync(path.join(root, 'models/SocialInboxMessage.js'), 'utf8')), 'the model keeps its note pointing at eraseForInboxItems');
});
