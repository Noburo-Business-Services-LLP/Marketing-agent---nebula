// The demo brand seed, Stage 3 (competitors, Inbox, Photoshoot, Videos): pure parts only, no database, no network, no ffmpeg run.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');

const K = require('../scripts/demo-brand/constants');
const safety = require('../scripts/demo-brand/safety');
const competitors = require('../scripts/demo-brand/competitors');
const inbox = require('../scripts/demo-brand/inbox');
const photoshoot = require('../scripts/demo-brand/photoshoot');
const videos = require('../scripts/demo-brand/videos');
const content = require('../scripts/demo-brand/content');
const images3 = require('../scripts/demo-brand/images3');
const { competitorCard, workingPosts } = require('../services/competitors/bestPosts');
const { summarise } = require('../services/competitors/snapshot');
const { weekStartOf } = require('../services/week/weekMath');
const { analyzeEngagement } = require('../services/socialInboxService');
const demoProfile = require('../services/demoProfile');
const { QUARK_COSTS } = require('../config/apiCosts');
const { defaultModels } = require('../services/accountDeletion');
const { erasable } = require('../services/dataRegistry');

const NOW = new Date('2026-10-21T10:30:00Z'); // a Wednesday
const DAY = 86400000;
const BASE = 'http://localhost:5000';
const UID = new mongoose.Types.ObjectId();
const POST_LINK = /^https:\/\/(www\.)?instagram\.com\/(p|reel)\/[A-Za-z0-9_-]{1,64}\/?$/;

const comp = competitors.build({ userId: UID, now: NOW, base: BASE });
const box = inbox.build({ userId: UID, now: NOW });
const prodRows = K.PRODUCTS.map((p) => ({ _id: new mongoose.Types.ObjectId(), name: p.name, imageUrl: safety.assetUrl(BASE, `products/${p.slug}-1.jpg`), images: [safety.assetUrl(BASE, `products/${p.slug}-1.jpg`), safety.assetUrl(BASE, `products/${p.slug}-2.jpg`)] }));
const place = { _id: new mongoose.Types.ObjectId(), name: 'Our studio in Chennai', url: safety.assetUrl(BASE, 'places/studio-chennai.jpg') };
const shoot = photoshoot.build({ userId: UID, now: NOW, base: BASE, products: prodRows, place });
const vids = videos.build({ userId: UID, now: NOW, base: BASE });
const model = (n) => require(`../models/${n}`);
const sha = (o) => JSON.stringify(o);

test('competitors: five fictional brands (Kaya Veda and Pure Petal Co among them), 12 consecutive weekly readings each', () => {
  assert.strictEqual(comp.competitors.length, 5);
  assert.deepStrictEqual(comp.competitors.map((c) => c.name).sort(), K.COMPETITORS.map((c) => c.name).sort());
  assert.ok(comp.competitors.some((c) => c.name === 'Kaya Veda') && comp.competitors.some((c) => c.name === 'Pure Petal Co'));
  assert.strictEqual(comp.snapshots.length, 60);
  for (const c of comp.competitors) {
    const rows = comp.snapshots.filter((s) => String(s.competitorId) === String(c._id)).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    assert.strictEqual(rows.length, 12, c.name);
    rows.forEach((r, i) => {
      if (i) assert.strictEqual(Date.parse(`${r.weekStart}T00:00:00Z`) - Date.parse(`${rows[i - 1].weekStart}T00:00:00Z`), 7 * DAY, 'consecutive weeks');
      assert.ok(r.takenAt <= NOW && r.ok === true && r.handle.endsWith('.demo'));
      assert.strictEqual(weekStartOf(r.takenAt), r.weekStart);
    });
    assert.strictEqual(rows[11].weekStart, weekStartOf(NOW), 'the newest reading is this India week');
    assert.ok(rows[11].followers > rows[0].followers * 1.03 && rows[11].followers < rows[0].followers * 1.5, `${c.name} grew believably`);
    assert.ok(rows.every((r) => r.posts && r.posts.length > 0 && r.posts.length <= 12 && r.posts.every((p) => POST_LINK.test(p.url))));
  }
  // an unrelated handle is never used: the demo handles are fictional and end in .demo
  assert.ok(comp.competitors.every((c) => c.socialHandles.instagram.endsWith('.demo') && c.handleStatus === 'confirmed' && c.isActive && !c.isIgnored));
});

