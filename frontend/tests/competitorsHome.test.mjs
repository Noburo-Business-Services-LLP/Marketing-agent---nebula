import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  boardState, tileView, homeCards, boardNote, trendHandoff, workingView, trendView, isPlainCopy, sectionsToShow,
} from '../utils/competitorsHome.ts';

const best = (over = {}) => ({ period: 'week', type: 'video', likes: 1240, comments: 86, at: '2026-10-17T05:30:00.000Z', url: 'https://www.instagram.com/p/abc/', ...over });
const card = (over = {}) => ({
  id: 'c1', name: 'Sweet Co Bakery', handle: 'sweetco', status: 'tracking', profileUrl: 'https://www.instagram.com/sweetco/',
  followers: { value: 5400, change: 120 }, postsThisWeek: { value: 5, atLeast: false }, bestPost: best(),
  worked: { kind: 'format', best: 'video', ratio: 3, text: 'Reels got 3 times the likes of photos on average this month.' },
  weekOf: '2026-10-12', isCurrentWeek: true, lastCheckedOn: '2026-10-13', ...over,
});
const action = (over = {}) => ({ label: 'Make a post like this', kind: 'post', mode: 'single', brief: 'A post about Fresh bakes, one of the themes in your plan.', ...over });
const res = (over = {}) => ({ success: true, entitled: true, trackerOn: true, state: 'ready', competitors: [card()], working: [], trending: [], degraded: [], weekStart: '2026-10-12', asOf: '', ...over });

test('board state: loading, error, locked (no add-on), none, pending (tracker off or first check), ready, staff', () => {
  assert.equal(boardState(null, false), 'loading');
  assert.equal(boardState(null, true), 'error');
  assert.equal(boardState(res({ state: 'error' }), false), 'error');
  assert.equal(boardState(res({ entitled: false, state: 'not_entitled' }), false), 'locked');
  assert.equal(boardState(res({ state: 'no_competitors', competitors: [] }), false), 'none');
  assert.equal(boardState(res({ state: 'tracker_off' }), false), 'pending');
  assert.equal(boardState(res({ state: 'waiting' }), false), 'pending');
  assert.equal(boardState(res(), false), 'ready');
  assert.equal(boardState(res({ staff: true }), false), 'staff');
  assert.equal(boardState({ nonsense: true }, false), 'error', 'an answer that is not this shape is a failed load');
});

test('a tracked tile: @handle, Indian-grouped followers with the change, posts this week, best post, what worked', () => {
  const v = tileView(card({ followers: { value: 125000, change: -35 } }));
  assert.equal(v.initial, 'S');
  assert.equal(v.handleText, '@sweetco');
  assert.deepEqual(v.chip, { text: 'Tracking', tone: 'good' });
  assert.equal(v.followers.value, '1,25,000');
  assert.deepEqual(v.followers.chip, { text: '-35', dir: 'down', label: 'down 35 since last week' });
  assert.equal(v.posts, '5 posts');
  assert.equal(v.best.text, 'Best this week: a reel on Saturday 17 October');
  assert.equal(v.best.counts, '1,240 likes, 86 comments');
  assert.equal(v.best.url, 'https://www.instagram.com/p/abc/');
  assert.equal(v.worked, 'Reels got 3 times the likes of photos on average this month.');
  assert.equal(v.note, null);
  assert.equal(v.handleAction, null);
  assert.equal(tileView(card({ followers: { value: 900, change: 0 } })).followers.chip.text, 'No change');
  assert.equal(tileView(card({ followers: { value: 900, change: null } })).followers.chip, null);
});

