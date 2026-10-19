// Approval, origin, Bin and counts for drafts (impact map simplify-navigation, phase 1 backend).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');

const status = require('../services/draftStatus');
const life = require('../services/postLifecycle');

const OID = () => new mongoose.Types.ObjectId();
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-19T06:00:00Z');

// ---------- a tiny in-memory model that understands the filters these services use ----------
function get(doc, key) { return key.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc); }
function eq(a, b) { return String(a) === String(b); }
function matchValue(v, cond) {
  if (cond && typeof cond === 'object' && !(cond instanceof Date) && !(cond instanceof mongoose.Types.ObjectId) && Object.keys(cond).some((k) => k.startsWith('$'))) {
    return Object.entries(cond).every(([op, arg]) => {
      if (op === '$in') return arg.some((a) => (a === null ? v === null || v === undefined : eq(v, a)));
      if (op === '$nin') return !arg.some((a) => (a === null ? v === null || v === undefined : eq(v, a)));
      if (op === '$ne') return !(v !== undefined && v !== null && eq(v, arg));
      if (op === '$lt') return v != null && new Date(v) < new Date(arg);
      if (op === '$lte') return v != null && new Date(v) <= new Date(arg);
      if (op === '$gte') return v != null && new Date(v) >= new Date(arg);
      if (op === '$exists') return arg ? v !== undefined : v === undefined;
      if (op === '$type') return arg === 'objectId' ? v instanceof mongoose.Types.ObjectId : arg === 'number' ? typeof v === 'number' : false;
      throw new Error(`fake: unsupported ${op}`);
    });
  }
  if (cond === null) return v === null || v === undefined;
  return v !== undefined && v !== null && eq(v, cond);
}
function matches(doc, q) {
  return Object.entries(q || {}).every(([k, c]) => {
    if (k === '$or') return c.some((s) => matches(doc, s));
    if (k === '$nor') return !c.some((s) => matches(doc, s));
    if (k === '$and') return c.every((s) => matches(doc, s));
    return matchValue(get(doc, k), c);
  });
}
function fakeModel(seed = []) {
  const rows = seed.map((r) => ({ _id: OID(), ...r }));
  const wrap = (r) => (r ? Object.assign(r, { save: async function save() { return this; } }) : null);
  const chain = (p) => { p.lean = () => p; p.select = () => p; p.limit = (n) => chain(p.then((x) => x.slice(0, n))); p.maxTimeMS = () => p; p.sort = () => p; return p; };
  const apply = (r, u) => {
    for (const [k, v] of Object.entries(u.$set || {})) r[k] = v;
    for (const k of Object.keys(u.$unset || {})) delete r[k];
  };
  return {
    rows,
    findOne: (q) => chain(Promise.resolve(wrap(rows.find((r) => matches(r, q)) || null))),
    find: (q) => chain(Promise.resolve(rows.filter((r) => matches(r, q)))),
    countDocuments: (q) => chain(Promise.resolve(rows.filter((r) => matches(r, q)).length)),
    async updateOne(q, u) { const r = rows.find((x) => matches(x, q)); if (!r) return { matchedCount: 0, modifiedCount: 0 }; apply(r, u); return { matchedCount: 1, modifiedCount: 1 }; },
    findOneAndUpdate: (q, u) => chain(Promise.resolve((() => { const r = rows.find((x) => matches(x, q)); if (!r) return null; apply(r, u); return wrap(r); })())),
    async deleteOne(q) { const i = rows.findIndex((x) => matches(x, q)); if (i < 0) return { deletedCount: 0 }; rows.splice(i, 1); return { deletedCount: 1 }; }
  };
}

const OWNER = OID();
const OTHER = OID();
const CAL = OID();
const paid = { plan: { tier: 'starter', addons: ['publish'] } };
const free = { plan: { tier: 'free' } };

