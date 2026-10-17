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

const likesOf = (p) => num(p.likesCount !== undefined ? p.likesCount : p.likes);
const commentsOf = (p) => num(p.commentsCount !== undefined ? p.commentsCount : p.comments);

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
  const week = dated.filter((x) => x.age <= 7 * DAY);
  const mean = (f) => (dated.length ? Math.round(dated.reduce((s, x) => s + f(x.p), 0) / dated.length) : 0);

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
    posts30: dated.length,
    avgLikes: mean(likesOf),
    avgComments: mean(commentsOf),
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

function sentencesFor(name, snaps, at) {
  const cur = snaps[0];
  const prev = snaps[1];
  if (!prev) return [{ text: `We have started tracking ${name}. Changes show from next week.`, weight: 0.1 }];
  const out = [];
  const curPosts = num(cur.postsInWindow); const prevPosts = num(prev.postsInWindow);
  const diff = curPosts - prevPosts;
  if (Math.abs(diff) >= 2) {
    out.push({
      text: `${name} posted ${times(curPosts)} this week, ${diff > 0 ? 'up' : 'down'} from ${prevPosts}.`,
      weight: Math.abs(diff) / Math.max(prevPosts, 1),
    });
  } else if (prevPosts === 0 && curPosts > 0) {
    out.push({ text: `${name} posted ${times(curPosts)} this week, after none last week.`, weight: 0.5 });
  }
  const fDiff = num(cur.followers) - num(prev.followers);
  if (Math.abs(fDiff) >= 50 && Math.abs(fDiff) >= 0.01 * Math.max(num(cur.followers), num(prev.followers))) {
    out.push({
      text: `${name} ${fDiff > 0 ? 'gained' : 'lost'} ${Math.abs(fDiff)} follower${Math.abs(fDiff) === 1 ? '' : 's'} this week.`,
      weight: (Math.abs(fDiff) / Math.max(num(prev.followers), 1)) * 10,
    });
  }
  const top = cur.topPost; const topAt = toDate(cur.topPostAt);
  if (top && topAt && at - topAt <= 7 * DAY && topAt <= at) {
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

function insights({ items, now } = {}) {
  const at = toDate(now) || new Date();
  const highlights = [];
  const competitors = [];
  for (const item of asArray(items)) {
    const comp = (item && item.competitor) || {};
    const id = comp._id !== undefined ? comp._id : comp.id;
    const name = comp.name || 'A competitor';
    const snaps = asArray(item && item.snapshots).filter(Boolean);
    competitors.push({
      id, name,
      trend: snaps.slice(0, 4).reverse().map((s) => ({ weekStart: s.weekStart, postsInWindow: num(s.postsInWindow), avgLikes: num(s.avgLikes) })),
    });
    if (!snaps.length) continue;
    for (const s of sentencesFor(name, snaps, at)) highlights.push({ competitorId: id, name, text: s.text, weight: s.weight });
  }
  const ranked = highlights.map((h, i) => ({ h, i })).sort((a, b) => b.h.weight - a.h.weight || a.i - b.i).slice(0, 3).map((x) => x.h);
  return { highlights: ranked, competitors };
}

module.exports = { summarise, compare, insights };
