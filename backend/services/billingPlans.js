/**
 * Pure billing helpers: no database, no network, no environment reads.
 * Every price, Quark amount and add-on rule comes from config/apiCosts.js;
 * nothing here accepts an amount from a request.
 */
const crypto = require('crypto');
const { PLANS, TOPUP_PACKS, ADDONS, AGENCY, GST_RATE, gstPaise, chargePaise, outputsFor } = require('../config/apiCosts');
const { PLAN_PRESENTATION, ADDON_ENV_VARS, SLOT_ENV_VAR, INVOICE_ITEMS } = require('../config/plans');
const { resolveTier, addonsOf } = require('../config/entitlements');
const buckets = require('./quarkBuckets');
const agencyRules = require('./agency');

const GST_PERCENT = Math.round(GST_RATE * 100);
const PLAN_IDS = Object.keys(PLAN_PRESENTATION);
const ADDON_IDS = Object.keys(ADDONS);
const fmt = (n) => n.toLocaleString('en-IN');

function isPlanId(id) { return typeof id === 'string' && PLAN_IDS.includes(id); }
function isAddonId(id) { return typeof id === 'string' && ADDON_IDS.includes(id); }
// The extra client slot has one kind of item only.
const SLOT_KEY = 'client';
function isSlotKey(key) { return key === SLOT_KEY; }
// The most extra slots one agency can hold: the total client limit less the clients the plan includes.
const MAX_EXTRA_SLOTS = AGENCY.maxClients - AGENCY.includedClients;