function actions({ drafts = [], campaigns = [], user = paid } = {}) {
  const Draft = fakeModel(drafts);
  const Campaign = fakeModel(campaigns);
  const upserts = [];
  const upsertCampaign = async (draft, userId, targetStatus) => {
    let c = draft.campaignId ? Campaign.rows.find((r) => eq(r._id, draft.campaignId)) : null;
    if (!c) { c = { _id: OID(), userId, status: targetStatus }; Campaign.rows.push(c); } else c.status = targetStatus;
    c.scheduling = { startDate: draft.scheduledDate };
    upserts.push(targetStatus);
    return c;
  };
  const api = life.createPostActions({ Draft, Campaign, loadUser: async () => user, upsertCampaign, now: () => NOW });
  return { api, Draft, Campaign, upserts };
}

// ---------- origin ----------
test('origin: the stored value wins, otherwise calendar-made rows are automation and everything else is manual', () => {
  assert.strictEqual(status.originOf({ origin: 'manual', contentCalendarId: CAL }), 'manual');
  assert.strictEqual(status.originOf({ origin: 'automation' }), 'automation');
  assert.strictEqual(status.originOf({ contentCalendarId: CAL }), 'automation');
  assert.strictEqual(status.originOf({ calendarDay: 3, contentCalendarId: null }), 'automation'); // weekly plan rows have no calendar id
  assert.strictEqual(status.originOf({ calendarDay: null }), 'manual');
  assert.strictEqual(status.originOf({ origin: 'something' }), 'manual');
  assert.strictEqual(status.originOf({}), 'manual');
  assert.strictEqual(status.originOf(null), 'manual');
  assert.deepStrictEqual([...status.ORIGINS], ['manual', 'automation']);
});

test('needs approval: only automation posts that wait, never videos, never manual ones', () => {
  assert.strictEqual(status.needsApproval({ status: 'completed', origin: 'automation', sourceType: 'post' }), true);
  assert.strictEqual(status.needsApproval({ status: 'completed', calendarDay: 2, sourceType: 'post' }), true);
  assert.strictEqual(status.needsApproval({ status: 'completed', origin: 'manual', sourceType: 'post' }), false);
  assert.strictEqual(status.needsApproval({ status: 'approved', origin: 'automation', sourceType: 'post' }), false);
  assert.strictEqual(status.needsApproval({ status: 'binned', origin: 'automation', sourceType: 'post' }), false);
  assert.strictEqual(status.needsApproval({ status: 'draft', origin: 'automation', sourceType: 'reel' }), false);
  assert.strictEqual(status.stateOf('approved'), 'approved');
  assert.strictEqual(status.stateOf('binned'), 'closed');
});

test('the needs-approval database filter means the same as the function', () => {
  const rows = [
    { userId: OWNER, status: 'completed', origin: 'automation', sourceType: 'post' },
    { userId: OWNER, status: 'draft', calendarDay: 4, contentCalendarId: null, sourceType: 'post' },
    { userId: OWNER, status: 'draft', contentCalendarId: CAL, sourceType: 'calendar' },
    { userId: OWNER, status: 'draft', origin: 'manual', contentCalendarId: CAL, sourceType: 'post' },
    { userId: OWNER, status: 'completed', sourceType: 'post' },
    { userId: OWNER, status: 'approved', origin: 'automation', sourceType: 'post' },
    { userId: OWNER, status: 'binned', origin: 'automation', sourceType: 'post' },
    { userId: OWNER, status: 'draft', origin: 'automation', sourceType: 'reel' },
    { userId: OTHER, status: 'draft', origin: 'automation', sourceType: 'post' }
  ];
  const f = status.needsApprovalFilter(OWNER);
  for (const r of rows) assert.strictEqual(matches(r, f), String(r.userId) === String(OWNER) && status.needsApproval(r), JSON.stringify(r));
  assert.ok(f.status && f.status.$in, 'starts with { userId, status } so the existing index is used');
});

