// The Videos flow (/api/videos): idea -> concept -> one clip from Gemini Omni -> optional changes.
const { priceText } = require('../config/quarkWording');
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
const chain = require('../services/studioVideoChain');
const { QUARK_COSTS, STUDIO_CLIP_SECONDS } = require('../config/apiCosts');
const { generateOpenAIImage } = require('../services/openaiImage');

const COST = () => QUARK_COSTS.studio_video;
const spendGuard = require('../services/spendGuard');
// Refuse before charging when the daily ceiling is reached or the provider is switched off.
async function busy(res, action) {
  const g = await spendGuard.check(action);
  if (g.ok) return false;
  res.status(503).json({ success: false, serviceBusy: true, message: g.message });
  return true;
}
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
  style: v.style, language: v.language, voice: v.voice || 'female', aspectRatio: v.aspectRatio, videoUrl: v.videoUrl,
  clips: v.clips || 1, clipsDone: v.clipsDone || 0, platforms: Array.isArray(v.platforms) ? v.platforms : [], parts: Array.isArray(v.parts) ? v.parts.map((p) => ({ beats: p.beats || [], spokenLine: p.spokenLine || '' })) : [],
  notice: v.notice || '', seconds: v.seconds, parent: v.parent ? String(v.parent) : null, change: v.change,
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
  for (const c of chars.slice(0, 2)) out.push({ kind: 'person', name: c.name, url: c.url });
  if (places[0]) out.splice(Math.min(out.length, 2), 0, { kind: 'place', name: places[0].name, url: places[0].url });
  for (const p of prods) {
    const url = p.imageUrl || (Array.isArray(p.images) ? p.images[0] : '');
    if (url && out.length < MAX_REFS) out.push({ kind: 'product', name: p.name, url });
  }
  return out.slice(0, MAX_REFS);
}

router.get('/options', protect, async (req, res) => {
  const styles = Object.entries(sv.STYLES).map(([key, x]) => ({ key, label: x.label, hint: x.hint, image: x.image }));
  const languages = Object.keys(sv.LANGUAGES).map((key) => ({ key, label: sv.LANGUAGE_LABELS[key] }));
  const voices = sv.VOICES.map((key) => ({ key, label: key === 'male' ? 'Male voice' : 'Female voice' }));
  const lengths = Array.from({ length: sv.MAX_CLIPS }, (_, i) => ({ clips: i + 1, seconds: (i + 1) * STUDIO_CLIP_SECONDS, quarks: (i + 1) * COST() }));
  res.json({
    success: true, styles, languages, voices, lengths, aspectRatios: sv.ASPECT_RATIOS, platformShapes: sv.platformShapes(), platforms: sv.PLATFORM_IDS,
    // quarks is the price of one clip (kept for older screens); costPerClip is the same number, named for what it is.
    quarks: COST(), costPerClip: COST(), max: sv.MAX_CLIPS, referenceQuarks: QUARK_COSTS.studio_reference, seconds: STUDIO_CLIP_SECONDS, clipSeconds: STUDIO_CLIP_SECONDS
  });
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
    const clips = sv.clipsOf(b.clips);
    const prompt = sv.buildConceptPrompt({
      idea: b.idea, style: b.style, language, brand, clips, aspectRatio: sv.aspectOf(b.aspectRatio),
      who: [sv.clip(b.who, 200), names('person') && `the person in the saved photo "${names('person')}"`].filter(Boolean).join('; '),
      where: [sv.clip(b.where, 200), names('place') && `the place in the saved photo "${names('place')}"`].filter(Boolean).join('; '),
      products: names('product')
    });
    const raw = await callTextLLM(prompt, { jsonMode: true, maxTokens: 900 + 350 * (clips - 1), language: language === 'none' ? 'english' : language, purpose: 'plan' });
    const c = sv.parseConcept(raw, clips);
    if (!c.concept) return res.status(502).json({ success: false, message: 'We could not plan this video. Please try again.' });
    res.json({ success: true, ...c, references: refs.map((r) => ({ kind: r.kind, name: r.name, url: r.url })), clips, seconds: clips * STUDIO_CLIP_SECONDS, quarks: clips * COST() });
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
    // Back to the wallet that paid (recorded at charge time), never to a client record.
    const back = await quarkBuckets.refundTo(doc.user, claimed.quarks, { action: 'studio_video_refund', ref: String(doc._id), payerId: claimed.payer });
    if (!back.ok) console.error('[videos] could not return Quarks for', String(doc._id), '- no wallet to return them to');
  }
}

async function charge(userId, id, amount = COST()) {
  await quarkBuckets.settleWallet(userId).catch(() => null);
  const r = await quarkBuckets.spend(userId, amount, { action: 'studio_video', description: 'Video', ref: id });
  if (r.success) await StudioVideo.updateOne({ _id: id }, { $set: { payer: r.payerId } }).catch(() => null);
  return r.success;
}