test('competitors: every stored reading is the app\'s own summarise() of the raw posts (nothing is typed in by hand)', () => {
  const c = comp.competitors[0];
  const latest = comp.snapshots.filter((s) => String(s.competitorId) === String(c._id)).sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0];
  const raw = competitors.rawPosts(competitors.SPECS[c.name], NOW).filter((p) => p.timestamp <= latest.takenAt).slice(-12).reverse();
  const again = summarise({ profile: { followersCount: latest.followers, postsCount: 90 + competitors.rawPosts(competitors.SPECS[c.name], NOW).filter((p) => p.timestamp <= latest.takenAt).length }, posts: raw, now: latest.takenAt });
  assert.deepStrictEqual({ ...again, posts: again.posts.map((p) => p.url) }, { ...Object.fromEntries(Object.keys(again).map((k) => [k, latest[k]])), posts: latest.posts.map((p) => p.url) });
  // all raw post links are unique across the five brands
  const codes = comp.snapshots.flatMap((s) => s.posts.map((p) => p.url));
  assert.ok(new Set(codes).size > 100);
});

test('competitors: Home and the Competitors page read them (tiles, best posts, what worked, pictures)', () => {
  const thumbsOn = (c) => new Map(c.postThumbs.map((t) => [t.postKey, t.thumbUrl]));
  const cards = comp.competitors.map((c) => {
    const snaps = comp.snapshots.filter((s) => String(s.competitorId) === String(c._id)).sort((a, b) => b.weekStart.localeCompare(a.weekStart)).slice(0, 4);
    return competitorCard({ competitor: c, status: 'tracking', snapshots: snaps, now: NOW, thumbs: thumbsOn(c) });
  });
  for (const card of cards) {
    assert.ok(card.followers && card.followers.value > 5000 && card.followers.change !== null, card.name);
    assert.ok(card.isCurrentWeek && card.bestPost && card.gallery.length === 6, card.name);
    assert.ok(card.avatarUrl && card.avatarUrl.startsWith(`${BASE}${safety.ASSET_PATH}/competitors/`), 'a profile picture the page accepts');
    assert.ok(card.gallery.filter((g) => g.thumbUrl).length >= 4, 'post pictures on the gallery');
    assert.ok(card.bestPost.thumbUrl, 'the best post has its picture');
  }
  assert.ok(cards.filter((c) => c.worked).length >= 3, 'a clear pattern for most brands');
  assert.ok(cards.filter((c) => c.worked && /Reels/.test(c.worked.text)).length >= 3, 'reels do best, like the brand\'s own results');
  assert.strictEqual(workingPosts(cards, { pillars: ['Ritual and ingredients'] }).length, 3);
});

test('competitors: the demo picture shape is accepted outside production only, and nothing else slips through', () => {
  const ok = `${BASE}${safety.ASSET_PATH}/competitors/kaya-veda-avatar.jpg`;
  assert.ok(demoProfile.isDemoCompetitorPicture(ok, { NODE_ENV: 'development' }));
  assert.ok(demoProfile.isDemoCompetitorPicture(ok, {}));
  assert.ok(!demoProfile.isDemoCompetitorPicture(ok, { NODE_ENV: 'production' }), 'never in production');
  for (const bad of [`${BASE}${safety.ASSET_PATH}/products/a.jpg`, 'http://evil.example/demo-assets/zaya/competitors/a.jpg', `${BASE}${safety.ASSET_PATH}/competitors/../x.jpg`, `https://localhost:5000${safety.ASSET_PATH}/competitors/a.jpg`, `${BASE}${safety.ASSET_PATH}/competitors/a.png`, '', null]) {
    assert.ok(!demoProfile.isDemoCompetitorPicture(bad, {}), String(bad));
  }
  const { isStoredAvatarUrl } = require('../services/competitors/avatar');
  const { isStoredThumbUrl, thumbMap } = require('../services/competitors/postThumbs');
  assert.ok(isStoredAvatarUrl(ok) && isStoredThumbUrl(ok));
  assert.ok(!isStoredAvatarUrl('http://example.com/a.jpg') && !isStoredThumbUrl('https://www.instagram.com/p/x/'), 'other links are still refused');
  // the thumbs switch does not hide a local demo picture, and still hides a hosted one
  const c = { postThumbs: [{ postKey: 'p-a', thumbUrl: ok }, { postKey: 'p-b', thumbUrl: 'https://res.cloudinary.com/x/image/upload/nebula-competitor-posts/a-b.webp' }] };
  assert.deepStrictEqual([...thumbMap(c, { on: false }).keys()], ['p-a']);
  assert.deepStrictEqual([...thumbMap(c, { on: true }).keys()], ['p-a', 'p-b']);
});

