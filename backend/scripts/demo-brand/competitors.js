'use strict';
/**
 * The demo brand's competitors: five fictional Indian ayurveda-skincare brands (no real brand), each with 12 weekly
 * readings of its public Instagram profile, the way the weekly tracker stores them (CompetitorSnapshot).
 *
 * Method (decision D114, the same as Stage 2): only RAW material is invented, in the shape the scraper returns (a profile
 * with a follower count and the newest 12 posts with type, likes, comments, link, time, hashtags). Every stored snapshot
 * is then worked out by the app's OWN pure function (services/competitors/snapshot.js summarise), and the picture choice by
 * the app's own chooseKeys (services/competitors/postThumbs.js), so the Competitors page and Home cannot drift from the
 * data. Dates are counted back from today: the newest reading is the current India week, taken a few hours ago.
 *
 * The story: Glow Ghar is big and slow-growing, Amla and Ash is small and fast, Kaya Veda posts reels and gets about twice
 * the likes of its photos, Pure Petal Co leans on photos and carousels, Ritu Organics is regional with high engagement.
 * Every post link is a plausible but invented Instagram address; none of it names a real account or post.
 */
const mongoose = require('mongoose');
const { COMPETITORS } = require('./constants');
const { assetUrl } = require('./safety');
const { seeded } = require('./images');
const pics = require('./images3');
const { summarise } = require('../../services/competitors/snapshot');
const { weekStartOf } = require('../../services/week/weekMath');
const { chooseKeys, candidatePosts } = require('../../services/competitors/postThumbs');
const caps = require('../../config/competitors');

const DAY = 86400000;
const IST = 330 * 60000;
const WEEKS = caps.KEEP_WEEKS; // 12 readings each

/** What is made up about each competitor (the names and handles come from constants.js). */
const SPECS = Object.freeze({
  'Kaya Veda': {
    slug: 'kaya-veda', initials: 'KV', followers0: 44200, growth: 0.011, perWeek: 4, video: 0.45, carousel: 0.2, er: 0.026, type: 'direct',
    location: 'Bengaluru, Karnataka', description: 'Premium ayurvedic face oils and serums, sold online and in a few boutiques.', createdDaysAgo: 118,
    look: { bg: '#E4EEE8', accent: '#2F6B5E', fg: '#FFFFFF', soft: '#C5D8CE' }, packs: ['dropper', 'jar']
  },
  'Pure Petal Co': {
    slug: 'pure-petal-co', initials: 'PP', followers0: 58100, growth: 0.007, perWeek: 5, video: 0.25, carousel: 0.3, er: 0.019, type: 'national',
    location: 'Mumbai, Maharashtra', description: 'Rose and herbal skincare with a gentle, minimal range.', createdDaysAgo: 116,
    look: { bg: '#F8E4E8', accent: '#B5546B', fg: '#FFFFFF', soft: '#EBC9D1' }, packs: ['mist', 'tube']
  },
  'Ritu Organics': {
    slug: 'ritu-organics', initials: 'RO', followers0: 19600, growth: 0.014, perWeek: 3, video: 0.35, carousel: 0.15, er: 0.034, type: 'regional',
    location: 'Coimbatore, Tamil Nadu', description: 'Small-batch seasonal skincare and hair oils from Tamil Nadu.', createdDaysAgo: 112,
    look: { bg: '#F3EBD6', accent: '#7A6A2B', fg: '#FFFFFF', soft: '#E4D8B2' }, packs: ['bottle', 'jar']
  },
  'Glow Ghar': {
    slug: 'glow-ghar', initials: 'GG', followers0: 81300, growth: 0.004, perWeek: 6, video: 0.2, carousel: 0.25, er: 0.012, type: 'market_leader',
    location: 'Delhi NCR', description: 'A big everyday skincare and bath brand with a wide range and frequent offers.', createdDaysAgo: 109,
    look: { bg: '#FBEFD2', accent: '#D08A12', fg: '#FFFFFF', soft: '#F0D9A0' }, packs: ['tube', 'bottle']
  },
  'Amla and Ash': {
    slug: 'amla-and-ash', initials: 'AA', followers0: 8700, growth: 0.021, perWeek: 2, video: 0.5, carousel: 0.1, er: 0.045, type: 'startup',
    location: 'Hyderabad, Telangana', description: 'A young hair and scalp brand built on amla, ash gourd and hibiscus.', createdDaysAgo: 104,
    look: { bg: '#E6E3EF', accent: '#4B3F72', fg: '#FFFFFF', soft: '#CFC9E2' }, packs: ['jar', 'dropper']
  }
});

