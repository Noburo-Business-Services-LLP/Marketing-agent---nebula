const test = require('node:test');
const assert = require('node:assert');
const { runPlan } = require('../services/blueprint/planner');

const sheet = { facts: [], context: {} };
const input = {};

test('an unusable first answer is asked for once more, then the plan is refused', async () => {
  let calls = 0;
  const origWarn = console.warn; console.warn = () => {};
  try {
    const plan = await runPlan({ sheet, input, direction: null, callLLM: async () => { calls += 1; return '{}'; }, parseJSON: JSON.parse });
    assert.strictEqual(plan, null);
    assert.strictEqual(calls, 2);
  } finally { console.warn = origWarn; }
});