test('inbox: 25 conversations, the status mix, 3 waiting for approval, approval mode', () => {
  assert.deepStrictEqual(box.counts, { conversations: 25, unread: 7, read: 5, replied: 11, closed: 2, pending: 3, messages: 42 });
  assert.strictEqual(box.settings.automationMode, 'approval_required');
  assert.strictEqual(box.settings.enabled, true);
  assert.strictEqual(box.settings.channels.messages, true);
  assert.ok(box.conversations.every((c) => ['instagram', 'facebook', 'youtube'].includes(c.platform)));
  assert.ok(new Set(box.conversations.map((c) => c.platform)).size === 3);
  const unread = box.conversations.filter((c) => c.status === 'unread');
  assert.ok(unread.every((c) => c.unreadCount >= 1) && box.conversations.filter((c) => c.status !== 'unread').every((c) => c.unreadCount === 0), 'the unread count follows the status (Home counts unread conversations)');
  assert.ok(box.conversations.some((c) => c.priority === 'high' && c.sentiment === 'negative'), 'a complaint');
  assert.ok(box.conversations.some((c) => /bulk/i.test(c.lastMessagePreview)), 'a bulk pricing query');
  const text = box.messages.filter((m) => m.direction === 'inbound').map((m) => m.body).join(' ');
  assert.ok(/[஀-௿]/.test(text) && /irukku|pannalama/.test(text) && /mein|hai kya/.test(text), 'Tamil and Hindi mixes');
  assert.ok(/shade/.test(text) && /refund/.test(text) && /Ordered 6 days ago/.test(text) && /Is the toner alcohol free/.test(text) && /collaborat/.test(text), 'shade, complaint, delay, ingredient and collaboration messages');
});

test('inbox: scores and priorities are the app\'s own analyzeEngagement, replies carry the signature, nothing is dated in the future', () => {
  const byConv = new Map(box.conversations.map((c) => [String(c._id), c]));
  for (const m of box.messages) {
    const conv = byConv.get(String(m.conversationId));
    assert.ok(conv, 'every message belongs to a conversation');
    assert.ok(m.createdAt < NOW && conv.lastMessageAt < NOW);
    if (m.direction === 'inbound') {
      const a = analyzeEngagement(m.body);
      assert.deepStrictEqual([m.sentiment, m.priority, m.spamScore, m.leadScore, m.engagementScore], [a.sentiment, a.priority, a.spamScore, a.leadScore, a.engagementScore]);
    } else {
      assert.ok(m.body.endsWith(`\n\n${inbox.SIGNATURE}`) && m.senderType === 'agent' && m.status === 'sent' && m.autoSent === false);
    }
  }
  const ids = box.messages.map((m) => m.providerMessageId);
  assert.strictEqual(new Set(ids).size, ids.length);
  // the pending drafts: inbound direct messages with a drafted reply and a reason, exactly what GET /pending lists
  const pending = box.messages.filter((m) => m.ai.autoReplyStatus === 'pending_approval');
  assert.strictEqual(pending.length, 3);
  assert.ok(pending.every((m) => m.direction === 'inbound' && m.messageType === 'dm' && m.ai.autoReplyCandidate && m.ai.autoReplyReason && m.ai.draftSource === 'ai' && byConv.get(String(m.conversationId)).status === 'unread'));
  assert.ok(pending.some((m) => m.ai.autoReplyReason === 'Negative sentiment requires approval'));
  // four replies were drafted, approved and sent; none went out by itself in approval mode
  assert.strictEqual(box.messages.filter((m) => m.ai.autoReplyStatus === 'sent' && m.ai.autoReplyReason === 'Approved and sent').length, 4);
  assert.ok(box.messages.every((m) => !m.autoReplied && !m.autoSent));
  // the embedded copy matches the stored messages
  for (const conv of box.conversations) assert.strictEqual(conv.messages.length, box.messages.filter((m) => String(m.conversationId) === String(conv._id)).length);
});

