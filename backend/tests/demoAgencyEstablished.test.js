// The established demo agency (scripts/demo-agency): pure builders, no database. The wallet must add up per client, every client
// must have history, and nothing customer-facing may use the banned words.
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const build = require('../scripts/demo-agency/build');
const vids = require('../scripts/demo-agency/videos');
const { AGENCY, CLIENTS, TEMPLATES } = require('../scripts/demo-agency/constants');
const { PLANS, AGENCY: AG, QUARK_COSTS } = require('../config/apiCosts');

const O = () => new mongoose.Types.ObjectId();
const NOW = new Date('2026-10-23T10:00:00Z');
const t = build.timeline(NOW);
const made = CLIENTS.map((def, i) => {
  const posts = build.buildClientPosts({ client: def, index: i, userId: O(), t, base: 'http://localhost:5000' });
  const plan = vids.videoPlan({ t, client: def, index: i });
  return { def, id: O(), posts, published: posts.published, videos: plan.map((v) => ({ createdAt: v.at })) };
});

test('six clients, an agency email that cannot be a real person, five monthly charges', () => {
  assert.equal(CLIENTS.length, 6);
  assert.match(AGENCY.email, /^demo-agency[a-z0-9.-]*@example\.test$/);
  assert.equal(t.charges.length, 5);
});

test('every client has published history, scheduled posts and posts waiting for approval, all 4:5', () => {
  for (const c of made) {
    assert.ok(c.published.length >= 10, `${c.def.name} has history`);
    assert.ok(c.posts.drafts.some((d) => d.status === 'scheduled'));
    assert.equal(c.posts.drafts.filter((d) => d.status === 'draft').length, 2);
    assert.ok(c.posts.drafts.every((d) => d.aspectRatio === '4:5'));
    assert.ok(c.published.every((d) => d.publishedAt < NOW));
  }
});

test('the wallet adds up: grants minus spends is the balance, never negative, spends name a client', () => {
  const w = build.buildWallet({ t, ownerId: O(), clients: made });
  let bal = 0;
  for (const r of w.rows) {
    bal += r.quarks;
    assert.ok(r.balanceAfter >= 0);
    if (r.type === 'spend') assert.ok(r.workspace, 'a spend names its client');
  }
  assert.equal(bal, w.credits.balance);
  assert.equal(w.credits.planBalance, w.credits.balance);
  const grant = PLANS.agency.quarks + AG.slot.quarks;
  assert.ok(w.credits.balance > 0 && w.credits.balance < grant);
});

test('post and video counts in the ledger match what exists', () => {
  const w = build.buildWallet({ t, ownerId: O(), clients: made });
  const videoRows = w.rows.filter((r) => r.action === 'studio_video').length;
  assert.equal(videoRows, made.reduce((n, c) => n + c.videos.length, 0));
  const posts = w.rows.filter((r) => r.action === 'image_generated').reduce((n, r) => n - r.quarks, 0) / QUARK_COSTS.image_generated;
  const published = made.reduce((n, c) => n + c.published.length, 0);
  assert.ok(posts >= published, 'pictures made cover every published post');
});

test('billing history has the plan every month and the extra client slot from the third charge', () => {
  const pay = build.buildPayments(t);
  assert.equal(pay.filter((p) => /Agency/.test(p.item)).length, 5);
  assert.equal(pay.filter((p) => /extra client/.test(p.item)).length, 3);
});

test('client social keys start with demo- so the provider is never called', () => {
  for (const def of CLIENTS) assert.match(build.ayrshareFor(def, t, '').profileKey, /^demo-/);
});

test('no banned words in anything a customer reads', () => {
  const banned = /\b(credit|credits|trial|7 days|gemini|openai|fal\.ai|ayrshare|razorpay)\b/i;
  for (const def of CLIENTS) {
    for (const [i, tpl] of TEMPLATES.entries()) {
      const w = tpl(def, def.items[i % 6], def.items[(i + 1) % 6]);
      assert.ok(!banned.test(`${w.head} ${w.sub} ${w.cap}`), `${def.name} template ${i}`);
    }
    assert.ok(!banned.test(JSON.stringify(def)));
  }
});
