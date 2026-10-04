/**
 * Pure billing helpers: no database, no network, no environment reads.
 * Every price, Quark amount and add-on rule comes from config/apiCosts.js;
 * nothing here accepts an amount from a request.
 */
const crypto = require('crypto');
const { PLANS, TOPUP_PACKS, ADDONS, GST_RATE, gstPaise, chargePaise } = require('../config/apiCosts');
const { PLAN_PRESENTATION, ADDON_ENV_VARS, INVOICE_ITEMS } = require('../config/plans');
const { resolveTier, addonsOf } = require('../config/entitlements');

const GST_PERCENT = Math.round(GST_RATE * 100);
const PLAN_IDS = Object.keys(PLAN_PRESENTATION);
const ADDON_IDS = Object.keys(ADDONS);
const fmt = (n) => n.toLocaleString('en-IN');

function isPlanId(id) { return typeof id === 'string' && PLAN_IDS.includes(id); }
function isAddonId(id) { return typeof id === 'string' && ADDON_IDS.includes(id); }

function planFeatures(id) {
  const plan = PLANS[id];
  const c = plan.commits;
  const out = [`${fmt(plan.quarks)} Quarks every month`, `${c.image_generated} image posts a month`, `${c.hero} Hero video${c.hero === 1 ? '' : 's'} a month`];
  return out.concat(PLAN_PRESENTATION[id].extraFeatures);
}

function priceBlock(inr) { return { inr, gstPaise: gstPaise(inr), chargePaise: chargePaise(inr) }; }

function planQuote(id) {
  if (!isPlanId(id)) return null;
  return { id, ...priceBlock(PLANS[id].inr), quarks: PLANS[id].quarks };
}
function addonQuote(id) {
  if (!isAddonId(id)) return null;
  return { id, ...priceBlock(ADDONS[id].inr) };
}

function planCatalogue() {
  return {
    plans: PLAN_IDS.map((id) => ({
      id, name: PLAN_PRESENTATION[id].name, description: PLAN_PRESENTATION[id].description,
      ...planQuote(id), features: planFeatures(id)
    })),
    topups: TOPUP_PACKS.map((p) => ({ ...priceBlock(p.inr), quarks: p.quarks })),
    addons: ADDON_IDS.map((id) => ({
      id, label: ADDONS[id].label, ...priceBlock(ADDONS[id].inr),
      requires: [...(ADDONS[id].requires || [])], includes: [...(ADDONS[id].includes || [])]
    }))
  };
}

// A top-up is a pack price, sent as a number. Anything else is not a pack.
function findTopupPack(packInr) {
  if (typeof packInr !== 'number' || !Number.isInteger(packInr)) return null;
  return TOPUP_PACKS.find((p) => p.inr === packInr) || null;
}

// The add-on names switched on by buying `addon` (the bundle switches on its parts too).
function expandAddon(addon) {
  const a = ADDONS[addon];
  if (!a) return [];
  return a.includes ? [addon, ...a.includes] : [addon];
}
const heldBy = (held, name) => held.includes(name) || held.includes('bundle');

function canBuyAddon(user, addon) {
  if (!isAddonId(addon)) return { ok: false, message: 'Please choose one of the available add-ons.' };
  const tier = resolveTier(user);
  if (tier !== 'starter' && tier !== 'professional') {
    return { ok: false, message: 'Add-ons are available on the Starter and Professional plans. Please choose a plan first.' };
  }
  const held = addonsOf(user);
  if (heldBy(held, addon)) return { ok: false, message: 'You already have this add-on.' };
  for (const need of ADDONS[addon].requires || []) {
    if (!heldBy(held, need)) return { ok: false, message: `This add-on needs ${ADDONS[need].label}. Please add that first.` };
  }
  return { ok: true, message: '' };
}

// Invoice line: item name, the ex-GST amount, and GST as its own 18 percent line.
function invoiceSpec(kind, key) {
  let inr; let description;
  if (kind === 'plan' && isPlanId(key)) { inr = PLANS[key].inr; description = `${PLAN_PRESENTATION[key].name} plan, one month, ${fmt(PLANS[key].quarks)} Quarks`; }
  else if (kind === 'addon' && isAddonId(key)) { inr = ADDONS[key].inr; description = `${ADDONS[key].label}, one month`; }
  else if (kind === 'topup') {
    const pack = findTopupPack(key);
    if (!pack) return null;
    inr = pack.inr; description = `${fmt(pack.quarks)} Quarks`;
  } else return null;
  const gst = gstPaise(inr);
  return { itemName: INVOICE_ITEMS[kind], description, amountInr: inr, gstPercent: GST_PERCENT, gstPaise: gst, totalPaise: chargePaise(inr) };
}

