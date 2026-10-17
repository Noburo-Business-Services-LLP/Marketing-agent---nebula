const test = require('node:test');
const assert = require('node:assert');
const planner = require('../services/blueprint/planner');
const { PLAN_NEBULAA_CAN } = require('../config/blueprint');

// A minimal evidence sheet and a valid base answer, built from the planner's own test helpers if they exist.
const sheet = { client: { name: 'Sweet Co' }, basis: 'limited', facts: [{ id: 'F1', kind: 'typed', field: 'Offer', text: 'Custom cakes baked to order' }, { id: 'F2', kind: 'page', field: 'About', text: 'Family bakery in Chennai' }], unverified: [] };
const base = () => ({
  promise: { text: 'More enquiries for custom cakes.', tag: 'proposed' },
  positioning: { audience: [{ text: 'Families in Chennai', tag: 'inference', factIds: ['F2'] }], territory: { name: 'Baked to order', rationale: { text: 'Fresh, made for you.', tag: 'proposed' } }, line: { text: 'Cakes made for your day.', tag: 'proposed' } },
  pillars: ['Behind the oven', 'Custom orders', 'Happy tables', 'Seasonal'].map((n) => ({ name: n, why: { text: 'It shows the work.', tag: 'proposed' }, example: { text: 'A cake being finished.', tag: 'proposed' } })),
  calendar: Array.from({ length: 24 }, (_, i) => ({ day: i + 1, pillar: ['Behind the oven', 'Custom orders', 'Happy tables', 'Seasonal'][i % 4], format: 'image post', hook: { text: 'A cake for your day.', tag: 'proposed' } })),
  channels: [{ channel: 'Instagram', priority: 1, role: { text: 'Show the cakes.', tag: 'proposed' } }, { channel: 'WhatsApp', priority: 2, role: { text: 'Take orders.', tag: 'proposed' } }],
  roadmap: [{ phase: 'foundation', focus: { text: 'Set up.', tag: 'proposed' }, actions: [{ text: 'Post three times a week.', tag: 'proposed' }], measure: [{ text: 'Enquiries.', tag: 'proposed' }] }, { phase: 'storytelling', focus: { text: 'Tell stories.', tag: 'proposed' }, actions: [], measure: [] }, { phase: 'growth', focus: { text: 'Grow.', tag: 'proposed' }, actions: [], measure: [] }],
  firstSteps: [{ text: 'Post today.', tag: 'proposed' }]
});

test('a good icp block is kept, tagged, and capped at four lines a list', () => {
  const p = base();
  p.icp = { who: [{ text: 'Families in Chennai who order for birthdays', tag: 'inference', factIds: ['F2'] }], pains: ['Too little time', 'Unsure who to trust', 'Late deliveries', 'Plain designs', 'High prices', 'No reminders', 'Limited choice'].map((t) => ({ text: t, tag: 'proposed' })), where: [{ text: 'Instagram and WhatsApp groups', tag: 'proposed' }], triggers: [{ text: 'A birthday is coming', tag: 'proposed' }] };
  const out = planner.normalisePlan(p, sheet);
  assert.ok(out && out.plan.icp);
  assert.strictEqual(out.plan.icp.pains.length, 4);
  assert.ok(out.plan.icp.who[0].tag === 'inference' || out.plan.icp.who[0].tag === 'proposed');
});

test('effort rows keep only channels in the channel plan, percentages sum to 100, and Nebulaa only claims what it can do', () => {
  const p = base();
  p.effort = [
    { channel: 'Instagram', organicPct: 80, paidPct: 20, nebulaaDoes: ['posts', 'videos', 'telepathy'], youDo: [{ text: 'Reply to DMs the same day.', tag: 'proposed' }] },
    { channel: 'WhatsApp', organicPct: 70, paidPct: 20, nebulaaDoes: ['inbox replies'], youDo: [] },
    { channel: 'LinkedIn', organicPct: 100, paidPct: 0, nebulaaDoes: ['posts'], youDo: [] }
  ];
  const e = planner.normalisePlan(p, sheet).plan.effort;
  const insta = e.find((r) => r.channel === 'Instagram');
  assert.deepStrictEqual(insta.nebulaaDoes, ['posts', 'videos']);
  assert.strictEqual(insta.organicPct + insta.paidPct, 100);
  assert.ok(!e.some((r) => r.channel === 'LinkedIn'), 'LinkedIn is not in the channel plan');
  const wa = e.find((r) => r.channel === 'WhatsApp');
  assert.strictEqual(wa.organicPct + wa.paidPct, 100, 'a row that does not add up is repaired to 100');
  e.forEach((r) => r.nebulaaDoes.forEach((a) => assert.ok(PLAN_NEBULAA_CAN.includes(a), a)));
});

test('a missing or broken icp/effort never fails the plan', () => {
  const out = planner.normalisePlan(base(), sheet);
  assert.ok(out && out.plan);
  assert.strictEqual(out.plan.icp, null);
  assert.deepStrictEqual(out.plan.effort, []);
  const p = base(); p.icp = 'nonsense'; p.effort = [{ channel: 5 }, null, 'x'];
  const again = planner.normalisePlan(p, sheet);
  assert.ok(again && again.plan);
  assert.deepStrictEqual(again.plan.effort, []);
});
