### Task 4: The calendar follows the plan

**Files:**
- Create: `backend/services/week/planContext.js`
- Modify: `backend/services/contentCalendarService.js` (`calendarPrompt` and `generateMonthlyCalendar`: add the plan block when a plan exists)
- Test: `backend/tests/planContext.test.js`

**Interfaces:**
- `planContext({ plan, now }): { pillars, channelMix, phase, focus, text } | null` (pure): from `plan.result.plan` and the plan's start date (`completedAt`): `phase` = `foundation` (days 1 to 30 since the plan's first run for this account), `storytelling` (31 to 60), `growth` (61 and later, capped at growth); `pillars` = the plan's pillar names; `channelMix` = `effort` rows (`channel`, `organicPct`) or channels with roles when no effort; `focus` = that phase's roadmap `focus.text` and the first two `actions`; `text` = a short instruction block (max 900 characters) for the calendar prompt: "Plan guidance: themes: …; channels: …; this month's phase: … focus: …; keep every idea inside these themes." Returns null when `plan` is null or malformed.
- `generateMonthlyCalendar` accepts `{ planGuidance }` (string) and puts it in the prompt through `calendarPrompt`; the caller loads the plan via `planService.currentPlan(userId)` and `planContext`. No plan → identical prompt to today (a test pins this).

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/planContext.test.js
const test = require('node:test');
const assert = require('node:assert');
const { planContext } = require('../services/week/planContext');
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
});
test('no plan or a broken plan gives null, never an error', () => {
  assert.strictEqual(planContext({ plan: null, now: new Date() }), null);
  assert.strictEqual(planContext({ plan: { result: {} }, now: new Date() }), null);
});
```
Add a second test file section in the same file for the prompt: `calendarPrompt(profile, month, '', {})` equals the old output when no `planGuidance` is passed (compute the old output once in the test by calling with an explicit empty guidance and compare equal), and contains the guidance when passed.

- [ ] **Step 2: Run to verify it fails.** **Step 3: Implement** `planContext.js` (pure) and the small additions to `calendarPrompt` (append the guidance block before the output-format instructions; read the function first and keep every existing line) and `generateMonthlyCalendar` (accept `planGuidance`, pass through). Wire the callers in `routes/contentCalendar.js` (`generate-next`, `regenerate`) and `processAutoGeneration` only where a calendar is generated: load the plan with `planService.currentPlan` inside try/catch (a plan lookup failure must never block calendar generation). **Step 4: Run the test, then the full backend suite. Step 5: Commit** — `git add backend && git commit -m "Calendar: monthly content follows the plan's themes, channels and phase"`

---

