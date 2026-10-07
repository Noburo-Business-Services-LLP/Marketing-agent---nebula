// The demo seed's usage data must be realistic: real Quark action names, dates that make sense, and a funnel with drop-off.
const test = require('node:test');
const assert = require('node:assert');
const { buildData } = require('../scripts/seed-staff-demo');
const { buildUsage } = require('../services/staff/usage');
const { QUARK_COSTS } = require('../config/apiCosts');

const NOW = new Date('2026-10-07T06:30:00Z').getTime();
const DAY = 86400000;
const data = () => buildData(NOW, 'x'.repeat(60));
const rowsFrom = (list, pick = () => 1) => {
  const m = {};
  list.forEach((x) => { m[x.index] = (m[x.index] || 0) + pick(x); });
  return Object.entries(m).map(([k, n]) => ({ _id: `c${k}`, n }));
};

test('the seed carries campaigns, video, hero, blueprint and inbox records with the fields the Usage page reads', () => {
  const d = data();
  for (const k of ['campaigns', 'videoJobs', 'heroJobs', 'blueprints', 'inbox']) assert.ok(Array.isArray(d[k]) && d[k].length > 0, `${k} missing`);
  assert.ok(d.campaigns.every((c) => c.status === 'posted' && c.publishedAt));
  assert.ok(d.videoJobs.some((j) => j.status === 'completed') && d.videoJobs.some((j) => j.status === 'failed'));
  assert.ok(d.drafts.some((x) => x.imageUrl) && d.drafts.some((x) => x.slides) && d.drafts.some((x) => x.variant));
});

test('every Quark history action in the seed is one the app really writes', () => {
  const { clients } = data();
  const known = (a) => QUARK_COSTS[a] !== undefined || (a.endsWith('_refund') && QUARK_COSTS[a.slice(0, -7)] !== undefined) || ['purchase', 'staff_grant'].includes(a);
  clients.forEach((c) => c.credits.history.forEach((h) => assert.ok(known(h.action), `${c.key}: unknown action ${h.action}`)));
});

test('nothing in the usage data is dated in the future or before the account existed', () => {
  const d = data();
  const created = (i) => d.clients[i].createdAt.getTime();
  const check = (label, i, at) => { assert.ok(at.getTime() <= NOW, `${label} in the future`); assert.ok(at.getTime() >= created(i), `${label} before sign-up (client ${i})`); };
  d.campaigns.forEach((c) => check('campaign', c.index, c.publishedAt));
  d.videoJobs.forEach((j) => check('video', j.index, j.createdAt));
  d.heroJobs.forEach((j) => check('hero', j.index, j.createdAt));
  d.blueprints.forEach((j) => check('blueprint', j.index, j.createdAt));
  d.inbox.forEach((m) => check('inbox', m.index, m.generatedAt));
  d.drafts.forEach((x) => check('draft', x.index, x.createdAt));
  d.clients.forEach((c) => c.credits.history.forEach((h) => check('quark history', c.index, h.createdAt)));
});

test('the Usage numbers computed from the seed are worth looking at, and hidden accounts are left out', () => {
  const d = data();
  const users = d.clients.map((c) => ({ ...c, _id: `c${c.index}` }));
  const since = NOW - 30 * DAY;
  const usage = {
    images: rowsFrom(d.drafts.filter((x) => x.createdAt.getTime() >= since && !x.variant), (x) => (x.slides ? x.slides : x.imageUrl ? 1 : 0)),
    postsDrafted: rowsFrom(d.drafts.filter((x) => x.createdAt.getTime() >= since && !x.variant)),
    postsPublished: rowsFrom(d.campaigns.filter((c) => c.publishedAt.getTime() >= since)),
    videos: rowsFrom(d.videoJobs.filter((j) => j.status === 'completed' && j.createdAt.getTime() >= since)),
    heroVideos: rowsFrom(d.heroJobs.filter((j) => j.status === 'completed' && j.createdAt.getTime() >= since)),
    blueprints: rowsFrom(d.blueprints.filter((j) => j.status === 'completed' && j.createdAt.getTime() >= since)),
    repliesDrafted: rowsFrom(d.inbox.filter((m) => m.generatedAt.getTime() >= since))
  };
  const contentIds = [...new Set([...d.drafts, ...d.videoJobs].map((x) => `c${x.index}`))];
  const publishedIds = [...new Set(d.campaigns.map((c) => `c${c.index}`))];
  const u = buildUsage({ users, usage, funnelData: { contentIds, publishedIds }, window: 90, level: 'full', now: NOW });
  u.featureUse.items.forEach((i) => assert.ok(i.count > 0 && i.clients > 0, `${i.key} empty`));
  const counts = u.funnel.steps.map((s) => s.count);
  assert.ok(counts[0] > 20);
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i] <= counts[i - 1] && counts[i] > 0, `funnel not shrinking at ${i}: ${counts}`);
  assert.ok(counts[counts.length - 1] < counts[0] / 2, 'paid should be a clear drop');
  assert.ok(u.quarks.categories.every((c) => c.quarks > 0), 'every Quark group has spend');
  assert.ok(u.quarks.possiblyIncompleteClients >= 1);
  // hidden test accounts have usage rows in the seed, yet are not counted
  const hiddenWithUse = d.drafts.some((x) => x.index >= 60);
  assert.ok(hiddenWithUse, 'seed should give hidden accounts some use so the exclusion is exercised');
  const withHidden = JSON.stringify(rowsFrom(d.drafts.filter((x) => x.index >= 60)));
  assert.notStrictEqual(withHidden, '[]');
});
