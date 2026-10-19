'use strict';
/**
 * The read model behind GET /api/competitors/best-posts (Home and the Competitors page). PURE: no database, no network,
 * no model call, never throws on missing fields. It only re-reads what the weekly tracker already stored.
 *
 * Score of a post (used for "best post"): likes + 3 x comments. A comment takes more effort than a like, the same weight
 * the snapshot's own top post uses. A post whose likes Instagram hides (stored as null) has no score and never wins.
 *
 * "What worked" is one plain sentence computed here from post type, India weekday and India hour, only when the last
 * 30 days hold at least MIN_POSTS_FOR_PATTERN posts with known likes, each compared group has at least MIN_GROUP posts,
 * and the better group's average likes are at least MIN_RATIO times the other's (and the other averages at least 1 like).
 * The strongest pattern wins (format, then weekend, then evening on a tie). Nothing is said otherwise.
 *
 * Briefs for "Make a post like this" are written here from the customer's own words (plan themes, own captions) and the
 * pattern; a competitor's name, handle or caption never enters a brief.
 * Rules and examples: docs/superpowers/ops/competitors-home.md
 */
const { weekStartOf } = require('../week/weekMath');

const DAY = 864e5;
const MONTH_DAYS = 30;
const SCORE_COMMENT_WEIGHT = 3;
const MIN_POSTS_FOR_PATTERN = 6;
const MIN_GROUP = 2;
const MIN_RATIO = 1.5;
const EVENING_HOUR = 17;
const MAX_WORKING = 3;
const MAX_TRENDING = 4;
const FESTIVAL_WINDOW_DAYS = 30;
const MAX_BRIEF = 200;
const MAKE_LABEL = 'Make a post like this';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const NOUN = { video: 'reel', image: 'photo', carousel: 'carousel' };
const PLURAL = { video: 'reels', image: 'photos', carousel: 'carousels' };
const BRIEF_NOUN = { video: 'reel', image: 'photo post', carousel: 'carousel' };

