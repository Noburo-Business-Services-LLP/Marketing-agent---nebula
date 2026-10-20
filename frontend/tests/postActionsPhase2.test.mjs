// Navigation phase 2, second half: Schedule all on the Create results, the actions of studio videos and Photoshoot
// photos, the calendar's post lookup and studio videos in the Library.
import test from 'node:test';
import assert from 'node:assert/strict';
import { schedulable, scheduleTimes, scheduleSummary, defaultGapDays, platformsOf } from '../utils/scheduleAll.ts';
import { studioVideoActionKeys, studioAgainQuarks, photoActionKeys, photoMakeAgainConfirm, studioDeleteConfirm, MEDIA_ORDER, libraryVideoActionKeys } from '../utils/itemActions.ts';
import { draftByCampaign, campaignIdOf } from '../utils/calendarPosts.ts';
import { fromStudioVideo, SOURCE_WORD } from '../utils/library.ts';
import { postActionsFor } from '../utils/postActions.ts';

const IMG = 'https://res.cloudinary.com/x/image/upload/a.jpg';
const post = (over = {}) => ({ _id: 'p1', status: 'draft', origin: 'manual', imageUrl: IMG, platforms: ['instagram', 'facebook'], ...over });

test('Create results are manual posts: no Approve; Schedule, Post now, Download, Edit, Make again with its price, Archive and Delete', () => {
  const keys = postActionsFor(post(), { publish: 'ok', hasAccount: true, makeAgainQuarks: 11, canEdit: true });
  assert.deepEqual(keys.map((a) => a.key), ['schedule', 'postNow', 'download', 'edit', 'makeAgain', 'archive', 'delete']);
  assert.equal(keys.find((a) => a.primary).key, 'schedule');
  assert.equal(keys.find((a) => a.key === 'makeAgain').quarks, 11);
  assert.match(keys.find((a) => a.key === 'postNow').confirm.message, /Instagram and Facebook/);
  // A post Nebulaa made (automation) still asks for approval first, even on this screen.
  assert.equal(postActionsFor(post({ origin: 'automation' }), { publish: 'ok' })[0].key, 'approve');
});

test('Schedule all takes only finished posts made by hand that are not scheduled or posted yet', () => {
  const list = [
    post({ _id: 'a' }), post({ _id: 'b', status: 'completed' }), post({ _id: 'c', status: 'processing' }), post({ _id: 'd', status: 'failed', imageUrl: '' }),
    post({ _id: 'e', status: 'scheduled' }), post({ _id: 'f', status: 'published' }), post({ _id: 'g', origin: 'automation' }),
    post({ _id: 'h', isCarouselSlide: true }), post({ _id: 'i', imageUrl: '', platforms: ['linkedin'] }), post({ _id: 'j', imageUrl: '' }),
    post({ _id: 'k', status: 'approved', origin: 'automation' }),
  ];
  assert.deepEqual(schedulable(list).map((d) => d._id), ['a', 'b', 'i', 'k']);
  assert.deepEqual(schedulable(null), []);
});

test('Schedule all spreads the posts from the first date, at the same time of day', () => {
  const first = new Date(2026, 9, 21, 10, 0, 0);
  const times = scheduleTimes(first, 3, 2);
  assert.deepEqual(times.map((t) => [t.getDate(), t.getHours(), t.getMinutes()]), [[21, 10, 0], [23, 10, 0], [25, 10, 0]]);
  assert.equal(scheduleTimes(first, 0, 1).length, 0);
  assert.equal(defaultGapDays(2), 4);
  assert.equal(defaultGapDays(7), 1);
  assert.equal(defaultGapDays(1), 7);
  assert.equal(defaultGapDays(undefined), 1);
});

