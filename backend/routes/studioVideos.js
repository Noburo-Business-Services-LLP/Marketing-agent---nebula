// The Videos flow (/api/videos): idea -> concept -> one clip from Gemini Omni -> optional changes.
const { priceText } = require('../config/quarkWording');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const router = express.Router();
// A malformed id is a plain 400 before any query runs (middleware/validateObjectId.js).
require('../middleware/validateObjectId').applyObjectIdParams(router, ['id']);
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const BrandAsset = require('../models/BrandAsset');
const Product = require('../models/Product');
const StudioVideo = require('../models/StudioVideo');
const { listTimeout } = require('../utils/listQueryTimeout');
const { callTextLLM } = require('../services/openAI');
const omni = require('../services/omniVideo');
const sv = require('../services/studioVideo');
const quarkBuckets = require('../services/quarkBuckets');
const chain = require('../services/studioVideoChain');
const finishing = require('../services/studioVideoFinish');
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

// A queued video (consumer path, E9 B1) is shown as 'processing' with queued:true, so every screen keeps working.
const shape = (v) => ({
  id: String(v._id), status: v.status === 'queued' ? 'processing' : v.status, ...(v.status === 'queued' ? { queued: true } : {}), title: v.title, concept: v.concept, spokenLine: v.spokenLine,
  style: v.style, language: v.language, voice: v.voice || 'female', aspectRatio: v.aspectRatio, videoUrl: v.videoUrl,
  clips: v.clips || 1, clipsDone: v.clipsDone || 0, platforms: Array.isArray(v.platforms) ? v.platforms : [], parts: Array.isArray(v.parts) ? v.parts.map((p) => ({ beats: p.beats || [], spokenLine: p.spokenLine || '' })) : [],
  transition: v.transition || 'fade', subtitles: !!v.subtitles, logo: !!v.logo, endLine: v.endLine || '',
  notice: v.notice || '', seconds: v.seconds, parent: v.parent ? String(v.parent) : null, change: v.change,
  quarks: v.quarks, error: v.status === 'failed' ? (v.error || 'The video could not be made. Your Quarks were returned.') : '',
  createdAt: v.createdAt, completedAt: v.completedAt
});

async function brandOf(userId) {
  const user = await User.findById(userId).select('businessProfile companyName').lean();
  const bp = (user && user.businessProfile) || {};
  return { name: bp.name || (user && user.companyName) || '', industry: bp.industry || '', location: bp.businessLocation || '', facts: bp.description || '' };
}

// The brand logo link for this account (same sources as the Hero flow); '' when none is saved.
async function logoUrlOf(userId) {
  try {
    if (testIo.logoUrl) return await testIo.logoUrl(userId);
    const b = await require('../services/heroVideoBrief').loadBrand(userId);
    return (b && b.logoUrl) || '';
  } catch (_) { return ''; }
}

