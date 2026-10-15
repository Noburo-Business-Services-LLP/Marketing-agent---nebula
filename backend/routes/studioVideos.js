// The Videos flow (/api/videos): idea -> concept -> one clip from Gemini Omni -> optional changes.
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const router = express.Router();
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const BrandAsset = require('../models/BrandAsset');
const Product = require('../models/Product');
const StudioVideo = require('../models/StudioVideo');
const { callTextLLM } = require('../services/openAI');
const omni = require('../services/omniVideo');
const sv = require('../services/studioVideo');
const quarkBuckets = require('../services/quarkBuckets');
const { QUARK_COSTS, STUDIO_CLIP_SECONDS } = require('../config/apiCosts');

const COST = () => QUARK_COSTS.studio_video;
const MAX_REFS = 3;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const STALE_MS = 15 * 60 * 1000;
const userIdOf = (req) => String(req.user?.userId || req.user?.id || req.user?._id || '');

// Tiny per-account limiter: concepts are cheap, clips are not.
const hits = new Map();
function allowed(kind, userId, max, windowMs = 3600000, now = Date.now()) {
  const k = `${kind}:${userId}`;
  const list = (hits.get(k) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) { hits.set(k, list); return false; }
  list.push(now); hits.set(k, list); return true;
}

const shape = (v) => ({
  id: String(v._id), status: v.status, title: v.title, concept: v.concept, spokenLine: v.spokenLine,
  style: v.style, language: v.language, aspectRatio: v.aspectRatio, videoUrl: v.videoUrl,
  seconds: v.seconds, parent: v.parent ? String(v.parent) : null, change: v.change,
  quarks: v.quarks, error: v.status === 'failed' ? (v.error || 'The video could not be made. Your Quarks were returned.') : '',
  createdAt: v.createdAt, completedAt: v.completedAt
});

async function brandOf(userId) {
  const user = await User.findById(userId).select('businessProfile companyName').lean();
  const bp = (user && user.businessProfile) || {};
  return { name: bp.name || (user && user.companyName) || '', industry: bp.industry || '', location: bp.businessLocation || '', facts: bp.description || '' };
}

async function toRef(url) {
  try {
    if (!/^https:\/\//i.test(String(url))) return null;
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) return null;
    const mimeType = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
    if (!/^image\/(png|jpe?g|webp)$/i.test(mimeType)) return null;
    return { mimeType, data: buf.toString('base64') };
  } catch (_) { return null; }
}

/** Resolves what the person picked to their own saved photos. Ids that are not theirs are ignored. */
async function resolveReferences(userId, { characterIds = [], placeIds = [], productIds = [] }) {
  const out = [];
  const take = (arr) => (Array.isArray(arr) ? arr.map(String).filter((x) => /^[a-f0-9]{24}$/i.test(x)) : []);
  const chars = take(characterIds).length ? await BrandAsset.find({ _id: { $in: take(characterIds) }, user: userId, type: 'character' }).select('url name').lean() : [];
  const places = take(placeIds).length ? await BrandAsset.find({ _id: { $in: take(placeIds) }, user: userId, type: 'environment' }).select('url name').lean() : [];
  const prods = take(productIds).length ? await Product.find({ _id: { $in: take(productIds) }, user: userId }).select('imageUrl images name').lean() : [];
  if (chars[0]) out.push({ kind: 'person', name: chars[0].name, url: chars[0].url });
  if (places[0]) out.push({ kind: 'place', name: places[0].name, url: places[0].url });
  for (const p of prods) {
    const url = p.imageUrl || (Array.isArray(p.images) ? p.images[0] : '');
    if (url && out.length < MAX_REFS) out.push({ kind: 'product', name: p.name, url });
  }
  return out.slice(0, MAX_REFS);
}

router.get('/options', protect, async (req, res) => {
  const styles = Object.entries(sv.STYLES).map(([key, s]) => ({ key, label: s.label, hint: s.hint }));
  res.json({ success: true, styles, languages: [{ key: 'english', label: 'English' }, { key: 'tamil', label: 'Tamil' }, { key: 'none', label: 'No speech, music only' }], quarks: COST(), seconds: STUDIO_CLIP_SECONDS });
});