test('posts this week: "at least" when the count is cut short; none; not this week says when it was last checked', () => {
  assert.equal(tileView(card({ postsThisWeek: { value: 12, atLeast: true } })).posts, 'At least 12 posts');
  assert.equal(tileView(card({ postsThisWeek: { value: 1, atLeast: false } })).posts, '1 post');
  assert.equal(tileView(card({ postsThisWeek: { value: 0, atLeast: false } })).posts, 'No posts yet');
  const old = tileView(card({ isCurrentWeek: false, postsThisWeek: null, lastCheckedOn: '2026-09-15', bestPost: best({ period: 'month' }) }));
  assert.equal(old.posts, null);
  assert.deepEqual(old.chip, { text: 'Last checked 15 September', tone: 'neutral' });
  assert.equal(old.best.text, 'Best this month: a reel on Saturday 17 October');
  const noPattern = tileView(card({ worked: null }));
  assert.equal(noPattern.worked, 'Not enough posts yet to see a pattern.');
  assert.equal(noPattern.workedIsQuiet, true);
});

test('tiles without data say why, in plain words, with the right handle action; never a number', () => {
  const cases = {
    no_handle: ['Needs a handle', 'Add their Instagram handle to start tracking them.', 'edit'],
    unconfirmed: ['Confirm handle', 'We found this handle. Confirm it so we can track them.', 'confirm'],
    waiting: ['First check pending', 'Their first weekly check has not happened yet.', null],
    failed: ['Could not read', 'We could not read this account. Check the handle.', 'edit'],
    private: ['Private account', 'This account is private, so its posts cannot be seen.', 'edit'],
    paused: ['Paused', 'Paused after repeated problems. Edit the handle to resume.', 'edit'],
  };
  for (const [status, [chip, note, act]] of Object.entries(cases)) {
    const v = tileView(card({ status, followers: null, postsThisWeek: null, bestPost: null, worked: null, weekOf: null, isCurrentWeek: false, profileUrl: null }));
    assert.equal(v.chip.text, chip, status);
    assert.equal(v.note, note, status);
    assert.equal(v.handleAction, act, status);
    assert.equal(v.followers, null);
    assert.equal(v.best, null);
    assert.equal(v.worked, null);
  }
});

test('Home picks at most three tiles, tracked ones with a best post first', () => {
  const list = [card({ id: 'a', status: 'no_handle', bestPost: null }), card({ id: 'b', bestPost: best({ likes: 10 }) }), card({ id: 'c', bestPost: best({ likes: 900 }) }), card({ id: 'd', status: 'waiting', bestPost: null }), card({ id: 'e', bestPost: null })];
  assert.deepEqual(homeCards(res({ competitors: list })).map((c) => c.id), ['c', 'b', 'e']);
  assert.deepEqual(homeCards(res({ competitors: [] })), []);
});

test('quiet notes: an add-on note links to plans except inside a client workspace; pending never promises a date', () => {
  assert.deepEqual(boardNote('locked', { clientWorkspace: false }), { text: 'Following your competitors is an add-on.', link: { to: '/trial-expired', text: 'See plans' } });
  assert.deepEqual(boardNote('locked', { clientWorkspace: true }), { text: 'Following your competitors is an add-on.', link: null });
  assert.equal(boardNote('none', {}).link.to, '/competitors');
  const pending = boardNote('pending', {});
  assert.match(pending.text, /have not been checked yet/);
  assert.ok(!/\b(today|tomorrow|soon|monday|hours?)\b/i.test(pending.text));
  assert.equal(boardNote('ready', {}), null);
});

test('Make a post like this opens Create (single or carousel) or Videos with the brief, marked as from Home', () => {
  assert.deepEqual(trendHandoff(action(), 'tamil'), { target: 'carousel', route: '/campaigns', data: { mode: 'single', topic: 'A post about Fresh bakes, one of the themes in your plan.', language: 'tamil', source: 'home' } });
  assert.deepEqual(trendHandoff(action({ mode: 'carousel' }), null).data.mode, 'carousel');
  assert.deepEqual(trendHandoff(action({ kind: 'video', mode: null, brief: 'A reel about Fresh bakes.' }), ''), { target: 'video', route: '/reels', data: { idea: 'A reel about Fresh bakes.', source: 'home' } });
  assert.equal(trendHandoff(action({ brief: '' }), null), null);
  assert.equal(trendHandoff(null, null), null);
  assert.equal(trendHandoff(action({ brief: 'x'.repeat(900) }), null).data.topic.length, 500);
});

