const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { transcribe, URL: ENDPOINT } = require('../services/studioTranscribe');

const tmp = () => { const f = path.join(os.tmpdir(), `tr-${Date.now()}-${Math.random().toString(36).slice(2)}.m4a`); fs.writeFileSync(f, Buffer.from('fake audio')); return f; };
const okFetch = (log, body) => async (url, init) => { log.push({ url, init }); return { ok: true, status: 200, json: async () => body }; };
const BODY = { duration: 9.4, segments: [{ start: 0, end: 5.5, text: ' hello', no_speech_prob: 0.01, avg_logprob: -0.2, tokens: [1, 2] }], words: [{ word: 'hello', start: 0.1, end: 0.5 }] };

test('one POST to the transcription endpoint with whisper-1, verbose_json, segment and word timestamps and the language', async () => {
  const f = tmp(); const log = [];
  const r = await transcribe(f, 'ta', { fetch: okFetch(log, BODY), env: { OPENAI_API_KEY: 'sk-test-abc' } });
  fs.unlinkSync(f);
  assert.strictEqual(log.length, 1);
  assert.strictEqual(log[0].url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.strictEqual(ENDPOINT, log[0].url);
  assert.strictEqual(log[0].init.method, 'POST');
  assert.strictEqual(log[0].init.headers.Authorization, 'Bearer sk-test-abc');
  const form = log[0].init.body;
  assert.strictEqual(form.get('model'), 'whisper-1');
  assert.strictEqual(form.get('response_format'), 'verbose_json');
  assert.deepStrictEqual(form.getAll('timestamp_granularities[]'), ['segment', 'word']);
  assert.strictEqual(form.get('language'), 'ta');
  assert.ok(form.get('file') && form.get('file').size === 10);
  assert.deepStrictEqual(r.segments, [{ start: 0, end: 5.5, text: ' hello', no_speech_prob: 0.01, avg_logprob: -0.2 }]);
  assert.deepStrictEqual(r.words, [{ start: 0.1, end: 0.5, word: 'hello' }]);
});

test('the key goes only into the Authorization header; no language means none is sent', async () => {
  const f = tmp(); const log = [];
  await transcribe(f, null, { fetch: okFetch(log, BODY), env: { OPENAI_API_KEY: 'sk-test-abc' } });
  fs.unlinkSync(f);
  assert.ok(!log[0].init.body.has('language'));
  const keys = [...log[0].init.body.keys()];
  for (const k of keys) assert.ok(!String(log[0].init.body.get(k)).includes('sk-test-abc') || k === 'file');
  assert.strictEqual(String(log[0].url).includes('sk-'), false);
});

test('the key is read when called, and a missing key fails before any request', async () => {
  const f = tmp(); const log = [];
  await assert.rejects(() => transcribe(f, 'en', { fetch: okFetch(log, BODY), env: {} }), /not set/);
  assert.strictEqual(log.length, 0);
  const env = {};
  const p = transcribe(f, 'en', { fetch: okFetch(log, BODY), env });
  env.OPENAI_API_KEY = 'sk-late';
  await p.catch(() => {});
  fs.unlinkSync(f);
});

test('a failed request is one attempt only, and the error never carries the key, the reply or the audio name', async () => {
  const f = tmp(); let n = 0;
  const bad = async () => { n += 1; return { ok: false, status: 429, json: async () => ({ error: { message: 'bad key sk-test-abc' } }), text: async () => 'sk-test-abc' }; };
  let err;
  await transcribe(f, 'ta', { fetch: bad, env: { OPENAI_API_KEY: 'sk-test-abc' } }).catch((e) => { err = e; });
  assert.strictEqual(n, 1);
  assert.match(err.message, /HTTP 429/);
  assert.ok(!/sk-test|bad key/.test(err.message + JSON.stringify(err)));
  const boom = async () => { n += 1; throw new Error('connect ECONNRESET with sk-test-abc'); };
  await transcribe(f, 'ta', { fetch: boom, env: { OPENAI_API_KEY: 'sk-test-abc' } }).catch((e) => { err = e; });
  fs.unlinkSync(f);
  assert.strictEqual(n, 2);
  assert.ok(!/sk-test/.test(err.message));
});

test('a request that never answers is aborted at the timeout', async () => {
  const f = tmp(); let aborted = false;
  const hang = (url, init) => new Promise((_, rej) => { init.signal.addEventListener('abort', () => { aborted = true; rej(new Error('aborted')); }); });
  await assert.rejects(() => transcribe(f, 'en', { fetch: hang, env: { OPENAI_API_KEY: 'sk-x' }, timeoutMs: 30 }), /timed out/);
  fs.unlinkSync(f);
  assert.ok(aborted);
});

test('a reply that is not usable gives empty lists, not a crash', async () => {
  const f = tmp();
  const r = await transcribe(f, 'en', { fetch: okFetch([], { text: 'only text' }), env: { OPENAI_API_KEY: 'sk-x' } });
  fs.unlinkSync(f);
  assert.deepStrictEqual(r, { segments: [], words: [], duration: null });
});

test('under the test runner the real network is never used', async () => {
  const f = tmp();
  await assert.rejects(() => transcribe(f, 'en', { env: { OPENAI_API_KEY: 'sk-x' } }), /not allowed/);
  fs.unlinkSync(f);
});