test('photoshoot: three finished photoshoots with 14 local photos, planned by the app\'s own planPhotos', () => {
  assert.strictEqual(shoot.jobs.length, 3);
  assert.strictEqual(shoot.photos, 14);
  assert.deepStrictEqual(shoot.jobs.map((j) => j.pack).sort(), ['festival', 'flatlay', 'product']);
  const { MAX_PHOTOS_PER_JOB } = require('../config/photoshoot');
  const { packOf } = require('../config/photoshootPacks');
  for (const j of shoot.jobs) {
    assert.ok(j.status === 'done' && j.outcome === 'ok' && j.photos.length === j.photoCount && j.photoCount <= MAX_PHOTOS_PER_JOB && j.photoCount === j.count);
    assert.ok(j.quarks === j.quarksPerPhoto * j.photoCount && j.quarksPerPhoto === QUARK_COSTS.photoshoot_image);
    const pack = packOf(j.pack);
    assert.ok(pack.counts.includes(j.count) && pack.aspectRatios.includes(j.aspectRatio) && (!j.background || pack.backgrounds.includes(j.background)));
    assert.ok(j.photos.every((p, i) => p.index === i && p.status === 'done' && p.inLibrary && p.url.startsWith(`${BASE}${safety.ASSET_PATH}/photoshoot/`) && p.prompt && p.attempts === 1));
    assert.ok(j.finishedAt <= NOW && j.chargedAt < j.finishedAt && j.inFlight === undefined && !j.refunded);
    assert.ok(safety.hasMarker('PhotoshootJob', j));
  }
  assert.ok(shoot.jobs[0].place && shoot.jobs[0].photos.some((p) => p.inPlace), 'the product shoot uses the studio place');
  assert.strictEqual(new Set(shoot.jobs.map((j) => j.key)).size, 3);
  assert.strictEqual(shoot.pictures.size, 14);
  const day = (d) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
  assert.ok(shoot.jobs.every((j) => j.day === day(j.createdAt)));
});

test('photoshoot: the pictures are drawn images of the right shape', () => {
  const [rel, draw] = [...shoot.pictures][0];
  const buf = draw();
  assert.ok(buf[0] === 0xff && buf[1] === 0xd8, `${rel} is a JPEG`);
  const [w, h] = images3.PHOTO_SIZES['4:5'];
  const size = require('../scripts/demo-brand/images').imageSize(buf);
  assert.deepStrictEqual([size.width, size.height], [w, h]);
});

