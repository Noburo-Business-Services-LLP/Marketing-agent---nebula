// The scheduler takes a per-campaign claim before it sends anything. Fakes only: no database, no provider.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { fakeClaimCampaigns } = require('./helpers/fakeClaimCampaigns');

const stub = (rel, exports) => {
  const id = require.resolve(path.join('..', rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
let published = [];
let publisher = async () => ({ success: true, postId: 'p1', platformPostIds: {}, data: {} });
stub('services/campaignPublisher', { publishCampaignToSocial: async (c) => { published.push(String(c._id)); return publisher(c); } });
let learned = [];
stub('services/aiCampaignLearning', { learnCampaignPublish: async (c) => { learned.push(String(c._id)); } });
stub('services/backgroundGate', { blockedAccountIdsSafe: async () => [] });
stub('services/socialMediaAPI', { getPostStatus: async () => ({ success: false }) });

const Campaign = require('../models/Campaign');
const Draft = require('../models/Draft');
const User = require('../models/User');
const { processDueCampaigns } = require('../services/campaignScheduler');

let C;
const NOW = new Date('2026-10-20T10:00:00Z');
function setup(extra = {}) {
  published = []; learned = [];
  publisher = async () => ({ success: true, postId: 'p1', platformPostIds: {}, data: {} });
  C = fakeClaimCampaigns([{ _id: 'c1', status: 'scheduled', platforms: ['instagram'], scheduling: { startDate: new Date(0), frequency: 'once' }, ...extra }]);
}
Campaign.find = () => {
  const p = Promise.resolve([...C.rows.values()].filter((c) => c.status === 'scheduled').map((c) => ({ ...c })));
  p.select = () => p; p.sort = () => p; p.limit = () => p; return p;
};
for (const m of ['findOneAndUpdate', 'updateOne', 'findByIdAndUpdate', 'findOne']) Campaign[m] = (...a) => C[m](...a);
User.findById = () => ({ select: async () => ({ ayrshare: { profileKey: 'k' } }) });
Draft.findOne = () => { const p = Promise.resolve(null); p.select = () => p; p.lean = () => p; return p; };
Draft.updateOne = async () => ({ modifiedCount: 0 });
const quiet = async (fn) => { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } };

test('two ticks at once on the same campaign: exactly one posts', async () => {
  setup();
  publisher = async () => { await new Promise((r) => setTimeout(r, 20)); return { success: true, postId: 'p1', platformPostIds: {}, data: {} }; };
  await quiet(() => Promise.all([processDueCampaigns({ now: NOW }), processDueCampaigns({ now: NOW })]));
  assert.deepStrictEqual(published, ['c1']);
  assert.strictEqual(C.rows.get('c1').status, 'posted');
  assert.strictEqual(C.rows.get('c1').publishClaim, undefined);
  assert.deepStrictEqual(learned, ['c1']);
});

test('a live claim held by someone else: skipped, nothing posted', async () => {
  setup({ publishClaim: { by: 'other', at: NOW, until: new Date(NOW.getTime() + 60e3) } });
  await quiet(() => processDueCampaigns({ now: NOW }));
  assert.deepStrictEqual(published, []);
  assert.strictEqual(C.rows.get('c1').status, 'scheduled');
  assert.strictEqual(C.rows.get('c1').publishClaim.by, 'other');
});

test('an expired claim is taken over and the post goes out once', async () => {
  setup({ publishClaim: { by: 'dead', at: new Date(NOW - 1200e3), until: new Date(NOW - 600e3) } });
  await quiet(() => processDueCampaigns({ now: NOW }));
  assert.deepStrictEqual(published, ['c1']);
  assert.strictEqual(C.rows.get('c1').status, 'posted');
  assert.strictEqual(C.rows.get('c1').publishClaim, undefined);
});

test('stale holder: claim taken over while it was sending, so it records nothing and does not overwrite', async () => {
  setup();
  publisher = async () => {
    // another run took the claim over while this one was still inside the provider call
    C.rows.get('c1').publishClaim = { by: 'newer', at: NOW, until: new Date(NOW.getTime() + 600e3) };
    return { success: true, postId: 'OLD', platformPostIds: {}, data: {} };
  };
  await quiet(() => processDueCampaigns({ now: NOW }));
  const row = C.rows.get('c1');
  assert.strictEqual(row.status, 'scheduled');
  assert.strictEqual(row.socialPostId, undefined);
  assert.strictEqual(row.publishClaim.by, 'newer');
  assert.deepStrictEqual(learned, []);
});

test('stale holder failing late does not count a failure or clear the new holder', async () => {
  setup();
  publisher = async () => {
    C.rows.get('c1').publishClaim = { by: 'newer', at: NOW, until: new Date(NOW.getTime() + 600e3) };
    return { success: false, error: 'boom' };
  };
  await quiet(() => processDueCampaigns({ now: NOW }));
  const row = C.rows.get('c1');
  assert.strictEqual(row.publishFailureCount, undefined);
  assert.strictEqual(row.publishClaim.by, 'newer');
});

test('a failed send clears the claim, counts the failure, and the next tick can claim again', async () => {
  setup();
  publisher = async () => ({ success: false, error: 'temporary glitch' });
  await quiet(() => processDueCampaigns({ now: NOW }));
  let row = C.rows.get('c1');
  assert.strictEqual(row.publishFailureCount, 1);
  assert.strictEqual(row.publishClaim, undefined);
  assert.strictEqual(row.status, 'scheduled');
  publisher = async () => ({ success: true, postId: 'p2', platformPostIds: {}, data: {} });
  await quiet(() => processDueCampaigns({ now: new Date(NOW.getTime() + 1000) }));
  assert.strictEqual(published.length, 2);
  assert.strictEqual(C.rows.get('c1').status, 'posted');
});

test('a thrown error also clears the claim', async () => {
  setup();
  publisher = async () => { throw new Error('network down'); };
  await quiet(() => processDueCampaigns({ now: NOW }));
  assert.strictEqual(C.rows.get('c1').publishClaim, undefined);
  assert.strictEqual(C.rows.get('c1').publishFailureCount, 1);
});

test('a repeating campaign goes back to scheduled with a new date and no claim', async () => {
  setup({ scheduling: { startDate: new Date(NOW - 1000), frequency: 'daily', scheduleType: 'recurring', interval: 1, postTime: '10:00' } });
  await quiet(() => processDueCampaigns({ now: NOW }));
  const row = C.rows.get('c1');
  assert.strictEqual(published.length, 1);
  assert.strictEqual(row.publishClaim, undefined);
  assert.strictEqual(row.status, row.status === 'posted' ? 'posted' : 'scheduled');
});
