import test from 'node:test';
import assert from 'node:assert/strict';
import { fromPostDraft, fromVideoDraft, fromHeroJob, applyFilters, DEFAULT_FILTERS, stillFor } from '../utils/library.ts';

const MP4 = 'https://res.cloudinary.com/demo/video/upload/v1/x/abc.mp4';

test('all three sources become the same card shape', () => {
  const post = fromPostDraft({ _id: 'p1', title: 'Diwali offer', imageUrl: 'https://i/x.jpg', status: 'scheduled', platforms: ['Instagram'], createdAt: '2026-10-01' });
  const vid = fromVideoDraft({ jobId: 'v1', title: 'Filter coffee', status: 'created', finalVideoUrl: MP4, createdAt: '2026-10-02' });
  const hero = fromHeroJob({ jobId: 'h1', status: 'completed', title: 'A phone buzzes', videoUrl: MP4, publish: { status: 'scheduled', platforms: ['instagram'] }, createdAt: '2026-10-03' });
  for (const c of [post, vid, hero]) assert.deepEqual(Object.keys(c).filter((k) => k !== 'raw' && k !== 'finish').sort(), ['caption', 'createdAt', 'id', 'kind', 'mediaUrl', 'platforms', 'source', 'status', 'thumbnailUrl', 'title']);
  assert.equal(post.raw._id, 'p1'); assert.equal(vid.raw, undefined);
  assert.equal(post.kind, 'image'); assert.equal(post.status, 'scheduled'); assert.deepEqual(post.platforms, ['instagram']);
  assert.equal(vid.status, 'ready'); assert.match(vid.thumbnailUrl, /so_1/);
  assert.equal(hero.status, 'scheduled'); assert.equal(hero.source, 'hero');
});

test('status words map across sources', () => {
  assert.equal(fromPostDraft({ _id: 'a', status: 'processing' }).status, 'creating');
  assert.equal(fromPostDraft({ _id: 'a', status: 'published' }).status, 'posted');
  assert.equal(fromHeroJob({ jobId: 'a', status: 'processing' }).status, 'creating');
  assert.equal(fromHeroJob({ jobId: 'a', status: 'failed' }).status, 'failed');
  assert.equal(fromVideoDraft({ jobId: 'a', status: 'posted' }).status, 'posted');
});

test('missing or junk rows give no card and never throw', () => {
  assert.equal(fromPostDraft(null), null); assert.equal(fromVideoDraft({}), null); assert.equal(fromHeroJob(undefined), null);
  const odd = fromPostDraft({ _id: 'z', createdAt: 'not a date', platforms: 'x' });
  assert.equal(odd.createdAt, 0); assert.deepEqual(odd.platforms, []); assert.equal(odd.title, 'Untitled post');
});

test('filters by kind, status, platform and search, newest first', () => {
  const items = [
    fromPostDraft({ _id: '1', title: 'Pongal sale', status: 'draft', platforms: ['instagram'], imageUrl: 'https://i/a.jpg', createdAt: '2026-10-01' }),
    fromVideoDraft({ jobId: '2', title: 'Coffee pour', status: 'posted', platform: { selectedPlatforms: ['facebook'] }, createdAt: '2026-10-05' }),
    fromHeroJob({ jobId: '3', status: 'completed', title: 'Desk morning', videoUrl: MP4, createdAt: '2026-10-07' }),
  ];
  assert.deepEqual(applyFilters(items, DEFAULT_FILTERS).map((i) => i.id), ['3', '2', '1']);
  assert.deepEqual(applyFilters(items, { ...DEFAULT_FILTERS, kind: 'image' }).map((i) => i.id), ['1']);
  assert.deepEqual(applyFilters(items, { ...DEFAULT_FILTERS, kind: 'video', status: 'posted' }).map((i) => i.id), ['2']);
  assert.deepEqual(applyFilters(items, { ...DEFAULT_FILTERS, platform: 'instagram' }).map((i) => i.id), ['1']);
  assert.deepEqual(applyFilters(items, { ...DEFAULT_FILTERS, query: 'DESK' }).map((i) => i.id), ['3']);
  assert.deepEqual(applyFilters(items, { ...DEFAULT_FILTERS, source: 'hero' }).map((i) => i.id), ['3']);
});

test('a still is made only for a hosted video link', () => {
  assert.match(stillFor(MP4), /\.jpg$/);
  assert.equal(stillFor('https://x.com/a.mp4'), '');
});

test('a reel draft from the plan is a video with its job and file', () => {
  const r = fromPostDraft({ _id: 'r1', title: 'Pour', contentType: 'reel', status: 'draft', imageUrl: '', creative: { videoUrl: 'https://res.cloudinary.com/demo/video/upload/v1/a.mp4' }, generationProgress: { jobId: 'job9' } });
  assert.equal(r.kind, 'video'); assert.equal(r.source, 'reel'); assert.equal(r.jobId, 'job9');
  assert.match(r.mediaUrl, /\.mp4$/); assert.match(r.thumbnailUrl, /\.jpg$/);
  const img = fromPostDraft({ _id: 'i1', imageUrl: 'https://i/a.jpg', status: 'draft' });
  assert.equal(img.source, 'post'); assert.equal(img.kind, 'image');
});

test('a carousel uses its first rendered slide as the cover and reports how many slides it has', () => {
  const c = fromPostDraft({
    _id: 'c1', title: 'Story', status: 'draft', contentType: 'carousel', createdAt: '2026-10-14',
    carouselSlides: [{ order: 2, imageUrl: 'https://i/2.jpg' }, { order: 1, imageUrl: 'https://i/1.jpg' }, { order: 3, imageUrl: '' }],
  });
  assert.equal(c.thumbnailUrl, 'https://i/1.jpg');
  assert.deepEqual(c.slides, ['https://i/1.jpg', 'https://i/2.jpg']);
  assert.equal(c.slideTotal, 3);
});

import { readFileSync } from 'node:fs';
test('Library filters are one compact row with accessible groups', () => {
  const src = readFileSync(new URL('../pages/Library.tsx', import.meta.url), 'utf8');
  assert.equal((src.match(/data-testid="library-filter-row"/g) || []).length, 1);
  assert.match(src, /role="group" aria-label="Type"/);
  assert.match(src, /role="group" aria-label="Status"/);
  assert.match(src, /aria-pressed=\{filters\.kind === k\.key\}/);
  assert.match(src, /aria-pressed=\{filters\.status === s\.key\}/);
  assert.match(src, /focus-visible:ring-2/);
  assert.match(src, /overflow-x-auto/);
  assert.ok(!/h-9 px-4 rounded-full/.test(src));
});
