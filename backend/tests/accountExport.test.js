const test = require('node:test');
const assert = require('node:assert');
const { buildExport, stripSecrets } = require('../services/accountExport');
const { erasable } = require('../services/dataRegistry');

test('secrets are removed however deep, and ordinary data is kept', () => {
  const out = stripSecrets({ name: 'Asha', password: 'x', otp: { code: '1' }, ayrshare: { profileKey: 'k', title: 'T' }, connectedSocials: [{ platform: 'instagram', accessToken: 't', refreshToken: 'r', accountName: 'asha' }], __v: 3 });
  assert.deepStrictEqual(out, { name: 'Asha', ayrshare: { title: 'T' }, connectedSocials: [{ platform: 'instagram', accountName: 'asha' }] });
});

test('the export holds the account, the payments and every erasable collection that has data, and no secrets', async () => {
  const user = { _id: 'u1', email: 'a@example.com', password: 'HASH', emailKey: 'a@example.com', firstName: 'Asha', payments: [{ amount: 1178.82, razorpayPaymentId: 'pay_1', invoiceUrl: 'https://z/1' }], googleCalendar: { accessToken: 'secret' } };
  const asked = [];
  const mk = (name, docs) => ({ find: (q) => { asked.push([name, q]); return { limit: () => ({ lean: async () => docs }) }; } });
  const models = { Campaign: mk('Campaign', [{ _id: 'c1', userId: 'u1', title: 'Diwali', apiKey: 'zzz' }]), Draft: mk('Draft', []), CsmSession: mk('CsmSession', [{ _id: 's1', client: 'u1' }]) };
  const out = await buildExport('u1', { User: { findById: () => ({ lean: async () => user }) }, models, now: new Date('2026-10-16T00:00:00Z') });
  assert.strictEqual(out.generatedAt, '2026-10-16T00:00:00.000Z');
  assert.strictEqual(out.account.firstName, 'Asha');
  assert.ok(!('password' in out.account) && !('googleCalendar' in out.account) && !('emailKey' in out.account && out.account.emailKey));
  assert.strictEqual(out.payments[0].razorpayPaymentId, 'pay_1');
  assert.deepStrictEqual(Object.keys(out.collections).sort(), ['Campaign', 'CsmSession']);
  assert.ok(!('apiKey' in out.collections.Campaign[0]));
  assert.ok(Array.isArray(out.about) && out.about.length > 3);
  assert.deepStrictEqual(asked.find((a) => a[0] === 'CsmSession')[1], { $or: [{ client: 'u1' }, { csm: 'u1' }] });
  // it only reads the collections the registry says are erasable
  assert.ok(asked.every(([n]) => erasable().some((r) => r.model === n)));
});

test('an unknown account gives nothing, and a very large list is cut with a note', async () => {
  assert.strictEqual(await buildExport('nope', { User: { findById: () => ({ lean: async () => null }) }, models: {} }), null);
  const big = Array.from({ length: 5001 }, (_, i) => ({ _id: i }));
  const out = await buildExport('u1', { User: { findById: () => ({ lean: async () => ({ _id: 'u1', payments: [] }) }) }, models: { Campaign: { find: () => ({ limit: () => ({ lean: async () => big }) }) } } });
  assert.strictEqual(out.collections.Campaign.length, 5000);
  assert.match(out.note, /cut at 5000.*Campaign/);
});
