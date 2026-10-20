// Per-campaign publish claim (double-post safety). Fakes only: no database, no provider.
const test = require('node:test');
const assert = require('node:assert');
const { fakeClaimCampaigns } = require('./helpers/fakeClaimCampaigns');
const claims = require('../services/publishClaim');

const T0 = new Date('2026-10-20T10:00:00Z');
const at = (ms) => new Date(T0.getTime() + ms);
const mk = (extra = {}) => fakeClaimCampaigns([{ _id: 'c1', status: 'scheduled', ...extra }]);

test('two concurrent claimers: exactly one wins', async () => {
  const C = mk();
  const [a, b] = await Promise.all([
    claims.claim(C, 'c1', { statuses: ['scheduled'], now: T0 }),
    claims.claim(C, 'c1', { statuses: ['scheduled'], now: T0 })
  ]);
  assert.strictEqual([a, b].filter((x) => x.claimed).length, 1);
  assert.ok(C.rows.get('c1').publishClaim.by);
});

test('the claim lasts PUBLISH_CLAIM_MS (default 10 minutes) and is configurable', async () => {
  const C = mk();
  const r = await claims.claim(C, 'c1', { statuses: ['scheduled'], now: T0 });
  assert.strictEqual(C.rows.get('c1').publishClaim.until.getTime() - T0.getTime(), 10 * 60 * 1000);
  assert.strictEqual(claims.claimMs({ PUBLISH_CLAIM_MS: '90000' }), 90000);
  assert.strictEqual(claims.claimMs({ PUBLISH_CLAIM_MS: 'abc' }), 600000);
  assert.ok(r.token);
});

test('wrong status: no claim', async () => {
  const C = mk({ status: 'posted' });
  assert.strictEqual((await claims.claim(C, 'c1', { statuses: ['scheduled'], now: T0 })).claimed, false);
});

test('expired claim can be taken over; a live one cannot', async () => {
  const C = mk();
  const first = await claims.claim(C, 'c1', { statuses: ['scheduled'], now: T0 });
  assert.strictEqual((await claims.claim(C, 'c1', { statuses: ['scheduled'], now: at(5 * 60e3) })).claimed, false);
  const second = await claims.claim(C, 'c1', { statuses: ['scheduled'], now: at(11 * 60e3) });
  assert.strictEqual(second.claimed, true);
  assert.strictEqual(second.tookOver, true);
  assert.notStrictEqual(first.token, second.token);
});

test('a stale holder finishing late cannot overwrite the new holder, and the new holder still can', async () => {
  const C = mk();
  const first = await claims.claim(C, 'c1', { statuses: ['scheduled'], now: T0 });
  const second = await claims.claim(C, 'c1', { statuses: ['scheduled'], now: at(11 * 60e3) });
  assert.strictEqual(await claims.finish(C, 'c1', first.token, { status: 'posted', socialPostId: 'old' }), false);
  assert.strictEqual(C.rows.get('c1').status, 'scheduled');
  assert.strictEqual(C.rows.get('c1').socialPostId, undefined);
  assert.strictEqual(await claims.fail(C, 'c1', first.token, { lastPublishError: 'late' }), false);
  assert.strictEqual(await claims.finish(C, 'c1', second.token, { status: 'posted', socialPostId: 'new' }), true);
  const row = C.rows.get('c1');
  assert.strictEqual(row.status, 'posted');
  assert.strictEqual(row.socialPostId, 'new');
  assert.strictEqual(row.publishClaim, undefined);
});

test('a failure clears the claim so a retry can claim again', async () => {
  const C = mk();
  const a = await claims.claim(C, 'c1', { statuses: ['scheduled'], now: T0 });
  assert.strictEqual(await claims.fail(C, 'c1', a.token, { lastPublishError: 'boom', publishFailureCount: 1 }), true);
  assert.strictEqual(C.rows.get('c1').publishClaim, undefined);
  assert.strictEqual((await claims.claim(C, 'c1', { statuses: ['scheduled'], now: at(1000) })).claimed, true);
});

test('release gives the claim back without writing anything else', async () => {
  const C = mk();
  const a = await claims.claim(C, 'c1', { statuses: ['scheduled'], now: T0 });
  await claims.release(C, 'c1', a.token);
  assert.strictEqual(C.rows.get('c1').publishClaim, undefined);
  assert.strictEqual(C.rows.get('c1').status, 'scheduled');
});

test('hasLiveClaim sees a live claim and ignores an expired one', async () => {
  const C = mk();
  await claims.claim(C, 'c1', { statuses: ['scheduled'], now: T0 });
  assert.strictEqual(await claims.hasLiveClaim(C, 'c1', at(1000)), true);
  assert.strictEqual(await claims.hasLiveClaim(C, 'c1', at(11 * 60e3)), false);
});
