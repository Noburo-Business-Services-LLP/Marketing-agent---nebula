'use strict';
const { escapeHtml } = require('../utils/escapeHtml');
/**
 * The reminder email, three days before a monthly plan is charged: what will be charged, on which date, and how to stop it.
 * Pure helpers (who is due, the email) plus a runner that takes its database and mailer from the caller so tests send nothing.
 * Each month's reminder goes once: the billing date it was sent for is saved on the account before the email is sent.
 */
const bp = require('./billingPlans');
const { PLANS, ADDONS, AGENCY, chargePaise, outputsFor } = require('../config/apiCosts');
const { PLAN_PRESENTATION } = require('../config/plans');

const DAY = 24 * 60 * 60 * 1000;
// Remind when the charge is between 2 and 3.5 days away. A daily check always lands inside this window once.
const FROM_DAYS = 2;
const TO_DAYS = 3.5;

const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function planKeyOf(user) {
  const rec = ((user.plan && user.plan.subscriptions) || []).find((s) => s && s.kind === 'plan' && s.active);
  const key = (rec && rec.key) || (user.plan && user.plan.tier);
  return PLAN_PRESENTATION[key] && PLANS[key] ? key : null;
}

/** What the next charge will be, in paise including GST: the plan, every add-on and every extra client slot that is active. */
function nextChargePaise(user) {
  const key = planKeyOf(user);
  if (!key) return 0;
  let total = chargePaise(PLANS[key].inr);
  for (const s of ((user.plan && user.plan.subscriptions) || [])) {
    if (s && s.kind === 'addon' && s.active && ADDONS[s.key]) total += chargePaise(ADDONS[s.key].inr);
    if (s && s.kind === 'slot' && s.active && bp.isSlotKey(s.key)) total += chargePaise(AGENCY.slot.inr);
  }
  return total;
}

/** True when this account should be reminded now. */
function isDue(user, now = Date.now()) {
  if (!user || !user.email || user.isActive === false) return false;
  const sub = user.subscription || {};
  if (sub.status !== 'active' || sub.cancelAtPeriodEnd) return false;
  if (!planKeyOf(user) || !sub.nextBillingAt) return false;
  const at = new Date(sub.nextBillingAt).getTime();
  if (!Number.isFinite(at)) return false;
  const away = at - now;
  if (away < FROM_DAYS * DAY || away > TO_DAYS * DAY) return false;
  if (sub.reminderForBillingAt && new Date(sub.reminderForBillingAt).getTime() === at) return false;
  return true;
}

function longDate(d) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

function buildReminderEmail({ user, appUrl = 'https://gravity.nebulaa.ai' }) {
  const key = planKeyOf(user);
  if (!key) return null;
  const planName = PLAN_PRESENTATION[key].name;
  const o = outputsFor(PLANS[key].quarks);
  const when = longDate(user.subscription.nextBillingAt);
  const amount = rupees(nextChargePaise(user));
  const name = String(user.firstName || '').trim();
  const paragraphs = [
    name ? `Hello ${name},` : 'Hello,',
    `Your Nebulaa ${planName} plan renews on ${when}. We will charge ${amount}, including GST, to the payment method you used before. Nothing else is needed from you.`,
    `Each month your plan gives you up to ${o.posts} posts, or ${o.videos} short videos, in any mix. Quarks left from this month end when the month ends, and the new ones arrive when the plan renews.`,
    `If you do not want to renew, you can stop it yourself before ${when}. Open Nebulaa, go to Settings, then Billing, and choose Cancel plan. You can keep using the plan until the end of the month you paid for, and you will not be charged again.`,
    `Manage your plan here: ${appUrl}/#/settings`,
    'If you have any questions, reply to this email and our team will help.',
    'Nebulaa'
  ];
  return {
    subject: `Your Nebulaa ${planName} plan renews on ${when}`,
    text: paragraphs.join('\n\n'),
    html: paragraphs.map((p) => `<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;">${escapeHtml(p)}</p>`).join(''),
    amountPaise: nextChargePaise(user),
    when
  };
}

