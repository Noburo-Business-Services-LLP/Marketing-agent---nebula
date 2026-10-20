const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
// Shared per-user limits for paid AI, scraping, uploads and ad spend (docs/superpowers/ops/security-hardening.md).
const L = require('../middleware/limits');
const User = require('../models/User');
const { callTextLLM } = require('../services/openAI');
const { parseGeminiJSON } = require('../services/geminiAI');
const { normalisePostDetails } = require('../config/postStyles');
const CreateUpload = require('../models/CreateUpload');
const { extractFromFile } = require('../services/visionExtract');

// A small allowance so a stuck button cannot run up cost: 30 suggestions an hour per account.
const hits = new Map();
const LIMIT = 30;
function allowed(userId, now = Date.now()) {
  const list = (hits.get(userId) || []).filter((t) => now - t < 3600000);
  if (list.length >= LIMIT) { hits.set(userId, list); return false; }
  list.push(now); hits.set(userId, list); return true;
}

const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

/** The prompt: facts in, nothing invented out. Exported for tests. */
function buildSuggestPrompt({ idea, mode, languageLabel, profile }) {
  return `You fill in the optional "exact text" fields of a social media post for a small business.

THE IDEA THE OWNER WROTE:
${clip(idea, 1200) || '(nothing written yet)'}

FACTS ABOUT THE BUSINESS (the only facts you may use):
- Name: ${clip(profile.name, 80) || 'unknown'}
- Type of business: ${clip(profile.industry, 80) || 'unknown'}
- Place: ${clip(profile.location, 120) || 'unknown'}
- Website: ${clip(profile.website, 120) || 'none'}
- About: ${clip(profile.about, 400) || 'none'}
- Phone on the account: ${clip(profile.phone, 40) || 'none'}

FORMAT: ${mode === 'carousel' ? 'a carousel (several slides)' : mode === 'campaign' ? 'a campaign (several posts)' : 'a single post'}.
LANGUAGE for headline, offer, items and tagline: ${languageLabel}. Natural, correct wording. No words from other languages except names.

RULES:
- Use only the facts above and the idea. Never invent a price, discount, date, phone number, address, hours, product or claim.
- A field you cannot fill from the facts must be an empty string (or an empty list for items).
- headline: at most 6 words. offer: only if the idea states an offer, in the owner's own numbers. items: only products and prices the idea states, one per line. phone: only the phone on the account, or one written in the idea. address: only the place above or one written in the idea. hours: only if written in the idea. tagline: at most 6 words, only if the business has an obvious one in the facts, else empty.

Return JSON only:
{"headline":"","offer":"","items":[],"phone":"","address":"","hours":"","tagline":""}`;
}

// POST /api/create-assist/suggest-details { idea, mode, language }
router.post('/suggest-details', protect, L.lightAi, async (req, res) => {
  try {
    const userId = String(req.user.id || req.user._id || req.user.userId);
    if (!allowed(userId)) return res.status(429).json({ success: false, message: 'That was a lot of suggestions in a short time. Please try again in a little while.' });
    const idea = clip(req.body && req.body.idea, 1500);
    const mode = ['single', 'carousel', 'campaign', 'linkedin'].includes(req.body && req.body.mode) ? req.body.mode : 'single';
    const languageLabel = clip(req.body && req.body.language, 40) || 'English';
    const user = await User.findById(userId).select('businessProfile companyName mobileNumber').lean();
    const bp = (user && user.businessProfile) || {};
    const profile = { name: bp.name || (user && user.companyName), industry: bp.industry, location: bp.businessLocation, website: bp.website, about: bp.description, phone: user && user.mobileNumber };
    if (!idea && !profile.name) return res.status(400).json({ success: false, message: 'Write a line about the post first, and I can suggest the details.' });
    const raw = await callTextLLM(buildSuggestPrompt({ idea, mode, languageLabel, profile }), { jsonMode: true, maxTokens: 700, language: languageLabel, purpose: 'plan' });
    const parsed = parseGeminiJSON(raw) || {};
    const d = normalisePostDetails({
      headline: parsed.headline, offer: parsed.offer, items: Array.isArray(parsed.items) ? parsed.items.join('\n') : parsed.items,
      phone: parsed.phone, address: parsed.address, hours: parsed.hours, tagline: parsed.tagline,
    });
    // The phone is only ever the account's own or one the owner wrote; anything else is dropped.
    const phoneOk = (p) => !p || [profile.phone, idea].some((src) => String(src || '').replace(/\D/g, '').includes(String(p).replace(/\D/g, '')) && String(p).replace(/\D/g, '').length >= 6);
    if (!phoneOk(d.phone)) d.phone = '';
    res.json({ success: true, details: d, phoneFromAccount: Boolean(d.phone && profile.phone && String(profile.phone).replace(/\D/g, '').includes(d.phone.replace(/\D/g, ''))) });
  } catch (error) {
    console.error('[create-assist] suggest failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not suggest details right now. You can type them in.' });
  }
});