const asArray = (v) => (Array.isArray(v) ? v : []);
const isCount = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const toDate = (v) => { if (!v) return null; const d = v instanceof Date ? v : new Date(v); return Number.isFinite(d.getTime()) ? d : null; };
const ist = (d) => new Date(d.getTime() + 330 * 60000);
const istDate = (d) => ist(d).toISOString().slice(0, 10);
const dayLabel = (d) => { const x = ist(d); return `${WEEKDAYS[x.getUTCDay()]} ${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`; };
const shortDay = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : ''; };
const longDay = (iso) => { const d = new Date(`${iso}T00:00:00Z`); return Number.isFinite(d.getTime()) ? `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : ''; };
const fmt = (n) => new Intl.NumberFormat('en-IN').format(n);
const typeOf = (t) => {
  const v = String(t || '').toLowerCase();
  if (v === 'video' || v === 'reel' || v === 'reels') return 'video';
  if (v === 'sidecar' || v === 'carousel') return 'carousel';
  return 'image';
};
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const idOf = (c) => String((c && (c._id !== undefined ? c._id : c.id)) || '');
const handleOf = (c) => String((c && c.socialHandles && c.socialHandles.instagram) || (c && c.handle) || '').trim().replace(/^@/, '');
const HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/;
const POST_LINK = /^https:\/\/(www\.)?instagram\.com\/(p|reel|tv)\/[A-Za-z0-9_-]{1,64}\/?$/;

/**
 * A stable key for one stored post: its Instagram shortcode when the link is known ("p-Cx12_ab"), else its time
 * ("t-1760000000000"). With the competitor id it makes the post reference ("<competitorId>.<key>") that the Home drafts
 * use, so the page names a stored post and never sends any text of it.
 */
function postKeyOf(p) {
  const m = /instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]{1,64})\/?$/.exec(String((p && p.url) || ''));
  if (m) return `p-${m[1]}`;
  const at = toDate(p && p.at);
  return at ? `t-${at.getTime()}` : '';
}
const postRefOf = (competitorId, p) => { const k = postKeyOf(p); return competitorId && k ? `${competitorId}.${k}` : ''; };

/** likes + 3 x comments; null when the likes are not known. */
function scoreOf(p) {
  if (!p || !isCount(p.likes)) return null;
  return p.likes + SCORE_COMMENT_WEIGHT * (isCount(p.comments) ? p.comments : 0);
}

/** Posts of several snapshots (newest snapshot first), one per post link, newest reading kept, newest post first. */
function mergePosts(snapshots) {
  const seen = new Map();
  for (const s of asArray(snapshots)) {
    for (const raw of asArray(s && s.posts)) {
      const at = toDate(raw && raw.at);
      if (!at) continue;
      const type = typeOf(raw.type);
      const key = raw.url || `${at.getTime()}:${type}`;
      if (seen.has(key)) continue;
      seen.set(key, {
        at, type, likes: isCount(raw.likes) ? raw.likes : null, comments: isCount(raw.comments) ? raw.comments : null,
        pinned: raw.pinned === true, url: POST_LINK.test(String(raw.url || '')) ? raw.url : ''
      });
    }
  }
  return [...seen.values()].sort((a, b) => b.at - a.at);
}

const inMonth = (p, now) => p.at <= now && now - p.at <= MONTH_DAYS * DAY;
const inWeek = (p, now) => p.at <= now && weekStartOf(p.at) === weekStartOf(now);

/** Highest-scoring post of the India week or of the last 30 days, or null. A post with nothing on it never wins. */
function bestOf(posts, { now, period }) {
  const at = toDate(now) || new Date();
  let best = null;
  for (const p of asArray(posts)) {
    if (!p || !(p.at instanceof Date)) continue;
    if (!(period === 'week' ? inWeek(p, at) : inMonth(p, at))) continue;
    const s = scoreOf(p);
    if (s === null || s <= 0) continue;
    if (!best || s > best.score) best = { ...p, score: s };
  }
  return best;
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
function ratioText(r) {
  if (r >= 3) return `${Math.round(r)} times`;
  const one = Math.round(r * 10) / 10;
  return `${Number.isInteger(one) ? one : one.toFixed(1)} times`;
}

/** One plain sentence about a clear pattern in the last 30 days, or null. */
function whatWorked(posts, now) {
  const at = toDate(now) || new Date();
  const known = asArray(posts).filter((p) => p && p.at instanceof Date && inMonth(p, at) && isCount(p.likes));
  if (known.length < MIN_POSTS_FOR_PATTERN) return null;
  const found = [];
  const compare = (kind, order, a, b, text, best) => {
    if (a.length < MIN_GROUP || b.length < MIN_GROUP) return;
    const ma = mean(a.map((p) => p.likes)); const mb = mean(b.map((p) => p.likes));
    if (mb < 1) return;
    const r = ma / mb;
    if (r >= MIN_RATIO) found.push({ kind, order, ratio: r, best, text: text(ratioText(r)) });
  };

  // Format: the best type against every other post (named when only one other type is there).
  const byType = {};
  for (const p of known) (byType[p.type] = byType[p.type] || []).push(p);
  const groups = Object.entries(byType).filter(([, xs]) => xs.length >= MIN_GROUP);
  if (groups.length >= 2) {
    groups.sort((a, b) => mean(b[1].map((p) => p.likes)) - mean(a[1].map((p) => p.likes)));
    const [bestType, bestPosts] = groups[0];
    const rest = known.filter((p) => p.type !== bestType);
    const restTypes = [...new Set(rest.map((p) => p.type))];
    const other = restTypes.length === 1 ? PLURAL[restTypes[0]] : 'their other posts';
    compare('format', 0, bestPosts, rest, (r) => `${cap(PLURAL[bestType])} got ${r} the likes of ${other} on average this month.`, bestType);
  }
  // India weekend (Saturday and Sunday) against weekdays, either way round.
  const weekend = known.filter((p) => [0, 6].includes(ist(p.at).getUTCDay()));
  const weekday = known.filter((p) => ![0, 6].includes(ist(p.at).getUTCDay()));
  compare('day', 1, weekend, weekday, (r) => `Weekend posts got ${r} the likes of weekday posts on average this month.`, 'weekend');
  compare('day', 1, weekday, weekend, (r) => `Weekday posts got ${r} the likes of weekend posts on average this month.`, 'weekday');
  // India evening (from 5 pm) against earlier in the day, either way round.
  const evening = known.filter((p) => ist(p.at).getUTCHours() >= EVENING_HOUR);
  const earlier = known.filter((p) => ist(p.at).getUTCHours() < EVENING_HOUR);
  compare('time', 2, evening, earlier, (r) => `Posts after 5 pm got ${r} the likes of earlier posts on average this month.`, 'evening');
  compare('time', 2, earlier, evening, (r) => `Posts before 5 pm got ${r} the likes of evening posts on average this month.`, 'earlier');

  if (!found.length) return null;
  found.sort((a, b) => b.ratio - a.ratio || a.order - b.order);
  const w = found[0];
  return { kind: w.kind, best: w.best, ratio: Math.round(w.ratio * 10) / 10, text: w.text };
}

const consecutive = (prev, next) => {
  const a = Date.parse(`${prev}T00:00:00Z`); const b = Date.parse(`${next}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) && b - a === 7 * DAY;
};

