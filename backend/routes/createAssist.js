const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const { callTextLLM } = require('../services/openAI');
const { parseGeminiJSON } = require('../services/geminiAI');
const { normalisePostDetails } = require('../config/postStyles');

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
router.post('/suggest-details', protect, async (req, res) => {
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

module.exports = router;
module.exports.buildSuggestPrompt = buildSuggestPrompt;