test('videos: five finished clips with local links, the poster beside each, and the reels point at them', () => {
  assert.strictEqual(videos.VIDEOS.length, 5);
  assert.strictEqual(vids.length, 5);
  assert.strictEqual(vids.filter((v) => v.aspectRatio === '16:9').length, 1);
  for (const v of vids) {
    assert.ok(v.status === 'completed' && v.videoUrl.startsWith(`${BASE}${safety.ASSET_PATH}/videos/`) && v.videoUrl.endsWith('.mp4') && v.clips === 1 && v.clipsDone === 1);
    assert.ok(v.seconds === videos.SECONDS && v.quarks === QUARK_COSTS.studio_video && v.completedAt < NOW && !v.refunded && v.title && v.concept);
    assert.ok(safety.hasMarker('StudioVideo', v));
  }
  assert.strictEqual(videos.SECONDS, 11);
  assert.deepStrictEqual(videos.build({ userId: UID, now: NOW, base: BASE, hasFile: () => false }), [], 'a video whose file could not be made is not listed');
  // reels in the Library
  const productIds = Object.fromEntries(K.PRODUCTS.map((p) => [p.slug, new mongoose.Types.ObjectId()]));
  const plain = content.build({ userId: UID, now: NOW, base: BASE, productIds });
  const linked = content.build({ userId: UID, now: NOW, base: BASE, productIds, videoUrls: videos.videoUrlsOf(BASE) });
  assert.deepStrictEqual(linked.summary, plain.summary, 'the Library counts do not change');
  const withVideo = linked.drafts.filter((d) => d.creative && d.creative.videoUrl);
  assert.ok(withVideo.length >= 8 && withVideo.every((d) => d.contentType === 'reel' && d.creative.videoUrl.endsWith('.mp4') && d.imageUrl.endsWith('.jpg')));
  assert.ok(plain.drafts.every((d) => !d.creative || !d.creative.videoUrl));
  assert.ok(linked.campaigns.filter((c) => c.creative.videoUrl).every((c) => c.creative.type === 'reel'));
});