/** What one competitor tile shows. `snapshots`: this competitor's good snapshots, newest first. */
function competitorCard({ competitor, status, snapshots, now, lastCheckedAt = null } = {}) {
  const at = toDate(now) || new Date();
  const snaps = asArray(snapshots).filter((s) => s && s.ok !== false);
  const latest = snaps[0] || null;
  const prior = snaps[1] || null;
  const handle = handleOf(competitor);
  const linked = HANDLE_RE.test(handle) && !['no_handle', 'unconfirmed'].includes(status);
  const thisWeek = weekStartOf(at);
  const card = {
    id: idOf(competitor), name: String((competitor && competitor.name) || 'A competitor'), handle: HANDLE_RE.test(handle) ? handle : '',
    status: status || 'waiting', profileUrl: linked ? `https://www.instagram.com/${handle}/` : null,
    followers: null, postsThisWeek: null, bestPost: null, worked: null,
    weekOf: latest ? latest.weekStart || null : null, isCurrentWeek: !!(latest && latest.weekStart === thisWeek), lastCheckedOn: null
  };
  const taken = toDate((latest && latest.takenAt) || lastCheckedAt);
  card.lastCheckedOn = taken ? istDate(taken) : null;
  if (!latest) return card;

  const f = isCount(latest.followers) && latest.followers > 0 ? latest.followers : null;
  if (f !== null) {
    const pf = prior && consecutive(prior.weekStart, latest.weekStart) && isCount(prior.followers) && prior.followers > 0 ? prior.followers : null;
    card.followers = { value: f, change: pf === null ? null : f - pf };
  }
  if (card.isCurrentWeek && isCount(latest.postsInWindow)) {
    card.postsThisWeek = { value: latest.postsInWindow, atLeast: latest.postsInWindowMayBeTruncated === true };
  }
  const posts = mergePosts(snaps).filter((p) => p.at <= at);
  const week = bestOf(posts, { now: at, period: 'week' });
  const month = week ? null : bestOf(posts, { now: at, period: 'month' });
  const best = week || month;
  if (best) {
    card.bestPost = { period: week ? 'week' : 'month', type: best.type, likes: best.likes, comments: best.comments, at: best.at.toISOString(), url: best.url, score: best.score, ref: postRefOf(card.id, best) };
  } else if (!asArray(latest.posts).length && latest.topPost) {
    // An older snapshot (before the post list was stored): its own best post, if it is recent and has likes.
    const t = latest.topPost; const tAt = toDate(latest.topPostAt);
    if (tAt && tAt <= at && at - tAt <= MONTH_DAYS * DAY && isCount(t.likes) && t.likes > 0) {
      const url = POST_LINK.test(String(t.url || '')) ? t.url : '';
      card.bestPost = {
        period: weekStartOf(tAt) === thisWeek ? 'week' : 'month', type: typeOf(t.type), likes: t.likes, comments: isCount(t.comments) ? t.comments : null,
        at: tAt.toISOString(), url, score: scoreOf({ likes: t.likes, comments: t.comments }), ref: postRefOf(card.id, { url, at: tAt })
      };
    }
  }
  card.worked = whatWorked(posts, at);
  return card;
}