function defaultTransport(env = process.env) {
  return async ({ from, to, subject, html, text }) => {
    if (!env.RESEND_API_KEY) return { skipped: true };
    const { Resend } = require('resend');
    const { error } = await new Resend(env.RESEND_API_KEY).emails.send({ from, to, subject, html, text });
    if (error) throw new Error(error.message || 'Email provider error');
    return { sent: true };
  };
}

async function runRenewalRemindersOnce({ now = Date.now(), deps = {} } = {}) {
  const User = deps.User || require('../models/User');
  const send = deps.transport || defaultTransport(deps.env || process.env);
  const env = deps.env || process.env;
  const log = deps.logger || console;
  const candidates = await User.find({
    'subscription.status': 'active',
    'subscription.cancelAtPeriodEnd': { $ne: true },
    'subscription.nextBillingAt': { $gte: new Date(now + FROM_DAYS * DAY), $lte: new Date(now + TO_DAYS * DAY) },
    'plan.tier': { $in: ['starter', 'professional', 'agency'] },
    'agency.ownerId': null // a client workspace never pays or gets email; the agency account is the one reminded
  }).select('email firstName isActive subscription plan ayrshare.profileKey').limit(500).lean();
  let sent = 0; let skipped = 0;
  for (const user of candidates) {
    // A demo account (D112) never gets email.
    if (!isDue(user, now) || require('./demoProfile').isDemoProfile(user)) { skipped += 1; continue; }
    // Claim this month's reminder first, so two servers (or a restart) cannot both send it.
    const claimed = await User.findOneAndUpdate(
      { _id: user._id, 'subscription.reminderForBillingAt': { $ne: user.subscription.nextBillingAt } },
      { $set: { 'subscription.reminderForBillingAt': user.subscription.nextBillingAt } }
    );
    if (!claimed) { skipped += 1; continue; }
    try {
      const mail = buildReminderEmail({ user, appUrl: env.APP_PUBLIC_URL || 'https://gravity.nebulaa.ai' });
      if (!mail) { skipped += 1; continue; }
      const out = await send({ from: `Nebulaa <${env.RESEND_FROM_EMAIL || 'noreply@nebulaa.ai'}>`, to: user.email, subject: mail.subject, html: mail.html, text: mail.text });
      if (out && out.skipped) { await User.updateOne({ _id: user._id }, { $unset: { 'subscription.reminderForBillingAt': '' } }); skipped += 1; continue; }
      sent += 1;
    } catch (e) {
      // Release the claim so the next run tries again.
      await User.updateOne({ _id: user._id }, { $unset: { 'subscription.reminderForBillingAt': '' } }).catch(() => {});
      log.error('[reminders] could not send a renewal reminder:', e.message);
      try { require('./opsAlerts').recordFailure('billing', `renewal reminder: ${e.message}`); } catch (_) { /* alerting never stops the run */ }
    }
  }
  return { sent, skipped, considered: candidates.length };
}

function startRenewalReminders({ intervalMs = 6 * 60 * 60 * 1000, logger = require('../utils/logger') } = {}) {
  if (String(process.env.ENABLE_RENEWAL_REMINDERS || 'true').toLowerCase() === 'false') {
    logger.log('[reminders] disabled via ENABLE_RENEWAL_REMINDERS=false');
    return () => {};
  }
  logger.log(`[reminders] Renewal reminders started (every ${intervalMs}ms)`);
  // Through a lease (services/leaseLock.js), kept for half the interval after a good run, on top of the per-user claim.
  const leasedRun = require('./leaseLock').leased('scheduler:renewal-reminders', 30 * 60 * 1000, () => runRenewalRemindersOnce().then((r) => { if (r.sent) logger.log(`[reminders] sent ${r.sent}`); }), { cooldownMs: intervalMs / 2 });
  const run = () => leasedRun().catch((e) => logger.error('[reminders] run failed:', e.message));
  const timer = setInterval(run, intervalMs);
  const first = setTimeout(run, 2 * 60 * 1000);
  return () => { clearInterval(timer); clearTimeout(first); };
}

module.exports = { isDue, nextChargePaise, buildReminderEmail, runRenewalRemindersOnce, startRenewalReminders, FROM_DAYS, TO_DAYS };