test('videos: the ffmpeg command (three scenes, 0.5 s cross-fades, silent audio) and the missing-ffmpeg fallback', () => {
  const args = videos.ffmpegArgs({ scenes: ['a.jpg', 'b.jpg', 'c.jpg'], out: 'o.mp4', wide: false });
  assert.strictEqual(args.filter((a) => a === '-i').length, 4, 'three pictures and the silent track');
  const graph = args[args.indexOf('-filter_complex') + 1];
  assert.match(graph, /xfade=transition=fade:duration=0\.5:offset=3\.5/);
  assert.match(graph, /xfade=transition=fade:duration=0\.5:offset=7/);
  assert.match(graph, /s=720x1280/);
  assert.match(videos.ffmpegArgs({ scenes: ['a', 'b', 'c'], out: 'o', wide: true }).join(' '), /s=1280x720/);
  assert.strictEqual(args[args.indexOf('-t') + 1], '11');
  assert.ok(args.includes('libx264') && args.includes('yuv420p') && args.includes('+faststart'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zaya-s3-'));
  try {
    const calls = [];
    const fake = (bin, a) => { calls.push([bin, a]); fs.writeFileSync(a[a.indexOf('-t') + 2], 'mp4'); return { status: 0 }; };
    const v = videos.VIDEOS[0];
    const made = videos.makeVideo({ demoDir: dir, video: v, run: fake, ffmpeg: '/fake/ffmpeg' });
    assert.deepStrictEqual(made, { made: 2, skipped: '' });
    assert.ok(fs.existsSync(path.join(dir, videos.mp4Rel(v))) && fs.existsSync(path.join(dir, videos.posterRel(v))));
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(videos.makeVideo({ demoDir: dir, video: v, run: fake, ffmpeg: '/fake/ffmpeg' }), { made: 0, skipped: '' }, 'a second run makes nothing');
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'videos')).filter((f) => f.startsWith('.work')), [], 'no work folder left');
    const noFfmpeg = videos.makeVideo({ demoDir: dir, video: videos.VIDEOS[1], run: fake, ffmpeg: null });
    assert.deepStrictEqual(noFfmpeg, { made: 1, skipped: 'ffmpeg is not available' }, 'the poster is still made');
    const failing = videos.makeVideo({ demoDir: dir, video: videos.VIDEOS[2], run: () => ({ status: 1, stderr: 'boom' }), ffmpeg: '/fake/ffmpeg' });
    assert.match(failing.skipped, /ffmpeg failed/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('every Stage 3 row passes the real Mongoose schema', () => {
  const check = (name, list) => list.forEach((row, i) => { const e = new (model(name))(row).validateSync(); assert.ok(!e, `${name} ${i}: ${e && e.message}`); });
  check('Competitor', comp.competitors);
  check('CompetitorSnapshot', comp.snapshots);
  check('SocialInboxConversation', box.conversations);
  check('SocialInboxMessage', box.messages);
  check('AutoReplySettings', [box.settings]);
  check('PhotoshootJob', shoot.jobs);
  check('StudioVideo', vids);
  const productIds = Object.fromEntries(K.PRODUCTS.map((p) => [p.slug, new mongoose.Types.ObjectId()]));
  check('Draft', content.build({ userId: UID, now: NOW, base: BASE, productIds, videoUrls: videos.videoUrlsOf(BASE) }).drafts);
});

test('the demo picture links survive the URL setters of the real models', () => {
  const c = new (model('Competitor'))(comp.competitors[0]);
  assert.ok(c.avatarUrl.startsWith(`${BASE}${safety.ASSET_PATH}/competitors/`), 'avatar link kept');
  assert.strictEqual(c.postThumbs.length, comp.competitors[0].postThumbs.length);
  const v = new (model('StudioVideo'))(vids[0]);
  assert.strictEqual(v.videoUrl, vids[0].videoUrl);
});

test('no base64 anywhere; picture and video links are local demo-assets links; only post links go to Instagram', () => {
  const all = sha({ c: comp.competitors, s: comp.snapshots, i: box, p: shoot.jobs, v: vids });
  assert.ok(!/data:[a-z]+\/[a-z0-9.+-]+;base64/i.test(all) && !/base64,/i.test(all), 'no inline pictures');
  const links = all.match(/https?:\/\/[^"\\ ]+/g) || [];
  assert.ok(links.length > 300);
  for (const u of links) {
    if (u.startsWith(BASE)) assert.ok(u.startsWith(`${BASE}${safety.ASSET_PATH}/`), u);
    else assert.ok(POST_LINK.test(u) || /^https:\/\/[a-z0-9-]+\.example/.test(u), `unexpected outside link ${u}`);
  }
});

test('markers: every Stage 3 row carries its marker, and remove\'s filters name the demo user and cover every Stage 3 model', () => {
  const rows = { Competitor: comp.competitors, CompetitorSnapshot: comp.snapshots, SocialInboxConversation: box.conversations, SocialInboxMessage: box.messages, AutoReplySettings: [box.settings], PhotoshootJob: shoot.jobs, StudioVideo: vids };
  for (const [name, list] of Object.entries(rows)) {
    assert.ok(list.length > 0 && list.every((r) => safety.hasMarker(name, r)), name);
    const f = safety.markerFilter(name, UID);
    assert.strictEqual(String(f.user || f.userId), String(UID), name);
  }
  assert.ok(!safety.hasMarker('Competitor', { avatarUrl: 'https://res.cloudinary.com/x/image/upload/nebula-competitor-avatars/a.webp' }), 'a real customer\'s competitor is never matched');
  assert.ok(!safety.hasMarker('SocialInboxMessage', { providerMessageId: 'nebulaa-reply-123' }));
  assert.ok(!safety.hasMarker('StudioVideo', { videoUrl: 'https://res.cloudinary.com/x/video/upload/a.mp4' }));
  // remove: the marker pass lists every Stage 3 model and the registry sweep (what the app made for the account) lists them too
  const registry = new Set(erasable().map((r) => r.model));
  const models = defaultModels();
  for (const name of Object.keys(rows)) {
    assert.ok(Object.keys(safety.MARKERS).includes(name), `${name} has a marker`);
    assert.ok(registry.has(name) && models[name], `${name} is swept by the account erase registry`);
  }
});

test('the dates are counted back from today: another day gives readings of that week, never a future one', () => {
  const later = new Date('2026-11-04T03:00:00Z'); // Wednesday, early morning India time
  const b = competitors.build({ userId: UID, now: later, base: BASE });
  assert.strictEqual(b.snapshots.length, 60);
  assert.ok(b.snapshots.every((s) => s.takenAt <= later && s.posts.every((p) => p.at <= later)));
  const i = inbox.build({ userId: UID, now: later });
  assert.ok(i.messages.every((m) => m.createdAt < later));
});