const HEADS = [
  'Monsoon glow ritual', 'Saffron season is here', 'Three ingredients, one ritual', 'Sunday self-care', 'Behind the batch',
  'Skin diary: week four', 'The festive gifting edit', 'Your night routine, simplified', 'Hair oil day', 'Ask us anything',
  'Ingredient of the week', 'Slow mornings', 'What is inside the jar', 'Meet the maker', 'Weekend reset'
];
const TAGS = ['ayurveda', 'skincare', 'glowingskin', 'cleanbeauty', 'indianskincare', 'naturalskincare', 'haircare', 'rituals', 'kumkumadi', 'selfcare'];
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const DAY_WEIGHT = [0.9, 1, 1, 1, 1.15, 1.1, 0.85]; // Monday .. Sunday

const istMidnight = (d) => { const t = d.getTime() + IST; return new Date(t - (((t % DAY) + DAY) % DAY) - IST); };
const istWeekday = (d) => (new Date(d.getTime() + IST).getUTCDay() + 6) % 7; // Monday = 0

/** Followers of a competitor at a moment: a steady weekly growth with a little wobble. */
function followersAt(spec, now, at) {
  const weeks = (at.getTime() - (now.getTime() - WEEKS * 7 * DAY)) / (7 * DAY);
  const wobble = 1 + Math.sin(at.getTime() / (3 * DAY)) * 0.002;
  return Math.round(spec.followers0 * ((1 + spec.growth) ** weeks) * wobble);
}

/** The raw posts of one competitor over the last 15 weeks, oldest first, in the scraper's shape. */
function rawPosts(spec, now) {
  const r = seeded(`zaya-competitor-${spec.slug}`);
  const out = [];
  const used = new Set();
  const first = new Date(istMidnight(now).getTime() - 15 * 7 * DAY);
  for (let day = first; day.getTime() < now.getTime(); day = new Date(day.getTime() + DAY)) {
    const wd = istWeekday(day);
    const p = (spec.perWeek / 7) * DAY_WEIGHT[wd];
    const count = (r() < p ? 1 : 0) + (r() < p * 0.12 ? 1 : 0);
    for (let n = 0; n < count; n += 1) {
      const x = r();
      const hour = x < 0.2 ? 9 : x < 0.4 ? 13 : 19 + Math.floor(r() * 3);
      const at = new Date(day.getTime() + (hour * 60 + Math.floor(r() * 50)) * 60000);
      if (at.getTime() > now.getTime() - 40 * 60000) continue;
      const y = r();
      const type = y < spec.video ? 'Video' : y < spec.video + spec.carousel ? 'Sidecar' : 'Image';
      let code;
      do { code = Array.from({ length: 11 }, () => ALPHABET[Math.floor(r() * ALPHABET.length)]).join(''); } while (used.has(code));
      used.add(code);
      const followers = followersAt(spec, now, at);
      const typeMult = type === 'Video' ? 2.1 : type === 'Sidecar' ? 1.25 : 1;
      const dayMult = wd >= 5 ? 1.2 : 1;
      const hourMult = hour >= 17 ? 1.12 : 1;
      const noise = 0.65 + r() * 0.7;
      const standout = r() > 0.96 ? 2.4 : 1;
      const likes = Math.max(5, Math.round(followers * spec.er * typeMult * dayMult * hourMult * noise * standout));
      const hidden = r() < 0.02; // Instagram sometimes hides the likes: stored as unknown
      const comments = Math.max(0, Math.round(likes * (0.018 + r() * 0.03)));
      const tags = [0, 1, 2].map(() => TAGS[Math.floor(r() * TAGS.length)]);
      const head = HEADS[Math.floor(r() * HEADS.length)];
      out.push({
        timestamp: at, type, likesCount: hidden ? -1 : likes, commentsCount: hidden ? -1 : comments, shortCode: code,
        url: `https://www.instagram.com/${type === 'Video' ? 'reel' : 'p'}/${code}/`, isPinned: false,
        caption: `${head}. ${tags.map((t) => `#${t}`).join(' ')}`, hashtags: tags, head, code, pack: spec.packs[Math.floor(r() * spec.packs.length)]
      });
    }
  }
  return out;
}

/** The takenAt of the reading for week `w` weeks back (0 = this week). Past weeks: Sunday afternoon; this week: a few hours ago. */
function takenAtFor(w, now) {
  if (w === 0) {
    const t = new Date(now.getTime() - 4 * 3600000);
    return weekStartOf(t) === weekStartOf(now) ? t : new Date(now.getTime() - 60000);
  }
  const monday = new Date(`${weekStartOf(new Date(now.getTime() - w * 7 * DAY))}T00:00:00Z`).getTime() - IST; // Monday 00:00 India time
  return new Date(monday + 6 * DAY + 15 * 3600000); // Sunday 15:00 India time
}

