'use strict';
// The designed (image) edition of a finished Blueprint: start (one charge), the background run that makes, checks and
// finishes every page, refund-once, and the public view. Every real dependency is injected so the run is tested
// with a fake image provider and a fake vision checker.
const { QUARK_COSTS } = require('../../config/apiCosts');
const { buildDeck } = require('./designedDeck');
const { buildStyleSpec, buildPagePrompt } = require('./designedPrompt');
const { matchTranscript, pageAccepted, rejectionNote } = require('./designedCheck');
const { settleRefund, SWEEP_AFTER_MS } = require('../refundSettle');

const ACTION = 'blueprint_pdf';
const MAX_ATTEMPTS = 3;          // the first image and up to two regenerations
const PARALLEL_PAGES = 2;
const STALE_MS = 25 * 60 * 1000;
const MIN_IMAGE_SHARE = 1 / 3;   // below this many real images, the edition is not worth delivering

const MSG = {
  notFound: 'This Blueprint was not found.',
  notReady: 'Finish your Blueprint first, then you can make the designed PDF.',
  busy: 'Your designed PDF is already being made.',
  quarks: 'You do not have enough Quarks for this. Please buy Quarks or upgrade your plan.',
  failed: 'We could not make the designed PDF this time. Your Quarks were returned. Your Blueprint is still here.',
  stale: 'The designed PDF took too long, so we stopped it. Your Quarks were returned.',
};
const reply = (status, json) => ({ status, json });

