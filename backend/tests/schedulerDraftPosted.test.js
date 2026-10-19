// The scheduler marks the linked Draft posted, and never sends binned/archived/unapproved posts. Fakes only.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const stub = (rel, exports) => {
  const id = require.resolve(path.join('..', rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
let publishResult = { success: true, postId: 'p1', platformPostIds: { facebook: '123456_654321' }, data: {} };
let published = [];
stub('services/campaignPublisher', { publishCampaignToSocial: async (c) => { published.push(String(c._id)); return publishResult; } });
stub('services/aiCampaignLearning', { learnCampaignPublish: async () => {} });
stub('services/backgroundGate', { blockedAccountIdsSafe: async () => [] });
stub('services/socialMediaAPI', { getPostStatus: async () => ({ success: false }) });

const Campaign = require('../models/Campaign');
const Draft = require('../models/Draft');
const User = require('../models/User');
const { processDueCampaigns } = require('../services/campaignScheduler');

let campaigns, drafts;
function setup({ campaign = {}, draft } = {}) {
  published = [];
  publishResult = { success: true, postId: 'p1', platformPostIds: { facebook: '123456_654321' }, data: {} };
  campaigns = [{ _id: 'c1', status: 'scheduled', platforms: ['instagram', 'facebook'], scheduling: { startDate: new Date(0), frequency: 'once' }, ...campaign }];
  drafts = draft ? [{ _id: 'd1', campaignId: 'c1', ...draft }] : [];
}
Campaign.find = () => {
  const p = Promise.resolve(campaigns.filter((c) => c.status === 'scheduled'));
  p.sort = () => p; p.limit = () => p; return p;
};
Campaign.findByIdAndUpdate = async (id, u) => { const c = campaigns.find((x) => x._id === id); Object.assign(c, u.$set); return c; };
Campaign.updateOne = async (q, u) => { const c = campaigns.find((x) => x._id === q._id && x.status === q.status); if (c) Object.assign(c, u.$set); };
User.findById = () => ({ select: async () => ({ ayrshare: { profileKey: 'k' } }) });
Draft.findOne = (q) => { const d = drafts.find((x) => x.campaignId === q.campaignId); const p = Promise.resolve(d ? { ...d } : null); p.select = () => p; p.lean = () => p; return p; };
Draft.updateOne = async (q, u) => {
  const d = drafts.find((x) => x.campaignId === q.campaignId && q.status.$in.includes(x.status));
  if (d) Object.assign(d, u.$set);
  return { modifiedCount: d ? 1 : 0 };
};

test('success sets the linked draft posted with time and platforms, once', async () => {
  setup({ draft: { status: 'scheduled' } });
  await processDueCampaigns();
  assert.strictEqual(campaigns[0].status, 'posted');
  assert.strictEqual(drafts[0].status, 'published');
  assert.ok(drafts[0].publishedAt instanceof Date);
  assert.deepStrictEqual(drafts[0].publishedPlatforms, ['instagram', 'facebook']);
  const at = drafts[0].publishedAt;
  await processDueCampaigns(); // campaign is posted now, so nothing runs again
  assert.strictEqual(published.length, 1);
  assert.strictEqual(drafts[0].publishedAt, at);
});

test('calling the marker twice changes nothing more', async () => {
  setup({ draft: { status: 'approved' } });
  const { markLinkedDraftPosted } = require('../services/campaignScheduler');
  await markLinkedDraftPosted(campaigns[0], ['instagram'], new Date(1000));
  await markLinkedDraftPosted(campaigns[0], ['facebook'], new Date(2000));
  assert.strictEqual(drafts[0].status, 'published');
  assert.strictEqual(drafts[0].publishedAt.getTime(), 1000);
  assert.deepStrictEqual(drafts[0].publishedPlatforms, ['instagram']);
});

test('a failed post leaves the draft scheduled', async () => {
  setup({ draft: { status: 'scheduled' } });
  publishResult = { success: false, error: 'boom' };
  await processDueCampaigns();
  assert.strictEqual(drafts[0].status, 'scheduled');
  assert.notStrictEqual(campaigns[0].status, 'posted');
});

for (const [name, draft] of [
  ['binned', { status: 'binned' }],
  ['archived', { status: 'archived' }],
  ['unapproved automation', { status: 'draft', origin: 'automation' }],
]) {
  test(`${name} draft is never posted and leaves the schedule`, async () => {
    setup({ draft });
    await processDueCampaigns();
    assert.strictEqual(published.length, 0);
    assert.strictEqual(campaigns[0].status, 'draft');
    assert.strictEqual(drafts[0].status, draft.status);
  });
}

test('campaign with no linked draft still posts', async () => {
  setup({});
  await processDueCampaigns();
  assert.strictEqual(published.length, 1);
  assert.strictEqual(campaigns[0].status, 'posted');
});

test('a repeating campaign keeps its draft scheduled', async () => {
  setup({ draft: { status: 'scheduled' }, campaign: { scheduling: { startDate: new Date(0), frequency: 'daily', scheduleType: 'recurring', interval: 1, postTime: '10:00' } } });
  await processDueCampaigns();
  if (campaigns[0].status === 'scheduled') assert.strictEqual(drafts[0].status, 'scheduled');
});