/**
 * The whole set. `userId`, `now`, `base` (the picture base, http://localhost:<port>).
 * Returns { competitors, snapshots, pictures: Map(relative path -> draw function), facts }.
 */
function build({ userId, now, base }) {
  const competitors = []; const snapshots = []; const pictures = new Map(); const facts = {};
  COMPETITORS.forEach((def, idx) => {
    const spec = SPECS[def.name];
    if (!spec) throw new Error(`No spec for the competitor ${def.name}.`);
    const comp = { ...spec, name: def.name, handle: def.handle };
    const id = new mongoose.Types.ObjectId();
    const posts = rawPosts(spec, now);
    const rows = [];
    for (let w = WEEKS - 1; w >= 0; w -= 1) {
      const takenAt = takenAtFor(w, now);
      const newest = posts.filter((p) => p.timestamp.getTime() <= takenAt.getTime()).slice(-12).reverse(); // the scraper returns the newest 12
      const profile = { followersCount: followersAt(spec, now, takenAt), postsCount: 90 + posts.filter((p) => p.timestamp <= takenAt).length };
      const s = summarise({ profile, posts: newest, now: takenAt });
      rows.push({ userId, competitorId: id, takenAt, handle: def.handle, ok: true, ...s });
    }
    const weeks = new Set(rows.map((r) => r.weekStart));
    if (weeks.size !== WEEKS) throw new Error(`${def.name}: two readings fell in the same week.`);
    snapshots.push(...rows);

    // pictures: the profile picture and the posts the app would keep a picture for
    const avatarRel = `competitors/${spec.slug}-avatar.jpg`;
    pictures.set(avatarRel, () => pics.competitorAvatarJpg(comp));
    const latest = rows[rows.length - 1];
    const keys = chooseKeys(candidatePosts(rows.slice().reverse(), [], now), { now });
    const byKey = new Map(posts.map((p) => [`p-${p.code}`, p]));
    const postThumbs = [];
    for (const key of keys) {
      const p = byKey.get(key);
      if (!p) continue;
      const rel = `competitors/${spec.slug}-${p.code}.jpg`;
      pictures.set(rel, () => pics.competitorPostJpg(comp, { code: p.code, head: p.head, pack: p.pack, type: p.type === 'Video' ? 'video' : 'image' }));
      postThumbs.push({ postKey: key, thumbUrl: assetUrl(base, rel), sourceKey: '', at: new Date(latest.takenAt) });
    }

    const createdAt = new Date(now.getTime() - spec.createdDaysAgo * DAY + idx * 3600000);
    const month = posts.filter((p) => now.getTime() - p.timestamp.getTime() <= 30 * DAY);
    // The older "Competitor Activity Feed" on the Competitors page reads the posts stored on the competitor itself: the ones of the
    // last 30 days that have a picture, newest first.
    const thumbKeys = new Set(postThumbs.map((t) => t.postKey));
    const feed = month.filter((p) => thumbKeys.has(`p-${p.code}`)).sort((a, b) => b.timestamp - a.timestamp).slice(0, 6).map((p) => ({
      platform: 'instagram', postUrl: p.url, content: p.caption, imageUrl: assetUrl(base, `competitors/${spec.slug}-${p.code}.jpg`),
      likes: Math.max(0, p.likesCount), comments: Math.max(0, p.commentsCount), shares: 0, sentiment: 'positive',
      postedAt: p.timestamp, postedAtTimestamp: p.timestamp.getTime(), fetchedAt: latest.takenAt, isRealData: false
    }));
    competitors.push({
      _id: id, userId, name: def.name, website: `https://${spec.slug.replace(/-/g, '')}.example`, industry: 'Beauty & Wellness',
      socialHandles: { instagram: def.handle }, description: spec.description, location: spec.location, posts: feed,
      metrics: {
        avgEngagement: Math.round(spec.er * 1000) / 10, postFrequency: `${spec.perWeek} posts a week`, audienceSize: latest.followers, followers: latest.followers,
        following: 180 + idx * 60, lastFetched: latest.takenAt
      },
      isActive: true, isAutoDiscovered: false, isIgnored: false, competitorType: spec.type, handleStatus: 'confirmed',
      avatarUrl: assetUrl(base, avatarRel), avatarUpdatedAt: new Date(now.getTime() - 2 * DAY), postThumbs,
      tracking: { failures: 0, lastCheckedAt: latest.takenAt, lastHandle: def.handle },
      createdAt, updatedAt: latest.takenAt
    });
    facts[def.name] = { followers: [rows[0].followers, latest.followers], postsLast30Days: month.length, thumbs: postThumbs.length };
  });
  return { competitors, snapshots, pictures, facts };
}

module.exports = { SPECS, WEEKS, build, rawPosts, takenAtFor, followersAt };
