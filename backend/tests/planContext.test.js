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
const { withPlanGuidance } = require('../services/week/planContext');
const fs = require('node:fs');
const path = require('node:path');
test('withPlanGuidance adds guidance only when a plan exists and survives lookup failure', async () => {
  const has = await withPlanGuidance('u', { focus: 'x' }, { now: new Date('2026-10-05'), service: { currentPlan: async () => plan } });
  assert.match(has.planGuidance, /Behind the oven/);
  assert.strictEqual(has.focus, 'x');
  assert.deepStrictEqual(await withPlanGuidance('u', { focus: 'x' }, { service: { currentPlan: async () => null } }), { focus: 'x' });
  assert.deepStrictEqual(await withPlanGuidance('u', {}, { service: { currentPlan: async () => { throw new Error('down'); } } }), {});
});
test('every calendar entry point passes the plan guidance', () => {
  const routes = fs.readFileSync(path.join(__dirname, '../routes/contentCalendar.js'), 'utf8');
  // The content calendar GET is read-only now (performance week 1): two entry points generate, and both pass the guidance.
  assert.strictEqual((routes.match(/generateMonthlyCalendar\(/g) || []).length, 2);
  assert.strictEqual((routes.match(/planGuidance: await planGuidanceFor|await withPlanGuidance\(/g) || []).length, 2);
  const auth = fs.readFileSync(path.join(__dirname, '../routes/auth.js'), 'utf8');
  assert.match(auth, /withPlanGuidance\(user\._id\)\.then\(\(opts\) => generateMonthlyCalendar\(user, null, opts\)\)/);
});
