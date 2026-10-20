'use strict';
const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { compactAnswer, capMessage, isCompact, MARK } = require('../services/providerAnswer');

const big = `data:image/png;base64,${'iVBORw0KGgo'.repeat(300000)}`;

test('an Ayrshare answer keeps every field the readers use', () => {
  const answer = {
    status: 'success', id: 'ay1', refId: 'r1',
    postIds: [{ platform: 'instagram', id: '1789', postUrl: 'https://www.instagram.com/p/abc/', status: 'success' }],
    postUrl: 'https://www.instagram.com/p/abc/', retryCount: 1, retryRequestedAt: '2026-10-20T10:00:00Z',
    errors: [{ platform: 'facebook', code: 156, message: 'Duplicate post' }]
  };
  assert.deepStrictEqual(compactAnswer(answer), answer);
});

test('a base64 picture inside the answer is removed, wherever it is', () => {
  const out = compactAnswer({ error: `Ayrshare rejected media ${big}`, instagramFix: { accountKey: 'k', mediaUrls: [big], videoDebug: { preparedUrl: 'https://res.cloudinary.com/v.mp4' } }, initial: { post: big } });
  const json = JSON.stringify(out);
  assert.ok(json.length < 5000, `compacted to ${json.length}`);
  assert.ok(!/base64,/.test(json));
  assert.strictEqual(out.instagramFix.accountKey, 'k');
  assert.strictEqual(out.instagramFix.mediaUrls[0], MARK);
  assert.strictEqual(out.instagramFix.videoDebug.preparedUrl, 'https://res.cloudinary.com/v.mp4');
  assert.ok(out.error.startsWith('Ayrshare rejected media [inline data removed]'));
});

test('long strings are cut to 500, links up to 2048 kept, arrays capped, depth capped', () => {
  const link = `https://x.test/${'a'.repeat(1500)}`;
  const out = compactAnswer({ message: 'x'.repeat(3000), link, list: Array.from({ length: 100 }, (_, i) => i), deep: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } } });
  assert.strictEqual(out.message.length, 500);
  assert.strictEqual(out.link, link);
  assert.strictEqual(out.list.length, 25);
  assert.strictEqual(out.deep.a.b.c.d.e, '[nested data removed]');
});

test('an answer still over 32 KB keeps only the summary keys', () => {
  const wide = { status: 'error', id: 'z', postIds: [{ id: '1', platform: 'x' }] };
  for (let i = 0; i < 55; i++) wide[`k${i}`] = Array.from({ length: 25 }, () => 'y'.repeat(400));
  const out = compactAnswer(wide);
  assert.strictEqual(out.compacted, true);
  assert.strictEqual(out.status, 'error');
  assert.deepStrictEqual(out.postIds, [{ id: '1', platform: 'x' }]);
  assert.strictEqual(out.k1, undefined);
  assert.ok(JSON.stringify(out).length < 32 * 1024);
});

test('capMessage removes data URIs then cuts to 500', () => {
  assert.strictEqual(capMessage(`Upload failed: ${big} (code 400)`), 'Upload failed: [inline data removed] (code 400)');
  assert.strictEqual(capMessage('z'.repeat(900)).length, 500);
  assert.strictEqual(capMessage(null), null);
});

test('isCompact', () => {
  assert.strictEqual(isCompact({ status: 'ok' }), true);
  assert.strictEqual(isCompact({ e: big }), false);
  assert.strictEqual(isCompact('short'), true);
  assert.strictEqual(isCompact(big), false);
});

test('Campaign setters compact publishResult and lastPublishError on documents and update queries', () => {
  const Campaign = require('../models/Campaign');
  const c = new Campaign({ userId: new mongoose.Types.ObjectId(), name: 'c', publishResult: { error: big, postIds: [{ id: '1', platform: 'instagram' }] }, lastPublishError: `bad ${big}` });
  assert.strictEqual(c.publishResult.error, MARK);
  assert.deepStrictEqual(c.publishResult.postIds, [{ id: '1', platform: 'instagram' }]);
  assert.strictEqual(c.lastPublishError, 'bad [inline data removed]');
  const q = Campaign.findOneAndUpdate({ _id: c._id }, { $set: { publishResult: { initial: { error: big } }, lastPublishError: 'e'.repeat(2000) } });
  const cast = q._castUpdate(q._update);
  assert.strictEqual(cast.$set.publishResult.initial.error, MARK);
  assert.strictEqual(cast.$set.lastPublishError.length, 500);
  const cleared = new Campaign({ userId: new mongoose.Types.ObjectId(), name: 'c', lastPublishError: null, publishResult: null });
  assert.strictEqual(cleared.lastPublishError, null);
  assert.strictEqual(cleared.publishResult, null);
});

test('Draft errorMessage is capped', () => {
  const Draft = require('../models/Draft');
  const d = new Draft({ userId: new mongoose.Types.ObjectId(), title: 't', sourceType: 'post', errorMessage: `x ${big}` });
  assert.strictEqual(d.errorMessage, 'x [inline data removed]');
});

test('AICampaignHistory keeps only links in generatedImages and compacts sourceResponse', () => {
  const H = require('../models/AICampaignHistory');
  const h = new H({ userId: new mongoose.Types.ObjectId(), organizationId: 'o', generatedImages: [big, 'https://cdn.test/a.png'], sourceResponse: { raw: big, id: 'x' } });
  assert.deepStrictEqual([...h.generatedImages], ['https://cdn.test/a.png']);
  assert.deepStrictEqual(h.sourceResponse, { raw: MARK, id: 'x' });
});

test('AIContentPerformance assets keep links only (the Performance view only uses https links)', () => {
  const P = require('../models/AIContentPerformance');
  const p = new P({ userId: new mongoose.Types.ObjectId(), organizationId: 'o', assets: { images: [big, 'https://cdn.test/a.png'], thumbnails: [big], videos: ['https://cdn.test/v.mp4'] } });
  assert.deepStrictEqual([...p.assets.images], ['https://cdn.test/a.png']);
  assert.deepStrictEqual([...p.assets.thumbnails], []);
  assert.deepStrictEqual([...p.assets.videos], ['https://cdn.test/v.mp4']);
  const q = P.findOneAndUpdate({}, { $set: { assets: { images: [big], thumbnails: [big], videos: [] } } });
  const cast = q._castUpdate(q._update);
  assert.deepStrictEqual([...cast.$set.assets.images], []);
});