// Hooks for tests: fakes for the network and ffmpeg steps of a background run. Empty in production.
const testIo = {};

/**
 * Runs a longer video in the background: clips one after another, joined into one file. Clip 1 failing returns
 * everything (as a single clip does); a later clip failing after a retry delivers the shorter video and returns
 * the Quarks for the clips not made.
 */
async function runChain(doc, work, io = {}) {
  const total = work.prompts.length;
  try {
    const references = io.loadRefs ? await io.loadRefs() : await work.loadRefs();
    const out = await chain.makeChain({ prompts: work.prompts, references, aspectRatio: work.aspectRatio }, {
      generate: io.generate || ((a) => omni.generate(a)),
      lastFrame: io.lastFrame, concat: io.concat,
      onClip: (done) => StudioVideo.updateOne({ _id: doc._id }, { $set: { clipsDone: done } })
    });
    if (!out.ok) {
      const m = String(out.message || '');
      throw Object.assign(new Error(m), { friendly: true, shown: /returned/i.test(m) ? m : `${m.replace(/\s*$/, '')} Your Quarks were returned.`.trim() });
    }
    const url = await (io.store || store)(out.buffer);
    if (!url) throw Object.assign(new Error('The video could not be saved. Your Quarks were returned. Please try again.'), { friendly: true });
    if (out.made >= total) {
      await StudioVideo.updateOne({ _id: doc._id }, { $set: { status: 'completed', videoUrl: url, clipsDone: total, seconds: total * STUDIO_CLIP_SECONDS, completedAt: new Date() } });
    } else {
      await finishShort(doc, out.made, total, url);
    }
  } catch (e) {
    console.error('[videos] failed:', e.message);
    await fail(doc, e.friendly ? (e.shown || e.message) : 'The video could not be made this time. Your Quarks were returned. Please try again.');
  }
}

/** Keeps the clips that were made as a shorter video and returns the Quarks for the ones that were not. Once only. */
async function finishShort(doc, made, total, url) {
  const secs = made * STUDIO_CLIP_SECONDS;
  const notice = `Only ${made} of ${total} parts could be made, so this video is ${secs} seconds instead of ${total * STUDIO_CLIP_SECONDS}. You were not charged for the missing ${total - made === 1 ? 'part' : 'parts'}.`;
  const before = await StudioVideo.findOneAndUpdate(
    { _id: doc._id, refunded: false },
    { $set: { status: 'completed', videoUrl: url, clipsDone: made, seconds: secs, notice, refunded: true, completedAt: new Date() } },
    { new: false }
  );
  if (!before) return;
  const per = Math.round((before.quarks || 0) / (before.clips || total));
  const back = (before.quarks || 0) - per * made;
  await StudioVideo.updateOne({ _id: doc._id }, { $set: { quarks: per * made } }).catch(() => null);
  if (back > 0) {
    const r = await quarkBuckets.refundTo(doc.user, back, { action: 'studio_video_refund', ref: String(doc._id), payerId: before.payer });
    if (!r.ok) console.error('[videos] could not return Quarks for', String(doc._id), '- no wallet to return them to');
  }
}

/** The per-clip plan: what the owner edited, padded or cut to the number of clips. */
function partsFrom(b, clips) {
  const src = Array.isArray(b.parts) ? b.parts : [];
  return Array.from({ length: clips }, (_, i) => {
    const p = src[i] || (i === 0 ? { beats: b.beats, spokenLine: b.spokenLine } : {});
    return { beats: Array.isArray(p.beats) ? p.beats.map((x) => sv.clip(x, 160)).filter(Boolean).slice(0, 4) : [], spokenLine: sv.clip(p.spokenLine, 240) };
  });
}

