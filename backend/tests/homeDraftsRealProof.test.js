// The owner's one real run of the Home drafts (scripts/home-drafts-real-proof.js), proven here with a fake model.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { main, MAX_CALLS } = require('../scripts/home-drafts-real-proof');

const sink = () => { const lines = []; return { lines, log: (...a) => lines.push(a.join(' ')), err: (...a) => lines.push(a.join(' ')) }; };
const ENV = { I_APPROVED_HOME_DRAFT_CALLS: 'yes', OPENAI_API_KEY: 'sk-test-SECRET' };
const isCheck = (opts) => String(opts.systemMessage || '').startsWith('You check short social media text');

test('refuses without the approval flag or without a key, and makes no call', async () => {
  let calls = 0; const llm = async () => { calls += 1; return '{}'; };
  assert.strictEqual(await main([], { env: { OPENAI_API_KEY: 'k' }, llm, ...sink() }), 2);
  assert.strictEqual(await main([], { env: { I_APPROVED_HOME_DRAFT_CALLS: 'yes' }, llm, ...sink() }), 3);
  assert.strictEqual(await main([], { env: { I_APPROVED_HOME_DRAFT_CALLS: 'YES', OPENAI_API_KEY: 'k' }, llm, ...sink() }), 2);
  assert.strictEqual(calls, 0);
});

test('a good run: both drafts shown in Tamil and Hindi, the unkind samples refused, the key never printed', async () => {
  const s = sink(); const seen = [];
  const llm = async (prompt, opts) => {
    seen.push(opts);
    if (isCheck(opts)) return /கேவலம்|बकवास/.test(prompt) ? '{"decent":false,"reasons":["insults another shop"]}' : '{"decent":true,"reasons":[]}';
    return /"caption"/.test(opts.systemMessage)
      ? JSON.stringify({ caption: 'शुद्ध घी की मिठाइयाँ, हर सुबह ताज़ा बनाई गईं। इस त्योहार अपनों के साथ मिठास बाँटिए। #मिठाई #त्योहार', imageIdea: 'A tray of fresh ghee sweets on a brass plate by a window.' })
      : JSON.stringify({ comment: 'ரொம்ப அழகான ரீல், பார்த்தாலே இனிப்பு சாப்பிடணும் போல இருக்கு.' });
  };
  const code = await main([], { env: ENV, llm, ...s });
  assert.strictEqual(code, 0);
  const all = s.lines.join('\n');
  assert.ok(!all.includes('SECRET'));
  assert.match(all, /witty_comment in tamil \(witty\): shown, 2 calls/);
  assert.match(all, /response_post in hindi \(friendly\): shown, 2 calls/);
  assert.match(all, /tamil: not decent/); assert.match(all, /hindi: not decent/);
  assert.ok(seen.every((o) => o.noFallback === true && o.jsonMode === true), 'every call is pinned, no fallback');
  assert.ok(seen.filter((o) => !isCheck(o)).every((o) => /Tamil|Hindi/.test(o.systemMessage)));
  const saved = all.match(/no key\): (\S+\.json)/)[1];
  const j = JSON.parse(fs.readFileSync(saved, 'utf8'));
  assert.strictEqual(j.calls, 6); assert.ok(!JSON.stringify(j).includes('SECRET'));
});

test('never more than the call limit, even when every draft is refused; a check that passes an unkind sample fails the run', async () => {
  let calls = 0;
  const refuseAll = async (prompt, opts) => { calls += 1; return isCheck(opts) ? '{"decent":false,"reasons":["no"]}' : JSON.stringify(/"caption"/.test(opts.systemMessage) ? { caption: 'x'.repeat(50), imageIdea: 'A picture idea here.' } : { comment: 'A kind and lovely comment here.' }); };
  const s = sink();
  assert.strictEqual(await main([], { env: ENV, llm: refuseAll, ...s }), 0);
  assert.ok(calls <= MAX_CALLS, `${calls}`);
  assert.match(s.lines.join('\n'), /not shown \(422\)/);
  const passAll = async (prompt, opts) => (isCheck(opts) ? '{"decent":true,"reasons":[]}' : JSON.stringify({ comment: 'A kind and lovely comment here.', caption: 'y'.repeat(50), imageIdea: 'A picture idea here.' }));
  const t = sink();
  assert.strictEqual(await main([], { env: ENV, llm: passAll, ...t }), 5);
  assert.match(t.lines.join('\n'), /WARNING: the check passed an unkind sample/);
});
