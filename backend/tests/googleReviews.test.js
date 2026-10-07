const test = require('node:test');
const assert = require('node:assert');
const g = require('../services/googleReviews');

test('every spelling of Google Business Profile maps to gmb', () => {
  for (const n of ['gmb', 'google', 'GoogleBusiness', 'google business profile', 'google_business']) assert.strictEqual(g.toAyrsharePlatform(n), 'gmb');
  assert.strictEqual(g.toAyrsharePlatform('Instagram'), 'instagram');
  assert.strictEqual(g.toAyrsharePlatform('X'), 'twitter');
  assert.strictEqual(g.toAyrsharePlatform('twitter'), 'twitter');
});

test('reviews are normalised from number and word ratings and reply state', () => {
  const out = g.normalizeReviews({ reviews: [
    { id: 'a', rating: 5, review: 'Lovely', reviewer: { displayName: 'Priya' }, created: '2026-10-01' },
    { id: 'b', starRating: 'TWO', comment: 'Late', reviewer: 'Sam', reviewReply: { comment: 'Sorry' } },
    { rating: 4 }
  ] });
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual([out[0].rating, out[0].reviewer, out[0].replied], [5, 'Priya', false]);
  assert.deepStrictEqual([out[1].rating, out[1].replied, out[1].existingReply], [2, true, 'Sorry']);
});

test('ratings of three or less always need a person to approve', () => {
  assert.strictEqual(g.needsHumanApproval({ rating: 3 }), true);
  assert.strictEqual(g.needsHumanApproval({ rating: 1 }), true);
  assert.strictEqual(g.needsHumanApproval({ rating: 5 }), false);
});

test('the reply prompt forbids invented facts and carries the review', () => {
  const p = g.buildReplyPrompt({ review: { reviewer: 'Priya', rating: 1, text: 'Cold food' }, business: { name: 'Cafe Aroma' } });
  assert.match(p, /Cafe Aroma/);
  assert.match(p, /Never invent facts/);
  assert.match(p, /Cold food/);
});

test('fetchReviews asks for gmb with the profile key and reports provider errors plainly', async () => {
  let seen;
  const ok = await g.fetchReviews({ profileKey: 'PK', apiKey: 'K', fetchImpl: async (u, o) => { seen = { u, o }; return { ok: true, json: async () => ({ averageRating: 4.5, totalReviewCount: 2, reviews: [{ id: 'x', rating: 5, review: 'Great' }] }) }; } });
  assert.match(seen.u, /reviews\?platform=gmb$/);
  assert.strictEqual(seen.o.headers['Profile-Key'], 'PK');
  assert.strictEqual(ok.success, true);
  assert.strictEqual(ok.reviews.length, 1);
  const bad = await g.fetchReviews({ apiKey: 'K', fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ status: 'error' }) }) });
  assert.strictEqual(bad.success, false);
  assert.strictEqual(bad.reason, 'provider_error');
  const none = await g.fetchReviews({ apiKey: '' , fetchImpl: async () => { throw new Error('should not be called'); } });
  assert.strictEqual(none.reason, 'not_configured');
});

test('draftReply trims quotes from the model output', async () => {
  const text = await g.draftReply({ review: { reviewer: 'A', rating: 5, text: 'Nice' }, business: {}, llm: async () => '  "Thank you, Priya!"  ' });
  assert.strictEqual(text, 'Thank you, Priya!');
});
