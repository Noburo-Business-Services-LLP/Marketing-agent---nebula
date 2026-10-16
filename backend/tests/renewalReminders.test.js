const test = require('node:test');
const assert = require('node:assert');
const rr = require('../services/renewalReminders');
const { chargePaise, PLANS, ADDONS } = require('../config/apiCosts');

const NOW = Date.parse('2026-11-10T06:00:00Z');
const DAY = 86400000;
const user = (over = {}) => ({
  _id: 'u1', email: 'a@example.com', firstName: 'Asha', isActive: true,
  subscription: { status: 'active', nextBillingAt: new Date(NOW + 3 * DAY), cancelAtPeriodEnd: false },
  plan: { tier: 'starter', subscriptions: [{ subscriptionId: 's1', kind: 'plan', key: 'starter', active: true }] },
  ...over
});

test('an account is due three days before the charge, and not earlier or later', () => {
  assert.strictEqual(rr.isDue(user(), NOW), true);
  assert.strictEqual(rr.isDue(user({ subscription: { status: 'active', nextBillingAt: new Date(NOW + 5 * DAY) } }), NOW), false);
  assert.strictEqual(rr.isDue(user({ subscription: { status: 'active', nextBillingAt: new Date(NOW + 1 * DAY) } }), NOW), false);
});

test('no reminder for a plan that is being cancelled, halted, already reminded, or without an email', () => {
  const base = user().subscription;
  assert.strictEqual(rr.isDue(user({ subscription: { ...base, cancelAtPeriodEnd: true } }), NOW), false);
  assert.strictEqual(rr.isDue(user({ subscription: { ...base, status: 'halted' } }), NOW), false);
  assert.strictEqual(rr.isDue(user({ subscription: { ...base, reminderForBillingAt: base.nextBillingAt } }), NOW), false);
  assert.strictEqual(rr.isDue(user({ email: '' }), NOW), false);
  assert.strictEqual(rr.isDue(user({ plan: { tier: 'managed', subscriptions: [] } }), NOW), false);
});

test('the amount is the plan plus every active add-on, with GST', () => {
  const u = user({ plan: { tier: 'starter', subscriptions: [
    { kind: 'plan', key: 'starter', active: true }, { kind: 'addon', key: 'publish', active: true }, { kind: 'addon', key: 'inbox', active: false }] } });
  assert.strictEqual(rr.nextChargePaise(u), chargePaise(PLANS.starter.inr) + chargePaise(ADDONS.publish.inr));
});

test('the email names the plan, the date and the amount, says how to stop, and follows the voice rules', () => {
  const m = rr.buildReminderEmail({ user: user() });
  assert.match(m.subject, /Your Nebulaa Starter plan renews on 13 November 2026/);
  assert.match(m.text, /₹1,178\.82, including GST/);
  assert.match(m.text, /Settings, then Billing, and choose Cancel plan/);
  assert.match(m.text, /^Hello Asha,/);
  assert.ok(!/[!—–]/.test(`${m.subject}${m.text}`), 'no exclamation marks or dashes');
  assert.ok(!/credit|trial|migrat|production/i.test(`${m.subject}${m.text}`), 'forbidden words');
});

test('the runner sends one reminder per month: a second run sends nothing', async () => {
  const docs = [user()];
  const User = {
    find: () => ({ select: () => ({ limit: () => ({ lean: async () => docs.map((d) => JSON.parse(JSON.stringify(d), (k, v) => (k === 'nextBillingAt' || k === 'reminderForBillingAt' ? new Date(v) : v))) }) }) }),
    findOneAndUpdate: async (q, u) => {
      const d = docs.find((x) => x._id === q._id);
      const have = d.subscription.reminderForBillingAt && new Date(d.subscription.reminderForBillingAt).getTime();
      if (have === new Date(d.subscription.nextBillingAt).getTime()) return null;
      Object.assign(d.subscription, { reminderForBillingAt: u.$set['subscription.reminderForBillingAt'] });
      return d;
    },
    updateOne: async () => ({})
  };
  const sent = [];
  const deps = { User, transport: async (m) => { sent.push(m); return { sent: true }; }, env: {}, logger: { error() {}, log() {} } };
  const a = await rr.runRenewalRemindersOnce({ now: NOW, deps });
  const b = await rr.runRenewalRemindersOnce({ now: NOW + 3600000, deps });
  assert.strictEqual(a.sent, 1);
  assert.strictEqual(b.sent, 0);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].to, 'a@example.com');
});

test('a failed send releases the claim so the next run tries again', async () => {
  const docs = [user()]; let unset = 0;
  const User = {
    find: () => ({ select: () => ({ limit: () => ({ lean: async () => docs }) }) }),
    findOneAndUpdate: async () => docs[0],
    updateOne: async (q, u) => { if (u.$unset) unset += 1; return {}; }
  };
  const deps = { User, transport: async () => { throw new Error('mail down'); }, env: {}, logger: { error() {}, log() {} } };
  const r = await rr.runRenewalRemindersOnce({ now: NOW, deps });
  assert.strictEqual(r.sent, 0);
  assert.strictEqual(unset, 1);
});
