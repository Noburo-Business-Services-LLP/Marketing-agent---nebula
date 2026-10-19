import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
test('Library: one row of views (tabs with counts) and one compact filter row with accessible groups', () => {
  const src = readFileSync(new URL('../pages/Library.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../components/library/library.css', import.meta.url), 'utf8');
  assert.equal((src.match(/data-testid="library-filter-row"/g) || []).length, 1);
  assert.equal((src.match(/data-testid="library-views"/g) || []).length, 1);
  assert.match(src, /role="tablist" aria-label="Views"/);
  assert.match(src, /role="tab" aria-selected=\{on\}/);
  assert.match(src, /role="group" aria-label="Type"/);
  assert.match(src, /aria-pressed=\{filters\.kind === k\.key\}/);
  assert.match(src, /focus-visible:ring-2/);
  // the views scroll sideways inside themselves on a phone
  assert.match(css, /\.nb-lib-views \{[^}]*overflow-x: auto/);
  assert.match(css, /\.nb-lib-view:focus-visible/);
  assert.ok(!/h-9 px-4 rounded-full/.test(src));
});

import { SOURCE_WORD, libraryTileActions, STATUS_WORD as STATUS_WORDS } from '../utils/library.ts';

test('every source and status has words for its chip', () => {
  ['post', 'reel', 'video-draft', 'hero', 'photoshoot'].forEach((s) => assert.ok(SOURCE_WORD[s]));
  ['creating', 'draft', 'ready', 'approved', 'scheduled', 'posted', 'archived', 'binned', 'failed'].forEach((s) => assert.ok(STATUS_WORDS[s]));
});

test('tile actions: none while creating, edit for drafts and failed, download only with a file and not for posts', () => {
  assert.deepEqual(libraryTileActions({ status: 'creating', mediaUrl: 'https://x/y.mp4', source: 'hero' }), []);
  assert.deepEqual(libraryTileActions({ status: 'draft', mediaUrl: '', source: 'post' }), ['open', 'edit']);
  assert.deepEqual(libraryTileActions({ status: 'ready', mediaUrl: 'https://x/y.mp4', source: 'hero' }), ['open', 'download']);
  assert.deepEqual(libraryTileActions({ status: 'posted', mediaUrl: 'https://x/y.jpg', source: 'post' }), ['open']);
});

test('post cards keep one size in a flowing grid: no widened last card, no search box, no source dropdown', () => {
  const page = fs.readFileSync(new URL('../pages/Library.tsx', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../components/library/library.css', import.meta.url), 'utf8');
  assert.ok(!page.includes('fillRows') && !page.includes('gridColumn'), 'a card is never widened to fill a row');
  assert.ok(!/Search by title or caption/.test(page) && !page.includes('Where it came from'));
  assert.match(css, /\.nb-lib-grid \{[^}]*repeat\(auto-fill, minmax\(220px, 1fr\)\)/);
  assert.match(css, /\.nb-lib-pic \{[^}]*aspect-ratio: 4 \/ 5/);
  assert.match(css, /\.nb-lib-tile \{[^}]*max-width: 340px/);
});

import { LIBRARY_VIEWS, inView, defaultView, viewFromQuery, statusWordOf } from '../utils/library.ts';

test('library views: the owner order, and each item lands in the right view', () => {
  assert.deepEqual(LIBRARY_VIEWS.map((v) => v.label), ['Needs approval', 'Approved', 'Scheduled', 'Posted', 'All', 'Archived', 'Bin']);
  const auto = fromPostDraft({ _id: 'a', status: 'draft', origin: 'automation', imageUrl: 'https://i/a.jpg' });
  const mine = fromPostDraft({ _id: 'm', status: 'draft', origin: 'manual' });
  const approved = fromPostDraft({ _id: 'p', status: 'approved' });
  const binned = fromPostDraft({ _id: 'b', status: 'binned', binnedAt: '2026-10-18T00:00:00Z' });
  const archived = fromPostDraft({ _id: 'r', status: 'archived' });
  assert.equal(auto.needsApproval, true); assert.equal(mine.needsApproval, undefined);
  assert.equal(statusWordOf(auto), 'Needs approval'); assert.equal(statusWordOf(mine), 'Draft');
  assert.equal(approved.status, 'approved'); assert.equal(statusWordOf(approved), 'Approved');
  assert.equal(binned.status, 'binned'); assert.ok(binned.binnedAt > 0); assert.equal(statusWordOf(binned), 'In the Bin');
  assert.ok(inView(auto, 'approve')); assert.ok(!inView(mine, 'approve'));
  assert.ok(inView(approved, 'approved')); assert.ok(inView(binned, 'bin')); assert.ok(inView(archived, 'archived'));
  assert.ok(inView(mine, 'all')); assert.ok(!inView(binned, 'all')); assert.ok(!inView(archived, 'all'));
});

test('library default view: the address first, then Needs approval while something waits', () => {
  assert.equal(viewFromQuery('BIN'), 'bin'); assert.equal(viewFromQuery('nope'), '');
  assert.equal(defaultView('scheduled', 4), 'scheduled');
  assert.equal(defaultView(null, 3), 'approve');
  assert.equal(defaultView('', 0), 'all');
  assert.equal(defaultView(undefined, null), 'all');
});
