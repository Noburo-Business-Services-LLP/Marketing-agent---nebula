// Your data and your account (/api/account): download it, ask for it to be deleted, undo that, and agree to the current terms.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const { protect } = require('../middleware/auth');
const { isStaff } = require('../services/staff/permissions');
const { resolveTier } = require('../config/entitlements');
const del = require('../services/accountDeletion');
const { buildExport } = require('../services/accountExport');
const { consentRecord } = require('../services/consent');

const router = express.Router();
const idOf = (req) => String(req.user?._id || req.user?.id || '');
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please wait a few minutes and try again.' },
  keyGenerator: (req) => `${idOf(req)}|${ipKeyGenerator(req.ip)}`
});

const models = () => del.defaultModels();

// The password is asked again for anything that downloads or erases the account (shared with removing a client).
const passwordOk = (userId, password) => del.passwordOk(userId, password, { User: models().User });

router.get('/status', protect, async (req, res) => {
  const user = req.user;
  const e = del.eligibility(user, { isStaff, resolveTier });
  res.json({
    success: true,
    deletion: user.deletion && user.deletion.status === 'pending' ? { status: 'pending', purgeAfter: user.deletion.purgeAfter, requestedAt: user.deletion.requestedAt } : null,
    canDelete: e.ok, reason: e.ok || e.already ? '' : e.message,
    clients: e.ok && e.clients ? e.clients : 0, // an agency's clients are deleted with it
    graceDays: del.GRACE_DAYS,
    consent: user.consent && user.consent.acceptedAt ? { acceptedAt: user.consent.acceptedAt } : null
  });
});

router.post('/export', protect, limiter, async (req, res) => {
  try {
    const userId = idOf(req);
    const m = models();
    const user = await m.User.findById(userId).select('privacy');
    const last = user && user.privacy && user.privacy.lastExportAt && new Date(user.privacy.lastExportAt).getTime();
    if (last && Date.now() - last < 24 * 3600 * 1000) {
      return res.status(429).json({ success: false, message: 'You downloaded your data less than a day ago. You can download it again tomorrow.' });
    }
    if (!(await passwordOk(userId, req.body && req.body.password))) return res.status(403).json({ success: false, message: 'That password is not right.' });
    const data = await buildExport(userId, { User: m.User, models: m });
    if (!data) return res.status(404).json({ success: false, message: 'Account not found.' });
    await m.User.updateOne({ _id: userId }, { $set: { 'privacy.lastExportAt': new Date() } });
    const name = `nebulaa-my-data-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[account] export failed:', e.message);
    res.status(500).json({ success: false, message: 'We could not prepare your data just now. Please try again in a few minutes.' });
  }
});

router.post('/deletion/request', protect, limiter, async (req, res) => {
  try {
    const user = req.user;
    const e = del.eligibility(user, { isStaff, resolveTier });
    if (!e.ok) return res.status(e.already ? 409 : 403).json({ success: false, message: e.message });
    if (String(req.body && req.body.confirm).trim() !== 'DELETE') return res.status(400).json({ success: false, message: 'Type DELETE to confirm.' });
    if (!(await passwordOk(idOf(req), req.body && req.body.password))) return res.status(403).json({ success: false, message: 'That password is not right.' });
    // The payment client is only built when there is a plan to stop, so an account with no plan can be deleted without it.
    const razorpay = { subscriptions: { cancel: (...a) => {
      const Razorpay = require('razorpay');
      return new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET }).subscriptions.cancel(...a);
    } } };
    const out = await del.requestDeletion({ user, models: models(), razorpay, mail: require('../services/accountMail') });
    if (!out.ok) return res.status(502).json({ success: false, message: out.message });
    res.json({ success: true, purgeAfter: out.purgeAfter, message: 'Your account will be deleted. You have 14 days to change your mind.' });
  } catch (err) {
    console.error('[account] deletion request failed:', err.message);
    res.status(500).json({ success: false, message: 'We could not start the deletion just now. Nothing was changed. Please try again in a few minutes.' });
  }
});

router.post('/deletion/restore', protect, limiter, async (req, res) => {
  try {
    const out = await del.restoreDeletion({ user: req.user, models: models() });
    if (!out.ok) return res.status(400).json({ success: false, message: out.message });
    res.json({ success: true, message: out.note });
  } catch (err) {
    console.error('[account] restore failed:', err.message);
    res.status(500).json({ success: false, message: 'We could not restore your account just now. Please try again.' });
  }
});

// Existing accounts agree to the current Terms and Privacy Policy once, from a prompt after they sign in.
router.post('/consent', protect, limiter, async (req, res) => {
  try {
    if (!(req.body && (req.body.accept === true || req.body.accept === 'true'))) return res.status(400).json({ success: false, message: 'Please agree to the Terms and the Privacy Policy to continue.' });
    await models().User.updateOne({ _id: idOf(req) }, { $set: { consent: consentRecord(new Date(), 'login_prompt') } });
    res.json({ success: true });
  } catch (err) {
    console.error('[account] consent failed:', err.message);
    res.status(500).json({ success: false, message: 'We could not save that just now. Please try again.' });
  }
});

module.exports = router;
