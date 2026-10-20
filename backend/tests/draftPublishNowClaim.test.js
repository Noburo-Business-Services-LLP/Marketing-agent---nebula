// "Post now" takes the per-campaign claim before it sends, answers a plain 409 when the post is already being sent,
// and records only while it still holds the claim. Fakes only: no database, no provider.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { fakeClaimCampaigns } = require('./helpers/fakeClaimCampaigns');

const stub = (rel, exports) => {
  const id = require.resolve(path.join('..', rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
let published = [];
let publisher;
stub('services/campaignPublisher', { publishCampaignToSocial: async (c) => { published.push(String(c._id)); return publisher(c); } });

const Campaign = require('../models/Campaign');
const Draft = require('../models/Draft');
const User = require('../models/User');
const router = require('../routes/drafts');

let C;
let draftSaves;
let draftRow;
const NOW = Date.now();
function setup({ campaign, draft = {} } = {}) {
  published = []; draftSaves = 0;
  publisher = async () => ({ success: true, postId: 'p1', platformPostIds: { instagram: 'ig1' }, data: { ok: true } });
  C = fakeClaimCampaigns(campaign ? [{ _id: 'c1', userId: 'u1', ...campaign }] : []);
  draftRow = { _id: 'd1', userId: 'u1', status: 'approved', title: 't', platforms: ['instagram'], caption: 'x', campaignId: campaign ? 'c1' : undefined, ...draft };
}
// upsert: the real code saves a mongoose document; here a plain object that writes into the fake rows
Campaign.findOne = async (f) => { const r = await C.findOne(f); if (!r) return null; return docOf(r); };
function docOf(r) {
  const doc = { ...r };
  doc.save = async function save() { const { save, ...plain } = this; const row = C.rows.get(String(plain._id)); Object.assign(row, plain); return this; };
  return doc;
}
const RealCampaign = Campaign;
const origCtor = Campaign.prototype.save;
Campaign.prototype.save = async function save() {
  const o = this.toObject({ depopulate: true });
  const id = String(this._id);
  const row = C.rows.get(id) || {};
  Object.assign(row, o, { _id: id });
  C.rows.set(id, row);
  return this;
};
for (const m of ['findOneAndUpdate', 'updateOne']) RealCampaign[m] = (...a) => C[m](...a);
// hasLiveClaim uses findOne with a claim filter: route through the fake matcher for that call only
const plainFindOne = Campaign.findOne;
Campaign.findOne = async (f) => (f && f['publishClaim.until'] ? C.findOne(f) : plainFindOne(f));
User.findById = async () => ({ ayrshare: { profileKey: 'k' } });
Draft.findOne = async () => {
  const d = { ...draftRow };
  d.save = async function save() { draftSaves += 1; const { save, ...plain } = this; Object.assign(draftRow, plain); return this; };
  return d;
};

const layer = router.stack.find((l) => l.route && l.route.path === '/:id/publish');
const handler = layer.route.stack[layer.route.stack.length - 1].handle;
const mkRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const call = async () => {
  const res = mkRes();
  const w = console.warn; const l = console.log; const e = console.error;
  console.warn = () => {}; console.log = () => {}; console.error = () => {};
  try { await handler({ params: { id: 'd1' }, user: { userId: 'u1' }, body: {} }, res); } finally { console.warn = w; console.log = l; console.error = e; }
  return res;
};

test('a free post is claimed, sent once, recorded, the claim cleared, the draft published', async () => {
  setup({ campaign: { status: 'draft', name: 'n', objective: 'awareness', platforms: ['instagram'], creative: {} } });
  const res = await call();
  assert.strictEqual(res.code, 200);
  assert.deepStrictEqual(published, ['c1']);
  const row = C.rows.get('c1');
  assert.strictEqual(row.status, 'posted');
  assert.strictEqual(row.socialPostId, 'p1');
  assert.strictEqual(row.publishClaim, undefined);
  assert.strictEqual(draftRow.status, 'published');
});

test('the scheduler already holds the claim: plain 409, nothing sent, campaign untouched', async () => {
  setup({ campaign: { status: 'scheduled', publishClaim: { by: 'scheduler-x', at: new Date(NOW), until: new Date(NOW + 600e3) } } });
  const res = await call();
  assert.strictEqual(res.code, 409);
  assert.strictEqual(res.body.message, 'This post is already being sent.');
  assert.deepStrictEqual(published, []);
  assert.strictEqual(C.rows.get('c1').status, 'scheduled');
  assert.strictEqual(C.rows.get('c1').publishClaim.by, 'scheduler-x');
});

test('the scheduler claims between the early check and the claim: still a 409', async () => {
  setup({ campaign: { status: 'scheduled', name: 'n', objective: 'awareness', platforms: ['instagram'], creative: {} } });
  const realUser = User.findById;
  User.findById = async () => { // the scheduler wins the race here
    C.rows.get('c1').publishClaim = { by: 'scheduler-y', at: new Date(), until: new Date(Date.now() + 600e3) };
    return { ayrshare: { profileKey: 'k' } };
  };
  try {
    const res = await call();
    assert.strictEqual(res.code, 409);
    assert.deepStrictEqual(published, []);
  } finally { User.findById = realUser; }
});

test('an expired claim does not block Post now', async () => {
  setup({ campaign: { status: 'scheduled', name: 'n', objective: 'awareness', platforms: ['instagram'], creative: {}, publishClaim: { by: 'dead', at: new Date(NOW - 1200e3), until: new Date(NOW - 600e3) } } });
  const res = await call();
  assert.strictEqual(res.code, 200);
  assert.deepStrictEqual(published, ['c1']);
});

test('claim lost while sending: nothing overwritten, the draft is still marked published once', async () => {
  setup({ campaign: { status: 'draft', name: 'n', objective: 'awareness', platforms: ['instagram'], creative: {} } });
  publisher = async () => {
    C.rows.get('c1').publishClaim = { by: 'newer', at: new Date(), until: new Date(Date.now() + 600e3) };
    return { success: true, postId: 'OLD', platformPostIds: {}, data: {} };
  };
  const res = await call();
  assert.strictEqual(res.code, 200);
  const row = C.rows.get('c1');
  assert.notStrictEqual(row.status, 'posted');
  assert.notStrictEqual(row.socialPostId, 'OLD');
  assert.strictEqual(row.publishClaim.by, 'newer');
});

test('a failed send clears the claim so Post now can be pressed again', async () => {
  setup({ campaign: { status: 'draft', name: 'n', objective: 'awareness', platforms: ['instagram'], creative: {} } });
  publisher = async () => ({ success: false, error: 'temporary glitch' });
  const res = await call();
  assert.strictEqual(res.code, 400);
  const row = C.rows.get('c1');
  assert.strictEqual(row.publishClaim, undefined);
  assert.strictEqual(row.status, 'draft');
  assert.strictEqual(row.lastPublishError, 'temporary glitch');
  publisher = async () => ({ success: true, postId: 'p2', platformPostIds: {}, data: {} });
  assert.strictEqual((await call()).code, 200);
  assert.strictEqual(published.length, 2);
});

test('a thrown publisher gives the claim back', async () => {
  setup({ campaign: { status: 'draft', name: 'n', objective: 'awareness', platforms: ['instagram'], creative: {} } });
  publisher = async () => { throw new Error('network down'); };
  const res = await call();
  assert.strictEqual(res.code, 500);
  assert.strictEqual(C.rows.get('c1').publishClaim, undefined);
});

test('the draft published update is idempotent: an already published draft is not saved again', async () => {
  setup({ campaign: { status: 'draft', name: 'n', objective: 'awareness', platforms: ['instagram'], creative: {} }, draft: { status: 'published' } });
  const res = await call();
  assert.strictEqual(res.code, 200);
  assert.strictEqual(draftSaves, 0);
});