// ---------- approve ----------
test('approve with a future planned date and the right to publish schedules it on that date, never posts it', async () => {
  const at = new Date(NOW.getTime() + 3 * DAY);
  const { api, Draft, upserts } = actions({ drafts: [{ userId: OWNER, status: 'completed', origin: 'automation', sourceType: 'post', plannedDate: at }] });
  const id = Draft.rows[0]._id;
  const out = await api.approve(OWNER, id);
  assert.strictEqual(out.status, 200);
  assert.strictEqual(out.json.outcome, 'scheduled');
  assert.strictEqual(Draft.rows[0].status, 'scheduled');
  assert.strictEqual(new Date(Draft.rows[0].scheduledDate).getTime(), at.getTime());
  assert.deepStrictEqual(upserts, ['scheduled']);
  assert.ok(Draft.rows[0].approvedAt);
});

test('approve without a planned date, with a past date, or without the Publish add-on waits as approved', async () => {
  for (const [row, user] of [
    [{ status: 'completed', origin: 'automation' }, paid],
    [{ status: 'draft', origin: 'automation', plannedDate: new Date(NOW.getTime() - DAY) }, paid],
    [{ status: 'completed', origin: 'automation', plannedDate: new Date(NOW.getTime() + DAY) }, free],
    [{ status: 'completed', origin: 'automation', plannedDate: new Date(NOW.getTime() + DAY) }, { plan: { tier: 'starter', addons: [] } }]
  ]) {
    const { api, Draft, upserts } = actions({ drafts: [{ userId: OWNER, sourceType: 'post', ...row }], user });
    const out = await api.approve(OWNER, Draft.rows[0]._id);
    assert.strictEqual(out.status, 200, JSON.stringify(row));
    assert.strictEqual(out.json.outcome, 'approved');
    assert.strictEqual(Draft.rows[0].status, 'approved');
    assert.deepStrictEqual(upserts, []);
  }
});

test('approve refuses what cannot be approved and never touches another account', async () => {
  const { api, Draft } = actions({ drafts: [
    { userId: OTHER, status: 'completed', origin: 'automation', sourceType: 'post' },
    { userId: OWNER, status: 'processing', origin: 'automation', sourceType: 'post' },
    { userId: OWNER, status: 'failed', origin: 'automation', sourceType: 'post' },
    { userId: OWNER, status: 'published', origin: 'automation', sourceType: 'post' },
    { userId: OWNER, status: 'binned', origin: 'automation', sourceType: 'post' },
    { userId: OWNER, status: 'scheduled', origin: 'automation', sourceType: 'post' }
  ] });
  assert.strictEqual((await api.approve(OWNER, Draft.rows[0]._id)).status, 404);
  assert.strictEqual(Draft.rows[0].status, 'completed');
  assert.strictEqual((await api.approve(OWNER, 'not-an-id')).status, 404);
  for (const i of [1, 2, 3, 4]) assert.strictEqual((await api.approve(OWNER, Draft.rows[i]._id)).status, 409, Draft.rows[i].status);
  const again = await api.approve(OWNER, Draft.rows[5]._id);
  assert.strictEqual(again.status, 200);
  assert.strictEqual(again.json.outcome, 'scheduled');
});

// ---------- the publish gate ----------
test('automation posts must be approved before publish or schedule; manual posts go straight out', () => {
  const gate = life.publishGate;
  assert.deepStrictEqual(gate({ status: 'completed', origin: 'automation' }), { status: 409, message: 'Approve this post first.' });
  assert.deepStrictEqual(gate({ status: 'draft', calendarDay: 2 }), { status: 409, message: 'Approve this post first.' });
  assert.strictEqual(gate({ status: 'approved', origin: 'automation' }), null);
  assert.strictEqual(gate({ status: 'scheduled', origin: 'automation' }), null);
  for (const s of ['draft', 'ready', 'completed', 'approved', 'scheduled']) assert.strictEqual(gate({ status: s, origin: 'manual' }), null, s);
  assert.strictEqual(gate({ status: 'binned', origin: 'manual' }).status, 409);
  assert.match(gate({ status: 'binned', origin: 'manual' }).message, /Bin/);
});

