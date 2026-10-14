const test = require('node:test');
const assert = require('node:assert');
const { reapStaleDrafts, MESSAGE } = require('../services/staleDrafts');

function fakeDraft(rows) {
  const store = rows.map((r) => ({ ...r }));
  return {
    store,
    find: (q) => ({ limit: async () => store.filter((d) => d.status === q.status && d.updatedAt < q.updatedAt.$lt) }),
    updateOne: async (cond, upd) => {
      const d = store.find((x) => x._id === cond._id && x.status === cond.status);
      if (!d) return { modifiedCount: 0 };
      Object.assign(d, upd.$set);
      return { modifiedCount: 1 };
    },
  };
}

test('unfinished drafts are closed and refunded once; fresh and finished ones are left alone', async () => {
  const NOW = Date.parse('2026-10-14T12:00:00Z');
  const old = new Date(NOW - 60 * 60000);
  const fresh = new Date(NOW - 2 * 60000);
  const Draft = fakeDraft([
    { _id: 'p1', status: 'processing', contentType: 'post', imageUrl: '', userId: 'u1', updatedAt: old },
    { _id: 'c0', status: 'processing', contentType: 'carousel', userId: 'u2', updatedAt: old, carouselSlides: [{ imageUrl: '' }, { imageUrl: '' }, { imageUrl: '' }] },
    { _id: 'c2', status: 'processing', contentType: 'carousel', userId: 'u3', updatedAt: old, carouselSlides: [{ imageUrl: 'https://x/1.jpg' }, { imageUrl: '' }] },
    { _id: 'k1', status: 'processing', contentType: 'campaign', userId: 'u4', updatedAt: old },
    { _id: 'f1', status: 'processing', contentType: 'post', userId: 'u5', updatedAt: fresh },
    { _id: 'd1', status: 'completed', contentType: 'post', userId: 'u6', updatedAt: old },
  ]);
  const refunds = [];
  const refund = async (...a) => refunds.push(a);
  const out = await reapStaleDrafts({ Draft, refund, now: NOW, log: { log() {}, error() {} } });
  assert.strictEqual(out.handled, 4);
  assert.deepStrictEqual(refunds.map((r) => r.slice(0, 3)), [['u1', 'image_generated', 1], ['u2', 'carousel_generated', 3]]);
  assert.strictEqual(Draft.store.find((d) => d._id === 'p1').errorMessage, MESSAGE);
  assert.strictEqual(Draft.store.find((d) => d._id === 'f1').status, 'processing');
  assert.strictEqual(Draft.store.find((d) => d._id === 'd1').status, 'completed');
  const again = await reapStaleDrafts({ Draft, refund, now: NOW, log: { log() {}, error() {} } });
  assert.strictEqual(again.handled, 0);
  assert.strictEqual(refunds.length, 2);
});