function defaultDeps() {
  const crypto = require('crypto');
  return {
    Blueprint: require('../../models/Blueprint'),
    deduct: (...a) => require('../../middleware/trialGuard').deductCredits(...a),
    refund: (...a) => require('../../middleware/trialGuard').refundCredits(...a),
    chargeProof: (...a) => require('../quarkBuckets').chargeProof(...a),
    alertOwner: (a) => require('../opsAlerts').notify(a),
    generateImage: (prompt) => require('../openaiImage').generateOpenAIImageBuffer(prompt),
    readText: (buf) => require('../openaiImage').readTextFromImage(buf),
    uploadPage: async (jpeg) => {
      const r = await require('../imageUploader').uploadBase64Image(`data:image/jpeg;base64,${jpeg.toString('base64')}`, 'nebula-blueprint-pages');
      return r && r.success ? r.url : '';
    },
    uploadPdf: async (pdf, hint) => {
      const r = await require('../imageUploader').uploadPdfBuffer(pdf, 'nebula-blueprint-pdfs', hint);
      return r && r.success ? r.url : '';
    },
    fetchLogo: async (url) => {
      try {
        if (!/^https:\/\//i.test(String(url || ''))) return null;
        const res = await fetch(url);
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        return buf.length > 0 && buf.length < 5 * 1024 * 1024 ? buf : null;
      } catch (_) { return null; }
    },
    enqueue: (...a) => require('./runner').enqueue(...a),
    now: () => Date.now(),
    newId: () => crypto.randomUUID(),
  };
}

/** What the browser may see of the designed edition. */
function publicDesigned(d) {
  if (!d || !d.status) return undefined;
  const pages = Array.isArray(d.pages) ? d.pages : [];
  const total = Number(d.total) || pages.length || 0;
  return {
    status: d.status,
    total,
    done: pages.filter((p) => p.status === 'ok' || p.status === 'fallback').length,
    pages: pages.map((p) => ({ n: p.n, id: p.id, title: p.title, status: p.status, imageUrl: p.imageUrl || '' })),
    pdfUrl: d.status === 'completed' ? d.pdfUrl || '' : '',
    refunded: !!(d.charge && d.charge.state === 'refunded'),
    error: d.status === 'failed' && d.error ? d.error : null,
    quarks: d.charge && d.charge.quarks,
  };
}

function createDesignedService(depsIn) {
  const deps = depsIn || defaultDeps();
  const { Blueprint } = deps;
  const at = () => new Date(deps.now());

  // Refunds follow one rule (see refundSettle.js): CLAIM into 'refunding' (payer, amount, ref and time recorded in the
  // same atomic update), PAY with the charge's ref to the wallet that paid, MARK 'refunded'. A crash or a failed payment
  // leaves 'refunding'; settleStuck (reconcile, the sweep) pays it later, once, and only when chargeProof says nobody has.
  const refundOk = (res) => !(res && res.success === false);
  const finishRefund = (blueprintId, state) => Blueprint.updateOne({ blueprintId, 'designed.charge.state': 'refunding' }, { $set: { 'designed.charge.state': state } });
  const payRefund = (blueprintId, userId, ref, payerId) => deps.refund(String(userId), ACTION, 1, 'Refund: designed Blueprint PDF', { ref, ...(payerId ? { payerId } : {}) });
  const claimRefund = (blueprintId, from, c = {}) => Blueprint.findOneAndUpdate(
    { blueprintId, 'designed.charge.state': from },
    { $set: { 'designed.charge.state': 'refunding', 'designed.charge.refundAt': at(), 'designed.charge.refundQuarks': Number(c.quarks) || QUARK_COSTS[ACTION], 'designed.charge.refundPayer': c.payerId || '', 'designed.charge.refundFrom': from } }
  );
  const chargeRefOf = (blueprintId, c = {}) => c.ref || `${blueprintId}:pdf`;

  async function refundOnce(blueprintId, userId) {
    const before = await Blueprint.findOne({ blueprintId });
    const claimed = await claimRefund(blueprintId, 'charged', before && before.designed && before.designed.charge);
    if (!claimed) return false;
    try {
      const c = (claimed.designed && claimed.designed.charge) || {};
      const res = await payRefund(blueprintId, userId, chargeRefOf(blueprintId, c), c.payerId);
      if (!refundOk(res)) throw new Error((res && res.error) || 'refund returned success:false');
      await finishRefund(blueprintId, 'refunded');
      return true;
    } catch (err) {
      console.error(`[blueprint-pdf] refund failed for ${blueprintId}:`, err && err.message);
      return false; // stays 'refunding': never released to 'charged' (a refund that landed would then be paid twice)
    }
  }

  async function settleHeld(held) {
    const c = (held.designed && held.designed.charge) || {};
    const out = await settleRefund({
      ref: chargeRefOf(held.blueprintId, c), userId: String(held.userId), quarks: Number(c.refundQuarks) || Number(c.quarks) || QUARK_COSTS[ACTION], payerId: c.refundPayer || c.payerId || '',
      chargeProof: deps.chargeProof || (async () => { throw new Error('no proof source'); }), alert: deps.alertOwner, label: 'blueprint-pdf',
      quietNoCharge: c.refundFrom === 'pending',
      pay: async ({ payerId }) => refundOk(await payRefund(held.blueprintId, held.userId, chargeRefOf(held.blueprintId, c), payerId))
    });
    if (out === 'paid' || out === 'already') await finishRefund(held.blueprintId, 'refunded');
    else if (out === 'nocharge') await finishRefund(held.blueprintId, 'none');
    else if (out === 'unproven' || out === 'over') await finishRefund(held.blueprintId, 'unproven');
    return out === 'paid';
  }

  async function settleStuck(blueprintId) {
    const older = new Date(deps.now() - SWEEP_AFTER_MS);
    const held = await Blueprint.findOneAndUpdate({ blueprintId, 'designed.charge.state': 'refunding', 'designed.charge.refundAt': { $lt: older } }, { $set: { 'designed.charge.refundAt': at() } });
    return held ? settleHeld(held) : false;
  }

  // The edition ended while its charge was still 'pending' (a crash between the debit and the record): the ref on the
  // debit answers whether the customer paid.
  async function settlePending(blueprintId) {
    const before = await Blueprint.findOne({ blueprintId });
    if (!(await claimRefund(blueprintId, 'pending', before && before.designed && before.designed.charge))) return false;
    const fresh = await Blueprint.findOne({ blueprintId });
    return fresh ? settleHeld(fresh) : false;
  }

  async function failAndRefund(blueprintId, userId, message) {
    const moved = await Blueprint.findOneAndUpdate(
      { blueprintId, 'designed.status': { $in: ['queued', 'processing'] } },
      { $set: { 'designed.status': 'failed', 'designed.error': message, 'designed.heartbeatAt': at() } }
    );
    if (!moved) return false;
    await refundOnce(blueprintId, userId);
    return true;
  }

  async function start({ userId, id }) {
    const key = String(id);
    const uid = String(userId);
    const doc = await Blueprint.findOne({ blueprintId: key, userId: uid });
    if (!doc) return reply(404, { success: false, message: MSG.notFound });
    if (doc.status !== 'completed' || !doc.result) return reply(409, { success: false, message: MSG.notReady });
    if (doc.designed && ['queued', 'processing'].includes(doc.designed.status)) return reply(409, { success: false, busy: true, message: MSG.busy });
    if (doc.designed && doc.designed.status === 'completed') return reply(200, { success: true, designed: publicDesigned(doc.designed) });

    const deck = buildDeck(doc.result);
    const quarks = QUARK_COSTS[ACTION];
    const chargeRef = `${key}:pdf:${at().getTime()}`; // one ref per attempt: a retry after a refund is a new charge
    // Claim the start atomically: only one request can move a Blueprint without a live edition into 'queued'.
    const claimed = await Blueprint.findOneAndUpdate(
      { blueprintId: key, userId: uid, status: 'completed', $or: [{ designed: { $exists: false } }, { designed: null }, { 'designed.status': 'failed' }] },
      { $set: { designed: { status: 'queued', total: deck.length, pages: deck.map((p) => ({ n: p.n, id: p.id, title: p.title, status: 'pending', attempts: 0 })), charge: { state: 'pending', quarks, ref: chargeRef }, startedAt: at(), heartbeatAt: at() } } }
    );
    if (!claimed) return reply(409, { success: false, busy: true, message: MSG.busy });

    let paid = null;
    try { paid = await deps.deduct(uid, ACTION, 1, 'Designed Blueprint PDF', { ref: chargeRef }); } catch (err) { console.error('[blueprint-pdf] deduct failed:', err && err.message); }
    if (!paid || paid.success !== true) {
      await Blueprint.updateOne({ blueprintId: key }, { $unset: { designed: '' } });
      return reply(403, { success: false, creditsExhausted: true, reason: 'quarks', message: MSG.quarks });
    }
    // Recorded only while still 'pending' (never over a refund claim), with the wallet that paid so a refund goes back to it.
    try {
      const marked = await Blueprint.findOneAndUpdate({ blueprintId: key, 'designed.charge.state': 'pending' }, { $set: { 'designed.charge.state': 'charged', ...(paid.payerId ? { 'designed.charge.payerId': String(paid.payerId) } : {}) } });
      if (!marked) return reply(500, { success: false, message: MSG.failed }); // already claimed for a refund by the sweep
    } catch (err) {
      let back = null;
      try { back = await deps.refund(uid, ACTION, 1, 'Refund: designed Blueprint PDF not started', { ref: chargeRef, ...(paid.payerId ? { payerId: String(paid.payerId) } : {}) }); } catch (_) { /* logged below */ }
      if (back && back.success !== false) await Blueprint.updateOne({ blueprintId: key }, { $unset: { designed: '' } }).catch(() => {});
      // Refund did not land: the edition stays, failed and 'pending', so reconcile settles it from the proof.
      else await Blueprint.updateOne({ blueprintId: key }, { $set: { 'designed.status': 'failed', 'designed.error': MSG.failed, 'designed.heartbeatAt': at() } }).catch(() => {});
      return reply(500, { success: false, message: MSG.failed });
    }
    deps.enqueue(() => run({ blueprintId: key, userId: uid }));
    return reply(202, { success: true, started: true, quarks });
  }

  async function touch(blueprintId, set) {
    await Blueprint.updateOne({ blueprintId }, { $set: { ...set, 'designed.heartbeatAt': at() } });
  }

  // One page: make, read back, compare; regenerate up to twice; otherwise a plain page from the same text.
  async function makePage({ page, deck, style, logo, colours }) {
    const { composePage, fallbackPage } = require('./designedCompose');
    const prompt = buildPagePrompt(page, style);
    let attempts = 0;
    let lastNote = '';
    while (attempts < MAX_ATTEMPTS) {
      attempts += 1;
      const gen = await deps.generateImage(prompt);
      if (!gen || !gen.success || !gen.buffer) { lastNote = 'The image could not be made.'; continue; }
      const sharp = require('sharp');
      const small = await sharp(gen.buffer).jpeg({ quality: 82 }).toBuffer();
      const transcript = await deps.readText(small);
      const m = matchTranscript(page.lines, transcript, { allowed: [page.title, page.kicker], headings: [page.title, page.kicker] });
      // A cover or closing page with no planned lines is accepted when the model produced an image at all.
      if (pageAccepted(m) && (transcript || !page.lines.length)) {
        const finished = await composePage({ image: gen.buffer, logo, n: page.n, total: deck.length, illustrative: page.kind !== 'closing' });
        return { status: 'ok', attempts, buffer: finished, note: '' };
      }
      lastNote = rejectionNote(m);
    }
    const plain = await fallbackPage({ page, colours, logo, n: page.n, total: deck.length });
    return { status: 'fallback', attempts, buffer: plain, note: lastNote };
  }

  async function run({ blueprintId, userId }) {
    const doc = await Blueprint.findOne({ blueprintId, userId });
    if (!doc || !doc.result) return;
    const moved = await Blueprint.findOneAndUpdate({ blueprintId, 'designed.status': 'queued' }, { $set: { 'designed.status': 'processing', 'designed.heartbeatAt': at() } });
    if (!moved) return;
    try {
      const result = doc.result;
      const deck = buildDeck(result);
      const colours = ((result.cover && result.cover.colours) || []).map((c) => c.hex).filter(Boolean);
      const style = buildStyleSpec({ businessName: result.cover && result.cover.businessName, industry: doc.input && doc.input.whatYouSell, colours });
      const logoUrl = result.cover && result.cover.logo && result.cover.logo.url;
      const logo = logoUrl ? await deps.fetchLogo(logoUrl) : null;

      const outcomes = new Array(deck.length);
      let cursor = 0;
      const worker = async () => {
        while (cursor < deck.length) {
          const i = cursor; cursor += 1;
          const page = deck[i];
          let made;
          try { made = await makePage({ page, deck, style, logo, colours }); } catch (err) {
            console.error(`[blueprint-pdf] page ${page.n} failed:`, err && err.message);
            const { fallbackPage } = require('./designedCompose');
            made = { status: 'fallback', attempts: MAX_ATTEMPTS, buffer: await fallbackPage({ page, colours, logo, n: page.n, total: deck.length }), note: 'Made from your text.' };
          }
          const url = await deps.uploadPage(made.buffer).catch(() => '');
          outcomes[i] = { ...made, url };
          const done = outcomes.filter(Boolean).length;
          await touch(blueprintId, {
            [`designed.pages.${i}.status`]: made.status, [`designed.pages.${i}.attempts`]: made.attempts, [`designed.pages.${i}.imageUrl`]: url, [`designed.pages.${i}.note`]: made.note,
            'designed.progress': Math.round((done / deck.length) * 90),
          });
        }
      };
      await Promise.all(Array.from({ length: PARALLEL_PAGES }, worker));

      const real = outcomes.filter((o) => o && o.status === 'ok').length;
      if (real < Math.ceil(deck.length * MIN_IMAGE_SHARE)) {
        await failAndRefund(blueprintId, userId, MSG.failed);
        return;
      }
      const { buildPdf } = require('./designedCompose');
      const pdf = await buildPdf(outcomes.map((o) => o.buffer), { title: `${(result.cover && result.cover.businessName) || 'Brand'} Growth Blueprint` });
      const pdfUrl = await deps.uploadPdf(pdf, `blueprint-${blueprintId}`);
      if (!pdfUrl) { await failAndRefund(blueprintId, userId, MSG.failed); return; }
      await Blueprint.updateOne({ blueprintId, 'designed.status': 'processing' }, { $set: { 'designed.status': 'completed', 'designed.pdfUrl': pdfUrl, 'designed.progress': 100, 'designed.completedAt': at(), 'designed.heartbeatAt': at() } });
    } catch (err) {
      console.error(`[blueprint-pdf] run failed for ${blueprintId}:`, err && err.message);
      await failAndRefund(blueprintId, userId, MSG.failed);
    }
  }

  // A run that stopped reporting is ended and refunded; money still open on it (a refund claim a crash or an outage left
  // unpaid, or a charge that was never recorded) is settled from the proof. Every step is guarded.
  async function reconcile(doc) {
    let d = doc && doc.designed;
    if (!d) return doc;
    const reload = async () => (await Blueprint.findOne({ blueprintId: doc.blueprintId, userId: doc.userId })) || doc;
    if (['queued', 'processing'].includes(d.status) && deps.now() - new Date(d.heartbeatAt || d.startedAt).getTime() > STALE_MS) {
      await failAndRefund(doc.blueprintId, doc.userId, MSG.stale);
      doc = await reload(); d = doc.designed || d;
    }
    const state = d.charge && d.charge.state;
    if (d.status === 'failed' && state === 'charged') { await refundOnce(doc.blueprintId, doc.userId); return reload(); }
    if (d.status === 'failed' && state === 'pending') { await settlePending(doc.blueprintId); return reload(); }
    if (state === 'refunding') { await settleStuck(doc.blueprintId); return reload(); }
    return doc;
  }

  // A bounded pass over editions with a refund stuck in 'refunding' (called from the Blueprint sweep).
  async function sweepUnsettled(limit = 10) {
    const older = new Date(deps.now() - SWEEP_AFTER_MS);
    const rows = (await Blueprint.find({ 'designed.charge.state': 'refunding', 'designed.charge.refundAt': { $lt: older } }).limit(limit).lean().catch(() => [])) || [];
    let looked = 0;
    for (const r of rows) { try { await settleStuck(r.blueprintId); looked += 1; } catch (e) { console.error('[blueprint-pdf] settle sweep failed:', e && e.message); } }
    return looked;
  }

  return { start, run, reconcile, sweepUnsettled, publicDesigned };
}

module.exports = { createDesignedService, publicDesigned, MAX_ATTEMPTS, MIN_IMAGE_SHARE };