// Step 2 -> 3: turn the idea and choices into a concept the owner can read and edit. Free.
router.post('/concept', protect, async (req, res) => {
  try {
    const userId = userIdOf(req);
    if (!allowed('concept', userId, 40)) return res.status(429).json({ success: false, message: 'Please wait a little before planning another video.' });
    const b = req.body || {};
    const brand = await brandOf(userId);
    const refs = await resolveReferences(userId, b);
    const names = (kind) => refs.filter((r) => r.kind === kind).map((r) => r.name).filter(Boolean).join(', ');
    const language = sv.languageOf(b.language);
    const prompt = sv.buildConceptPrompt({
      idea: b.idea, style: b.style, language, brand,
      who: [sv.clip(b.who, 200), names('person') && `the person in the saved photo "${names('person')}"`].filter(Boolean).join('; '),
      where: [sv.clip(b.where, 200), names('place') && `the place in the saved photo "${names('place')}"`].filter(Boolean).join('; '),
      products: names('product')
    });
    const raw = await callTextLLM(prompt, { jsonMode: true, maxTokens: 900, language: language === 'tamil' ? 'tamil' : 'english', purpose: 'plan' });
    const c = sv.parseConcept(raw);
    if (!c.concept) return res.status(502).json({ success: false, message: 'We could not plan this video. Please try again.' });
    res.json({ success: true, ...c, references: refs.map((r) => ({ kind: r.kind, name: r.name, url: r.url })), quarks: COST() });
  } catch (e) {
    console.error('[videos] concept failed:', e.message);
    res.status(500).json({ success: false, message: 'We could not plan this video. Please try again.' });
  }
});

async function store(buffer) {
  const file = path.join(os.tmpdir(), `nebula-studio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`);
  fs.writeFileSync(file, buffer);
  try {
    const up = await require('../services/imageUploader').uploadVideoFile(file, 'nebula-studio-videos');
    return up && up.url;
  } finally { try { fs.unlinkSync(file); } catch (_) { /* temp file */ } }
}

/** Runs one clip in the background: make, store, mark done. On any failure the Quarks go back, once. */
async function run(doc, work, io = {}) {
  const makeIt = io.work || work;
  try {
    const out = await makeIt();
    if (!out.ok) throw Object.assign(new Error(out.message), { friendly: true });
    const url = await (io.store || store)(out.buffer);
    if (!url) throw Object.assign(new Error('The video could not be saved. Your Quarks were returned. Please try again.'), { friendly: true });
    await StudioVideo.updateOne({ _id: doc._id }, { $set: { status: 'completed', videoUrl: url, completedAt: new Date() } });
  } catch (e) {
    console.error('[videos] failed:', e.message);
    await fail(doc, e.friendly ? e.message : 'The video could not be made this time. Your Quarks were returned. Please try again.');
  }
}

async function fail(doc, message) {
  const claimed = await StudioVideo.findOneAndUpdate(
    { _id: doc._id, refunded: false },
    { $set: { status: 'failed', error: message, refunded: true, completedAt: new Date() } },
    { new: true }
  );
  if (claimed && claimed.quarks > 0) {
    await User.updateOne({ _id: doc.user }, { $inc: { 'credits.balance': claimed.quarks, 'credits.totalUsed': -claimed.quarks } });
    quarkBuckets.record({ user: doc.user, type: 'refund', quarks: claimed.quarks, action: 'studio_video_refund', ref: String(doc._id) });
  }
}

async function charge(userId, id) {
  await quarkBuckets.settle(userId).catch(() => null);
  const r = await quarkBuckets.spend(userId, COST(), { action: 'studio_video', description: 'Video', ref: id });
  return r.success;
}

