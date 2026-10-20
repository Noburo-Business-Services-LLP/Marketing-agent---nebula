// Status sync and the publish claim: the sync reconciles a crashed claim by reading the provider (it never posts for it),
// and its one send (the Instagram video rebuild) takes the same claim as the scheduler. Fakes only.
const test = require('node:test');
const assert = require('node:assert');
const { fakeClaimCampaigns } = require('./helpers/fakeClaimCampaigns');
const { syncPastDueCampaign } = require('../services/campaignStatusSync');

const NOW = new Date('2026-10-20T10:00:00Z');
const quiet = async (fn) => {
  const l = console.log; const w = console.warn; console.log = () => {}; console.warn = () => {};
  try { return await fn(); } finally { console.log = l; console.warn = w; }
};
const mkRow = (extra = {}) => ({
  _id: 'c1', userId: 'u1', name: 'Post', status: 'scheduled', scheduledFor: new Date(NOW - 3600e3), socialPostId: 'ayr-1',
  platforms: ['instagram'], ...extra
});
function deps(C, { status, publishes = [], rebuild } = {}) {
  return {
    Campaign: C,
    getPostStatus: async () => ({ success: true, data: status }),
    retryAyrsharePost: async () => ({ success: false }),
    publishCampaignToSocial: async (c) => { publishes.push(c._id); if (rebuild) return rebuild(c); throw new Error('must not post here'); },
    classifyInstagramPublishFailure: () => null,
    extractFacebookPostIdFromAyrsharePayload: () => '',
    markLinkedDraftPosted: async () => {}
  };
}
const stale = { by: 'scheduler-dead', at: new Date(NOW - 1200e3), until: new Date(NOW - 600e3) };

test('a crash after the provider call left a stale claim: the sync reads the provider, marks posted, and posts nothing', async () => {
  const C = fakeClaimCampaigns([mkRow({ publishClaim: stale })]);
  const publishes = [];
  const r = await quiet(() => syncPastDueCampaign({ ...C.rows.get('c1') }, { now: NOW, deps: deps(C, { status: { status: 'success' }, publishes }) }));
  assert.strictEqual(r, 'posted');
  assert.strictEqual(C.rows.get('c1').status, 'posted');
  assert.deepStrictEqual(publishes, []);
});

test('provider says still pending: the crashed row is left as it is and nothing is posted', async () => {
  const C = fakeClaimCampaigns([mkRow({ publishClaim: stale })]);
  const publishes = [];
  const r = await quiet(() => syncPastDueCampaign({ ...C.rows.get('c1') }, { now: NOW, deps: deps(C, { status: { status: 'scheduled' }, publishes }) }));
  assert.strictEqual(r, 'pending');
  assert.strictEqual(C.rows.get('c1').status, 'scheduled');
  assert.deepStrictEqual(publishes, []);
});

const igVideoFail = { status: 'error', message: 'Cannot process your post at this time', retryAvailable: true };
const videoRow = (extra = {}) => mkRow({ creative: { type: 'video', videoUrl: 'https://x/v.mp4' }, ...extra });

test('Instagram video rebuild takes the claim, posts once, records, and clears the claim', async () => {
  const C = fakeClaimCampaigns([videoRow()]);
  const publishes = [];
  const r = await quiet(() => syncPastDueCampaign({ ...C.rows.get('c1') }, { now: NOW, deps: deps(C, { status: igVideoFail, publishes, rebuild: async () => ({ success: true, postId: 'ayr-2', data: {} }) }) }));
  assert.strictEqual(r, 'posted');
  assert.deepStrictEqual(publishes, ['c1']);
  assert.strictEqual(C.rows.get('c1').status, 'posted');
  assert.strictEqual(C.rows.get('c1').socialPostId, 'ayr-2');
  assert.strictEqual(C.rows.get('c1').publishClaim, undefined);
});

test('Instagram video rebuild while the scheduler holds a live claim: skipped, nothing posted', async () => {
  const live = { by: 'scheduler-x', at: NOW, until: new Date(NOW.getTime() + 600e3) };
  const C = fakeClaimCampaigns([videoRow({ publishClaim: live })]);
  const publishes = [];
  const r = await quiet(() => syncPastDueCampaign({ ...C.rows.get('c1') }, { now: NOW, deps: deps(C, { status: igVideoFail, publishes, rebuild: async () => ({ success: true, postId: 'x', data: {} }) }) }));
  assert.strictEqual(r, 'changed');
  assert.deepStrictEqual(publishes, []);
  assert.strictEqual(C.rows.get('c1').publishClaim.by, 'scheduler-x');
});

test('Instagram video rebuild that fails gives the claim back', async () => {
  const C = fakeClaimCampaigns([videoRow()]);
  await quiet(() => syncPastDueCampaign({ ...C.rows.get('c1') }, { now: NOW, deps: deps(C, { status: igVideoFail, rebuild: async () => ({ success: false, error: 'no' }) }) }));
  assert.strictEqual(C.rows.get('c1').publishClaim, undefined);
});
