// The week's proposal: what to make this week, scaled to what the pool can pay. Pure.
function kindOf(format) {
  const f = String(format || '').toLowerCase();
  if (f.includes('reel') || f.includes('video')) return 'video';
  if (f.includes('carousel')) return 'carousel';
  return 'post';
}

const fromCalendar = (items) => items.map((c) => ({
  kind: kindOf(c.format), topic: c.headline || '', channel: c.platform || null, pillar: c.contentPillar || null,
  source: 'calendar', calendarItemId: c._id,
}));

const fromPlan = (entries) => entries.map((e) => ({
  kind: kindOf(e.format), topic: (e.hook && e.hook.text) || '', channel: null, pillar: e.pillar || null, source: 'plan',
}));

const PLURAL = { post: 'posts', carousel: 'carousels', video: 'videos' };

function scaleDown(items, pool, costs) {
  const removed = { videos: 0, carousels: 0, posts: 0 };
  const list = items.slice();
  const total = () => list.reduce((s, i) => s + costs[i.kind], 0);
  for (const kind of ['video', 'carousel', 'post']) {
    while (total() > pool) {
      let at = -1;
      for (let i = list.length - 1; i >= 0; i--) if (list[i].kind === kind) { at = i; break; }
      if (at < 0) break;
      list.splice(at, 1);
      removed[PLURAL[kind]] += 1;
    }
  }
  return { list, removed };
}

function weekProposal({ planCalendar = [], calendarItems = [], cadence = {}, pool = 0, costs, weekStart }) {
  const base = calendarItems && calendarItems.length ? fromCalendar(calendarItems) : fromPlan(planCalendar || []);
  const cap = Number.isFinite(cadence && cadence.reelsPerWeek) ? cadence.reelsPerWeek : 1;
  let seenVideos = 0;
  const capped = base.filter((i) => (i.kind !== 'video' ? true : ++seenVideos <= cap));
  const { list, removed } = scaleDown(capped, Math.max(0, pool || 0), costs);
  const items = list.map((i, index) => ({ id: `${weekStart}:${index}`, ...i }));
  const counts = { posts: 0, carousels: 0, videos: 0 };
  for (const i of items) counts[PLURAL[i.kind]] += 1;
  return {
    items, counts,
    scaledDown: removed.videos + removed.carousels + removed.posts > 0,
    removed,
    empty: items.length === 0,
  };
}

module.exports = { weekProposal };
