// The owner's one real planner run (scripts/plan-additions-real-proof.js), proven here with a fake model.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { main, MAX_CALLS } = require('../scripts/plan-additions-real-proof');
const fresh = require('./fixtures/blueprintPlanNew.json');

const sink = () => { const lines = []; return { lines, log: (...a) => lines.push(a.join(' ')), err: (...a) => lines.push(a.join(' ')) }; };
const ENV = { I_APPROVED_ONE_PLAN_RUN: 'yes', OPENAI_API_KEY: 'sk-test-SECRET' };

test('refuses without the approval flag or without a key, and makes no call', async () => {
  let calls = 0; const llm = async () => { calls += 1; return '{}'; };
  assert.strictEqual(await main([], { env: { OPENAI_API_KEY: 'k' }, llm, model: 'm', ...sink() }), 2);
  assert.strictEqual(await main([], { env: { I_APPROVED_ONE_PLAN_RUN: 'yes' }, llm, model: 'm', ...sink() }), 3);
  assert.strictEqual(await main([], { env: { I_APPROVED_ONE_PLAN_RUN: 'YES', OPENAI_API_KEY: 'k' }, llm, model: 'm', ...sink() }), 2);
  assert.strictEqual(calls, 0);
});

test('a good run: one pinned call, the products reach the prompt, the new blocks are printed, the key never is', async () => {
  const s = sink(); const seen = [];
  const llm = async (prompt, opts) => { seen.push({ prompt, opts }); opts.onUsage({ prompt_tokens: 2500, completion_tokens: 4800 }); return JSON.stringify(fresh); };
  const code = await main([], { env: ENV, llm, model: 'test-model', ...s });
  assert.strictEqual(code, 0, s.lines.join('\n'));
  const all = s.lines.join('\n');
  assert.ok(!all.includes('SECRET'));
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0].opts.noFallback, true);
  for (const name of ['Ghee mysore pak', 'Badam halwa', 'Office sweet boxes (a service)', 'From Rs 380 for 250 g', 'City: K K Nagar, Madurai', 'Sells to: both businesses and individual customers']) assert.ok(seen[0].prompt.includes(name), name);
  assert.ok(!seen[0].prompt.includes('625020'));
  assert.match(all, /Calls: 1\. QA passed: true\. Answer cut and repaired: no\./);
  assert.match(all, /Measured tokens: 2500 in, 4800 out/);
  assert.match(all, /Offline \(3\):/);
  assert.match(all, /Numbers to watch \(5\):/);
  assert.match(all, /Enquiries \(You count this\)/);
  const saved = all.match(/no key\): (\S+\.json)/)[1];
  const j = JSON.parse(fs.readFileSync(saved, 'utf8'));
  assert.strictEqual(j.calls, 1); assert.ok(!JSON.stringify(j).includes('SECRET'));
  fs.rmSync(saved, { force: true });
});

test('two unusable answers stop at the planner limit; no third call is ever made', async () => {
  const s = sink(); let calls = 0;
  const llm = async () => { calls += 1; return '{"nothing": true}'; };
  const w = console.warn; console.warn = () => {};
  try { assert.strictEqual(await main([], { env: ENV, llm, model: 'm', ...s }), 5); } finally { console.warn = w; }
  assert.strictEqual(calls, MAX_CALLS);
  assert.match(s.lines.join('\n'), /did not return a usable plan after 2 calls/);
});