function razorpayPlanBody(kind, key) {
  const isPlan = kind === 'plan';
  const quote = isPlan ? planQuote(key) : addonQuote(key);
  if (!quote) return null;
  return {
    period: 'monthly', interval: 1,
    item: {
      name: isPlan ? INVOICE_ITEMS.plan : INVOICE_ITEMS.addon,
      amount: quote.chargePaise, currency: 'INR',
      description: `${isPlan ? PLAN_PRESENTATION[key].name : ADDONS[key].label}, monthly, including ${GST_PERCENT}% GST`
    },
    notes: { product: 'nebulaa', kind, key }
  };
}
function envVarFor(kind, key) { return kind === 'plan' ? PLAN_PRESENTATION[key]?.envVar : ADDON_ENV_VARS[key]; }

function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
function verifyWebhookSignature(rawBody, signature, secret) {
  if (!secret || !Buffer.isBuffer(rawBody)) return false;
  return safeEqualHex(crypto.createHmac('sha256', secret).update(rawBody).digest('hex'), signature);
}
function verifyCheckoutSignature(payload, signature, secret) {
  if (!secret) return false;
  return safeEqualHex(crypto.createHmac('sha256', secret).update(payload).digest('hex'), signature);
}

/**
 * The single atomic update for one captured payment. The caller applies it with a
 * filter that includes `'payments.razorpayPaymentId': { $ne: paymentId }`, so a
 * replay matches nothing and grants nothing. Quarks come from config only.
 *   record: our own stored subscription record { subscriptionId, kind, key }
 *   kind 'topup': record = { kind:'topup', key: packInr, orderId }
 */
function buildChargeUpdate(record, { paymentId, paidPaise, subscription, now = new Date() }) {
  let quarks = 0; const $set = {}; const update = {};
  const spec = invoiceSpec(record.kind, record.key);
  if (!spec) return null;
  if (record.kind === 'plan') {
    quarks = PLANS[record.key].quarks;
    $set['plan.tier'] = record.key;
    $set['plan.subscriptionId'] = record.subscriptionId;
    $set['subscription.status'] = 'active';
    $set['subscription.razorpaySubscriptionId'] = record.subscriptionId;
    if (record.razorpayPlanId) $set['subscription.razorpayPlanId'] = record.razorpayPlanId;
    if (subscription && subscription.current_end) $set['subscription.currentPeriodEnd'] = new Date(subscription.current_end * 1000);
    if (subscription && subscription.charge_at) $set['subscription.nextBillingAt'] = new Date(subscription.charge_at * 1000);
  } else if (record.kind === 'addon') {
    update.$addToSet = { 'plan.addons': { $each: expandAddon(record.key) } };
  } else if (record.kind === 'topup') {
    quarks = findTopupPack(Number(record.key)).quarks;
  }
  if (record.kind !== 'topup') $set['plan.subscriptions.$[sub].active'] = true;
  if (quarks) update.$inc = { 'credits.balance': quarks };
  update.$push = {
    payments: {
      razorpayOrderId: record.subscriptionId || record.orderId, razorpayPaymentId: paymentId,
      amount: paidPaise / 100, currency: 'INR', credits: quarks, status: 'paid', paidAt: now,
      item: spec.itemName, exGstAmount: spec.amountInr
    }
  };
  if (Object.keys($set).length) update.$set = $set;
  return { update, quarks, spec, arrayFilters: record.kind === 'topup' ? undefined : [{ 'sub.subscriptionId': record.subscriptionId }] };
}

/**
 * Update for a subscription that ended (cancelled, halted, completed).
 * Plan: back to free with add-ons cleared. Add-on: remove only what no other
 * active add-on subscription still provides.
 */
function buildEndUpdate(user, record, eventName) {
  const status = eventName === 'subscription.halted' ? 'halted' : eventName === 'subscription.cancelled' ? 'cancelled' : 'expired';
  const arrayFilters = [{ 'sub.subscriptionId': record.subscriptionId }];
  const $set = { 'plan.subscriptions.$[sub].active': false };
  if (record.kind === 'plan') {
    if (user.plan && user.plan.subscriptionId && user.plan.subscriptionId !== record.subscriptionId) {
      return { update: { $set }, arrayFilters }; // a stale subscription: leave the current plan alone
    }
    $set['plan.tier'] = 'free'; $set['plan.addons'] = []; $set['subscription.status'] = status;
    return { update: { $set }, arrayFilters };
  }
  const stillProvided = new Set();
  for (const s of (user.plan && user.plan.subscriptions) || []) {
    if (s.kind === 'addon' && s.active && s.subscriptionId !== record.subscriptionId) expandAddon(s.key).forEach((a) => stillProvided.add(a));
  }
  const remove = expandAddon(record.key).filter((a) => !stillProvided.has(a));
  const update = { $set };
  if (remove.length) update.$pull = { 'plan.addons': { $in: remove } };
  return { update, arrayFilters };
}

module.exports = {
  PLAN_IDS, ADDON_IDS, isPlanId, isAddonId, planQuote, addonQuote, planCatalogue, findTopupPack,
  expandAddon, canBuyAddon, invoiceSpec, razorpayPlanBody, envVarFor,
  verifyWebhookSignature, verifyCheckoutSignature, buildChargeUpdate, buildEndUpdate
};