router.post('/create', protect, async (req, res) => {
  try {
    const userId = userIdOf(req);
    if (!allowed('create', userId, 30)) return res.status(429).json({ success: false, message: 'Please wait a little before making another video.' });
    if (await busy(res, 'studio_video')) return;
    const active = await StudioVideo.countDocuments({ user: userId, status: 'processing', startedAt: { $gt: new Date(Date.now() - STALE_MS * sv.MAX_CLIPS) } });
    if (active >= 2) return res.status(429).json({ success: false, message: 'Two videos are already being made. Please wait for one to finish.' });
    const b = req.body || {};
    const concept = sv.clip(b.concept, 700);
    if (!concept) return res.status(400).json({ success: false, message: 'Plan the video first.' });
    const style = sv.styleOf(b.style); const language = sv.languageOf(b.language);
    const voice = sv.voiceOf(b.voice); const clips = sv.clipsOf(b.clips);
    const aspectRatio = sv.aspectOf(b.aspectRatio); const platforms = sv.platformsOf(b.platforms);
    const refs = await resolveReferences(userId, b);
    const brand = await brandOf(userId);
    const parts = partsFrom(b, clips).map((p) => (language === 'none' ? { ...p, spokenLine: '' } : p));
    const base = {
      concept, style, language, voice, aspectRatio, who: sv.clip(b.who, 300), where: sv.clip(b.where, 300),
      hasPersonPhoto: refs.some((r) => r.kind === 'person'), hasPlacePhoto: refs.some((r) => r.kind === 'place'), hasProductPhoto: refs.some((r) => r.kind === 'product'),
      brandName: brand.name
    };
    const prompts = parts.map((p, k) => sv.assemblePrompt({ ...base, beats: p.beats, spokenLine: p.spokenLine, continuation: k > 0 }));
    const total = clips * COST();
    const doc = await StudioVideo.create({
      user: userId, title: sv.clip(b.title, 60) || 'My video', idea: sv.clip(b.idea, 1200), concept,
      spokenLine: parts.map((p) => p.spokenLine).filter(Boolean).join(' ').slice(0, 1200), style, language, voice, aspectRatio, clips, clipsDone: 0,
      parts: clips > 1 ? parts : [], platforms, prompt: prompts.join('\n---\n'), references: refs, quarks: total, seconds: clips * STUDIO_CLIP_SECONDS
    });
    // The whole price is taken in one charge, before anything is made: it either covers every clip or nothing starts.
    if (!(await charge(userId, String(doc._id), total))) {
      await StudioVideo.deleteOne({ _id: doc._id });
      return res.status(403).json({ success: false, creditsExhausted: true, upgradeRequired: true, reason: 'quarks', message: `${clips > 1 ? `A ${clips * STUDIO_CLIP_SECONDS} second video` : 'A video'} needs ${priceText(total)}. Please top up or choose a plan.` });
    }
    res.status(202).json({ success: true, video: shape(doc) });
    const loadRefs = async () => (await Promise.all(refs.map((r) => toRef(r.url)))).filter(Boolean);
    setImmediate(() => {
      if (clips === 1) {
        return run(doc, async () => omni.generate({ prompt: prompts[0], references: await loadRefs(), aspectRatio }), testIo);
      }
      return runChain(doc, { prompts, aspectRatio, loadRefs }, testIo);
    });
  } catch (e) {
    console.error('[videos] create failed:', e.message);
    res.status(500).json({ success: false, message: 'We could not start the video. Please try again.' });
  }
});

// Who could appear in this idea: up to three roles with a short description each. Free: a short text call.
router.post('/cast', protect, async (req, res) => {
  try {
    const userId = userIdOf(req);
    if (!allowed('cast', userId, 40)) return res.status(429).json({ success: false, message: 'Please wait a little.' });
    const idea = sv.clip(req.body && req.body.idea, 1000);
    if (!idea) return res.json({ success: true, cast: [] });
    const brand = await brandOf(userId);
    const raw = await callTextLLM(`A small Indian business wants a 10 second video. Suggest who could appear in it: at most 3 different people, each with a role and a one-line look. Base them only on the idea; do not invent facts.

IDEA: ${idea}
BUSINESS: ${sv.clip(brand.name, 80)} (${sv.clip(brand.industry, 60)}) in ${sv.clip(brand.location, 60)}

Return JSON only: {"cast":[{"role":"2 to 4 words","description":"age, looks, clothing and manner in one line, believable for a local setting"}]}`, { jsonMode: true, maxTokens: 500, purpose: 'plan' });
    let cast = [];
    try { const s = String(raw); const o = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)); cast = (o.cast || []).slice(0, 3).map((c) => ({ role: sv.clip(c.role, 40), description: sv.clip(c.description, 200) })).filter((c) => c.role && c.description); } catch (_) { cast = []; }
    res.json({ success: true, cast });
  } catch (e) {
    console.error('[videos] cast failed:', e.message);
    res.json({ success: true, cast: [] });
  }
});

