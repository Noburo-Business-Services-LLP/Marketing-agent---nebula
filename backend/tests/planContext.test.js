const test = require('node:test');
const assert = require('node:assert');
const { planContext, planGuidanceFor } = require('../services/week/planContext');
const { calendarPrompt } = require('../services/contentCalendarService');
const plan = { id: 'p', completedAt: new Date('2026-09-20'), result: { plan: {
  pillars: [{ name: 'Behind the oven' }, { name: 'Custom orders' }, { name: 'Happy tables' }],
  channels: [{ channel: 'Instagram', role: { text: 'Show the cakes.' } }],
  effort: [{ channel: 'Instagram', organicPct: 80, paidPct: 20 }],
  roadmap: [{ phase: 'foundation', focus: { text: 'Set up the basics.' }, actions: [{ text: 'Post three times a week.' }, { text: 'Reply to every comment.' }, { text: 'Third' }] }, { phase: 'storytelling', focus: { text: 'Tell customer stories.' }, actions: [] }, { phase: 'growth', focus: { text: 'Grow reach.' }, actions: [] }]
} } };
test('the phase follows the days since the plan started', () => {
  assert.strictEqual(planContext({ plan, now: new Date('2026-10-05') }).phase, 'foundation');
  assert.strictEqual(planContext({ plan, now: new Date('2026-10-25') }).phase, 'storytelling');
  assert.strictEqual(planContext({ plan, now: new Date('2026-12-30') }).phase, 'growth');
});
test('the guidance text names the themes, channels and the phase focus, and stays short', () => {
  const c = planContext({ plan, now: new Date('2026-10-05') });
  assert.match(c.text, /Behind the oven/);
  assert.match(c.text, /Instagram/);
  assert.match(c.text, /Set up the basics/);
  assert.ok(c.text.length <= 900);
  assert.deepStrictEqual(c.pillars, ['Behind the oven', 'Custom orders', 'Happy tables']);
  assert.doesNotMatch(c.text, /credit|trial|quark/i);
});
test('very long plans still stay within 900 characters', () => {
  const long = JSON.parse(JSON.stringify(plan));
  long.result.plan.pillars = Array.from({ length: 30 }, (_, i) => ({ name: `Theme number ${i} with words` }));
  assert.ok(planContext({ plan: long, now: new Date('2026-10-05') }).text.length <= 900);
});
test('no plan or a broken plan gives null, never an error', () => {
  assert.strictEqual(planContext({ plan: null, now: new Date() }), null);
  assert.strictEqual(planContext({ plan: { result: {} }, now: new Date() }), null);
});
test('a failing plan lookup gives empty guidance', async () => {
  assert.strictEqual(await planGuidanceFor('u', { service: { currentPlan: async () => { throw new Error('down'); } } }), '');
  assert.match(await planGuidanceFor('u', { now: new Date('2026-10-05'), service: { currentPlan: async () => plan } }), /Behind the oven/);
});
test('the calendar prompt is unchanged without guidance and carries it when given', () => {
  const profile = { businessName: 'Oven Co' };
  const old = calendarPrompt(profile, '2026-10', 'English', { planGuidance: '' });
  assert.strictEqual(calendarPrompt(profile, '2026-10', 'English', {}), old);
  assert.strictEqual(calendarPrompt(profile, '2026-10', 'English'), old);
  const withPlan = calendarPrompt(profile, '2026-10', 'English', { planGuidance: 'Plan guidance: themes: X' });
  assert.ok(withPlan.includes('Plan guidance: themes: X'));
  assert.ok(withPlan.indexOf('Plan guidance') < withPlan.indexOf('OUTPUT FORMAT'));
});
