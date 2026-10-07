const test = require('node:test');
const assert = require('node:assert');
const { publishVideoDraft, providerPlatforms, buildPostText } = require('../services/videoPublish');

const base = { profileKey: 'PK', platforms: ['instagram', 'x'], caption: 'Hello', hashtags: ['#a', 'b'], videoUrl: 'https://cdn/x.mp4', publishNow: true };

test('platform names map to the provider and X becomes twitter', () => {
  assert.deepStrictEqual(providerPlatforms(['Instagram', 'x', 'twitter', 'gmb', 'nope']), ['instagram', 'twitter']);
});

test('caption and hashtags are combined, adding # where missing', () => {
  assert.strictEqual(buildPostText('Hi', ['#a', 'b']), 'Hi\n\n#a #b');
  assert.strictEqual(buildPostText('', '#x #y'), '#x #y');
});

test('publishing now sends the video with the profile key and no schedule', async () => {
  let seen;
  const r = await publishVideoDraft({ ...base, post: async (p, text, o) => { seen = { p, text, o }; return { success: true, data: { id: 'abc' } }; } });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.status, 'published');
  assert.deepStrictEqual(seen.p, ['instagram', 'twitter']);
  assert.deepStrictEqual(seen.o.mediaUrls, ['https://cdn/x.mp4']);
  assert.strictEqual(seen.o.profileKey, 'PK');
  assert.strictEqual(seen.o.isVideo, true);
  assert.strictEqual(seen.o.scheduleDate, undefined);
  assert.strictEqual(r.providerId, 'abc');
});

test('scheduling passes the date to the provider', async () => {
  let seen;
  const r = await publishVideoDraft({ ...base, publishNow: false, scheduledAt: '2026-10-10T08:30:00.000Z', post: async (p, t, o) => { seen = o; return { success: true, data: {} }; } });
  assert.strictEqual(r.status, 'scheduled');
  assert.strictEqual(seen.scheduleDate, '2026-10-10T08:30:00.000Z');
});

test('missing pieces are refused in plain words and the provider is never called', async () => {
  const never = async () => { throw new Error('should not be called'); };
  assert.strictEqual((await publishVideoDraft({ ...base, platforms: [], post: never })).code, 'no_platform');
  assert.strictEqual((await publishVideoDraft({ ...base, platforms: ['gmb'], post: never })).code, 'no_platform');
  assert.strictEqual((await publishVideoDraft({ ...base, videoUrl: '', post: never })).code, 'no_video');
  assert.strictEqual((await publishVideoDraft({ ...base, profileKey: '', post: never })).code, 'not_connected');
  assert.strictEqual((await publishVideoDraft({ ...base, publishNow: false, scheduledAt: 'nonsense', post: never })).code, 'bad_time');
});

test('a provider failure never shows provider wording', async () => {
  const r = await publishVideoDraft({ ...base, post: async () => ({ success: false, error: 'Ayrshare: Paid Plan Required code 169' }) });
  assert.strictEqual(r.ok, false);
  assert.doesNotMatch(r.message, /Ayrshare|169|Plan/);
});