router.post('/create', protect, async (req, res) => {
  try {
    const userId = userIdOf(req);
    if (!allowed('create', userId, 30)) return res.status(429).json({ success: false, message: 'Please wait a little before making another video.' });
    const active = await StudioVideo.countDocuments({ user: userId, status: 'processing', startedAt: { $gt: new Date(Date.now() - STALE_MS) } });
    if (active >= 2) return res.status(429).json({ success: false, message: 'Two videos are already being made. Please wait for one to finish.' });
    const b = req.body || {};
    const concept = sv.clip(b.concept, 700);
    if (!concept) return res.status(400).json({ success: false, message: 'Plan the video first.' });
    const style = sv.styleOf(b.style); const language = sv.languageOf(b.language);
    const aspectRatio = b.aspectRatio === '16:9' ? '16:9' : '9:16';
    const refs = await resolveReferences(userId, b);
    const brand = await brandOf(userId);
    const prompt = sv.assemblePrompt({
      concept, beats: Array.isArray(b.beats) ? b.beats.map((x) => sv.clip(x, 160)).slice(0, 4) : [],
      spokenLine: language === 'none' ? '' : sv.clip(b.spokenLine, 240), style, language, aspectRatio,
      who: sv.clip(b.who, 300), where: sv.clip(b.where, 300),
      hasPersonPhoto: refs.some((r) => r.kind === 'person'), hasPlacePhoto: refs.some((r) => r.kind === 'place'), hasProductPhoto: refs.some((r) => r.kind === 'product'),
      brandName: brand.name
    });
    const doc = await StudioVideo.create({
      user: userId, title: sv.clip(b.title, 60) || 'My video', idea: sv.clip(b.idea, 1200), concept, spokenLine: sv.clip(b.spokenLine, 240),
      style, language, aspectRatio, prompt, references: refs, quarks: COST(), seconds: STUDIO_CLIP_SECONDS
    });
    if (!(await charge(userId, String(doc._id)))) {
      await StudioVideo.deleteOne({ _id: doc._id });
      return res.status(403).json({ success: false, creditsExhausted: true, upgradeRequired: true, reason: 'quarks', message: `A video needs ${COST()} Quarks. Please top up or choose a plan.` });
    }
    res.status(202).json({ success: true, video: shape(doc) });
    setImmediate(() => run(doc, async () => {
      const loaded = (await Promise.all(refs.map((r) => toRef(r.url)))).filter(Boolean);
      return omni.generate({ prompt, references: loaded, aspectRatio });
    }));
  } catch (e) {
    console.error('[videos] create failed:', e.message);
    res.status(500).json({ success: false, message: 'We could not start the video. Please try again.' });
  }
});

router.post('/:id/change', protect, async (req, res) => {
  try {
    const userId = userIdOf(req);
    if (!allowed('create', userId, 30)) return res.status(429).json({ success: false, message: 'Please wait a little before making another change.' });
    const instruction = sv.clip(req.body && req.body.instruction, 400);
    if (!instruction) return res.status(400).json({ success: false, message: 'Say what to change.' });
    const base = await StudioVideo.findOne({ _id: req.params.id, user: userId, status: 'completed' });
    if (!base || !base.videoUrl) return res.status(404).json({ success: false, message: 'That video is not ready yet.' });
    const doc = await StudioVideo.create({
      user: userId, title: base.title, idea: base.idea, concept: base.concept, spokenLine: base.spokenLine, style: base.style,
      language: base.language, aspectRatio: base.aspectRatio, prompt: instruction, parent: base._id, change: instruction,
      references: base.references, quarks: COST(), seconds: STUDIO_CLIP_SECONDS
    });
    if (!(await charge(userId, String(doc._id)))) {
      await StudioVideo.deleteOne({ _id: doc._id });
      return res.status(403).json({ success: false, creditsExhausted: true, upgradeRequired: true, reason: 'quarks', message: `A change needs ${COST()} Quarks. Please top up or choose a plan.` });
    }
    res.status(202).json({ success: true, video: shape(doc) });
    setImmediate(() => run(doc, async () => {
      const r = await fetch(base.videoUrl);
      if (!r.ok) return { ok: false, message: 'The earlier video could not be opened. Your Quarks were returned.' };
      return omni.change({ videoBuffer: Buffer.from(await r.arrayBuffer()), instruction, aspectRatio: base.aspectRatio });
    }));
  } catch (e) {
    console.error('[videos] change failed:', e.message);
    res.status(500).json({ success: false, message: 'We could not start the change. Please try again.' });
  }
});

router.get('/', protect, async (req, res) => {
  const list = await StudioVideo.find({ user: userIdOf(req) }).sort({ createdAt: -1 }).limit(30).lean();
  res.json({ success: true, videos: list.map(shape) });
});

router.get('/:id', protect, async (req, res) => {
  const v = await StudioVideo.findOne({ _id: req.params.id, user: userIdOf(req) });
  if (!v) return res.status(404).json({ success: false, message: 'Video not found.' });
  // A job that has been running far too long was lost (a restart, a crash): finish it as failed and return the Quarks.
  if (v.status === 'processing' && Date.now() - new Date(v.startedAt).getTime() > STALE_MS) {
    await fail(v, 'The video took too long and was stopped. Your Quarks were returned. Please try again.');
    const again = await StudioVideo.findById(v._id);
    return res.json({ success: true, video: shape(again) });
  }
  res.json({ success: true, video: shape(v) });
});

router.delete('/:id', protect, async (req, res) => {
  await StudioVideo.deleteOne({ _id: req.params.id, user: userIdOf(req), status: { $ne: 'processing' } });
  res.json({ success: true });
});

module.exports = router;
module.exports.run = run;
