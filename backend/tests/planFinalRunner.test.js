const test = require('node:test');
const assert = require('node:assert');
const runner = require('../services/blueprint/runner');

const gate = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };
const tick = () => new Promise((r) => setImmediate(r));

test('I8: plan runs queue in their own lane, one at a time, and never block the default lane', async () => {
  const g = gate();
  const ran = [];
  runner.enqueue(async () => { ran.push('plan1'); await g.p; }, 1, 'plan');
  runner.enqueue(async () => { ran.push('plan2'); }, 1, 'plan');
  await tick();
  assert.deepStrictEqual(ran, ['plan1'], 'second plan run waits for the first');
  runner.enqueue(async () => { ran.push('paid1'); }, 2);
  runner.enqueue(async () => { ran.push('paid2'); }, 2);
  await tick(); await tick();
  assert.ok(ran.includes('paid1') && ran.includes('paid2'), 'paid runs are not starved by a busy plan lane');
  assert.ok(!ran.includes('plan2'));
  g.open();
  await tick(); await tick();
  assert.ok(ran.includes('plan2'));
  const s = runner._state();
  assert.strictEqual(s.active, 0);
  assert.strictEqual(s.queued, 0);
});

test('I8: the default lane still caps at the given concurrency', async () => {
  const g = gate();
  let running = 0; let peak = 0;
  for (let i = 0; i < 5; i += 1) runner.enqueue(async () => { running += 1; peak = Math.max(peak, running); await g.p; running -= 1; }, 2);
  await tick();
  assert.strictEqual(peak, 2);
  g.open();
  await tick(); await tick(); await tick();
  assert.strictEqual(running, 0);
});