// ---- Files dropped into the Create box ----------------------------------------------------------------------------
const MAX_FILES = 4;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_PDF_PAGES = 4;
const ALLOWED = { 'image/png': 'image', 'image/jpeg': 'image', 'image/webp': 'image', 'application/pdf': 'pdf' };
const readHits = new Map();
const voiceHits = new Map();
function within(map, userId, limit, now = Date.now()) {
  const list = (map.get(userId) || []).filter((t) => now - t < 3600000);
  if (list.length >= limit) { map.set(userId, list); return false; }
  list.push(now); map.set(userId, list); return true;
}

function parseDataUrl(value) {
  const m = /^data:([a-z0-9.+\/-]+);base64,([A-Za-z0-9+\/=\s]+)$/i.exec(String(value || ''));
  if (!m) return null;
  return { mime: m[1].toLowerCase(), base64: m[2].replace(/\s+/g, '') };
}
const bytesOf = (b64) => Math.floor((b64.length * 3) / 4);

/** Keeps only the first pages of a PDF, so a long brochure costs the same as a short one. */
async function firstPages(base64) {
  try {
    const { PDFDocument } = require('pdf-lib');
    const src = await PDFDocument.load(Buffer.from(base64, 'base64'), { ignoreEncryption: true });
    const total = src.getPageCount();
    if (total <= MAX_PDF_PAGES) return base64;
    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, Array.from({ length: MAX_PDF_PAGES }, (_, i) => i));
    pages.forEach((pg) => out.addPage(pg));
    return Buffer.from(await out.save()).toString('base64');
  } catch (_) { return base64; }
}

async function keepOriginal(dataUrl, name) {
  try {
    const cloudinary = require('cloudinary').v2;
    const up = await cloudinary.uploader.upload(dataUrl, { folder: 'nebula-uploads', resource_type: 'auto', use_filename: false });
    return (up && up.secure_url) || '';
  } catch (_) { return ''; }
}

const publicUpload = (u) => ({ id: String(u._id), name: u.name, kind: u.kind, url: u.url, summary: u.summary, brief: u.brief, details: u.details || {}, notes: u.notes, mimeType: u.mimeType, createdAt: u.createdAt });

// POST /api/create-assist/read-files { files: [{ name, data }], language }
router.post('/read-files', protect, async (req, res) => {
  try {
    const userId = String(req.user.id || req.user._id || req.user.userId);
    const files = Array.isArray(req.body && req.body.files) ? req.body.files.slice(0, MAX_FILES) : [];
    if (files.length === 0) return res.status(400).json({ success: false, message: 'Add a picture or a PDF first.' });
    if (!within(readHits, userId, 20)) return res.status(429).json({ success: false, message: 'You have added a lot of files in a short time. Please try again in a little while.' });
    const languageLabel = clip(req.body && req.body.language, 40) || 'English';
    const results = [];
    for (const f of files) {
      const name = clip(f && f.name, 120) || 'file';
      const parsed = parseDataUrl(f && f.data);
      const kind = parsed && ALLOWED[parsed.mime];
      if (!parsed || !kind) { results.push({ name, ok: false, message: 'Use a PNG, JPG, WebP or PDF file.' }); continue; }
      // The bytes must really be a picture or a PDF (never SVG or HTML, whatever the claimed type).
      if (!require('../services/uploadSafety').checkUpload({ mime: parsed.mime, name, buffer: Buffer.from(parsed.base64.slice(0, 2732), 'base64'), allow: ['png', 'jpeg', 'webp', 'pdf'] }).ok) { results.push({ name, ok: false, message: 'Use a PNG, JPG, WebP or PDF file.' }); continue; }
      if (bytesOf(parsed.base64) > MAX_FILE_BYTES) { results.push({ name, ok: false, message: 'This file is too big. Please use one under 8 MB.' }); continue; }
      let b64 = parsed.base64;
      if (kind === 'pdf') b64 = await firstPages(b64);
      const dataUrl = `data:${parsed.mime};base64,${b64}`;
      const read = await extractFromFile({ type: kind, dataUrl, name }, { languageLabel });
      if (!read.ok) { results.push({ name, ok: false, message: read.message, sensitive: Boolean(read.sensitive) }); continue; }
      const url = await keepOriginal(dataUrl, name);
      const saved = await CreateUpload.create({ user: userId, name, mimeType: parsed.mime, kind: read.kind, url, summary: read.summary, brief: read.brief, details: read.details, notes: read.notes });
      results.push({ name, ok: true, upload: publicUpload(saved), businessName: read.businessName, dates: read.dates });
    }
    res.json({ success: true, results });
  } catch (error) {
    console.error('[create-assist] read-files failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not read the files right now. You can type the details in.' });
  }
});

