'use strict';
/**
 * The demo account itself: a verified user with onboarding and the tour done, current consent, the Growth plan
 * (`plan.tier = professional`) with the Publish, Competitors and Inbox bundle, a payment history shaped exactly like
 * the one the real payment path writes (services/billingPlans.js), and a Quark wallet with a ledger that adds up.
 * The builders are pure (dates are counted back from `now`), so the tests can check every number.
 */
const { PLANS, ADDONS, TOPUP_PACKS, chargePaise } = require('../../config/apiCosts');
const { INVOICE_ITEMS } = require('../../config/plans');
const { consentRecord } = require('../../services/consent');
const { TOPUP_VALID_DAYS, PLAN_GRACE_DAYS } = require('../../services/quarkBuckets');
const { BRAND, PALETTE, PROFILE_ANSWERS, COMPETITORS, TIMELINE } = require('./constants');
const { DEMO_EMAIL, DEMO_TAG, tagRef } = require('./safety');

const DAY = 24 * 60 * 60 * 1000;
const PLAN_KEY = 'professional';
const ADDON_KEY = 'bundle';
const SUB_PLAN = 'sub_demo_zaya_growth';
const SUB_ADDON = 'sub_demo_zaya_bundle';

/** The same calendar day `months` earlier (clamped to the month's end), at the same time of day. */
function monthsBefore(date, months) {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** Every date of the account's life, counted back from `now`. */
function timeline(now = new Date()) {
  const lastCharge = new Date(now.getTime() - TIMELINE.daysSinceLastCharge * DAY);
  lastCharge.setUTCHours(4, 0, 0, 0); // 09:30 in India
  const charges = [];
  for (let i = TIMELINE.planCharges - 1; i >= 0; i -= 1) charges.push(monthsBefore(lastCharge, i));
  const nextCharge = monthsBefore(lastCharge, -1);
  const createdAt = new Date(charges[0].getTime() - 40 * 60 * 1000); // signed up 40 minutes before the first payment
  const topupAt = new Date(now.getTime() - TIMELINE.topupDaysAgo * DAY);
  topupAt.setUTCHours(12, 15, 0, 0);
  return { now, createdAt, charges, nextCharge, topupAt };
}

const rupees = (paise) => paise / 100;

/** The payment rows (oldest first), in the exact shape buildChargeUpdate pushes. */
function buildPayments(t) {
  const pack = TOPUP_PACKS.find((p) => p.inr === TIMELINE.topupPackInr);
  const rows = [];
  t.charges.forEach((at, i) => {
    const n = i + 1;
    rows.push({
      razorpayOrderId: SUB_PLAN, razorpayPaymentId: `pay_demoZayaPlan${n}`, amount: rupees(chargePaise(PLANS[PLAN_KEY].inr)),
      currency: 'INR', credits: PLANS[PLAN_KEY].quarks, status: 'paid', paidAt: at, item: INVOICE_ITEMS.plan, exGstAmount: PLANS[PLAN_KEY].inr, invoiceUrl: ''
    });
    if (n >= TIMELINE.bundleFromCharge) {
      rows.push({
        razorpayOrderId: SUB_ADDON, razorpayPaymentId: `pay_demoZayaAddon${n}`, amount: rupees(chargePaise(ADDONS[ADDON_KEY].inr)),
        currency: 'INR', credits: 0, status: 'paid', paidAt: new Date(at.getTime() + 2 * 60 * 1000), item: INVOICE_ITEMS.addon, exGstAmount: ADDONS[ADDON_KEY].inr, invoiceUrl: ''
      });
    }
  });
  rows.push({
    razorpayOrderId: 'order_demoZayaTopup1', razorpayPaymentId: 'pay_demoZayaTopup1', amount: rupees(chargePaise(pack.inr)),
    currency: 'INR', credits: pack.quarks, status: 'paid', paidAt: t.topupAt, item: INVOICE_ITEMS.topup, exGstAmount: pack.inr, invoiceUrl: ''
  });
  return rows.sort((a, b) => a.paidAt - b.paidAt);
}

// How a month's Quarks were spent: whole studio videos and photoshoot pictures, captions, the rest in post pictures.
function monthSpendRows(total, monthIndex) {
  const out = [];
  const videos = monthIndex === 0 ? 1 : 2;
  for (let v = 0; v < videos; v += 1) out.push({ action: 'studio_video', quarks: 161, note: 'Short video' });
  out.push({ action: 'photoshoot_image', quarks: 80, note: 'Photoshoot, 8 photos' });
  out.push({ action: 'campaign_text', quarks: 96, note: 'Captions and replies' });
  let rest = total - out.reduce((s, r) => s + r.quarks, 0);
  const weeks = 4;
  for (let w = 0; w < weeks && rest > 0; w += 1) {
    const q = w === weeks - 1 ? rest : Math.round(rest / (weeks - w) / 11) * 11;
    out.push({ action: 'image_generated', quarks: q, note: `Week ${w + 1} posts` });
    rest -= q;
  }
  return out;
}

/**
 * The wallet story as Quark ledger rows (oldest first) and the final buckets. Each plan charge replaces what was
 * left of the last month's allowance (an expiry row, as routes/payment.js writes it), then grants the new month;
 * spending takes the plan bucket first, then the top-up (services/quarkBuckets.js).
 */
function buildWallet(t) {
  const grant = PLANS[PLAN_KEY].quarks;
  const pack = TOPUP_PACKS.find((p) => p.inr === TIMELINE.topupPackInr);
  const rows = [];
  let plan = 0; let topup = 0; let used = 0;
  const balance = () => plan + topup;
  const push = (row) => rows.push({ ...row, balanceAfter: balance() });
  t.charges.forEach((at, i) => {
    if (plan > 0) { const gone = plan; plan = 0; push({ type: 'expiry', bucket: 'plan', quarks: -gone, action: 'plan_expired', ref: tagRef(`expiry-${i}`), createdAt: at }); }
    plan = grant;
    push({ type: 'grant', bucket: 'plan', quarks: grant, action: 'plan_charge', ref: tagRef(`pay_demoZayaPlan${i + 1}`), note: 'Growth plan, monthly Quarks', createdAt: new Date(at.getTime() + 1000) });
    const end = i + 1 < t.charges.length ? t.charges[i + 1] : t.now;
    const spends = monthSpendRows(TIMELINE.monthSpends[i], i);
    const step = (end.getTime() - at.getTime()) / (spends.length + 1);
    spends.forEach((s, k) => {
      const when = new Date(at.getTime() + step * (k + 1));
      // The top-up arrives before the spend that needs it.
      if (pack && !rows.some((r) => r.type === 'purchase') && t.topupAt <= when) {
        topup += pack.quarks;
        push({ type: 'purchase', bucket: 'topup', quarks: pack.quarks, action: 'topup', ref: tagRef('pay_demoZayaTopup1'), note: `Top-up, ${pack.quarks} Quarks`, createdAt: t.topupAt });
      }
      let q = s.quarks;
      const fromPlan = Math.min(plan, q); plan -= fromPlan; q -= fromPlan;
      const fromTopup = Math.min(topup, q); topup -= fromTopup; q -= fromTopup;
      if (q > 0) throw new Error(`The demo wallet would go below zero in month ${i + 1}. Check TIMELINE.monthSpends.`);
      used += s.quarks;
      push({ type: 'spend', bucket: fromPlan ? 'plan' : 'topup', quarks: -s.quarks, action: s.action, ref: tagRef(`spend-${i + 1}-${k + 1}`), note: s.note, createdAt: when });
    });
  });
  const topupExpiresAt = new Date(t.topupAt.getTime() + TOPUP_VALID_DAYS * DAY);
  const planExpiresAt = new Date(t.nextCharge.getTime() + PLAN_GRACE_DAYS * DAY);
  const history = rows.slice(-100).map((r) => ({
    action: r.action, amount: r.quarks, cost: r.quarks < 0 ? -r.quarks : 0, description: r.note || r.action,
    balanceAfter: r.balanceAfter, ref: r.ref, createdAt: r.createdAt, timestamp: r.createdAt
  }));
  const credits = { balance: balance(), totalUsed: used, planBalance: plan, planExpiresAt, topupBalance: topup, topupExpiresAt, topupHeld: 0, history };
  return { rows, credits };
}

/** The business profile in the new questionnaire shape (values from config/businessQuestions.js). */
function businessProfile({ logoUrl = '' } = {}) {
  return {
    name: BRAND.name, website: BRAND.website, industry: PROFILE_ANSWERS.industry, problemSolved: BRAND.problemSolved,
    niche: BRAND.niche, businessType: PROFILE_ANSWERS.businessType, businessLocation: BRAND.city, targetAudience: BRAND.targetAudience,
    brandVoice: [...PROFILE_ANSWERS.brandVoice], marketingGoals: [...PROFILE_ANSWERS.marketingGoals], description: BRAND.description,
    competitors: COMPETITORS.map((c) => c.name), yearsInBusiness: PROFILE_ANSWERS.yearsInBusiness, brandMaturity: PROFILE_ANSWERS.brandMaturity,
    targetCustomerProfile: BRAND.targetCustomerProfile, targetGender: PROFILE_ANSWERS.targetGender, reachAreas: [...PROFILE_ANSWERS.reachAreas],
    ageGroups: [...PROFILE_ANSWERS.ageGroups], customerType: PROFILE_ANSWERS.customerType, pricePositioning: PROFILE_ANSWERS.pricePositioning,
    keyDifferentiator: BRAND.keyDifferentiator, brandStory: BRAND.brandStory, heroProduct: BRAND.heroProduct,
    contentLanguage: PROFILE_ANSWERS.contentLanguage, additionalLanguages: [...PROFILE_ANSWERS.additionalLanguages], accountKind: PROFILE_ANSWERS.accountKind,
    contentRestrictions: BRAND.contentRestrictions, firstMonthContentAngles: BRAND.firstMonthContentAngles, contentCadence: { ...PROFILE_ANSWERS.contentCadence },
    brandAssets: { logoUrl, ogImage: '', favicon: '', brandColors: [PALETTE.plum, PALETTE.roseGold, PALETTE.cream, PALETTE.sage], images: logoUrl ? [{ src: logoUrl, alt: `${BRAND.name} logo`, isLogo: true }] : [] }
  };
}

/** Everything on the user record except the password and the social accounts (socials.js adds those). */
function buildUserFields(t, { logoUrl = '' } = {}) {
  const { credits } = buildWallet(t);
  const planRecord = { subscriptionId: SUB_PLAN, kind: 'plan', key: PLAN_KEY, razorpayPlanId: 'plan_demo_zaya_growth', expectedPaise: chargePaise(PLANS[PLAN_KEY].inr), active: true, createdAt: t.charges[0] };
  const addonRecord = { subscriptionId: SUB_ADDON, kind: 'addon', key: ADDON_KEY, razorpayPlanId: 'plan_demo_zaya_bundle', expectedPaise: chargePaise(ADDONS[ADDON_KEY].inr), active: true, createdAt: t.charges[TIMELINE.bundleFromCharge - 1] };
  return {
    email: DEMO_EMAIL, firstName: BRAND.founder.firstName, lastName: BRAND.founder.lastName, companyName: BRAND.name,
    isVerified: true, onboardingCompleted: true, initialCampaignsGenerated: true, isActive: true,
    businessProfile: businessProfile({ logoUrl }),
    consent: consentRecord(t.createdAt, DEMO_TAG),
    tour: { completedAt: new Date(t.createdAt.getTime() + 25 * 60 * 1000), step: 'done', replays: 0 },
    setup: { planOpenedAt: new Date(t.createdAt.getTime() + 60 * 60 * 1000), firstWeekApprovedAt: new Date(t.createdAt.getTime() + 2 * DAY) },
    trial: { startDate: t.createdAt, isExpired: false },
    lastLoginAt: t.now,
    subscription: {
      plan: 'free', status: 'active', razorpaySubscriptionId: SUB_PLAN, razorpayPlanId: planRecord.razorpayPlanId,
      currentPeriodEnd: t.nextCharge, nextBillingAt: t.nextCharge, cancelAtPeriodEnd: false,
      // Marked as already reminded for this billing date, so the renewal reminder email is never sent (no real email).
      reminderForBillingAt: t.nextCharge
    },
    plan: {
      tier: PLAN_KEY, addons: ['bundle', ...ADDONS.bundle.includes], subscriptionId: SUB_PLAN,
      welcomeEmailSentAt: t.charges[0], subscriptions: [planRecord, addonRecord]
    },
    credits,
    payments: buildPayments(t),
    createdAt: t.createdAt
  };
}

/** The ledger rows for the database (each tagged with the demo marker in `ref`). */
function ledgerRows(t, userId) {
  return buildWallet(t).rows.map((r) => ({ user: userId, ...r }));
}

module.exports = { PLAN_KEY, ADDON_KEY, SUB_PLAN, SUB_ADDON, monthsBefore, timeline, buildPayments, buildWallet, monthSpendRows, businessProfile, buildUserFields, ledgerRows };