function planFeatures(id) {
  const o = outputsFor(PLANS[id].quarks);
  const out = [
    `Up to ${fmt(o.posts)} posts a month, or`,
    `up to ${fmt(o.videos)} short videos with voice and music`,
    'Spend it on posts or videos, in any mix',
    'Top up any time'
  ];
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

function slotQuote() {
  return { id: SLOT_KEY, ...priceBlock(AGENCY.slot.inr), quarks: AGENCY.slot.quarks };
}

function planCatalogue() {
  return {
    plans: PLAN_IDS.map((id) => ({
      id, name: PLAN_PRESENTATION[id].name, description: PLAN_PRESENTATION[id].description,
      ...planQuote(id), outputs: outputsFor(PLANS[id].quarks), features: planFeatures(id)
    })),
    topups: TOPUP_PACKS.map((p) => ({ ...priceBlock(p.inr), quarks: p.quarks, outputs: outputsFor(p.quarks) })),
    addons: ADDON_IDS.map((id) => ({
      id, label: ADDONS[id].label, ...priceBlock(ADDONS[id].inr),
      requires: [...(ADDONS[id].requires || [])], includes: [...(ADDONS[id].includes || [])]
    })),
    agency: { includedClients: AGENCY.includedClients, maxClients: AGENCY.maxClients, slotInr: AGENCY.slot.inr, slotQuarks: AGENCY.slot.quarks },
    slot: slotQuote()
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
  if (tier === 'agency') return { ok: false, message: 'Publishing, inbox and competitor insights are included in the Agency plan.' };
  if (tier !== 'starter' && tier !== 'professional') {
    return { ok: false, message: 'Add-ons are available on the Starter and Growth plans. Please choose a plan first.' };
  }
  const held = addonsOf(user);
  if (heldBy(held, addon)) return { ok: false, message: 'You already have this add-on.' };
  for (const need of ADDONS[addon].requires || []) {
    if (!heldBy(held, need)) return { ok: false, message: `This add-on needs ${ADDONS[need].label}. Please add that first.` };
  }
  return { ok: true, message: '' };
}

// Only an agency account (never a client workspace) may buy a client slot, and never beyond the most clients.
function canBuySlot(user) {
  if (!agencyRules.isAgency(user)) return { ok: false, message: 'Client slots are part of the Agency plan.' };
  if (agencyRules.clientLimitOf(user) >= AGENCY.maxClients) {
    return { ok: false, message: `You are at the most clients one agency account can have (${AGENCY.maxClients}). Contact us for a larger set-up.` };
  }
  return { ok: true, message: '' };
}

// Invoice line: item name, the ex-GST amount, and GST as its own 18 percent line.
function invoiceSpec(kind, key) {
  let inr; let description;
  let itemName = INVOICE_ITEMS[kind];
  if (kind === 'plan' && isPlanId(key)) {
    inr = PLANS[key].inr; description = `${PLAN_PRESENTATION[key].name} plan, one month, ${fmt(PLANS[key].quarks)} Quarks`;
    if (INVOICE_ITEMS[key]) itemName = INVOICE_ITEMS[key];
  }
  else if (kind === 'addon' && isAddonId(key)) { inr = ADDONS[key].inr; description = `${ADDONS[key].label}, one month`; }
  else if (kind === 'slot' && isSlotKey(key)) { inr = AGENCY.slot.inr; description = 'Extra client brand, one month'; }
  else if (kind === 'topup') {
    const pack = findTopupPack(key);
    if (!pack) return null;
    inr = pack.inr; description = `${fmt(pack.quarks)} Quarks`;
  } else return null;
  const gst = gstPaise(inr);
  return { itemName, description, amountInr: inr, gstPercent: GST_PERCENT, gstPaise: gst, totalPaise: chargePaise(inr) };
}

function razorpayPlanBody(kind, key) {
  const isPlan = kind === 'plan';
  const isSlot = kind === 'slot';
  const quote = isPlan ? planQuote(key) : isSlot ? (isSlotKey(key) ? slotQuote() : null) : addonQuote(key);
  if (!quote) return null;
  const name = isPlan ? (INVOICE_ITEMS[key] || INVOICE_ITEMS.plan) : isSlot ? INVOICE_ITEMS.slot : INVOICE_ITEMS.addon;
  const label = isPlan ? `${PLAN_PRESENTATION[key].name}` : isSlot ? 'Extra client brand' : ADDONS[key].label;
  return {
    period: 'monthly', interval: 1,
    item: { name, amount: quote.chargePaise, currency: 'INR', description: `${label}, monthly, including ${GST_PERCENT}% GST` },
    notes: { product: 'nebulaa', kind, key }
  };
}
function envVarFor(kind, key) {
  if (kind === 'plan') return PLAN_PRESENTATION[key]?.envVar;
  if (kind === 'slot') return isSlotKey(key) ? SLOT_ENV_VAR : undefined;
  return ADDON_ENV_VARS[key];
}

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
 * The price a subscription must be charged: the one stored on the record when it was bought (paise, GST included),
 * so a later change of the price for new sign-ups never changes what an existing subscription renews at. A record
 * made before this was stored uses today's price. Returns the invoice spec with that price.
 */
function priceOfRecord(record, spec) {
  if (!spec || !record) return spec;
  const stored = record.expectedPaise;
  if (!Number.isInteger(stored) || stored <= 0 || stored === spec.totalPaise) return spec;
  // Prices are whole rupees, so the ex-GST price is the one whose price plus GST is the stored total.
  const ex = Math.round(stored / (100 + GST_PERCENT));
  if (chargePaise(ex) === stored) return { ...spec, amountInr: ex, gstPaise: gstPaise(ex), totalPaise: stored };
  const exPaise = Math.round((stored * 100) / (100 + GST_PERCENT));
  return { ...spec, amountInr: exPaise / 100, gstPaise: stored - exPaise, totalPaise: stored };
}
const expectedPaiseOf = (record, spec) => priceOfRecord(record, spec).totalPaise;

/**
 * The single atomic update for one captured payment. The caller applies it with a
 * filter that includes `'payments.razorpayPaymentId': { $ne: paymentId }`, so a
 * replay matches nothing and grants nothing. Quarks come from config only.
 *   record: our own stored subscription record { subscriptionId, kind, key }
 *   kind 'topup': record = { kind:'topup', key: packInr, orderId }
 */
function buildChargeUpdate(record, { paymentId, paidPaise, subscription, now = new Date(), heldToRelease = 0, firstCycle = true, topup = null }) {
  let quarks = 0; const $set = {}; const update = {}; let inc = null;
  const spec = priceOfRecord(record, invoiceSpec(record.kind, record.key));
  if (!spec) return null;
  if (record.kind === 'plan') {
    quarks = PLANS[record.key].quarks;
    $set['plan.tier'] = record.key;
    $set['plan.subscriptionId'] = record.subscriptionId;
    $set['subscription.status'] = 'active';
    $set['subscription.cancelAtPeriodEnd'] = false; // a new payment means the plan is running again
    $set['subscription.razorpaySubscriptionId'] = record.subscriptionId;
    if (record.razorpayPlanId) $set['subscription.razorpayPlanId'] = record.razorpayPlanId;
    if (subscription && subscription.current_end) $set['subscription.currentPeriodEnd'] = new Date(subscription.current_end * 1000);
    if (subscription && subscription.charge_at) $set['subscription.nextBillingAt'] = new Date(subscription.charge_at * 1000);
    // The monthly allowance replaces what was left of the last one and ends with the paid month.
    // The caller subtracts what is left of the previous allowance in the same guarded update, so the result is exactly the new allowance.
    const grant = buckets.planGrantUpdate(quarks, {
      now, heldToRelease,
      periodEnd: subscription && subscription.current_end ? new Date(subscription.current_end * 1000) : undefined
    });
    Object.assign($set, grant.set); inc = grant.inc;
  } else if (record.kind === 'addon') {
    update.$addToSet = { 'plan.addons': { $each: expandAddon(record.key) } };
  } else if (record.kind === 'slot') {
    // Every paid cycle brings the slot's Quarks; only the first payment of the subscription adds the client slot.
    quarks = AGENCY.slot.quarks;
    // They never lengthen the life of top-up Quarks already held: the 60 days only start when the bucket is empty.
    const grant = buckets.topupGrantUpdate(quarks, { now, keepExpiry: buckets.topupIsLive(topup, now) });
    Object.assign($set, grant.set); inc = { ...grant.inc };
    if (firstCycle) inc['agency.extraSlots'] = 1;
  } else if (record.kind === 'topup') {
    quarks = findTopupPack(Number(record.key)).quarks;
    const grant = buckets.topupGrantUpdate(quarks, { now });
    Object.assign($set, grant.set); inc = grant.inc;
  }
  if (record.kind !== 'topup') $set['plan.subscriptions.$[sub].active'] = true;
  if (inc) update.$inc = inc;
  else if (quarks) update.$inc = { 'credits.balance': quarks };
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
function endUpdateFor(record, eventName) {
  if (!record || record.kind !== 'slot') return null;
  const $set = { 'plan.subscriptions.$[sub].active': false };
  // A cancelled or completed slot is over for good: a charge that arrives later must not bring it back.
  // A halted one can be resumed by the customer, so it is not marked.
  if (eventName !== 'subscription.halted') $set['plan.subscriptions.$[sub].ended'] = true;
  return { $inc: { 'agency.extraSlots': -1 }, $set };
}

function buildEndUpdate(user, record, eventName) {
  if (record.kind === 'slot') {
    // Lowers the limit once, and only for a slot that was active: the filter makes a repeated or early event do nothing.
    return {
      update: endUpdateFor(record, eventName), arrayFilters: [{ 'sub.subscriptionId': record.subscriptionId }], endsSlot: true,
      filter: { 'plan.subscriptions': { $elemMatch: { subscriptionId: record.subscriptionId, active: true } } }
    };
  }
  const status = eventName === 'subscription.halted' ? 'halted' : eventName === 'subscription.cancelled' ? 'cancelled' : 'expired';
  const arrayFilters = [{ 'sub.subscriptionId': record.subscriptionId }];
  const $set = { 'plan.subscriptions.$[sub].active': false };
  if (record.kind === 'plan') {
    if (user.plan && user.plan.subscriptionId && user.plan.subscriptionId !== record.subscriptionId) {
      return { update: { $set }, arrayFilters }; // a stale subscription: leave the current plan alone
    }
    $set['plan.tier'] = 'free'; $set['plan.addons'] = []; $set['subscription.status'] = status;
    return { update: { $set }, arrayFilters, endsPlan: true };
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
  PLAN_IDS, ADDON_IDS, SLOT_KEY, MAX_EXTRA_SLOTS, isPlanId, isAddonId, isSlotKey, planQuote, addonQuote, slotQuote, planCatalogue, findTopupPack,
  expandAddon, canBuyAddon, canBuySlot, invoiceSpec, razorpayPlanBody, envVarFor,
  verifyWebhookSignature, verifyCheckoutSignature, buildChargeUpdate, buildEndUpdate, endUpdateFor, priceOfRecord, expectedPaiseOf
};