async function toRef(url) {
  try {
    if (!/^https:\/\//i.test(String(url))) return null;
    // SSRF-safe download (services/safeFetch.js): public https only, pinned address, size, time and type caps.
    const { buffer: buf, contentType } = await require('../services/safeFetch').safeFetchBuffer(url, { types: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'], maxBytes: MAX_IMAGE_BYTES });
    const mimeType = contentType || 'image/jpeg';
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

/** The change call: the earlier video, downloaded, and the instruction. Shared by the in-process and consumer paths. */
async function changeWork(baseUrl, instruction, aspectRatio, io = {}) {
  let videoBuffer;
  try {
    ({ buffer: videoBuffer } = await require('../services/safeFetch').safeFetchBuffer(baseUrl, { types: ['video/', 'application/octet-stream'], maxBytes: 200 * 1024 * 1024, timeoutMs: 120000 }));
  } catch (_) {
    return { ok: false, message: 'The earlier video could not be opened. Your Quarks were returned.' };
  }
  return (io.change || ((a) => omni.change(a)))({ videoBuffer, instruction, aspectRatio });
}

router.get('/options', protect, async (req, res) => {
  const styles = Object.entries(sv.STYLES).map(([key, x]) => ({ key, label: x.label, hint: x.hint, image: x.image }));
  const languages = Object.keys(sv.LANGUAGES).map((key) => ({ key, label: sv.LANGUAGE_LABELS[key] }));
  const voices = sv.VOICES.map((key) => ({ key, label: key === 'male' ? 'Male voice' : 'Female voice' }));
  const lengths = Array.from({ length: sv.MAX_CLIPS }, (_, i) => ({ clips: i + 1, seconds: (i + 1) * STUDIO_CLIP_SECONDS, quarks: (i + 1) * COST() }));
  const transitions = finishing.TRANSITIONS.map((t) => ({ key: t.key, label: t.label }));
  const hasLogo = !!(await logoUrlOf(userIdOf(req)));
  res.json({
    success: true, styles, languages, voices, lengths, transitions, hasLogo, endLineMax: finishing.END_LINE_MAX, aspectRatios: sv.ASPECT_RATIOS, platformShapes: sv.platformShapes(), platforms: sv.PLATFORM_IDS,
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

// ---- consumer path only (E9 stage B1, services/studioVideoConsumer.js): each clip is stored as soon as it is made ----
const matchedOf = (r) => Number(r && (r.matchedCount !== undefined ? r.matchedCount : (r.n !== undefined ? r.n : r.modifiedCount))) || 0;

/** Uploads one finished clip so a later run can resume after it (same uploader as the finished video). */
async function storeClip(buffer) {
  const file = path.join(os.tmpdir(), `nebula-studio-clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`);
  fs.writeFileSync(file, buffer);
  try {
    const up = await require('../services/imageUploader').uploadVideoFile(file, 'nebula-studio-clips');
    return up && up.url;
  } finally { try { fs.unlinkSync(file); } catch (_) { /* temp file */ } }
}

/** Downloads a stored clip (same caps as the change flow). */
async function loadClip(url) {
  const { buffer } = await require('../services/safeFetch').safeFetchBuffer(url, { types: ['video/', 'application/octet-stream'], maxBytes: 200 * 1024 * 1024, timeoutMs: 120000 });
  return buffer;
}

/** The clips an earlier run stored, in order, as long as they can be read back: [{ url, buffer }]. */
async function resumeClips(doc, total, io = {}) {
  const urls = (Array.isArray(doc.clipUrls) ? doc.clipUrls : []).slice(0, total);
  const out = [];
  for (const url of urls) {
    if (!url) break;
    let buffer = null;
    try { buffer = await (io.loadClip || loadClip)(url); } catch (_) { buffer = null; }
    if (!buffer || !buffer.length) break; // the stored prefix ends here: from this clip on, clips are made again
    out.push({ url, buffer });
  }
  return out;
}

/** Stored links of an earlier run that the resume could not use (after the first unreadable clip): their files are deleted. */
async function dropUnresumed(doc, stored, io = {}) {
  const kept = new Set(stored.map((x) => x.url));
  await dropClips((Array.isArray(doc.clipUrls) ? doc.clipUrls : []).filter((u) => u && !kept.has(u)), io);
}

/**
 * After clip k is made on the consumer path: store it, then write clipsDone and the stored links in ONE write that
 * only matches while this run still holds the claim. No match = the run lost its claim: delete the upload and stop.
 * `urls` is the run's stored prefix (updated in place). An upload that fails does not stop the video; only clips
 * after an unbroken prefix are stored (a resume needs every clip before it).
 */
async function keepClip(doc, ctl, io, urls, buffer, k) {
  let url = null;
  if (urls.length === k) {
    try { url = await (io.storeClip || storeClip)(buffer); } catch (e) { console.error('[videos] could not store a clip of', String(doc._id), e.message); url = null; }
  }
  const next = url ? [...urls, url] : urls.slice();
  let r = null;
  try {
    r = await StudioVideo.updateOne({ _id: doc._id, status: 'processing', ...ctl.owner }, { $set: { clipsDone: k + 1, clipUrls: next, leaseUntil: ctl.leaseEnd() } });
  } catch (e) {
    console.error('[videos] could not record a clip of', String(doc._id), e.message);
    // Unknown whether the write landed (a lost reply). Look: recorded = keep it as a success; not recorded = delete the
    // upload; cannot tell = keep the file (a link to a missing file only makes a later run make the clip again).
    let row = null; let known = true;
    try { row = await StudioVideo.findOne({ _id: doc._id }).select({ status: 1, workerId: 1, attempts: 1, clipUrls: 1 }).lean(); } catch (_) { known = false; }
    const landed = !!(url && row && Array.isArray(row.clipUrls) && row.clipUrls.includes(url));
    if (landed) { urls.length = 0; urls.push(...next); return; }
    if (url && known) await discardFile(url, io);
    return; // the heartbeat and the next check decide
  }
  if (!matchedOf(r)) {
    ctl.lose();
    if (url) await discardFile(url, io);
    throw Object.assign(new Error('run lost its claim'), { stopRun: true });
  }
  urls.length = 0; urls.push(...next);
}

/** Deletes stored clips once the video is closed (best effort, never throws, not awaited by callers that must not wait). */
async function dropClips(urls, io = testIo) {
  for (const u of Array.isArray(urls) ? urls : []) if (u) await discardFile(u, io);
}

/** Runs one clip in the background: make, store, mark done. On any failure the Quarks go back, once. */
async function run(doc, work, io = {}, fin = null, ctl = null) {
  const makeIt = io.work || work;
  const urls = [];
  try {
    let out = null;
    if (ctl) {
      // Consumer path: a clip an earlier run already made and stored is used again, never made (or paid for) twice.
      const stored = await resumeClips(doc, 1, io);
      await dropUnresumed(doc, stored, io);
      if (stored.length) { out = { ok: true, buffer: stored[0].buffer }; urls.push(stored[0].url); }
    }
    if (!out) {
      if (ctl) await ctl.check();
      out = await makeIt();
      if (out.ok && ctl) await keepClip(doc, ctl, io, urls, out.buffer, 0);
    }
    if (!out.ok) throw Object.assign(new Error(out.message), { friendly: true });
    if (ctl) ctl.finishing();
    const done = ctl ? await ctl.cpu(() => applyFinish(out.buffer, fin, io, null)) : await applyFinish(out.buffer, fin, io, null);
    if (ctl) await ctl.check();
    const url = await (io.store || store)(done.buffer);
    if (!url) throw Object.assign(new Error('The video could not be saved. Your Quarks were returned. Please try again.'), { friendly: true });
    const won = await completeIfOpen(doc, { status: 'completed', videoUrl: url, completedAt: new Date(), ...(done.notice ? { notice: done.notice } : {}), ...(done.seconds ? { seconds: done.seconds } : {}), ...(ctl ? { leaseUntil: null } : {}) }, url, io, ctl ? ctl.owner : null);
    if (won && ctl) await dropClips(urls, io);
    if (!won) return;
  } catch (e) {
    if (ctl && e && e.stopRun) return; // this run no longer holds the video: whoever took it over owns it now
    console.error('[videos] failed:', e.message);
    const closed = await fail(doc, e.friendly ? e.message : 'The video could not be made this time. Your Quarks were returned. Please try again.', ctl ? ctl.owner : null);
    if (closed && ctl) await dropClips(urls, io);
  }
}

/**
 * The finishing pass (subtitles, logo, closing line). Never throws: on any problem the unfinished video comes back
 * with a plain notice, and the video is never failed or refunded because of it.
 * fin = { features, parts, language, logoUrl } or null for no finishing.
 */
async function applyFinish(buffer, fin, io, timing) {
  if (!fin || !finishing.wantsFinish(fin.features)) return { buffer, notice: '', seconds: null };
  try {
    const r = await (io.finish || finishing.finishVideo)({ buffer, features: fin.features, parts: fin.parts, language: fin.language, join: timing, logoUrl: fin.logoUrl });
    return { buffer: r.buffer || buffer, notice: r.notice || '', seconds: r.seconds ? Math.round(r.seconds * 10) / 10 : null };
  } catch (e) {
    console.error('[videos] finishing failed:', e.message);
    const f = fin.features;
    const note = [f.subtitles && finishing.NOTICE.subtitles, f.endLine && finishing.NOTICE.endLine, f.logo && finishing.NOTICE.logo].filter(Boolean).join(' ');
    return { buffer, notice: note, seconds: null };
  }
}

const MAX_REFUND_TRIES = 5;
const REFUNDING_STALE_MS = 2 * 60 * 1000;
const OPEN = (id) => ({ _id: id, status: 'processing', refunded: false, refundState: { $ne: 'refunding' } });
// `filter` adds the claim's conditions on the consumer path ({ workerId, attempts }, and the lease end for the lease
// sweep) or replaces the status ({ status: 'queued' } for a queued video nobody claimed).
const openFor = (id, filter) => ({ ...OPEN(id), ...(filter || {}) });

/** A refund that did not land needs a person: same alert helpers the Photoshoot module uses. */
function alertRefund(text, final = false) {
  if (testIo.alert) return testIo.alert(text, final);
  try {
    const ops = require('../services/opsAlerts');
    ops.recordFailure('studio_video_refund', text);
    if (final) ops.notify({ key: `studio_video_refund_gave_up:${text}`, subject: 'Nebulaa alert: a Videos refund needs a person', text: `${text}\n\nReturn it by hand and set refundState to done on the video.` });
  } catch (_) { /* best effort */ }
}

/** Pays a claimed refund (refundState 'refunding'), then marks it done. Returns true when the Quarks are back. */
async function payClaimed(row) {
  const id = String(row._id);
  let ok = false;
  try {
    const r = await quarkBuckets.refundTo(row.user, row.refundAmount, { action: 'studio_video_refund', ref: id, payerId: row.refundPayer });
    ok = !!(r && r.ok);
  } catch (e) { console.error('[videos] refund threw for', id, e.message); }
  if (ok) {
    await StudioVideo.updateOne({ _id: row._id, refundState: 'refunding' }, { $set: { refunded: true, refundState: 'done', refundFailed: false } }).catch((e) => console.error('[videos] could not mark refund done for', id, e.message));
    return true;
  }
  console.error('[videos] could not return Quarks for', id);
  await StudioVideo.updateOne({ _id: row._id, refundState: 'refunding' }, { $set: { refundFailed: true } }).catch(() => null);
  alertRefund(`Videos ${id}: the refund did not land (Quarks: ${row.refundAmount}); the sweep will retry.`);
  return false;
}

/**
 * Closes a processing video and returns Quarks, safely:
 *  - only what the charge proof shows was spent, never more, and only when no refund exists yet;
 *  - the claim (status change, amount, wallet, refundState 'refunding') is ONE atomic update, then the refund is paid,
 *    then refunded:true is written. A crash in between leaves 'refunding' for the sweep.
 * setFor(proof) returns the fields to set on the video; refundFor(doc, proof) the Quarks wanted back.
 */
async function closeWithRefund(doc, setFor, refundFor, filter = null) {
  const id = String(doc._id);
  let proof;
  try {
    proof = await quarkBuckets.chargeProof(id, { userId: String(doc.user), payerId: doc.payer ? String(doc.payer) : '' });
  } catch (e) {
    console.error('[videos] cannot read the charge proof for', id, '- left open for the sweep:', e.message);
    return null;
  }
  const spent = proof && proof.spend ? proof.spend.quarks : 0;
  const amount = proof && proof.spend && !proof.refunded ? Math.min(Math.max(0, Math.round(refundFor(doc, proof))), spent) : 0;
  const set = { ...setFor(proof || {}), completedAt: new Date(), refundAmount: amount };
  if (amount <= 0) {
    return StudioVideo.findOneAndUpdate(openFor(doc._id, filter), { $set: { ...set, refunded: true, refundState: '' } }, { new: true });
  }
  const claimed = await StudioVideo.findOneAndUpdate(openFor(doc._id, filter), { $set: { ...set, refundState: 'refunding', refundPayer: String(proof.spend.payer || ''), refundStartedAt: new Date(), refundTries: 0, refundFailed: false } }, { new: true });
  if (claimed) await payClaimed(claimed);
  return claimed;
}

async function fail(doc, message, filter = null) {
  return closeWithRefund(
    doc,
    (proof) => ({ status: 'failed', error: proof.spend ? message : 'The video could not be started. You were not charged.' }),
    (d) => d.quarks || 0,
    filter
  );
}

/** Completes a video only while it is still open (not failed, refunded or being refunded). Otherwise the file is discarded. */
async function completeIfOpen(doc, set, url, io = {}, filter = null) {
  const won = await StudioVideo.findOneAndUpdate(openFor(doc._id, filter), { $set: set }, { new: true });
  if (won) return won;
  console.error('[videos] finished after it was closed and refunded; not delivering', String(doc._id));
  await discardFile(url, io);
  return null;
}

/** Deletes an uploaded video nobody will see (best effort; never throws). */
async function discardFile(url, io = {}) {
  try {
    if (io.discard) await io.discard(url);
    else {
      const publicId = (/\/upload\/(?:v\d+\/)?(.+)\.[a-z0-9]+$/i.exec(String(url)) || [])[1];
      if (publicId) await require('cloudinary').v2.uploader.destroy(publicId, { resource_type: 'video' });
    }
  } catch (_) { /* best effort */ }
}

async function charge(userId, id, amount = COST(), units = 1) {
  await quarkBuckets.settleWallet(userId).catch(() => null);
  const r = await quarkBuckets.spend(userId, amount, { action: 'studio_video', description: 'Video', ref: id, units });
  if (r.success) await StudioVideo.updateOne({ _id: id }, { $set: { payer: r.payerId } }).catch(() => null);
  return r.success;
}

/** The charge did not (or may not have) land: delete the record when nothing was charged, else close it with a proven refund. */
async function settleUnstarted(doc) {
  if (!doc) return;
  try {
    const p = await quarkBuckets.chargeProof(String(doc._id), { userId: String(doc.user), payerId: doc.payer ? String(doc.payer) : '' });
    if (!p.spend) { await StudioVideo.deleteOne({ _id: doc._id }); return; }
    // Only an unclaimed row: if a worker already holds it (the queue flip landed but its reply was lost) the live run owns it.
    await fail(doc, 'The video could not be started. Your Quarks were returned. Please try again.', { workerId: null });
  } catch (e) { console.error('[videos] could not settle an unstarted video', String(doc._id), e.message); }
}

const consumer = () => require('../services/studioVideoConsumer');

/**
 * A charged consumer-path request threw after the queue flip may have landed (a lost reply). Re-reads the row: when it is
 * queued or a worker already holds it, the video was accepted, so the caller answers 202 with it and must NOT refund.
 * Returns the row, or null when it was not accepted (or cannot be read: then settleUnstarted's unclaimed-only fail applies).
 */
async function acceptedAfterLostReply(doc) {
  try {
    const row = await StudioVideo.findOne({ _id: doc._id }).lean();
    return row && (row.status === 'queued' || row.workerId) ? row : null;
  } catch (_) { return null; }
}

/**
 * Consumer path: the charge landed, so the row (created 'processing' with no worker, which no consumer claims) becomes
 * 'queued'. Throws when the flip did not happen, so the caller's settleUnstarted refunds the proven charge.
 */
async function queueAfterCharge(doc) {
  const q = await StudioVideo.findOneAndUpdate({ _id: doc._id, status: 'processing', workerId: null }, { $set: { status: 'queued', queuedAt: new Date() } }, { new: true });
  if (!q) throw new Error('the video could not be queued');
  return q;
}

/**
 * Runs a video a consumer claimed (services/studioVideoConsumer.js). `ctl` = { owner: { workerId, attempts }, check(),
 * lose(), leaseEnd(), cpu(fn), finishing() }. Every write is conditional on the claim; a run that lost it stops quietly.
 */
async function runClaimed(doc, ctl, ioIn = testIo) {
  const w = doc.work || {};
  // A row that was claimed before (a lost lease, a SIGTERM hand-back) asks Omni again for clips an earlier run may already
  // have paid for: each such call is recorded as one studio_video unit in the spend guard, so the daily ceiling sees it.
  const again = (Number(doc.attempts) || 0) > 1 || (Number(doc.releases) || 0) > 0;
  const counted = (fn) => (again ? async (a) => { try { await spendGuard.record('studio_video', 1); } catch (_) { /* best effort */ } return fn(a); } : fn);
  const io = { ...ioIn, generate: counted(ioIn.generate || ((a) => omni.generate(a))), change: counted(ioIn.change || ((a) => omni.change(a))) };
  if (w.kind === 'change') return run(doc, () => changeWork(w.baseUrl, w.instruction, doc.aspectRatio, io), io, null, ctl);
  const refs = Array.isArray(doc.references) ? doc.references : [];
  const loadRefs = async () => (await Promise.all(refs.map((r) => toRef(r.url)))).filter(Boolean);
  const f = w.finish || null;
  const logoUrl = f && f.features && f.features.logo ? await logoUrlOf(String(doc.user)) : '';
  const finish = f ? { features: f.features, parts: Array.isArray(f.parts) ? f.parts : [], language: f.language, logoUrl } : null;
  const prompts = Array.isArray(w.prompts) ? w.prompts : [];
  if (!prompts.length) return fail(doc, 'The video could not be made this time. Your Quarks were returned. Please try again.', ctl.owner);
  if (prompts.length === 1) {
    return run(doc, async () => io.generate({ prompt: prompts[0], references: io.loadRefs ? await io.loadRefs() : await loadRefs(), aspectRatio: doc.aspectRatio }), io, finish, ctl);
  }
  return runChain(doc, { prompts, aspectRatio: doc.aspectRatio, loadRefs, transition: doc.transition || 'fade', finish }, io, ctl);
}

// Users with a create in flight: makes the two-at-once check and the insert one step (in this process).
const creating = new Set();

// Hooks for tests: fakes for the network and ffmpeg steps of a background run. Empty in production.
const testIo = {};

/**
 * Runs a longer video in the background: clips one after another, joined into one file. Clip 1 failing returns
 * everything (as a single clip does); a later clip failing after a retry delivers the shorter video and returns
 * the Quarks for the clips not made.
 */
async function runChain(doc, work, io = {}, ctl = null) {
  const total = work.prompts.length;
  const urls = [];
  try {
    const references = io.loadRefs ? await io.loadRefs() : await work.loadRefs();
    const chainIo = {
      generate: io.generate || ((a) => omni.generate(a)),
      lastFrame: io.lastFrame, concat: io.concat,
      onClip: (done) => StudioVideo.updateOne({ _id: doc._id }, { $set: { clipsDone: done } })
    };
    if (ctl) {
      // Consumer path: resume after the clips an earlier run stored; every clip is stored and recorded under the claim;
      // ffmpeg (last frame, join) runs inside a CPU slot.
      const stored = await resumeClips(doc, total, io);
      await dropUnresumed(doc, stored, io);
      urls.push(...stored.map((x) => x.url));
      const frame = io.lastFrame || ((b) => chain.lastFrame(b));
      const join = io.concat || ((bufs, ar, tr) => chain.concat(bufs, ar, {}, tr));
      Object.assign(chainIo, {
        made: stored.map((x) => x.buffer),
        beforeClip: () => ctl.check(),
        afterClip: (buffer, k) => keepClip(doc, ctl, io, urls, buffer, k),
        lastFrame: (b) => ctl.cpu(() => frame(b)),
        concat: (bufs, ar, tr) => { ctl.finishing(); return ctl.cpu(() => join(bufs, ar, tr)); },
        onClip: null
      });
    }
    const out = await chain.makeChain({ prompts: work.prompts, references, aspectRatio: work.aspectRatio, transition: work.transition || 'fade' }, chainIo);
    if (!out.ok) {
      const m = String(out.message || '');
      throw Object.assign(new Error(m), { friendly: true, shown: /returned/i.test(m) ? m : `${m.replace(/\s*$/, '')} Your Quarks were returned.`.trim() });
    }
    if (ctl) ctl.finishing();
    const fin = work.finish ? { ...work.finish, parts: work.finish.parts.slice(0, out.made) } : null;
    const done = ctl ? await ctl.cpu(() => applyFinish(out.buffer, fin, io, out.timing)) : await applyFinish(out.buffer, fin, io, out.timing);
    if (ctl) await ctl.check();
    const url = await (io.store || store)(done.buffer);
    if (!url) throw Object.assign(new Error('The video could not be saved. Your Quarks were returned. Please try again.'), { friendly: true });
    // Real length: the clips overlap a little when they are joined with a fade or zoom.
    const realSeconds = done.seconds || (out.timing && out.timing.seconds ? Math.round(out.timing.seconds * 10) / 10 : out.made * STUDIO_CLIP_SECONDS);
    let closed = null;
    if (out.made >= total) {
      closed = await completeIfOpen(doc, { status: 'completed', videoUrl: url, clipsDone: total, seconds: realSeconds, notice: done.notice, completedAt: new Date(), ...(ctl ? { leaseUntil: null } : {}) }, url, io, ctl ? ctl.owner : null);
    } else {
      closed = await finishShort(doc, out.made, total, url, realSeconds, done.notice, io, ctl ? ctl.owner : null);
    }
    if (closed && ctl) await dropClips(urls, io);
  } catch (e) {
    if (ctl && e && e.stopRun) return; // this run no longer holds the video: whoever took it over owns it now
    console.error('[videos] failed:', e.message);
    const closed = await fail(doc, e.friendly ? (e.shown || e.message) : 'The video could not be made this time. Your Quarks were returned. Please try again.', ctl ? ctl.owner : null);
    if (closed && ctl) await dropClips(urls, io);
  }
}

/** Keeps the clips that were made as a shorter video and returns the Quarks for the ones that were not. Once only. */
async function finishShort(doc, made, total, url, realSeconds = 0, extraNotice = '', io = {}, filter = null) {
  const secs = realSeconds || made * STUDIO_CLIP_SECONDS;
  const shown = Math.round(secs);
  const notice = [`Only ${made} of ${total} parts could be made, so this video is ${shown} seconds instead of ${total * STUDIO_CLIP_SECONDS}. You were not charged for the missing ${total - made === 1 ? 'part' : 'parts'}.`, extraNotice].filter(Boolean).join(' ');
  const per = Math.round((doc.quarks || 0) / (doc.clips || total));
  // One atomic update: the shorter video, the lowered cost and the refund claim together.
  const closed = await closeWithRefund(
    doc,
    (proof) => (proof.spend
      ? { status: 'completed', videoUrl: url, clipsDone: made, seconds: secs, notice, quarks: per * made }
      : { status: 'failed', error: 'The video could not be started. You were not charged.' }),
    (d) => (d.quarks || 0) - per * made,
    filter
  );
  if (!closed || closed.status === 'failed') {
    if (!closed) console.error('[videos] short video was not delivered (already closed or proof unavailable):', String(doc._id));
    await discardFile(url, io);
  }
  return closed;
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
  let doc = null; let charged = false; let launched = false; let holding = false; let userId = ''; let viaConsumer = false;
  const release = () => { if (holding) { holding = false; creating.delete(userId); } };
  try {
    userId = userIdOf(req);
    if (!allowed('create', userId, 30)) return res.status(429).json({ success: false, message: 'Please wait a little before making another video.' });
    if (await busy(res, 'studio_video')) return;
    const tooMany = () => res.status(429).json({ success: false, message: 'Two videos are already being made. Please wait for one to finish.' });
    // The count and the insert are one step per account (this process), so two quick requests cannot both pass.
    if (creating.has(userId)) return tooMany();
    creating.add(userId); holding = true;
    const active = await StudioVideo.countDocuments({ user: userId, status: { $in: ['queued', 'processing'] }, startedAt: { $gt: new Date(Date.now() - STALE_MS * sv.MAX_CLIPS) } });
    if (active >= 2) return tooMany();
    const b = req.body || {};
    const concept = sv.clip(b.concept, 700);
    if (!concept) return res.status(400).json({ success: false, message: 'Plan the video first.' });
    const style = sv.styleOf(b.style); const language = sv.languageOf(b.language);
    const voice = sv.voiceOf(b.voice); const clips = sv.clipsOf(b.clips);
    const aspectRatio = sv.aspectOf(b.aspectRatio); const platforms = sv.platformsOf(b.platforms);
    const refs = await resolveReferences(userId, b);
    const brand = await brandOf(userId);
    const finishOpts = finishing.normalizeFinish(b, language);
    const parts = partsFrom(b, clips).map((p) => (language === 'none' ? { ...p, spokenLine: '' } : p));
    const base = {
      concept, style, language, voice, aspectRatio, who: sv.clip(b.who, 300), where: sv.clip(b.where, 300),
      hasPersonPhoto: refs.some((r) => r.kind === 'person'), hasPlacePhoto: refs.some((r) => r.kind === 'place'), hasProductPhoto: refs.some((r) => r.kind === 'product'),
      brandName: brand.name
    };
    const prompts = parts.map((p, k) => sv.assemblePrompt({ ...base, beats: p.beats, spokenLine: p.spokenLine, continuation: k > 0 }));
    const total = clips * COST();
    // ENABLE_STUDIO_VIDEO_CONSUMER (E9 B1): the row carries what a consumer needs and is queued after the charge.
    viaConsumer = consumer().enabled();
    doc = await StudioVideo.create({
      user: userId, title: sv.clip(b.title, 60) || 'My video', idea: sv.clip(b.idea, 1200), concept,
      spokenLine: parts.map((p) => p.spokenLine).filter(Boolean).join(' ').slice(0, 1200), style, language, voice, aspectRatio, clips, clipsDone: 0,
      parts: clips > 1 ? parts : [], platforms, transition: finishOpts.transition, subtitles: finishOpts.subtitles, logo: finishOpts.logo, endLine: finishOpts.endLine, prompt: prompts.join('\n---\n'), references: refs, quarks: total, seconds: clips * STUDIO_CLIP_SECONDS,
      ...(viaConsumer ? { work: { kind: 'create', prompts, finish: { features: finishOpts, parts, language } } } : {})
    });
    // The whole price is taken in one charge, before anything is made: it either covers every clip or nothing starts.
    release();
    if (!(await charge(userId, String(doc._id), total, clips))) {
      await StudioVideo.deleteOne({ _id: doc._id });
      doc = null;
      return res.status(403).json({ success: false, creditsExhausted: true, upgradeRequired: true, reason: 'quarks', message: `${clips > 1 ? `A ${clips * STUDIO_CLIP_SECONDS} second video` : 'A video'} needs ${priceText(total)}. Please top up or choose a plan.` });
    }
    charged = true;
    if (viaConsumer) {
      doc = await queueAfterCharge(doc);
      res.status(202).json({ success: true, video: shape(doc) });
      launched = true;
      consumer().studioVideoConsumer.kick();
      return;
    }
    res.status(202).json({ success: true, video: shape(doc) });
    launched = true;
    const loadRefs = async () => (await Promise.all(refs.map((r) => toRef(r.url)))).filter(Boolean);
    setImmediate(async () => {
      const logoUrl = finishOpts.logo ? await logoUrlOf(userId) : '';
      const finish = { features: finishOpts, parts, language, logoUrl };
      if (clips === 1) {
        return run(doc, async () => omni.generate({ prompt: prompts[0], references: await loadRefs(), aspectRatio }), testIo, finish);
      }
      return runChain(doc, { prompts, aspectRatio, loadRefs, transition: finishOpts.transition, finish }, testIo);
    });
  } catch (e) {
    console.error('[videos] create failed:', e.message);
    // Charged and the queue flip may have landed with its reply lost: the video is accepted, so answer success.
    const kept = charged && viaConsumer && doc && !launched ? await acceptedAfterLostReply(doc) : null;
    if (kept) {
      launched = true;
      if (!res.headersSent) res.status(202).json({ success: true, video: shape(kept) });
      try { consumer().studioVideoConsumer.kick(); } catch (_) { /* a consumer finds it within seconds */ }
    } else {
      // A record may exist without a started job: remove it if nothing was charged, else close it with a proven refund.
      if (doc && !launched) await settleUnstarted(doc);
      if (!res.headersSent) res.status(500).json({ success: false, message: 'We could not start the video. Please try again.' });
    }
  } finally { release(); }
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
  // A reference for this attempt: written on the charge, so chargeProof can see it and a refund is never paid twice or without a charge.
  const ref = `studio_ref_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    if (!allowed('reference', userId, 20)) return res.status(429).json({ success: false, message: 'Please wait a little before making more pictures.' });
    if (await busy(res, 'studio_reference')) return;
    const cost = QUARK_COSTS.studio_reference;
    await quarkBuckets.settleWallet(userId).catch(() => null);
    const paid = await quarkBuckets.spend(userId, cost, { action: 'studio_reference', description: kind === 'person' ? 'Person for a video' : 'Place for a video', ref });
    if (!paid.success) return res.status(403).json({ success: false, creditsExhausted: true, upgradeRequired: true, reason: 'quarks', message: `This needs ${priceText(cost)}. Please top up or choose a plan.` });
    const brand = await brandOf(userId);
    let out = null;
    try {
      out = await (testIo.image || generateOpenAIImage)(sv.buildReferencePrompt({ kind, description: req.body && req.body.description, city: brand.location }), { aspectRatio: kind === 'person' ? '16:9' : '9:16', quality: 'medium' });
    } catch (e) { console.error('[videos] reference failed:', e.message); }
    if (!out || !out.success || !/^https:\/\//.test(String(out.imageUrl || ''))) {
      // Back to the wallet that was just charged, only if the proof shows the charge and no refund yet.
      await refundReference(userId, ref, cost, paid.payerId);
      return res.status(502).json({ success: false, ref, message: 'We could not make that picture. Your Quarks were returned. Please try again.' });
    }
    res.json({ success: true, url: out.imageUrl, kind, quarks: cost, ref });
  } catch (e) {
    console.error('[videos] reference error:', e.message);
    res.status(500).json({ success: false, ref, message: 'We could not make that picture. Please try again.' });
  }
});

/** Refunds a failed reference picture: proof first, one retry, an alert when it still does not land. */
async function refundReference(userId, ref, cost, payerId) {
  try {
    const p = await quarkBuckets.chargeProof(ref, { userId, payerId: payerId ? String(payerId) : '' });
    if (!p.spend || p.refunded) return false;
    const amount = Math.min(cost, p.spend.quarks);
    for (let i = 0; i < 2; i += 1) {
      const r = await quarkBuckets.refundTo(userId, amount, { action: 'studio_reference_refund', ref, payerId: p.spend.payer }).catch(() => null);
      if (r && r.ok) return true;
    }
    alertRefund(`Videos reference ${ref}: the refund (Quarks: ${amount}) did not land.`, true);
  } catch (e) { console.error('[videos] reference refund error:', e.message); }
  return false;
}

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
  let doc = null; let launched = false; let charged = false; let viaConsumer = false;
  try {
    const userId = userIdOf(req);
    if (!allowed('create', userId, 30)) return res.status(429).json({ success: false, message: 'Please wait a little before making another change.' });
    if (await busy(res, 'studio_video')) return;
    const instruction = sv.clip(req.body && req.body.instruction, 400);
    if (!instruction) return res.status(400).json({ success: false, message: 'Say what to change.' });
    const base = await StudioVideo.findOne({ _id: req.params.id, user: userId, status: 'completed' });
    if (!base || !base.videoUrl) return res.status(404).json({ success: false, message: 'That video is not ready yet.' });
    if ((base.clips || 1) > 1 && (base.seconds || 0) > STUDIO_CLIP_SECONDS) return res.status(400).json({ success: false, message: 'Changes are available for 10-second videos. For a longer video, make a new version.' });
    viaConsumer = consumer().enabled();
    doc = await StudioVideo.create({
      user: userId, title: base.title, idea: base.idea, concept: base.concept, spokenLine: base.spokenLine, style: base.style,
      language: base.language, voice: base.voice || 'female', platforms: base.platforms || [], aspectRatio: base.aspectRatio, prompt: instruction, parent: base._id, change: instruction,
      references: base.references, quarks: COST(), seconds: STUDIO_CLIP_SECONDS,
      ...(viaConsumer ? { work: { kind: 'change', baseUrl: base.videoUrl, instruction } } : {})
    });
    if (!(await charge(userId, String(doc._id)))) {
      await StudioVideo.deleteOne({ _id: doc._id });
      doc = null;
      return res.status(403).json({ success: false, creditsExhausted: true, upgradeRequired: true, reason: 'quarks', message: `A change needs ${priceText(COST())}. Please top up or choose a plan.` });
    }
    charged = true;
    if (viaConsumer) {
      doc = await queueAfterCharge(doc);
      res.status(202).json({ success: true, video: shape(doc) });
      launched = true;
      consumer().studioVideoConsumer.kick();
      return;
    }
    res.status(202).json({ success: true, video: shape(doc) });
    launched = true;
    setImmediate(() => run(doc, () => changeWork(base.videoUrl, instruction, base.aspectRatio, { change: (a) => omni.change(a) })));
  } catch (e) {
    console.error('[videos] change failed:', e.message);
    const kept = charged && viaConsumer && doc && !launched ? await acceptedAfterLostReply(doc) : null;
    if (kept) {
      launched = true;
      if (!res.headersSent) res.status(202).json({ success: true, video: shape(kept) });
      try { consumer().studioVideoConsumer.kick(); } catch (_) { /* a consumer finds it within seconds */ }
    } else {
      if (doc && !launched) await settleUnstarted(doc);
      if (!res.headersSent) res.status(500).json({ success: false, message: 'We could not start the change. Please try again.' });
    }
  }
});

const staleMs = (v) => STALE_MS * (v.clips || 1);
// A queued video nobody claimed for this long (consumers switched off or down everywhere) is closed and refunded.
const queuedMaxMs = () => { const n = Number(process.env.STUDIO_VIDEO_QUEUED_MAX_MS); return Number.isFinite(n) && n > 0 ? n : 30 * 60 * 1000; };
const queuedSince = (v) => new Date(v.queuedAt || v.createdAt || v.startedAt).getTime();
const isStale = (v, now = Date.now()) => (v.status === 'processing' && now - new Date(v.startedAt).getTime() > staleMs(v))
  || (v.status === 'queued' && now - queuedSince(v) > queuedMaxMs());
const STALE_REASON = 'The video took too long and was stopped. Your Quarks were returned. Please try again.';
/**
 * The claim a stale close read: a queued row only while still queued; a processing row only while it is still the same run
 * (start time, worker, attempt), so a consumer re-claim between the read and the write is never failed. attempts 0 also
 * matches a row written before the field existed.
 */
const staleFilter = (v) => (v.status === 'queued'
  ? { status: 'queued' }
  : { startedAt: v.startedAt ?? null, workerId: v.workerId ?? null, attempts: Number(v.attempts) > 0 ? Number(v.attempts) : { $in: [0, null] } });
/** Closes a lost video (refund only with proof), only the claim that was read. */
async function closeStale(v) {
  const closed = await fail(v, STALE_REASON, staleFilter(v));
  // The video is closed for good: its stored clip files are no longer needed (best effort, never throws).
  if (closed && Array.isArray(closed.clipUrls) && closed.clipUrls.length) await dropClips(closed.clipUrls);
  return closed;
}

router.get('/', protect, async (req, res) => {
  const userId = userIdOf(req);
  let list = await listTimeout(StudioVideo.find({ user: userId }).sort({ createdAt: -1 }).limit(30).lean());
  // Lost jobs (a restart, a crash) are closed here too, not only when one video is opened. Bounded per request.
  const stale = list.filter((v) => isStale(v)).slice(0, 5);
  if (stale.length) {
    for (const v of stale) await closeStale(v).catch((e) => console.error('[videos] stale close failed:', e.message));
    list = await listTimeout(StudioVideo.find({ user: userId }).sort({ createdAt: -1 }).limit(30).lean());
  }
  res.json({ success: true, videos: list.map(shape) });
});

router.get('/:id', protect, async (req, res) => {
  const v = await StudioVideo.findOne({ _id: req.params.id, user: userIdOf(req) });
  if (!v) return res.status(404).json({ success: false, message: 'Video not found.' });
  // A job that has been running far too long was lost (a restart, a crash): finish it as failed and return the Quarks.
  if (isStale(v)) {
    await closeStale(v);
    const again = await StudioVideo.findById(v._id);
    return res.json({ success: true, video: shape(again || v) });
  }
  res.json({ success: true, video: shape(v) });
});

router.delete('/:id', protect, async (req, res) => {
  // Never while the video is queued (charged, about to run), processing, or a refund is still being paid.
  await StudioVideo.deleteOne({ _id: req.params.id, user: userIdOf(req), status: { $nin: ['queued', 'processing'] }, refundState: { $ne: 'refunding' } });
  res.json({ success: true });
});

/**
 * One bounded pass: close lost processing videos (refunding only what the proof shows was charged) and pay refunds
 * that a crash left in 'refunding'. Idempotent and safe to run in several processes: every step is an atomic claim.
 */
async function sweep({ limit = 25, now = Date.now() } = {}) {
  let closed = 0; let paid = 0;
  const lost = await StudioVideo.find({ status: 'processing', startedAt: { $lt: new Date(now - STALE_MS) } }).sort({ startedAt: 1 }).limit(limit * 2).lean();
  for (const v of lost.filter((x) => isStale(x, now)).slice(0, limit)) {
    try { await closeStale(v); closed += 1; } catch (e) { console.error('[videos] sweep close failed:', e.message); }
  }
  // Queued videos nobody claimed (consumer path, E9 B1): closed only while still queued, refunded with proof.
  const waiting = await StudioVideo.find({ status: 'queued', queuedAt: { $lt: new Date(now - queuedMaxMs()) } }).sort({ queuedAt: 1 }).limit(limit).lean();
  for (const v of waiting.filter((x) => isStale(x, now))) {
    try { await closeStale(v); closed += 1; } catch (e) { console.error('[videos] sweep close failed:', e.message); }
  }
  const stuck = await StudioVideo.find({ refundState: 'refunding', refundStartedAt: { $lt: new Date(now - REFUNDING_STALE_MS) }, refundTries: { $lt: MAX_REFUND_TRIES } }).sort({ refundStartedAt: 1 }).limit(limit).lean();
  for (const row of stuck) {
    try {
      // Take this retry atomically so another process (or the request itself) does not pay it at the same time.
      const mine = await StudioVideo.findOneAndUpdate({ _id: row._id, refundState: 'refunding', refundStartedAt: row.refundStartedAt }, { $set: { refundStartedAt: new Date(now) }, $inc: { refundTries: 1 } }, { new: true });
      if (!mine) continue;
      const proof = await quarkBuckets.chargeProof(String(row._id), { userId: String(row.user), payerId: row.refundPayer || '' });
      if (proof.refunded) {
        await StudioVideo.updateOne({ _id: row._id, refundState: 'refunding' }, { $set: { refunded: true, refundState: 'done', refundFailed: false } });
        paid += 1; continue;
      }
      const spent = proof.spend ? proof.spend.quarks : 0;
      const amount = Math.min(row.refundAmount || 0, spent);
      if (amount <= 0) { await StudioVideo.updateOne({ _id: row._id, refundState: 'refunding' }, { $set: { refunded: true, refundState: 'done', refundAmount: 0 } }); continue; }
      if (await payClaimed({ ...row, refundAmount: amount, refundPayer: row.refundPayer || (proof.spend && proof.spend.payer) || '' })) paid += 1;
      else if ((mine.refundTries || 0) >= MAX_REFUND_TRIES) alertRefund(`Videos ${String(row._id)}: the refund (Quarks: ${amount}) to ${row.refundPayer || String(row.user)} did not land after ${MAX_REFUND_TRIES} tries. Return it by hand.`, true);
    } catch (e) { console.error('[videos] sweep refund failed:', e.message); }
  }
  return { closed, paid };
}

/** Once shortly after start, then every 10 minutes. Off with ENABLE_STUDIO_VIDEO_SWEEP=off. Never throws. */
function startStudioVideoSweep({ env = process.env } = {}) {
  if (String(env.ENABLE_STUDIO_VIDEO_SWEEP || '').trim().toLowerCase() === 'off') return null;
  // Through a lease (services/leaseLock.js): the sweep returns Quarks.
  const run = () => Promise.resolve().then(() => require('../services/leaseLock').withLease('scheduler:studio-video-sweep', 10 * 60 * 1000, () => sweep())).catch((e) => console.warn('[videos] sweep failed:', e && e.message));
  setTimeout(run, 60 * 1000).unref();
  return setInterval(run, 10 * 60 * 1000).unref();
}

module.exports = router;
module.exports.run = run;
module.exports.runChain = runChain;
module.exports._io = testIo;
module.exports._money = { charge, fail, finishShort, sweep, settleUnstarted }; // for tests: the places the Videos flow moves Quarks
module.exports.runClaimed = runClaimed;
module.exports.dropClips = dropClips;
module.exports.shape = shape;
module.exports.sweep = sweep;
module.exports.startStudioVideoSweep = startStudioVideoSweep;