// ---- briefs ---------------------------------------------------------------------------------------------------------
/** The first plain phrase of a caption: no links, @names, #tags, emoji or symbols; at most 60 characters. */
function cleanTopic(text) {
  let s = String(text || '').replace(/https?:\/\/\S+/gi, ' ').replace(/[@#][\p{L}\p{M}\p{N}_.]+/gu, ' ');
  s = s.split(/[.!?\n।]/)[0] || '';
  s = s.replace(/[^\p{L}\p{M}\p{N}\s,'&-]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > 60) { s = s.slice(0, 60); const sp = s.lastIndexOf(' '); if (sp > 20) s = s.slice(0, sp); }
  s = s.replace(/[\s,&-]+$/, '').trim();
  return s.length >= 3 ? s : '';
}

const lc = (s) => String(s || '').toLowerCase();
/** A topic that mentions a competitor (name or handle) is replaced by a neutral one. */
function safeTopic(topic, banned) {
  const t = String(topic || '').trim();
  if (!t) return '';
  const low = lc(t);
  for (const b of asArray(banned)) { const x = lc(b).trim(); if (x.length >= 3 && low.includes(x)) return ''; }
  return t;
}

const STYLE = {
  format: (w) => `${PLURAL[w.best]} are getting the most likes this month`,
  weekend: () => 'posted at the weekend', weekday: () => 'posted on a weekday',
  evening: () => 'posted in the evening, after 5 pm', earlier: () => 'posted before 5 pm'
};

function actionFor(type, brief) {
  const t = typeOf(type);
  return { label: MAKE_LABEL, kind: t === 'video' ? 'video' : 'post', mode: t === 'video' ? null : t === 'carousel' ? 'carousel' : 'single', brief: brief.slice(0, MAX_BRIEF) };
}

function competitorBrief(card, topic) {
  const w = card.worked;
  const type = w && w.kind === 'format' ? w.best : card.bestPost.type;
  const about = `A ${BRIEF_NOUN[type]} about ${topic}`;
  if (!w) return { type, brief: `${about}, in the style of the best recent posts in your market.` };
  const style = w.kind === 'format' ? STYLE.format(w) : STYLE[w.best]();
  return { type, brief: `${about}, in the style that works: ${style}.` };
}

const bannedOf = (cards) => asArray(cards).flatMap((c) => [c && c.name, c && c.handle]).filter(Boolean);

/** The strongest best posts across competitors (at most three), each with a neutral brief. */
function workingPosts(cards, { pillars = [], max = MAX_WORKING } = {}) {
  const banned = bannedOf(cards);
  const topic = safeTopic(asArray(pillars)[0], banned) || 'your business';
  return asArray(cards)
    .filter((c) => c && c.bestPost && isCount(c.bestPost.score))
    .sort((a, b) => b.bestPost.score - a.bestPost.score || (a.id < b.id ? -1 : 1))
    .slice(0, max)
    .map((c) => {
      const b = c.bestPost;
      const counts = `${fmt(b.likes)} ${b.likes === 1 ? 'like' : 'likes'}${isCount(b.comments) && b.comments > 0 ? ` and ${fmt(b.comments)} ${b.comments === 1 ? 'comment' : 'comments'}` : ''}`;
      const { type, brief } = competitorBrief(c, topic);
      return {
        competitorId: c.id, name: c.name, handle: c.handle, period: b.period, type: b.type, likes: b.likes, comments: b.comments, at: b.at, url: b.url, ref: b.ref || '',
        reason: `A ${NOUN[b.type]} on ${dayLabel(new Date(b.at))} with ${counts}, their best ${b.period === 'week' ? 'this week' : 'this month'}.`,
        worked: c.worked ? c.worked.text : null,
        action: actionFor(type, brief)
      };
    });
}

/** "Trending for you": one item per honest source, at most four. */
function trendItems({ cards = [], own = [], pillars = [], festivals = [], entitled = false, now } = {}) {
  const at = toDate(now) || new Date();
  const banned = bannedOf(cards);
  const themes = asArray(pillars).map((x) => safeTopic(x, banned)).filter(Boolean);
  const topic = themes[0] || 'your business';
  const items = [];

  if (entitled) {
    const top = workingPosts(cards, { pillars: themes, max: 1 })[0];
    if (top) {
      items.push({
        id: `competitor:${top.competitorId}`, source: 'competitor', label: 'From a competitor', title: `What worked for ${top.name}`,
        reason: top.worked || top.reason, action: top.action
      });
    }
  }

  let bestOwn = null;
  for (const o of asArray(own)) {
    const d = toDate(o && o.at);
    if (!d || d > at || at - d > MONTH_DAYS * DAY) continue;
    const s = scoreOf({ likes: o.likes, comments: o.comments });
    if (s === null || !(o.likes > 0)) continue;
    if (!bestOwn || s > bestOwn.score) bestOwn = { ...o, at: d, score: s, type: typeOf(o.type) };
  }
  if (bestOwn) {
    const counts = `${fmt(bestOwn.likes)} ${bestOwn.likes === 1 ? 'like' : 'likes'}${isCount(bestOwn.comments) && bestOwn.comments > 0 ? ` and ${fmt(bestOwn.comments)} ${bestOwn.comments === 1 ? 'comment' : 'comments'}` : ''}`;
    const ownTopic = safeTopic(cleanTopic(bestOwn.caption), banned) || topic;
    items.push({
      id: 'own:best', source: 'own', label: 'From your own posts', title: 'Your best post this month',
      reason: `Your ${NOUN[bestOwn.type]} on ${dayLabel(bestOwn.at)} got ${counts}.`,
      action: actionFor(bestOwn.type, `A new ${BRIEF_NOUN[bestOwn.type]} about ${ownTopic}, in the style of your best post this month.`)
    });
  }

  const fest = asArray(festivals).find((f) => f && isCount(f.daysAway) && f.daysAway <= FESTIVAL_WINDOW_DAYS);
  if (fest) {
    const when = fest.daysAway === 0 ? 'today' : fest.daysAway === 1 ? 'tomorrow' : `in ${fest.daysAway} days`;
    items.push({
      id: `festival:${fest.id}`, source: 'festival', label: 'Coming up', title: fest.name,
      reason: `${longDay(fest.date)}, ${when}.`,
      action: actionFor('image', `A post for ${fest.name} on ${shortDay(fest.date)}, about ${topic}.`)
    });
  }

  if (themes.length) {
    items.push({
      id: 'plan:0', source: 'plan', label: 'From your plan', title: themes[0], reason: 'One of the themes in your plan.',
      action: actionFor('image', `A post about ${themes[0]}, one of the themes in your plan.`)
    });
  }
  // Defensive: an item whose words do not pass the wording rule is left out rather than shown.
  return items.filter((i) => [i.title, i.reason, i.action.brief].every(isPlainText)).slice(0, MAX_TRENDING);
}

// ---- wording guard --------------------------------------------------------------------------------------------------
const BANNED = require('../../config/competitorWording');
/** True when a sentence follows the customer wording rule and says nothing unkind about anyone. */
function isPlainText(s) {
  const t = String(s || '');
  return !BANNED.some((re) => re.test(t));
}

module.exports = {
  scoreOf, postKeyOf, postRefOf, mergePosts, bestOf, whatWorked, competitorCard, workingPosts, trendItems, cleanTopic, safeTopic, isPlainText,
  SCORE_COMMENT_WEIGHT, MIN_POSTS_FOR_PATTERN, MIN_GROUP, MIN_RATIO, MONTH_DAYS, FESTIVAL_WINDOW_DAYS, MAX_WORKING, MAX_TRENDING
};
