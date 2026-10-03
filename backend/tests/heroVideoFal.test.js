const test = require('node:test');
const assert = require('node:assert/strict');
const hero = require('../services/heroVideoService');

const M = 'bytedance/seedance-2.0/text-to-video';

function fakeFal({ status, result, resultErr } = {}) {
  const calls = {};
  return {
    calls,
    queue: {
      submit: async (model, opts) => { calls.submit = { model, opts }; return { request_id: 'req_1' }; },
      status: async (model, opts) => { calls.status = { model, opts }; return { status }; },
      result: async (model, opts) => { calls.result = { model, opts }; if (resultErr) throw resultErr; return result; }
    }
  };
}

test('submitHeroClip returns request_id', async () => {
  const fal = fakeFal();
  const id = await hero.submitHeroClip({ model: M, input: { prompt: 'x' } }, fal);
  assert.equal(id, 'req_1');
  assert.equal(fal.calls.submit.model, M);
  assert.deepEqual(fal.calls.submit.opts.input, { prompt: 'x' });
});

test('status maps IN_QUEUE and IN_PROGRESS', async () => {
  assert.deepEqual(await hero.getHeroClipStatus(M, 'r', fakeFal({ status: 'IN_QUEUE' })), { state: 'queued' });
  assert.deepEqual(await hero.getHeroClipStatus(M, 'r', fakeFal({ status: 'IN_PROGRESS' })), { state: 'processing' });
});

test('COMPLETED with video.url -> completed', async () => {
  const fal = fakeFal({ status: 'COMPLETED', result: { video: { url: 'https://v/x.mp4' } } });
  const s = await hero.getHeroClipStatus(M, 'r', fal);
  assert.deepEqual(s, { state: 'completed', videoUrl: 'https://v/x.mp4' });
  assert.equal(fal.calls.result.opts.requestId, 'r');
});

test('COMPLETED result shape variant (data.video.url) still works', async () => {
  const s = await hero.getHeroClipStatus(M, 'r', fakeFal({ status: 'COMPLETED', result: { data: { video: { url: 'https://v/y.mp4' } } } }));
  assert.equal(s.videoUrl, 'https://v/y.mp4');
});

test('COMPLETED without URL -> failed', async () => {
  const s = await hero.getHeroClipStatus(M, 'r', fakeFal({ status: 'COMPLETED', result: {} }));
  assert.equal(s.state, 'failed');
  assert.ok(s.error);
});

test('result() throwing -> failed with message', async () => {
  const s = await hero.getHeroClipStatus(M, 'r', fakeFal({ status: 'COMPLETED', resultErr: new Error('boom') }));
  assert.deepEqual(s, { state: 'failed', error: 'boom' });
});

test('missing FAL_KEY throws before network', async () => {
  const saved = process.env.FAL_KEY;
  delete process.env.FAL_KEY;
  try {
    await assert.rejects(() => hero.submitHeroClip({ model: M, input: {} }), /FAL_KEY/);
    await assert.rejects(() => hero.getHeroClipStatus(M, 'r'), /FAL_KEY/);
  } finally {
    if (saved !== undefined) process.env.FAL_KEY = saved;
  }
});

test('copyClipToStorage falls back to remote URL on failure and cleans up', async () => {
  const origErr = console.error; console.error = () => {};
  try {
    const url = await hero.copyClipToStorage('https://v/z.mp4', { download: async () => { throw new Error('nope'); } });
    assert.equal(url, 'https://v/z.mp4');
    let unlinked = null;
    const url2 = await hero.copyClipToStorage('https://v/z.mp4', {
      download: async () => ({ filePath: '/tmp/a.mp4' }),
      upload: async () => { throw new Error('cloud down'); },
      unlink: async (p) => { unlinked = p; }
    });
    assert.equal(url2, 'https://v/z.mp4');
    assert.equal(unlinked, '/tmp/a.mp4');
  } finally { console.error = origErr; }
});

test('copyClipToStorage returns cloudinary url on success', async () => {
  let folder;
  const url = await hero.copyClipToStorage('https://v/z.mp4', {
    download: async () => ({ filePath: '/tmp/b.mp4' }),
    upload: async (p, f) => { folder = f; return { url: 'https://res.cloudinary.com/x.mp4' }; },
    unlink: async () => {}
  });
  assert.equal(url, 'https://res.cloudinary.com/x.mp4');
  assert.equal(folder, 'nebula-hero-videos');
});
