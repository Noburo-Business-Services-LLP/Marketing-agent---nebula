const test = require('node:test');
const assert = require('node:assert');
const d = require('../services/accountDeletion');
const { erasable } = require('../services/dataRegistry');

const DAY = 86400000;
const NOW = new Date('2026-10-16T06:00:00Z');


// The purge query: pending or failed requests that are due, plus "running" ones whose claim is older than the cutoff.
const dueFilter = (q, x) => x.purgeAfter <= q.purgeAfter.$lte && x.attempts < q.attempts.$lt && q.$or.some((c) => (c.status.$in ? c.status.$in.includes(x.status) : (x.status === c.status && x.runningSince && x.runningSince < c.$or[0].runningSince.$lt)));
const claimMatch = (f, y) => y._id === f._id && (f.status.$in ? f.status.$in.includes(y.status) : (y.status === f.status && (f.runningSince == null ? y.runningSince == null : +y.runningSince === +f.runningSince)));
// ---- small in-memory stand-ins for the collections the service touches
function world(over = {}) {
  const w = { users: [{ _id: 'u1', email: 'asha@example.com', firstName: 'Asha', lastName: 'K', companyName: 'Asha Sweets', ayrshare: { profileKey: 'PK' },
    plan: { tier: 'starter', subscriptions: [{ subscriptionId: 'sub_plan', kind: 'plan', key: 'starter', active: true }, { subscriptionId: 'sub_addon', kind: 'addon', key: 'publish', active: true }] },
    subscription: { status: 'active', razorpaySubscriptionId: 'sub_plan' },
    billingDetails: { gstin: '33ABCDE1234F1Z7', legalName: 'Asha Traders', stateCode: 'TN' },
    payments: [{ razorpayPaymentId: 'pay_1', amount: 1178.82, item: 'Nebulaa subscription', paidAt: new Date('2026-09-20'), invoiceUrl: 'https://z/1' }], ...over.user }],
    campaigns: [{ _id: 'c1', userId: 'u1', status: 'scheduled' }, { _id: 'c2', userId: 'u1', status: 'draft' }],
    deletions: [], retained: [], tombstones: [], staff: [{ client: 'u1' }],
    docs: { Draft: [{ _id: 'd1', userId: 'u1', image: 'https://res.cloudinary.com/x/image/upload/v1/nebula-campaign-posts/a1.jpg' }], StudioVideo: [{ _id: 'v1', user: 'u1', videoUrl: 'https://res.cloudinary.com/x/video/upload/v2/nebula-studio-videos/v1.mp4' }] },
    deletedFiles: [], social: [], mails: [], log: [] };
  const match = (doc, f) => (f.$or ? f.$or.some((x) => match(doc, x)) : Object.entries(f).every(([k, v]) => String(doc[k]) === String(v)));
  const apply = (doc, u) => { for (const [k, v] of Object.entries(u.$set || {})) { const ps = k.split('.'); let c = doc; ps.slice(0, -1).forEach((p) => { c[p] = c[p] || {}; c = c[p]; }); c[ps.at(-1)] = v; } for (const k of Object.keys(u.$unset || {})) { const ps = k.split('.'); let c = doc; ps.slice(0, -1).forEach((p) => { c = c && c[p]; }); if (c) delete c[ps.at(-1)]; } if (u.$push) for (const [k, v] of Object.entries(u.$push)) (doc[k] = doc[k] || []).push(v); if (u.$inc) for (const [k, v] of Object.entries(u.$inc)) doc[k] = (doc[k] || 0) + v; };
  const models = {
    User: { findById: (id) => ({ select: () => ({ lean: async () => w.users.find((u) => u._id === id) || null }) }), updateOne: async (f, u) => { const x = w.users.find((y) => match(y, f)); if (x) apply(x, u); }, deleteOne: async (f) => { w.users = w.users.filter((y) => !match(y, f)); w.log.push('user deleted'); } },
    Campaign: { updateMany: async (f, u) => { w.campaigns.filter((c) => match(c, f)).forEach((c) => apply(c, u)); } },
    AccountDeletion: {
      create: async (doc) => { const x = { _id: `r${w.deletions.length + 1}`, attempts: 0, steps: [], ...doc }; w.deletions.push(x); return x; },
      updateOne: async (f, u) => { const x = w.deletions.find((y) => match(y, f)); if (x) apply(x, u); },
      updateMany: async (f, u) => { w.deletions.filter((y) => (!f.user || y.user === f.user) && (!f.status || y.status === f.status)).forEach((x) => apply(x, u)); },
      find: (q) => ({ limit: () => ({ lean: async () => w.deletions.filter((x) => dueFilter(q, x)) }) }),
      findOneAndUpdate: async (f, u) => { const x = w.deletions.find((y) => claimMatch(f, y)); if (!x) return null; apply(x, u); return x; }
    },
    RetainedPayment: { updateOne: async (f, u, o) => { if (!w.retained.some((r) => r.razorpayPaymentId === f.razorpayPaymentId)) w.retained.push(u.$setOnInsert); } },
    DeletedAccount: { updateOne: async (f, u) => { if (!w.tombstones.some((t) => t.emailHash === f.emailHash)) w.tombstones.push(u.$setOnInsert); } },
    StaffAction: { updateMany: async (f, u) => { w.staff.filter((s) => s.client === f.client).forEach((s) => apply(s, u)); } }
  };
  for (const r of erasable()) {
    const list = () => w.docs[r.model] || [];
    models[r.model] = { ...(models[r.model] || {}),
      find: (f) => ({ lean: () => ({ cursor: async function* () { for (const x of list().filter((y) => match(y, f))) yield x; } }) }),
      deleteMany: async (f) => { const before = list().length; w.docs[r.model] = list().filter((y) => !match(y, f)); return { deletedCount: before - w.docs[r.model].length }; }
    };
  }
  const razorpay = { calls: [], subscriptions: { cancel: async (id, atEnd) => { razorpay.calls.push([id, atEnd]); if (over.cancelFails) throw new Error('gateway down'); } } };
  const deps = { deleteAssets: async (assets) => { w.deletedFiles = assets; return over.filesFail ? { requested: assets.length, failedBatches: 1 } : { requested: assets.length, failedBatches: 0 }; }, deleteSocialProfile: async (k) => { w.social.push(k); return over.socialFails ? { success: false, error: 'boom' } : { success: true }; }, mail: { sendDeleted: async (u) => w.mails.push(['deleted', u.email]) } };
  return { w, models, razorpay, deps };
}
const mail = (w) => ({ sendDeletionRequested: async (u, when) => w.mails.push(['requested', u.email, when]) });

