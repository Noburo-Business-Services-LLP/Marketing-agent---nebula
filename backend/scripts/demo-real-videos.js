'use strict';
/**
 * Keeps the real videos made in the dev app as the demo user (D127). Docs: docs/superpowers/ops/demo-real-videos.md
 *
 *   node scripts/demo-real-videos.js status                          counts of real, kept and drawn videos
 *   node scripts/demo-real-videos.js adopt                           DRY RUN: shows what would change
 *   CONFIRM_ADOPT=yes node scripts/demo-real-videos.js adopt         does it
 *
 * Only the database nebulaa_dev and only the demo account (demo-zaya@example.test). `adopt` tags each real completed video
 * with a keep marker, points the Library reels (posts and campaigns) at the real clips, and removes the drawn clips they
 * replace. `seed-demo-brand.js create` then keeps those videos and does not redraw their slots; `remove` still deletes
 * everything. No provider is called and nothing is charged.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const safety = require('./demo-brand/safety');
const rv = require('./demo-brand/realVideos');

const DEMO_DIR = path.join(__dirname, '..', 'demo-assets', 'zaya');

async function main({ argv, env, deps, log = console.log }) {
  const mode = (argv || [])[0];
  if (!['status', 'adopt'].includes(mode)) throw new Error('Usage: node scripts/demo-real-videos.js status | adopt   (CONFIRM_ADOPT=yes to act)');
  safety.assertDevUri(env && env.MONGODB_URI); // before any connection
  const { dbName } = await deps.connect(env.MONGODB_URI);
  try {
    safety.assertDevTarget(dbName);
    const user = await deps.findUser();
    if (!user) throw new Error(`${safety.DEMO_EMAIL} does not exist. Nothing was changed.`);
    if (!safety.isDemoUser(user)) throw new Error(`${safety.DEMO_EMAIL} is not the seeded demo account. Nothing was changed.`);
    const rows = await deps.listVideos(user._id);
    const s = rv.summarize(rows);
    log(`Demo videos: ${s.real} real (${s.kept} kept), ${s.drawn} drawn${s.other ? `, ${s.other} not finished` : ''}.`);
    if (mode === 'status') return { summary: s };
    const base = deps.assetBase || safety.DEFAULT_ASSET_BASE;
    const p = rv.plan({ rows, ...deps.slots(base) });
    log(`Plan: keep ${p.tag.length} new real video(s), relink ${p.relink.length} Library reel(s), remove ${p.removeRows.length} drawn video(s) and ${p.files.length} drawn file(s).`);
    for (const t of p.tag) log(`  keep ${t.id} as ${t.keep}`);
    for (const x of p.skipped) log(`  note: ${x}`);
    if (!p.tag.length) { log('Nothing to adopt.'); return { plan: p, done: false }; }
    if (String(env.CONFIRM_ADOPT || '').toLowerCase() !== 'yes') { log('DRY RUN: nothing was changed. Run again with CONFIRM_ADOPT=yes to do it.'); return { plan: p, done: false }; }
    const r = await deps.apply(user._id, p);
    log(`Done: ${r.tagged} kept, ${r.relinked} link(s) changed, ${r.removed} drawn video(s) removed, ${r.files} file(s) removed.`);
    return { plan: p, done: true, result: r };
  } finally {
    await deps.disconnect();
  }
}

function realDeps({ demoDir = DEMO_DIR } = {}) {
  const mongoose = require('mongoose');
  const models = () => require('../services/accountDeletion').defaultModels();
  const videosMod = require('./demo-brand/videos');
  const { PRODUCTS } = require('./demo-brand/constants');
  const { assetUrl } = safety;
  return {
    async connect(uri) { await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 }); return { dbName: mongoose.connection.name }; },
    async disconnect() { await mongoose.disconnect(); },
    async findUser() { models(); return mongoose.model('User').findOne({ email: safety.DEMO_EMAIL }).select('email ayrshare.profileKey').lean(); },
    async listVideos(uid) {
      models();
      return mongoose.model('StudioVideo').find({ user: uid }).select('status videoUrl title idea concept spokenLine createdAt demoKeep').lean();
    },
    slots: (base) => ({
      products: PRODUCTS.map((p) => ({ slug: p.slug, name: p.name, ingredients: p.ingredients })),
      studio: videosMod.VIDEOS.map((v) => ({ slug: v.slug, url: assetUrl(base, videosMod.mp4Rel(v)) })),
      reels: videosMod.REELS.map((r) => ({ key: r.slug, product: r.product, url: assetUrl(base, videosMod.mp4Rel(r)) }))
    }),
    async apply(uid, p) {
      const m = models();
      let tagged = 0; let relinked = 0; let removed = 0; let files = 0;
      for (const t of p.tag) tagged += (await m.StudioVideo.updateOne({ _id: t.id, user: uid }, { $set: { demoKeep: t.keep } })).modifiedCount;
      // posts and campaigns that play a drawn clip play the real one (exact link match, this account only)
      for (const l of p.relink) {
        relinked += (await m.Draft.updateMany({ userId: uid, 'creative.videoUrl': l.from }, { $set: { 'creative.videoUrl': l.to } })).modifiedCount;
        relinked += (await m.Campaign.updateMany({ userId: uid, 'creative.videoUrl': l.from }, { $set: { 'creative.videoUrl': l.to } })).modifiedCount;
      }
      if (p.removeRows.length) removed = (await m.StudioVideo.deleteMany({ _id: { $in: p.removeRows }, user: uid, videoUrl: safety.MARKERS.StudioVideo.tag.videoUrl })).deletedCount;
      for (const rel of p.files) {
        const f = path.resolve(demoDir, rel);
        if (f.startsWith(path.resolve(demoDir) + path.sep) && fs.existsSync(f)) { fs.rmSync(f, { force: true }); files += 1; }
      }
      return { tagged, relinked, removed, files };
    }
  };
}

if (require.main === module) {
  main({ argv: process.argv.slice(2), env: process.env, deps: realDeps() })
    .then(() => process.exit(0))
    .catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
}

module.exports = { main, realDeps, DEMO_DIR };