test('rows for What is working and Trending keep the server sentences and the source label', () => {
  const w = workingView({ competitorId: 'c1', name: 'Sweet Co Bakery', handle: 'sweetco', period: 'week', type: 'video', likes: 1240, comments: 86, at: '', url: 'https://www.instagram.com/p/abc/', reason: 'A reel on Saturday 17 October with 1,240 likes and 86 comments, their best this week.', worked: null, action: action({ kind: 'video', mode: null }) });
  assert.equal(w.title, 'Sweet Co Bakery');
  assert.equal(w.kind, 'video');
  assert.equal(w.url, 'https://www.instagram.com/p/abc/');
  const t = trendView({ id: 'festival:x', source: 'festival', label: 'Coming up', title: "Children's Day", reason: 'Saturday 14 November, in 26 days.', action: action() });
  assert.equal(t.tone, 'festival');
  assert.equal(t.label, 'Coming up');
  assert.equal(trendView({ id: 'x', source: 'other', label: 'L', title: 'T', reason: 'R', action: action() }).tone, 'plan');
  // A link that is not an Instagram post link is never shown.
  assert.equal(workingView({ ...w, url: 'javascript:alert(1)', reason: 'r', action: action() }).url, null);
});

test('which sections Home shows: each only with real data; staff see none', () => {
  assert.deepEqual(sectionsToShow(res({ working: [{}], trending: [{}] }), 'ready'), { competitors: true, working: true, trending: true });
  assert.deepEqual(sectionsToShow(res({ working: [], trending: [] }), 'ready'), { competitors: true, working: false, trending: false });
  assert.deepEqual(sectionsToShow(res({ entitled: false, state: 'not_entitled', trending: [{}] }), 'locked'), { competitors: true, working: false, trending: true });
  assert.deepEqual(sectionsToShow(res({ staff: true }), 'staff'), { competitors: false, working: false, trending: false });
  assert.deepEqual(sectionsToShow(null, 'loading'), { competitors: true, working: false, trending: false });
});