test('who may ask: staff and managed accounts go through support, a pending request is not repeated', () => {
  const ok = d.eligibility({ plan: { tier: 'starter' } }, { isStaff: () => false, resolveTier: () => 'starter' });
  assert.strictEqual(ok.ok, true);
  assert.match(d.eligibility({}, { isStaff: () => true }).message, /Staff accounts/);
  assert.match(d.eligibility({}, { resolveTier: () => 'managed' }).message, /support@nebulaa\.ai/);
  assert.strictEqual(d.eligibility({ deletion: { status: 'pending' } }, {}).already, true);
});

test('asking: billing stops at once, the request waits 14 days, scheduled posts are held, the customer is told', async () => {
  const { w, models, razorpay } = world();
  const out = await d.requestDeletion({ user: w.users[0], models, razorpay, now: NOW, mail: mail(w) });
  assert.strictEqual(out.ok, true);
  assert.deepStrictEqual(razorpay.calls, [['sub_plan', 0], ['sub_addon', 0]], 'cancelled immediately, not at the end of the month');
  assert.strictEqual(+out.purgeAfter, NOW.getTime() + 14 * DAY);
  assert.strictEqual(w.users[0].deletion.status, 'pending');
  assert.deepStrictEqual(w.campaigns.map((c) => c.status), ['paused', 'draft']);
  assert.strictEqual(w.deletions[0].status, 'pending');
  assert.ok(!JSON.stringify(w.deletions[0]).includes('asha@example.com'), 'the request record holds no email');
  assert.strictEqual(w.mails[0][0], 'requested');
});

test('if billing cannot be stopped, nothing changes and the customer is told', async () => {
  const { w, models, razorpay } = world({ cancelFails: true });
  const out = await d.requestDeletion({ user: w.users[0], models, razorpay, now: NOW, mail: mail(w) });
  assert.strictEqual(out.ok, false);
  assert.match(out.message, /nothing was changed/);
  assert.strictEqual(w.deletions.length, 0);
  assert.ok(!w.users[0].deletion);
  assert.strictEqual(w.campaigns[0].status, 'scheduled');
});

test('restoring puts scheduled posts back and clears the request', async () => {
  const { w, models, razorpay } = world();
  await d.requestDeletion({ user: w.users[0], models, razorpay, now: NOW, mail: mail(w) });
  const out = await d.restoreDeletion({ user: w.users[0], models });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(w.users[0].deletion.status, '');
  assert.deepStrictEqual(w.campaigns.map((c) => c.status), ['scheduled', 'draft']);
  assert.strictEqual(w.deletions[0].status, 'restored');
  assert.strictEqual((await d.restoreDeletion({ user: w.users[0], models })).ok, false);
});

