const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const socialMediaAPI = require('./socialMediaAPI');

// Ayrshare calls our address when a comment or message arrives. The address carries the user id and a private
// per-user token, and we accept a call only when the token matches the one stored on that user.
// (Ayrshare can also sign calls with HMAC-SHA256 in X-Authorization-Content-SHA256, but the docs do not say how the
// signature is encoded and we do not keep the raw body, so the token is the check we rely on.)

const WEBHOOK_PATHS = [
  { action: 'messages', path: '/api/social/inbox/webhooks/ayrshare' },
  { action: 'comments', path: '/api/social/inbox/webhooks/comments/ayrshare' }
];

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

function sameToken(a, b) {
  const left = crypto.createHash('sha256').update(String(a || '')).digest();
  const right = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(left, right);
}

// Returns the user's webhook token, creating and saving one when missing. Safe if two calls race: only one write wins.
async function ensureWebhookToken(userId) {
  const existing = await User.findById(userId).select('+ayrshare.webhookToken');
  if (!existing) return '';
  if (existing.ayrshare?.webhookToken) return existing.ayrshare.webhookToken;
  await User.updateOne(
    { _id: userId, $or: [{ 'ayrshare.webhookToken': '' }, { 'ayrshare.webhookToken': { $exists: false } }] },
    { $set: { 'ayrshare.webhookToken': newToken() } }
  );
  const fresh = await User.findById(userId).select('+ayrshare.webhookToken');
  return fresh?.ayrshare?.webhookToken || '';
}

// True only when the user exists, has a stored token, and the given token matches it.
async function verifyWebhookToken(userId, token) {
  if (!userId || !token || !mongoose.Types.ObjectId.isValid(String(userId))) return false;
  const user = await User.findById(String(userId)).select('+ayrshare.webhookToken');
  const stored = user?.ayrshare?.webhookToken || '';
  if (!stored) return false;
  return sameToken(token, stored);
}

function buildWebhookUrl(baseUrl, path, userId, token) {
  return `${String(baseUrl).replace(/\/+$/, '')}${path}?userId=${encodeURIComponent(String(userId))}&token=${encodeURIComponent(token)}`;
}

/**
 * (Re)register the inbox webhooks for one user with Ayrshare. Not called anywhere automatically: run it on purpose.
 * Needs WEBHOOK_BASE_URL (public https address). Never logs or returns the token or the full address.
 */
async function registerInboxWebhook(user, { baseUrl = process.env.WEBHOOK_BASE_URL } = {}) {
  const profileKey = user?.ayrshare?.profileKey;
  if (!profileKey) return { success: false, error: 'No connected social profile for this user.' };
  if (!baseUrl || !/^https:\/\//i.test(baseUrl)) return { success: false, error: 'WEBHOOK_BASE_URL must be a public https address.' };
  const token = await ensureWebhookToken(user._id);
  if (!token) return { success: false, error: 'Could not create a webhook token.' };
  const results = [];
  for (const { action, path } of WEBHOOK_PATHS) {
    const result = await socialMediaAPI.setAyrshareWebhook(profileKey, buildWebhookUrl(baseUrl, path, user._id, token), action);
    results.push({ action, success: Boolean(result?.success) });
  }
  return { success: results.every((r) => r.success), results };
}

module.exports = { ensureWebhookToken, verifyWebhookToken, registerInboxWebhook, buildWebhookUrl, WEBHOOK_PATHS };