// Make a person (a reference sheet) or a place with AI, before the video. The customer approves it or asks for another.
router.post('/reference', protect, async (req, res) => {
  const userId = userIdOf(req);
  const kind = req.body && req.body.kind === 'place' ? 'place' : 'person';
  try {
    if (!allowed('reference', userId, 20)) return res.status(429).json({ success: false, message: 'Please wait a little before making more pictures.' });
    if (await busy(res, 'studio_reference')) return;
    const cost = QUARK_COSTS.studio_reference;
    await quarkBuckets.settleWallet(userId).catch(() => null);
    const paid = await quarkBuckets.spend(userId, cost, { action: 'studio_reference', description: kind === 'person' ? 'Person for a video' : 'Place for a video' });
    if (!paid.success) return res.status(403).json({ success: false, creditsExhausted: true, upgradeRequired: true, reason: 'quarks', message: `This needs ${priceText(cost)}. Please top up or choose a plan.` });
    const brand = await brandOf(userId);
    let out = null;
    try {
      out = await generateOpenAIImage(sv.buildReferencePrompt({ kind, description: req.body && req.body.description, city: brand.location }), { aspectRatio: kind === 'person' ? '16:9' : '9:16', quality: 'medium' });
    } catch (e) { console.error('[videos] reference failed:', e.message); }
    if (!out || !out.success || !/^https:\/\//.test(String(out.imageUrl || ''))) {
      // Back to the wallet that was just charged (the agency pool for a client workspace).
      await quarkBuckets.refundTo(userId, cost, { action: 'studio_reference_refund', payerId: paid.payerId });
      return res.status(502).json({ success: false, message: 'We could not make that picture. Your Quarks were returned. Please try again.' });
    }
    res.json({ success: true, url: out.imageUrl, kind, quarks: cost });
  } catch (e) {
    console.error('[videos] reference error:', e.message);
    res.status(500).json({ success: false, message: 'We could not make that picture. Please try again.' });
  }
});

// Keep an approved picture in the brand assets so it can be used again. Only pictures made here are accepted.
router.post('/reference/approve', protect, async (req, res) => {
  try {
    const userId = userIdOf(req);
    const kind = req.body && req.body.kind === 'place' ? 'place' : 'person';
    const url = String(req.body && req.body.url || '');
    let host = ''; try { host = new URL(url).hostname; } catch (_) { host = ''; }
    if (host !== 'res.cloudinary.com' || !/\/nebula-campaign-posts\//.test(url)) return res.status(400).json({ success: false, message: 'That picture cannot be saved.' });
    const name = sv.clip(req.body && req.body.name, 60) || (kind === 'person' ? 'Person' : 'Place');
    const publicId = (/\/upload\/(?:v\d+\/)?(.+)\.[a-z0-9]+$/i.exec(url) || [])[1];
    if (!publicId) return res.status(400).json({ success: false, message: 'That picture cannot be saved.' });
    const asset = await BrandAsset.create({ user: userId, type: kind === 'person' ? 'character' : 'environment', name, url, cloudinaryPublicId: publicId, format: 'png' });
    res.status(201).json({ success: true, asset: { id: String(asset._id), name: asset.name, url: asset.url, type: asset.type } });
  } catch (e) {
    console.error('[videos] approve failed:', e.message);
    res.status(500).json({ success: false, message: 'We could not save that picture. Please try again.' });
  }
});

router.post('/:id/change', protect, async (req, res) => {
  try {
    const userId = userIdOf(req);
    if (!allowed('create', userId, 30)) return res.status(429).json({ success: false, message: 'Please wait a little before making another change.' });
    if (await busy(res, 'studio_video')) return;
    const instruction = sv.clip(req.body && req.body.instruction, 400);
    if (!instruction) return res.status(400).json({ success: false, message: 'Say what to change.' });
    const base = await StudioVideo.findOne({ _id: req.params.id, user: userId, status: 'completed' });
    if (!base || !base.videoUrl) return res.status(404).json({ success: false, message: 'That video is not ready yet.' });
    if ((base.clips || 1) > 1 && (base.seconds || 0) > STUDIO_CLIP_SECONDS) return res.status(400).json({ success: false, message: 'Changes are available for 10-second videos. For a longer video, make a new version.' });
    const doc = await StudioVideo.create({
      user: userId, title: base.title, idea: base.idea, concept: base.concept, spokenLine: base.spokenLine, style: base.style,
      language: base.language, voice: base.voice || 'female', platforms: base.platforms || [], aspectRatio: base.aspectRatio, prompt: instruction, parent: base._id, change: instruction,
      references: base.references, quarks: COST(), seconds: STUDIO_CLIP_SECONDS
    });
    if (!(await charge(userId, String(doc._id)))) {
      await StudioVideo.deleteOne({ _id: doc._id });
      return res.status(403).json({ success: false, creditsExhausted: true, upgradeRequired: true, reason: 'quarks', message: `A change needs ${priceText(COST())}. Please top up or choose a plan.` });
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
  if (v.status === 'processing' && Date.now() - new Date(v.startedAt).getTime() > STALE_MS * (v.clips || 1)) {
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
module.exports.runChain = runChain;
module.exports._io = testIo;
module.exports._money = { charge, fail }; // for tests: the two places the Videos flow moves Quarks
