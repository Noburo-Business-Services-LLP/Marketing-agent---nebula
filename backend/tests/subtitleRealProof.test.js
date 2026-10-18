const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main } = require('../scripts/subtitle-real-proof');

let ffmpeg = null;
try { ffmpeg = require('ffmpeg-static'); if (ffmpeg && !fs.existsSync(ffmpeg)) ffmpeg = null; } catch (_) { ffmpeg = null; }
const mk = () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'proof-t-')), 'v.mp4');
  execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:d=7', '-f', 'lavfi', '-i', 'sine=d=7', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', f]);
  return f;
};
const sink = () => { const lines = []; return { lines, log: (...a) => lines.push(a.join(' ')), err: (...a) => lines.push(a.join(' ')) }; };

test('refuses without the approval flag, with no file, with no key, with a bad language', async () => {
  const s = sink(); let calls = 0;
  const transcribe = async () => { calls += 1; return { segments: [], words: [] }; };
  assert.strictEqual(await main(['x.mp4'], { env: { OPENAI_API_KEY: 'sk-t' }, transcribe, ...s }), 2);
  assert.strictEqual(await main([], { env: { I_APPROVED_ONE_WHISPER_CALL: 'yes', OPENAI_API_KEY: 'sk-t' }, transcribe, ...s }), 2);
  assert.strictEqual(await main([__filename], { env: { I_APPROVED_ONE_WHISPER_CALL: 'yes' }, transcribe, ...s }), 3);
  assert.strictEqual(await main([__filename, '--language', 'xx'], { env: { I_APPROVED_ONE_WHISPER_CALL: 'yes', OPENAI_API_KEY: 'sk-t' }, transcribe, ...s }), 2);
  assert.strictEqual(calls, 0);
});

test('one call only, prints counts, times and similarity, never more than 20 characters of the transcript or the key', { skip: !ffmpeg && 'ffmpeg-static missing' }, async () => {
  const f = mk(); const s = sink(); let calls = 0;
  const long = 'இன்றே ஆர்டர் செய்யுங்கள் ஆயிரம் ரூபாய்க்கு மேல் வீட்டிலேயே இலவச டெலிவரி';
  const transcribe = async () => { calls += 1; return { segments: [{ start: 0.2, end: 5.5, text: long }], words: [] }; };
  const code = await main([f, '--language', 'ta', '--line', long], { env: { I_APPROVED_ONE_WHISPER_CALL: 'yes', OPENAI_API_KEY: 'sk-test-SECRET' }, transcribe, ...s });
  assert.strictEqual(code, 0); assert.strictEqual(calls, 1);
  const all = s.lines.join('\n');
  assert.match(all, /Speech window: 0\.20 to 5\.50/);
  assert.match(all, /Similarity of the heard words to the line: 1\.00/);
  assert.ok(!all.includes(long) && !all.includes('SECRET'));
  const saved = all.match(/: (\S+subtitle-real-proof-\d+\.json)/)[1];
  const j = JSON.parse(fs.readFileSync(saved, 'utf8'));
  assert.strictEqual(j.calls, 1); assert.ok(Array.from(j.segments[0].first20).length <= 20);
  assert.ok(!fs.readFileSync(saved, 'utf8').includes(long));
  fs.unlinkSync(saved);
});

test('a failed call is not retried', { skip: !ffmpeg && 'ffmpeg-static missing' }, async () => {
  const f = mk(); const s = sink(); let calls = 0;
  const code = await main([f], { env: { I_APPROVED_ONE_WHISPER_CALL: 'yes', OPENAI_API_KEY: 'sk-t' }, transcribe: async () => { calls += 1; throw new Error('transcription failed (HTTP 500)'); }, ...s });
  assert.strictEqual(code, 4); assert.strictEqual(calls, 1);
});