test('wording guard: the helper copy and the component copy are plain, kind and free of banned words', () => {
  assert.equal(isPlainCopy('Great post!'), false);
  assert.equal(isPlainCopy('Their worst week'), false);
  assert.equal(isPlainCopy('Use your credits'), false);
  assert.equal(isPlainCopy('in 7 days'), false);
  assert.equal(isPlainCopy('Reels — best'), false);
  assert.equal(isPlainCopy('They beat you'), false);
  assert.equal(isPlainCopy('Reels got 3 times the likes of photos on average this month.'), true);
  for (const file of ['../utils/competitorsHome.ts', '../components/CompetitorTiles.tsx']) {
    const src = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    const strings = [...src.matchAll(/'([^'\\\n]{6,})'|"([^"\\\n]{6,})"|>([^<>{}\n]{6,})</g)].map((m) => (m[1] || m[2] || m[3]).trim())
      .filter((s) => /\s/.test(s) && !/^[a-z-]+(\s[a-z-]+)*$/.test(s) && !s.startsWith('nb-') && !/^\.?\//.test(s) && !/^https?:/.test(s) && !/[()=>{};]/.test(s));
    assert.ok(strings.length > 5, file);
    for (const s of strings) assert.ok(isPlainCopy(s), `${file}: ${s}`);
    assert.ok(!/src="http/.test(src), `${file} must not load an outside picture`);
  }
});

test('posts a week as bars: one per stored week, oldest first, labelled, heights from the largest week', async () => {
  const { weekBars, weekBarsSummary } = await import('../utils/competitorInsights.ts');
  const bars = weekBars([{ weekStart: '2026-09-28', postsInWindow: 2, avgLikes: 1 }, { weekStart: '2026-10-05', postsInWindow: 0, avgLikes: 0 }, { weekStart: '2026-10-12', postsInWindow: 5, avgLikes: 3 }], '2026-10-12');
  assert.deepEqual(bars.map((b) => [b.posts, b.height, b.current]), [[2, 40, false], [0, 0, false], [5, 100, true]]);
  assert.equal(bars[0].label, 'Week of 28 September: 2 posts');
  assert.equal(weekBarsSummary(bars), 'Posts a week: 28 September: 2 posts; 5 October: 0 posts; 12 October: 5 posts.');
  assert.deepEqual(weekBars(null), []);
  assert.equal(weekBars([{ weekStart: 'x', postsInWindow: 3 }]).length, 0);
  assert.equal(weekBars(Array.from({ length: 6 }, (_, i) => ({ weekStart: `2026-09-0${i + 1}`, postsInWindow: 1 }))).length, 4);
});

test('post pictures: only our stored copies or inline pictures load; never an Instagram link', async () => {
  const { thumbSrc, workingView, galleryView, gallerySpans } = await import('../utils/competitorsHome.ts');
  const ours = 'https://res.cloudinary.com/demo/image/upload/v1/nebula-competitor-posts/abc-p-X1.webp';
  assert.equal(thumbSrc(ours), ours);
  assert.equal(thumbSrc('data:image/svg+xml;utf8,%3Csvg%3E'), 'data:image/svg+xml;utf8,%3Csvg%3E');
  for (const bad of ['https://scontent.cdninstagram.com/x.jpg', 'https://res.cloudinary.com/demo/image/upload/v1/nebula-competitor-avatars/abc.webp', 'javascript:alert(1)', 'data:text/html,x', null, undefined, '']) assert.equal(thumbSrc(bad), null, String(bad));
  const w = workingView({ competitorId: 'c1', name: 'Sweet Co Bakery', handle: 'sweetco', period: 'week', type: 'video', likes: 1240, comments: 86, at: '2026-10-18T05:00:00Z',
    url: 'https://www.instagram.com/p/A1/', ref: 'c1.p-A1', reason: 'A reel on Sunday 18 October with 1,240 likes.', worked: 'Reels got 3 times the likes of photos on average this month.',
    action: { label: 'Make a post like this', kind: 'video', mode: null, brief: 'A reel.' }, thumbUrl: ours });
  assert.equal(w.thumb, ours);
  assert.equal(w.byline, 'From @sweetco');
  assert.deepEqual(w.counts, { likes: '1,240', comments: '86' });
  assert.equal(w.why, 'Reels got 3 times the likes of photos on average this month.');
  assert.equal(workingView({ ...w, competitorId: 'c1', name: 'X', handle: '', worked: null, reason: 'A photo.', likes: 3, comments: null, thumbUrl: 'https://scontent.cdninstagram.com/x.jpg', type: 'image', url: 'x', at: 'y', action: w.action }).thumb, null);
  const g = galleryView({ id: 'c1', name: 'Sweet', handle: 'sweetco', gallery: [
    { ref: 'a', pick: 'best', type: 'video', likes: 10, comments: 1, at: '2026-10-18T05:00:00Z', url: 'https://www.instagram.com/p/A1/', thumbUrl: ours },
    { ref: 'b', pick: 'latest', type: 'image', likes: null, comments: null, at: '2026-10-18T05:00:00Z', url: 'https://evil.com/', thumbUrl: null }] });
  assert.deepEqual(g.map((x) => [x.label, x.thumb ? 'ours' : null, x.url ? 'link' : null, x.likes]), [['Best', 'ours', 'link', '10 likes'], ['New', null, null, null]]);
  assert.match(g[0].alt, /^@sweetco: a reel from Sunday 18 October$/);
  assert.deepEqual(gallerySpans(6), { wide: 6, narrow: 3, spans: [1, 1, 1, 1, 1, 1] });
  assert.deepEqual(gallerySpans(5).spans, [1, 1, 1, 1, 2]);
  assert.deepEqual(gallerySpans(4), { wide: 4, narrow: 2, spans: [1, 1, 1, 1] });
  assert.deepEqual(gallerySpans(2), { wide: 2, narrow: 2, spans: [1, 1] });
});