// ---------- unschedule and unapprove ----------
test('unschedule moves a scheduled post back to approved and stops its campaign', async () => {
  const camp = { _id: OID(), userId: OWNER, status: 'scheduled' };
  const later = new Date(NOW.getTime() + DAY);
  const { api, Draft, Campaign } = actions({ drafts: [{ userId: OWNER, status: 'scheduled', origin: 'automation', sourceType: 'post', campaignId: camp._id, scheduledDate: later }], campaigns: [camp] });
  const out = await api.unschedule(OWNER, Draft.rows[0]._id);
  assert.strictEqual(out.status, 200);
  assert.strictEqual(Draft.rows[0].status, 'approved');
  assert.strictEqual(Draft.rows[0].scheduledDate, null);
  assert.strictEqual(new Date(Draft.rows[0].plannedDate).getTime(), later.getTime());
  assert.strictEqual(Campaign.rows[0].status, 'draft');
  assert.strictEqual((await api.unschedule(OWNER, Draft.rows[0]._id)).status, 409);
});

test('unschedule refuses a post that is about to go out or already going out', async () => {
  const soon = actions({ drafts: [{ userId: OWNER, status: 'scheduled', origin: 'manual', sourceType: 'post', scheduledDate: new Date(NOW.getTime() + 60 * 1000) }] });
  assert.strictEqual((await soon.api.unschedule(OWNER, soon.Draft.rows[0]._id)).status, 409);
  const camp = { _id: OID(), userId: OWNER, status: 'posted' };
  const gone = actions({ drafts: [{ userId: OWNER, status: 'scheduled', origin: 'manual', sourceType: 'post', campaignId: camp._id, scheduledDate: new Date(NOW.getTime() + DAY) }], campaigns: [camp] });
  assert.strictEqual((await gone.api.unschedule(OWNER, gone.Draft.rows[0]._id)).status, 409);
  assert.strictEqual(gone.Draft.rows[0].status, 'scheduled');
});

test('unapprove sends an approved post back to needs approval', async () => {
  const { api, Draft } = actions({ drafts: [{ userId: OWNER, status: 'approved', origin: 'automation', sourceType: 'post' }, { userId: OWNER, status: 'scheduled', origin: 'automation', sourceType: 'post' }] });
  assert.strictEqual((await api.unapprove(OWNER, Draft.rows[0]._id)).status, 200);
  assert.strictEqual(Draft.rows[0].status, 'draft');
  assert.strictEqual(status.needsApproval(Draft.rows[0]), true);
  assert.strictEqual((await api.unapprove(OWNER, Draft.rows[1]._id)).status, 409);
});

// ---------- Bin, Archive, Restore ----------
test('delete moves to the Bin and remembers the previous status; posted and scheduled items are refused', async () => {
  const { api, Draft } = actions({ drafts: [
    { userId: OWNER, status: 'completed', origin: 'manual', sourceType: 'post' },
    { userId: OWNER, status: 'published', origin: 'manual', sourceType: 'post' },
    { userId: OWNER, status: 'scheduled', origin: 'manual', sourceType: 'post' },
    { userId: OWNER, status: 'processing', origin: 'manual', sourceType: 'post' },
    { userId: OTHER, status: 'draft', origin: 'manual', sourceType: 'post' }
  ] });
  const out = await api.bin(OWNER, Draft.rows[0]._id);
  assert.strictEqual(out.status, 200);
  assert.strictEqual(Draft.rows[0].status, 'binned');
  assert.strictEqual(Draft.rows[0].binnedFrom, 'completed');
  assert.strictEqual(new Date(Draft.rows[0].binnedAt).getTime(), NOW.getTime());
  assert.strictEqual((await api.bin(OWNER, Draft.rows[0]._id)).status, 200); // twice is fine
  assert.strictEqual(Draft.rows[0].binnedFrom, 'completed');
  const posted = await api.bin(OWNER, Draft.rows[1]._id);
  assert.strictEqual(posted.status, 409);
  assert.match(posted.json.message, /Archive/);
  assert.match((await api.bin(OWNER, Draft.rows[2]._id)).json.message, /Unschedule this post first/);
  assert.strictEqual((await api.bin(OWNER, Draft.rows[3]._id)).status, 409);
  assert.strictEqual((await api.bin(OWNER, Draft.rows[4]._id)).status, 404);
  assert.strictEqual(Draft.rows[4].status, 'draft');
});

