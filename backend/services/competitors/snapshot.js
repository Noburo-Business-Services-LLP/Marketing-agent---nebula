// Competitor snapshot analysis. PURE: no database, no network, never throws on missing fields.
const { weekStartOf } = require('../week/weekMath');

const DAY = 86400000;
const num = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0);
const asArray = (v) => (Array.isArray(v) ? v : []);

function toDate(v) {
  if (v === undefined || v === null || v === '') return null;
  let d;
  if (v instanceof Date) d = v;
  else if (typeof v === 'number') d = new Date(v < 1e12 ? v * 1000 : v);
  else if (typeof v === 'string' && /^\d+$/.test(v.trim())) { const n = Number(v); d = new Date(n < 1e12 ? n * 1000 : n); }
  else d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function postDate(p) {
  for (const k of ['timestamp', 'takenAt', 'takenAtTimestamp', 'date']) {
    const d = toDate(p[k]);
    if (d) return d;
  }
  return null;
}

function postUrl(p) {
  if (p.url) return String(p.url);
  if (p.postUrl) return String(p.postUrl);
  return p.shortCode ? `https://www.instagram.com/p/${p.shortCode}/` : '';
}

const rawLikes = (p) => (p.likesCount !== undefined ? p.likesCount : p.likes);
const rawComments = (p) => (p.commentsCount !== undefined ? p.commentsCount : p.comments);
const likesOf = (p) => num(rawLikes(p));
const commentsOf = (p) => num(rawComments(p));
// Instagram reports -1 when likes are hidden or comments are switched off. That is "unknown", not zero: such a post is
// left out of the averages (it still counts as a post).
const known = (v) => typeof v === 'number' && isFinite(v) && v >= 0;

// The scraper returns the newest posts it finds, which can include an old pinned post first. The week is the
// Monday-to-Sunday week in India (the same week key the snapshot is stored under), never "the last 7 days".
const LIMIT_NOTE = 'postsInWindowMayBeTruncated';

function summarise({ profile, posts, now } = {}) {
  const at = toDate(now) || new Date();
  const prof = profile || {};
  const dated = [];
  for (const p of asArray(posts)) {
    if (!p || typeof p !== 'object') continue;
    const d = postDate(p);
    if (!d || d > at) continue;
    const age = at - d;
    if (age <= 30 * DAY) dated.push({ p, d, age });
  }
  const thisWeek = weekStartOf(at);
  const week = dated.filter((x) => weekStartOf(x.d) === thisWeek);
  const mean = (raw) => {
    const vals = dated.map((x) => raw(x.p)).filter(known);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  };

  // The scraper is asked for 12 posts. If every returned (non-pinned) post is inside this week, the account may have
  // posted more than we can see, so the count is a minimum. A small account with no more posts than we got is exact.
  const returned = [];
  for (const p of asArray(posts)) {
    if (!p || typeof p !== 'object' || p.isPinned) continue;
    const d = postDate(p);
    if (d && d <= at) returned.push(d);
  }
  const total = prof.postsCount;
  const moreExist = !(typeof total === 'number' && isFinite(total) && total <= asArray(posts).length);
  const mayBeTruncated = week.length > 0 && moreExist && week.length === returned.length && returned.every((d) => weekStartOf(d) === thisWeek);

  const formats = { image: 0, video: 0, carousel: 0 };
  for (const { p } of dated) {
    if (p.type === 'Video') formats.video++;
    else if (p.type === 'Sidecar') formats.carousel++;
    else formats.image++;
  }

  let top = null;
  for (const x of dated) {
    const score = likesOf(x.p) + 3 * commentsOf(x.p);
    if (!top || score > top.score) top = { ...x, score };
  }

  const counts = new Map();
  for (const { p } of dated) {
    for (const raw of asArray(p.hashtags)) {
      const t = String(raw || '').replace(/^#/, '').trim().toLowerCase();
      if (t) counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  const hashtags = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);

  return {
    weekStart: weekStartOf(at),
    followers: num(prof.followersCount),
    postsInWindow: week.length,
    [LIMIT_NOTE]: mayBeTruncated,
    posts30: dated.length,
    avgLikes: mean(rawLikes),
    avgComments: mean(rawComments),
    formats,
    topPost: top ? {
      url: postUrl(top.p), likes: likesOf(top.p), comments: commentsOf(top.p), type: top.p.type || 'Image',
      caption: String(top.p.caption || top.p.text || '').slice(0, 160),
    } : null,
    topPostAt: top ? top.d : null,
    hashtags,
  };
}

function compare(prev, cur) {
  const p = prev || {}; const c = cur || {};
  const prevAvg = num(p.avgLikes);
  return {
    posts: num(c.postsInWindow) - num(p.postsInWindow),
    followers: num(c.followers) - num(p.followers),
    avgLikesPct: prev && prevAvg > 0 ? Math.round(((num(c.avgLikes) - prevAvg) / prevAvg) * 100) : null,
  };
}

const typeWord = (t) => (t === 'Video' ? 'reel' : t === 'Sidecar' ? 'carousel' : 'photo');
const times = (n) => (n === 1 ? '1 time' : `${n} times`);

function bestPostSentence(name, cur, at, out) {
  const top = cur.topPost; const topAt = toDate(cur.topPostAt);
  if (top && topAt && topAt <= at && weekStartOf(topAt) === weekStartOf(at)) {
    const likes = num(top.likes); const avg = num(cur.avgLikes);
    if (likes > 0 && likes >= 1.5 * avg) {
      out.push({
        text: `${name}'s best post this week was a ${typeWord(top.type)} with ${likes} likes.`,
        weight: (likes / Math.max(avg, 1)) / 6,
      });
    }
  }
  return out;
}

// weekStart values are Monday dates (YYYY-MM-DD). `next` is exactly one week after `prev`.
const weekMs = (w) => (typeof w === 'string' ? Date.parse(`${w}T00:00:00Z`) : NaN);
const consecutive = (prev, next) => { const a = weekMs(prev); const b = weekMs(next); return isFinite(a) && isFinite(b) && b - a === 7 * DAY; };

/**
 * Sentences are written only for a snapshot of the CURRENT week, and a week-over-week change only when the previous
 * snapshot is exactly the week before. An older snapshot is never described as "this week".
 */
function sentencesFor(name, snaps, at) {
  const cur = snaps[0];
  const prev = snaps[1];
  if (!cur || cur.weekStart !== weekStartOf(at)) return [];
  if (!prev) return [{ text: `We have started tracking ${name}. Changes show from next week.`, weight: 0.1 }];
  const out = [];
  if (!consecutive(prev.weekStart, cur.weekStart)) return bestPostSentence(name, cur, at, out);
  const curPosts = num(cur.postsInWindow); const prevPosts = num(prev.postsInWindow);
  const diff = curPosts - prevPosts;
  // A count that may be cut short is a minimum: say "at least", never claim a drop from it, and never claim a rise over
  // an earlier week that was itself cut short.
  const curMin = cur.postsInWindowMayBeTruncated === true;
  const prevMin = prev.postsInWindowMayBeTruncated === true;
  const curText = curMin ? `at least ${times(curPosts)}` : times(curPosts);
  if (Math.abs(diff) >= 2) {
    if (diff > 0 ? !prevMin : !curMin) {
      out.push({
        text: `${name} posted ${curText} this week, ${diff > 0 ? 'up' : 'down'} from ${prevPosts}.`,
        weight: Math.abs(diff) / Math.max(prevPosts, 1),
      });
    }
  } else if (prevPosts === 0 && curPosts > 0) {
    out.push({ text: `${name} posted ${curText} this week, after none last week.`, weight: 0.5 });
  }
  const fDiff = num(cur.followers) - num(prev.followers);
  if (Math.abs(fDiff) >= 50 && Math.abs(fDiff) >= 0.01 * Math.max(num(cur.followers), num(prev.followers))) {
    out.push({
      text: `${name} ${fDiff > 0 ? 'gained' : 'lost'} ${Math.abs(fDiff)} follower${Math.abs(fDiff) === 1 ? '' : 's'} this week.`,
      weight: (Math.abs(fDiff) / Math.max(num(prev.followers), 1)) * 10,
    });
  }
  return bestPostSentence(name, cur, at, out);
}

function insights({ items, now } = {}) {
  const at = toDate(now) || new Date();
  const highlights = [];
  const competitors = [];
  for (const item of asArray(items)) {
    const comp = (item && item.competitor) || {};
    const id = comp._id !== undefined ? comp._id : comp.id;
    const name = comp.name || 'A competitor';
    const snaps = asArray(item && item.snapshots).filter(Boolean);
    const latest = snaps[0] || null;
    const prior = snaps[1] || null;
    const taken = latest && toDate(latest.takenAt);
    competitors.push({
      id, name,
      trend: snaps.slice(0, 4).reverse().map((s) => ({ weekStart: s.weekStart, postsInWindow: num(s.postsInWindow), avgLikes: num(s.avgLikes) })),
      // Which week the numbers are from. The card must say "last checked on <date>" unless isCurrentWeek is true.
      weekOf: latest ? latest.weekStart || null : null,
      isCurrentWeek: !!(latest && latest.weekStart === weekStartOf(at)),
      previousWeekOf: latest && prior && consecutive(prior.weekStart, latest.weekStart) ? prior.weekStart : null,
      lastCheckedOn: taken ? taken.toISOString().slice(0, 10) : (latest ? latest.weekStart || null : null),
    });
    if (!snaps.length) continue;
    for (const s of sentencesFor(name, snaps, at)) highlights.push({ competitorId: id, name, text: s.text, weight: s.weight });
  }
  const ranked = highlights.map((h, i) => ({ h, i })).sort((a, b) => b.h.weight - a.h.weight || a.i - b.i).slice(0, 3).map((x) => x.h);
  return { highlights: ranked, competitors };
}

module.exports = { summarise, compare, insights };