test('the purge waits for the 14 days, then erases everything on the list and keeps only what the law requires', async () => {
  const { w, models, razorpay, deps } = world();
  await d.requestDeletion({ user: w.users[0], models, razorpay, now: NOW, mail: mail(w) });
  const early = await d.runPurgeOnce({ models, deps, now: new Date(NOW.getTime() + 13 * DAY) });
  assert.deepStrictEqual(early, { completed: 0, failed: 0 });
  assert.strictEqual(w.users.length, 1);
  const out = await d.runPurgeOnce({ models, deps, now: new Date(NOW.getTime() + 15 * DAY) });
  assert.deepStrictEqual(out, { completed: 1, failed: 0 });
  assert.strictEqual(w.users.length, 0, 'the account is gone');
  assert.deepStrictEqual(w.docs.Draft, []); assert.deepStrictEqual(w.docs.StudioVideo, []);
  assert.deepStrictEqual(w.deletedFiles.map((a) => a.publicId).sort(), ['nebula-campaign-posts/a1', 'nebula-studio-videos/v1']);
  assert.deepStrictEqual(w.social, ['PK']);
  assert.strictEqual(w.retained.length, 1);
  assert.strictEqual(w.retained[0].invoicedTo.gstin, '33ABCDE1234F1Z7');
  assert.ok(+w.retained[0].retainUntil > NOW.getTime() + 7 * 365 * DAY);
  assert.strictEqual(w.tombstones.length, 1);
  assert.ok(!JSON.stringify(w.tombstones).includes('asha@example.com'), 'the tombstone is a one-way hash');
  assert.strictEqual(w.staff[0].client, null, 'the staff log no longer points at the person');
  assert.deepStrictEqual(w.deletions[0].steps.map((s) => s.name), ['keep_payment_records', 'files', 'social_profile', 'data', 'staff_log', 'tombstone', 'account']);
  assert.strictEqual(w.deletions[0].status, 'completed');
  assert.ok(w.mails.some((m) => m[0] === 'deleted'));
});

test('a failure stops the erase before the account goes, is recorded, and the next run carries on without repeating finished steps', async () => {
  const f = world({ filesFail: true });
  await d.requestDeletion({ user: f.w.users[0], models: f.models, razorpay: f.razorpay, now: NOW, mail: mail(f.w) });
  const later = new Date(NOW.getTime() + 15 * DAY);
  let out = await d.runPurgeOnce({ models: f.models, deps: f.deps, now: later, alert: (m) => f.w.log.push(m) });
  assert.deepStrictEqual(out, { completed: 0, failed: 1 });
  assert.strictEqual(f.w.users.length, 1, 'the account is NOT deleted while files remain');
  assert.match(f.w.log.join(' '), /stopped at "files"/);
  assert.strictEqual(f.w.deletions[0].status, 'failed');
  // fixed: the files can now be deleted; the finished payment step is not run again
  f.deps.deleteAssets = async (a) => ({ requested: a.length, failedBatches: 0 });
  out = await d.runPurgeOnce({ models: f.models, deps: f.deps, now: later });
  assert.deepStrictEqual(out, { completed: 1, failed: 0 });
  assert.strictEqual(f.w.retained.length, 1);
  assert.strictEqual(f.w.deletions[0].steps.filter((s) => s.name === 'keep_payment_records').length, 1);
  assert.strictEqual(f.w.users.length, 0);
});

test('a connected-accounts profile that cannot be deleted stops the erase; one already gone does not', async () => {
  const bad = world({ socialFails: true });
  await d.requestDeletion({ user: bad.w.users[0], models: bad.models, razorpay: bad.razorpay, now: NOW, mail: mail(bad.w) });
  assert.deepStrictEqual(await d.runPurgeOnce({ models: bad.models, deps: bad.deps, now: new Date(NOW.getTime() + 15 * DAY) }), { completed: 0, failed: 1 });
  const gone = world();
  gone.deps.deleteSocialProfile = async () => ({ success: false, error: 'Profile not found' });
  await d.requestDeletion({ user: gone.w.users[0], models: gone.models, razorpay: gone.razorpay, now: NOW, mail: mail(gone.w) });
  assert.deepStrictEqual(await d.runPurgeOnce({ models: gone.models, deps: gone.deps, now: new Date(NOW.getTime() + 15 * DAY) }), { completed: 1, failed: 0 });
});

test('hashes are stable, one way, and different for an account and an email', () => {
  assert.strictEqual(d.emailHash('Asha@Example.com '), d.emailHash('asha@example.com'));
  assert.notStrictEqual(d.accountHash('u1'), d.emailHash('u1'));
  assert.match(d.accountHash('u1'), /^[0-9a-f]{64}$/);
  assert.ok(!d.emailHash('asha@example.com').includes('asha'));
});