// GET /api/create-assist/uploads: the customer's saved files, newest first.
router.get('/uploads', protect, async (req, res) => {
  try {
    const userId = String(req.user.id || req.user._id || req.user.userId);
    const rows = await CreateUpload.find({ user: userId }).sort({ createdAt: -1 }).limit(12).lean();
    res.json({ success: true, uploads: rows.map(publicUpload) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Could not load your files.' });
  }
});

// DELETE /api/create-assist/uploads/:id: removes the record and, where possible, the stored original.
router.delete('/uploads/:id', protect, async (req, res) => {
  try {
    const userId = String(req.user.id || req.user._id || req.user.userId);
    if (!/^[a-f0-9]{24}$/i.test(String(req.params.id))) return res.status(400).json({ success: false, message: 'That file was not found.' });
    const doc = await CreateUpload.findOneAndDelete({ _id: req.params.id, user: userId }).lean();
    if (!doc) return res.status(404).json({ success: false, message: 'That file was not found.' });
    try {
      const m = /\/nebula-uploads\/([^./]+)/.exec(doc.url || '');
      if (m) await require('cloudinary').v2.uploader.destroy(`nebula-uploads/${m[1]}`, { resource_type: /pdf/.test(doc.mimeType) ? 'image' : 'image' });
    } catch (_) { /* the record is gone either way */ }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Could not remove that file.' });
  }
});

// POST /api/create-assist/transcribe { audio: dataUrl, language: 'en' | 'ta' }
router.post('/transcribe', protect, async (req, res) => {
  try {
    const userId = String(req.user.id || req.user._id || req.user.userId);
    if (!within(voiceHits, userId, 40)) return res.status(429).json({ success: false, message: 'Please wait a little before recording again.' });
    const m = /^data:(audio\/[a-z0-9.+-]+)(?:;[^,]*)?;base64,([A-Za-z0-9+\/=\s]+)$/i.exec(String(req.body && req.body.audio || ''));
    if (!m) return res.status(400).json({ success: false, message: 'No recording was received.' });
    const bytes = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
    if (bytes.length < 1500) return res.status(400).json({ success: false, message: 'That recording was too short. Please try again.' });
    if (bytes.length > 6 * 1024 * 1024) return res.status(400).json({ success: false, message: 'That recording was too long. Please keep it under a minute.' });
    const language = ['en', 'ta'].includes(req.body.language) ? req.body.language : 'en';
    const ext = /mp4|m4a/.test(m[1]) ? 'm4a' : (/ogg/.test(m[1]) ? 'ogg' : (/wav/.test(m[1]) ? 'wav' : 'webm'));
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: m[1].split(';')[0] }), `voice.${ext}`);
    form.append('model', process.env.TRANSCRIBE_MODEL || 'gpt-4o-transcribe');
    form.append('language', language);
    form.append('prompt', language === 'ta' ? 'A shop owner in Tamil Nadu describes a social media post: an offer, a festival, a product.' : 'A shop owner describes a social media post: an offer, a festival, a product.');
    const send = () => fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form });
    let r = await send();
    if (r.status >= 500) r = await send(); // a one-off gateway error (seen as 520) clears on the second try
    if (!r.ok) {
      console.error('[create-assist] transcribe HTTP', r.status);
      return res.status(502).json({ success: false, message: 'Could not turn the recording into text. Please try again, or type it.' });
    }
    const data = await r.json();
    const text = clip(data && data.text, 1500);
    if (!text) return res.status(200).json({ success: false, message: 'Nothing was heard. Please try again, closer to the phone.' });
    res.json({ success: true, text });
  } catch (error) {
    console.error('[create-assist] transcribe failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not turn the recording into text. Please type it.' });
  }
});

module.exports = router;
module.exports.buildSuggestPrompt = buildSuggestPrompt;