test('restore from the Bin within 14 days, never after; restore from Archived any time', async () => {
  const { api, Draft } = actions({ drafts: [
    { userId: OWNER, status: 'binned', binnedFrom: 'approved', binnedAt: new Date(NOW.getTime() - 13 * DAY), origin: 'automation', sourceType: 'post' },
    { userId: OWNER, status: 'binned', binnedFrom: 'draft', binnedAt: new Date(NOW.getTime() - 15 * DAY), origin: 'manual', sourceType: 'post' },
    { userId: OWNER, status: 'archived', archivedFrom: 'published', origin: 'manual', sourceType: 'post' },
    { userId: OWNER, status: 'archived', origin: 'automation', sourceType: 'post' },
    { userId: OWNER, status: 'completed', origin: 'manual', sourceType: 'post' },
    { userId: OWNER, status: 'binned', binnedFrom: 'scheduled', binnedAt: NOW, origin: 'manual', sourceType: 'post' }
  ] });
  assert.strictEqual((await api.restore(OWNER, Draft.rows[0]._id)).status, 200);
  assert.strictEqual(Draft.rows[0].status, 'approved');
  assert.strictEqual(Draft.rows[0].binnedAt, null);
  assert.strictEqual((await api.restore(OWNER, Draft.rows[1]._id)).status, 410);
  assert.strictEqual(Draft.rows[1].status, 'binned');
  await api.restore(OWNER, Draft.rows[2]._id);
  assert.strictEqual(Draft.rows[2].status, 'published');
  await api.restore(OWNER, Draft.rows[3]._id);
  assert.strictEqual(Draft.rows[3].status, 'draft');
  assert.strictEqual(status.needsApproval(Draft.rows[3]), true);
  assert.strictEqual((await api.restore(OWNER, Draft.rows[4]._id)).status, 409);
  await api.restore(OWNER, Draft.rows[5]._id);
  assert.strictEqual(Draft.rows[5].status, 'approved', 'a scheduled post never comes back as scheduled');
});

test('an old archived row without its previous status comes back as posted when its campaign went out', async () => {
  const camp = { _id: OID(), userId: OWNER, status: 'posted' };
  const { api, Draft } = actions({ drafts: [{ userId: OWNER, status: 'archived', origin: 'manual', sourceType: 'post', campaignId: camp._id }], campaigns: [camp] });
  await api.restore(OWNER, Draft.rows[0]._id);
  assert.strictEqual(Draft.rows[0].status, 'published');
});

test('archive keeps posted items, refuses scheduled ones and remembers where it came from', async () => {
  const { api, Draft } = actions({ drafts: [
    { userId: OWNER, status: 'published', origin: 'manual', sourceType: 'post' },
    { userId: OWNER, status: 'scheduled', origin: 'manual', sourceType: 'post' }
  ] });
  assert.strictEqual((await api.archive(OWNER, Draft.rows[0]._id)).status, 200);
  assert.strictEqual(Draft.rows[0].status, 'archived');
  assert.strictEqual(Draft.rows[0].archivedFrom, 'published');
  assert.strictEqual((await api.archive(OWNER, Draft.rows[1]._id)).status, 409);
});