test('the Schedule all question says how many posts, where, when, and that nothing is posted now', () => {
  const first = new Date(2026, 9, 21, 10, 0, 0);
  const text = scheduleSummary(6, ['instagram', 'facebook'], first, 1);
  assert.match(text, /^This schedules 6 posts to Instagram and Facebook, one a day at /);
  assert.match(text, /the first on .*21 Oct.*, the last on .*26 Oct/);
  assert.match(text, /Nothing is posted now\.$/);
  assert.match(scheduleSummary(3, ['instagram'], first, 7), /one a week/);
  assert.match(scheduleSummary(1, [], first, 1), /^This schedules 1 post for /);
  assert.deepEqual(platformsOf([post(), post({ platforms: ['linkedin'] })]), ['instagram', 'facebook', 'linkedin']);
});

test('studio videos: Download, Make again and Delete; never Schedule or Post now', () => {
  assert.deepEqual(studioVideoActionKeys({ status: 'completed', videoUrl: 'https://x/v.mp4' }), ['download', 'makeAgain', 'delete']);
  assert.deepEqual(studioVideoActionKeys({ status: 'failed' }), ['makeAgain', 'delete']);
  assert.deepEqual(studioVideoActionKeys({ status: 'processing' }), []);
  for (const k of ['download', 'makeAgain', 'delete', 'useInCreate', 'save', 'remove']) assert.ok(MEDIA_ORDER.includes(k));
  assert.equal(studioAgainQuarks({ clips: 2 }, [{ clips: 1, quarks: 161 }, { clips: 2, quarks: 322 }], 161), 322);
  assert.equal(studioAgainQuarks({ clips: 3 }, [], 161), 483);
  assert.equal(studioAgainQuarks({}, [], 0), 0);
  assert.equal(studioDeleteConfirm('Diwali').danger, true);
});

test('Photoshoot photos: Use in Create, Download, Make again with the price asked first, Save or Remove', () => {
  assert.deepEqual(photoActionKeys({ hasPhoto: true, inLibrary: true, canRedo: true }), ['useInCreate', 'download', 'makeAgain', 'remove']);
  assert.deepEqual(photoActionKeys({ hasPhoto: true, inLibrary: false, canRedo: false }), ['useInCreate', 'download', 'save']);
  assert.deepEqual(photoActionKeys({ hasPhoto: false, inLibrary: false, canRedo: true }), ['makeAgain']);
  assert.deepEqual(photoActionKeys({ hasPhoto: false, inLibrary: false, canRedo: false }), []);
  assert.match(photoMakeAgainConfirm(10).message, /for 10 Quarks/);
  assert.doesNotMatch(photoMakeAgainConfirm(0).message, /Quark/);
});

test('the calendar finds the post behind each entry, whether the campaign link is an id or populated', () => {
  const map = draftByCampaign([{ _id: 'd1', campaignId: 'c1' }, { _id: 'd2', campaignId: { _id: 'c2', campaignName: 'x' } }, { _id: 'd3' }, { _id: 'd4', campaignId: 'c1' }]);
  assert.equal(map.get('c1')._id, 'd1', 'the first post wins');
  assert.equal(map.get('c2')._id, 'd2');
  assert.equal(map.size, 2);
  assert.equal(campaignIdOf(null), '');
  assert.equal(draftByCampaign(undefined).size, 0);
});

test('studio videos join the Library as video tiles with Download, Make again and Delete', () => {
  const v = fromStudioVideo({ id: 'v1', status: 'completed', title: 'Diwali box', videoUrl: 'https://res.cloudinary.com/x/video/upload/v.mp4', concept: 'A box opens', clips: 2, platforms: ['Instagram'], createdAt: '2026-10-18T10:00:00Z' });
  assert.equal(v.source, 'studio');
  assert.equal(v.kind, 'video');
  assert.equal(v.status, 'ready');
  assert.equal(v.clips, 2);
  assert.match(v.thumbnailUrl, /so_1/);
  assert.deepEqual(libraryVideoActionKeys(v), ['download', 'makeAgain', 'delete']);
  assert.equal(SOURCE_WORD.studio, 'Video');
  assert.equal(fromStudioVideo({ id: 'v2', status: 'processing' }).status, 'creating');
  assert.deepEqual(libraryVideoActionKeys(fromStudioVideo({ id: 'v3', status: 'failed' })), ['makeAgain', 'delete']);
  assert.equal(fromStudioVideo({}), null);
});
