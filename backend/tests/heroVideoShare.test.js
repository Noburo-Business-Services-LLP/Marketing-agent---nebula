const test = require('node:test');
const assert = require('node:assert');
const { thumbnailFor, titleFor, shareHeroVideo } = require('../services/heroVideoShare');
const { publishVideoDraft } = require('../services/videoPublish');

const DONE = { status: 'completed', result: { videoUrl: 'https://res.cloudinary.com/demo/video/upload/v1/nebula-hero-videos/abc.mp4' }, payload: { beatSheet: [{ beat: 'A phone buzzes face down on a cluttered desk.' }] } };

test('thumbnail is a still frame of a hosted video, empty for anything else', () => {
  assert.equal(thumbnailFor(DONE.result.videoUrl), 'https://res.cloudinary.com/demo/video/upload/so_1,w_480,h_480,c_fill,g_auto,f_jpg/v1/nebula-hero-videos/abc.jpg');
  assert.equal(thumbnailFor('https://example.com/a.mp4'), '');
  assert.equal(thumbnailFor(''), '');
});

test('the title is a short line, never the whole prompt', () => {
  assert.equal(titleFor(DONE), 'A phone buzzes face down on a cluttered desk.');
  assert.equal(titleFor({ payload: { prompt: 'x'.repeat(5000) } }), 'Hero video');
});

test('posting now and scheduling send the video through the shared sender', async () => {
  const calls = [];
  const post = async (platforms, text, options) => { calls.push({ platforms, text, options }); return { success: true, data: { id: 'p1' } }; };
  const now = await shareHeroVideo({ job: DONE, user: { ayrshare: { profileKey: 'K' } }, body: { platforms: ['instagram'], caption: 'Hi', hashtags: ['a'], publishNow: true }, publishVideoDraft, post });
  assert.equal(now.status, 200);
  assert.equal(now.json.status, 'published');
  assert.equal(calls[0].options.mediaUrls[0], DONE.result.videoUrl);
  assert.equal(calls[0].options.scheduleDate, undefined);
  const later = await shareHeroVideo({ job: DONE, user: { ayrshare: { profileKey: 'K' } }, body: { platforms: ['facebook'], scheduledAt: '2030-01-01T10:00:00Z' }, publishVideoDraft, post });
  assert.equal(later.json.status, 'scheduled');
  assert.ok(calls[1].options.scheduleDate);
});

test('an unfinished video, missing accounts or a provider failure are refused in plain words', async () => {
  const post = async () => ({ success: false, error: 'raw vendor text' });
  assert.equal((await shareHeroVideo({ job: { status: 'processing' }, user: {}, body: {}, publishVideoDraft, post })).status, 400);
  const noKey = await shareHeroVideo({ job: DONE, user: {}, body: { platforms: ['instagram'], publishNow: true }, publishVideoDraft, post });
  assert.equal(noKey.status, 400);
  assert.match(noKey.json.message, /Connect your social accounts/);
  const failed = await shareHeroVideo({ job: DONE, user: { ayrshare: { profileKey: 'K' } }, body: { platforms: ['instagram'], publishNow: true }, publishVideoDraft, post });
  assert.equal(failed.status, 502);
  assert.doesNotMatch(JSON.stringify(failed.json), /vendor/);
});