// ---------- counts ----------
test('counts per view, for one account only', async () => {
  const mk = (s, extra = {}) => ({ userId: OWNER, status: s, sourceType: 'post', ...extra });
  const { api } = actions({ drafts: [
    mk('completed', { origin: 'automation' }), mk('draft', { calendarDay: 1 }), mk('failed', { origin: 'automation' }),
    mk('completed', { origin: 'manual' }), mk('approved', { origin: 'automation' }), mk('scheduled'), mk('scheduled'),
    mk('published'), mk('archived'), mk('binned'), mk('binned'), mk('binned'),
    mk('draft', { origin: 'automation', sourceType: 'reel' }),
    { userId: OTHER, status: 'completed', origin: 'automation', sourceType: 'post' }
  ] });
  const out = await api.counts(OWNER);
  assert.strictEqual(out.status, 200);
  assert.deepStrictEqual(out.json.counts, { needsApproval: 3, drafts: 1, approved: 1, scheduled: 2, posted: 1, archived: 1, binned: 3 });
});

// ---------- the routes file is wired the way the service expects ----------
test('drafts routes: new routes exist, counts sits before /:id, DELETE goes to the Bin, publish and schedule use the gate', () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/drafts.js'), 'utf8');
  for (const r of ["'/:id/approve'", "'/:id/unapprove'", "'/:id/unschedule'", "'/:id/archive'", "'/:id/restore'", "'/counts'"]) assert.ok(src.includes(r), r);
  assert.ok(src.indexOf("router.get('/counts'") < src.indexOf("router.get('/:id'"), 'counts before /:id');
  const publish = src.slice(src.indexOf("router.post('/:id/publish'"), src.indexOf("router.post('/:id/publish'") + 900);
  assert.match(publish, /publishGate\(/);
  const schedule = src.slice(src.indexOf("router.post('/:id/schedule'"), src.indexOf("router.post('/:id/schedule'") + 900);
  assert.match(schedule, /publishGate\(/);
  const del = src.slice(src.indexOf("router.delete('/:id'"), src.indexOf("router.delete('/:id'") + 400);
  assert.match(del, /\.bin\(/);
});

test('the list hides the Bin unless asked, and edits cannot change status or origin', () => {
  assert.deepStrictEqual(life.listStatusFilter(undefined), { $ne: 'binned' });
  assert.deepStrictEqual(life.listStatusFilter('all'), { $ne: 'binned' });
  assert.strictEqual(life.listStatusFilter('binned'), 'binned');
  assert.deepStrictEqual(life.listStatusFilter('draft'), { $in: ['draft', 'processing', 'completed', 'failed'] });
  const clean = life.editableFields({ title: 't', status: 'approved', origin: 'manual', userId: 'x', _id: 'y', binnedAt: 1, binnedFrom: 'a', archivedFrom: 'b', approvedAt: 2, contentCalendarId: 'c', calendarDay: 3, calendarWeek: 1, campaignId: 'k', plannedDate: 4, caption: 'c' });
  assert.deepStrictEqual(clean, { title: 't', caption: 'c' });
});

test('every place that creates a Draft says where it came from', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert.match(read('services/backgroundQueue.js'), /origin: 'automation'/);
  assert.match(read('routes/contentCalendar.js'), /origin: 'automation'/);
  const drafts = read('routes/drafts.js');
  assert.ok((drafts.match(/origin: 'manual'/g) || []).length >= 3, 'save, upload-media and generate-image-bg');
  assert.match(read('routes/campaigns.js'), /origin: 'manual'/);
  assert.match(read('routes/carousels.js'), /origin: 'manual'/);
  assert.match(read('routes/videoGeneration.js'), /origin: 'manual'/);
  assert.match(read('services/draftLocalization.js'), /origin: originOf\(source\)/);
});

test('the Draft model knows the new statuses and has no default origin (old rows are read through originOf)', () => {
  const Draft = require('../models/Draft');
  const enumValues = Draft.schema.path('status').enumValues;
  for (const s of ['approved', 'binned']) assert.ok(enumValues.includes(s), s);
  assert.strictEqual(Draft.schema.path('origin').defaultValue, undefined);
  const d = new Draft({ userId: OID(), title: 't', sourceType: 'post' });
  assert.strictEqual(d.origin, undefined);
  for (const p of ['binnedAt', 'binnedFrom', 'archivedFrom', 'approvedAt', 'plannedDate']) assert.ok(Draft.schema.path(p), p);
});

test('a planned date is 10:00 India time on the planned day', () => {
  assert.strictEqual(life.plannedDateFor({ isoDate: '2026-10-21' }).toISOString(), '2026-10-21T04:30:00.000Z');
  assert.strictEqual(life.plannedDateFor({ month: '2026-11', day: 3 }).toISOString(), '2026-11-03T04:30:00.000Z');
  assert.strictEqual(life.plannedDateFor({ month: 'nonsense', day: 3 }), null);
  assert.strictEqual(life.plannedDateFor({ month: '2026-02', day: 31 }), null);
  assert.strictEqual(life.plannedDateFor({}), null);
});

// ---------- Home, campaigns and video posting use the same rules ----------
test('Home "drafts waiting" counts with the same needs-approval filter as the Library badge', () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/homeSummary.js'), 'utf8');
  assert.match(src, /countDocuments\(needsApprovalFilter\(userId\)\)/);
  assert.doesNotMatch(src, /countDocuments\(awaitingFilter\(/);
});

test('the Home summary cache is cleared after every drafts write', () => {
  const src = fs.readFileSync(path.join(__dirname, '../server-main.js'), 'utf8');
  const watch = src.indexOf("app.use('/api', homeCacheWatch)");
  assert.ok(watch > 0 && watch < src.indexOf("app.use('/api/drafts', draftRoutes)"));
});

test('posting a Hero video needs the Publish add-on, checked before the Hero routes', () => {
  const src = fs.readFileSync(path.join(__dirname, '../server-main.js'), 'utf8');
  const gate = src.indexOf("app.post('/api/hero-video/jobs/:jobId/publish', protect, requireFeature('publish'))");
  const mount = src.indexOf("app.use('/api/hero-video'");
  assert.ok(gate > 0 && gate < mount, 'gate before the Hero mount');
  assert.ok(src.indexOf("app.post('/api/video-generation/schedulePost', protect, requireFeature('schedule'))") > 0, 'old reels stay gated');
});

test('campaign publish and scheduling refuse an automation post that is not approved', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/campaigns.js'), 'utf8');
  const pub = src.slice(src.indexOf("router.post('/:id/publish'"), src.indexOf("router.post('/:id/publish'") + 800);
  assert.match(pub, /campaignApprovalBlock\(/);
  const putAt = src.indexOf("router.put('/:id'");
  const put = src.slice(putAt, src.indexOf('\nrouter.', putAt + 10));
  assert.match(put, /campaignApprovalBlock\(/);
  const Draft = fakeModel([
    { userId: OWNER, status: 'completed', origin: 'automation', campaignId: 'C1', sourceType: 'post' },
    { userId: OWNER, status: 'approved', origin: 'automation', campaignId: 'C2', sourceType: 'post' },
    { userId: OWNER, status: 'draft', origin: 'manual', campaignId: 'C3', sourceType: 'post' }
  ]);
  assert.deepStrictEqual(await life.campaignApprovalBlock({ _id: 'C1' }, OWNER, { Draft }), { status: 409, message: 'Approve this post first.' });
  assert.strictEqual(await life.campaignApprovalBlock({ _id: 'C2' }, OWNER, { Draft }), null);
  assert.strictEqual(await life.campaignApprovalBlock({ _id: 'C3' }, OWNER, { Draft }), null);
  assert.strictEqual(await life.campaignApprovalBlock({ _id: 'C9' }, OWNER, { Draft }), null);
});
