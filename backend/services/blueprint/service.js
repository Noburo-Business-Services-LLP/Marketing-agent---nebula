'use strict';
// Brand Growth Blueprint service: start (limits, free slot, one charge), the background run, polling with
// stale-job reconcile, guided checkpoints, and refund-once. Mirrors the Hero money path (heroVideoFlow.js) without
// importing it: the charge is taken before work starts and refunded at most once, claimed atomically.
const { LIMITS } = require('../../config/blueprint');
const { QUARK_COSTS } = require('../../config/apiCosts');
const { normaliseInput, emailKey, businessKeysOf } = require('./input');

const ACTION = 'blueprint';
const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE = ['queued', 'processing'];

const MSG = {
  verify: 'Please verify your email address before you create your Blueprint.',
  fields: 'Please correct the highlighted fields.',
  used: 'You have already created your free Brand Growth Blueprint for this business. Open it, or upgrade to create more.',
  limit: 'You have reached the daily limit for Blueprints. Please try again tomorrow.',
  logo: 'The logo could not be uploaded. Try again, or continue without it.',
  quarks: 'You do not have enough Quarks for this. Please upgrade your plan, or buy an add-on pack or Quarks.',
  notFound: 'This Blueprint was not found.',
  notWaiting: 'This Blueprint is not waiting for your approval.',
  choose: 'Choose one of the directions to continue.',
  qa: 'We could not check this Blueprint well enough to share it. Please try again.',
  failed: 'We could not finish your Blueprint. Please try again.',
  stale: 'This Blueprint took too long, so we stopped it. Please try again.'
};

const idOf = (user) => (!user ? '' : user._id ? String(user._id) : user.id ? String(user.id) : '');
const reply = (status, json) => ({ status, json });

// Every real dependency is loaded on first use so requiring this file starts nothing.
function defaultDeps() {
  const crypto = require('crypto');
  const { isPublicHttpsUrl } = require('../heroVideoService');
  return {
    Blueprint: require('../../models/Blueprint'),
    deduct: (...a) => require('../../middleware/trialGuard').deductCredits(...a),
    refund: (...a) => require('../../middleware/trialGuard').refundCredits(...a),
    uploadLogo: async (dataUrl) => {
      const r = await require('../imageUploader').uploadBase64Image(dataUrl, 'nebula-blueprint-logos');
      if (!r || !r.success || !isPublicHttpsUrl(r.url)) throw new Error('upload failed');
      return r.url;
    },
    discover: (...a) => require('./discovery').discover(...a),
    plan: {
      build: (...a) => require('./pipeline').buildBlueprint(...a),
      directions: (...a) => require('./pipeline').proposeDirections(...a)
    },
    enqueue: (...a) => require('./runner').enqueue(...a),
    now: () => Date.now(),
    uuid: () => crypto.randomUUID(),
    hashIp: (ip) => crypto.createHash('sha256').update(`${process.env.JWT_SECRET || 'blueprint'}:${ip}`).digest('hex')
  };
}

// The uploaded logo reaches the sheet here: discovery only sees the typed address, never the file.
function applyLogo(sheet, input) {
  if (!sheet || !input || !input.logoUrl) return sheet;
  const cur = sheet.assets && sheet.assets.logo;
  if (cur && cur.url === input.logoUrl) return sheet;
  sheet.assets = { ...(sheet.assets || {}), logo: { url: input.logoUrl, source: 'typed' } };
  sheet.missing = (sheet.missing || []).filter((m) => m !== 'logo');
  sheet.unverified = (sheet.unverified || []).filter((u) => u.text !== 'Logo');
  return sheet;
}

function publicView(doc) {
  const awaiting = doc.status === 'awaiting_approval';
  const sheet = doc.sheet || {};
  return {
    id: doc.blueprintId,
    status: doc.status,
    step: doc.step,
    progress: doc.progress,
    mode: doc.mode,
    checkpoint: doc.checkpoint === undefined ? null : doc.checkpoint,
    businessName: doc.input && doc.input.businessName,
    createdAt: doc.createdAt,
    refunded: !!(doc.charge && doc.charge.state === 'refunded'),
    stop: doc.stop && doc.stop.message ? { reason: doc.stop.reason, message: doc.stop.message } : null,
    // The internal 'no_quarks' marker is never sent.
    error: doc.status === 'failed' && doc.error && doc.error.message && doc.error.message !== 'no_quarks' ? doc.error.message : null,
    discovery: awaiting && doc.checkpoint === 0
      ? {
        facts: (sheet.facts || []).map((f) => ({ id: f.id, text: f.text, source: f.source })),
        unverified: (sheet.unverified || []).map((u) => ({ id: u.id, text: u.text, reason: u.reason })),
        missing: sheet.missing || [],
        warnings: (sheet.warnings || []).map((w) => ({ reason: w.reason, message: w.message })),
        basis: sheet.basis
      }
      : undefined,
    directions: awaiting && doc.checkpoint === 1
      ? (doc.directions || []).map((d, i) => ({ id: i, name: d.name, rationale: d.rationale, risk: d.risk }))
      : undefined,
    result: doc.status === 'completed' ? doc.result : undefined
  };
}

function createBlueprintService(depsIn) {
  const deps = depsIn || defaultDeps();
  const { Blueprint } = deps;
  const at = () => new Date(deps.now());
  const noteFlag = (rule, detail) => ({ level: 'note', rule, where: 'run', detail });

  async function findExisting(key, keys) {
    return (await Blueprint.findOne({ freeSlot: true, emailKey: key }))
      || (keys.length ? await Blueprint.findOne({ freeSlot: true, businessKeys: { $in: keys } }) : null);
  }
  const alreadyUsed = (ex) => reply(409, { success: false, alreadyUsed: true, ...(ex ? { id: ex.blueprintId } : {}), message: MSG.used });

  // Refund at most once: the flag is claimed atomically BEFORE refunding; a failed refund releases the claim.
  async function refundOnce(doc) {
    const claimed = await Blueprint.findOneAndUpdate(
      { blueprintId: doc.blueprintId, 'charge.state': 'charged' },
      { $set: { 'charge.state': 'refunded' } }
    );
    if (!claimed) return false;
    try {
      const res = await deps.refund(String(doc.userId), ACTION, 1, 'Refund: Brand Growth Blueprint');
      if (res && res.success === false) throw new Error(res.error || 'refund returned success:false');
      return true;
    } catch (err) {
      console.error(`[blueprint] refund failed for ${doc.blueprintId}:`, err && err.message);
      try { await Blueprint.findOneAndUpdate({ blueprintId: doc.blueprintId }, { $set: { 'charge.state': 'charged' } }); } catch (_) { /* best effort */ }
      return false;
    }
  }

  // Ends the job (failed or stopped), releases the free slot and refunds. Only the caller that changes the status
  // refunds, so a stale poll and a late run can never both act.
  async function failAndRefund(doc, message, status = 'failed', extra = {}) {
    const moved = await Blueprint.findOneAndUpdate(
      { blueprintId: doc.blueprintId, status: { $in: ACTIVE } },
      { $set: { status, step: status, error: { message }, freeSlot: false, heartbeatAt: at(), ...extra } }
    );
    if (!moved) return false;
    await refundOnce(doc);
    return true;
  }

  async function start({ user, tier, body, ip }) {
    const userId = idOf(user);
    if (tier === 'free' && user.isVerified !== true) return reply(403, { success: false, verificationRequired: true, message: MSG.verify });

    const n = normaliseInput(body, { allowGuided: tier !== 'free' });
    if (!n.ok) return reply(400, { success: false, errors: n.errors, message: MSG.fields });
    const { input } = n;
    const key = emailKey(user.email);
    const keys = businessKeysOf(input);

    if (tier === 'free') {
      const ex = await findExisting(key, keys);
      if (ex) return alreadyUsed(ex);
    }

    const ipHash = deps.hashIp(ip);
    const since = new Date(deps.now() - DAY_MS);
    const ipCap = tier === 'free' ? LIMITS.FREE_PER_IP_PER_DAY : LIMITS.PAID_PER_IP_PER_DAY;
    if ((await Blueprint.countDocuments({ ipHash, createdAt: { $gte: since } })) >= ipCap) return reply(429, { success: false, message: MSG.limit });
    if (tier !== 'free' && (await Blueprint.countDocuments({ userId, createdAt: { $gte: since } })) >= LIMITS.PAID_PER_ACCOUNT_PER_DAY) {
      return reply(429, { success: false, message: MSG.limit });
    }

    if (n.logoDataUrl) {
      try { input.logoUrl = await deps.uploadLogo(n.logoDataUrl); } catch (_) {
        return reply(400, { success: false, errors: { logo: MSG.logo }, message: MSG.fields });
      }
    }

    const blueprintId = deps.uuid();
    const now = at();
    try {
      await Blueprint.create({
        blueprintId, userId, emailKey: key, tierAtStart: tier, mode: n.mode, status: 'queued', step: 'queued', progress: 0,
        checkpoint: null, heartbeatAt: now, input, businessKeys: keys, freeSlot: tier === 'free', ipHash, approvals: [], qaFlags: [],
        charge: { state: 'pending', quarks: QUARK_COSTS.blueprint }, createdAt: now
      });
    } catch (err) {
      if (err && err.code === 11000) return alreadyUsed(await findExisting(key, keys));
      throw err;
    }

    let paid = null;
    try { paid = await deps.deduct(userId, ACTION, 1, 'Brand Growth Blueprint'); } catch (err) {
      console.error('[blueprint] deduct failed:', err && err.message);
    }
    if (!paid || paid.success !== true) {
      // Nothing was taken, so nothing is refunded; the slot is released.
      await Blueprint.updateOne({ blueprintId }, { $set: { status: 'failed', step: 'failed', freeSlot: false, 'charge.state': 'none', error: { message: 'no_quarks' }, heartbeatAt: at() } });
      return reply(403, { success: false, creditsExhausted: true, upgradeRequired: true, reason: 'quarks', message: MSG.quarks });
    }
    await Blueprint.findOneAndUpdate({ blueprintId }, { $set: { 'charge.state': 'charged', heartbeatAt: at() } });
    deps.enqueue(() => run(blueprintId));
    return reply(202, { success: true, id: blueprintId, status: 'queued' });
  }

  async function run(id) {
    const claimed = await Blueprint.findOneAndUpdate(
      { blueprintId: id, status: 'queued' },
      { $set: { status: 'processing', startedAt: at(), heartbeatAt: at() } }
    );
    if (!claimed) return;
    const doc = claimed;
    // Every state write is conditional on the job still processing, so a job failed by a stale poll is never revived.
    const step = async (patch) => !!(await Blueprint.findOneAndUpdate({ blueprintId: id, status: 'processing' }, { $set: { ...patch, heartbeatAt: at() } }));
    try {
      if (!(await step({ step: 'reading', progress: 10 }))) return;
      let { sheet, sources } = doc;
      if (!sheet) {
        const out = await deps.discover({ input: doc.input });
        sheet = applyLogo(out.sheet, doc.input);
        sources = out.sources || [];
        if (!(await step({ sheet, sources, step: 'checking', progress: 35 }))) return;
      }
      if (sheet.stop) {
        await failAndRefund(doc, sheet.stop.message, 'stopped', { stop: { reason: sheet.stop.reason, message: sheet.stop.message } });
        return;
      }

      const approvals = doc.approvals || [];
      const flags = [];
      let direction = null;
      if (doc.mode === 'guided') {
        if (!approvals.some((a) => a.checkpoint === 0)) {
          await step({ status: 'awaiting_approval', checkpoint: 0, step: 'approval', progress: 40 });
          return;
        }
        let directions = doc.directions;
        const chosen = approvals.find((a) => a.checkpoint === 1);
        if (directions === undefined || directions === null) {
          try { directions = await deps.plan.directions({ input: doc.input, sheet }); } catch (err) {
            console.error('[blueprint] directions failed:', err && err.message);
            directions = [];
          }
          if (!Array.isArray(directions)) directions = [];
          if (directions.length >= 2) {
            await step({ directions, status: 'awaiting_approval', checkpoint: 1, step: 'approval', progress: 50 });
            return;
          }
          if (!(await step({ directions }))) return;
        } else if (directions.length >= 2 && !chosen) {
          await step({ status: 'awaiting_approval', checkpoint: 1, step: 'approval', progress: 50 });
          return;
        }
        if (directions.length < 2) flags.push(noteFlag('directions_skipped', 'Fewer than two directions were available, so the run continued automatically.'));
        if (chosen) direction = directions[chosen.choice] || null;
      }

      if (!(await step({ step: 'planning', progress: 60 }))) return;
      const built = await deps.plan.build({ input: doc.input, sheet, direction, mode: doc.mode, now: at(), sources: sources || [] });
      const qa = (built && built.qa) || { passed: false, flags: [] };
      const qaFlags = [...(qa.flags || []), ...flags];
      if (qa.passed === false || !built || !built.result) {
        await failAndRefund(doc, MSG.qa, 'failed', { qaFlags });
        return;
      }
      await Blueprint.findOneAndUpdate(
        { blueprintId: id, status: 'processing' },
        { $set: { status: 'completed', step: 'done', progress: 100, result: built.result, qaFlags, completedAt: at(), heartbeatAt: at() } }
      );
    } catch (err) {
      console.error(`[blueprint] run failed for ${id}:`, err && err.message);
      await failAndRefund(doc, MSG.failed);
    }
  }

  async function get({ userId, id }) {
    const uid = String(userId);
    const key = String(id);
    let doc = await Blueprint.findOne({ blueprintId: key, userId: uid });
    if (!doc) return reply(404, { success: false, message: MSG.notFound });
    if (ACTIVE.includes(doc.status) && deps.now() - new Date(doc.heartbeatAt).getTime() > LIMITS.STALE_MS) {
      await failAndRefund(doc, MSG.stale);
      doc = (await Blueprint.findOne({ blueprintId: key, userId: uid })) || doc;
    }
    // Self-heal a refund that failed earlier; guarded, so never a double refund.
    if ((doc.status === 'failed' || doc.status === 'stopped') && doc.charge && doc.charge.state === 'charged') {
      await refundOnce(doc);
      doc = (await Blueprint.findOne({ blueprintId: key, userId: uid })) || doc;
    }
    return reply(200, { success: true, ...publicView(doc) });
  }

  async function list({ userId }) {
    const rows = await Blueprint.find({ userId: String(userId) }).sort({ createdAt: -1 }).limit(20).lean();
    return reply(200, { success: true, blueprints: rows.map((d) => ({ id: d.blueprintId, businessName: d.input && d.input.businessName, status: d.status, createdAt: d.createdAt })) });
  }

  async function continueRun({ userId, id, body }) {
    const key = String(id);
    const doc = await Blueprint.findOne({ blueprintId: key, userId: String(userId) });
    if (!doc) return reply(404, { success: false, message: MSG.notFound });
    if (doc.status !== 'awaiting_approval') return reply(409, { success: false, message: MSG.notWaiting });
    const checkpoint = doc.checkpoint;
    let choice = null;
    if (checkpoint === 1) {
      const d = body && body.directionId;
      if (!Number.isInteger(d) || d < 0 || d >= (doc.directions || []).length) return reply(400, { success: false, message: MSG.choose });
      choice = d;
    }
    const approvals = [...(doc.approvals || []), { checkpoint, at: at(), choice }];
    const moved = await Blueprint.findOneAndUpdate(
      { blueprintId: key, status: 'awaiting_approval', checkpoint },
      { $set: { status: 'queued', checkpoint: null, heartbeatAt: at(), approvals } }
    );
    if (!moved) return reply(409, { success: false, message: MSG.notWaiting });
    deps.enqueue(() => run(key));
    return reply(202, { success: true, id: key, status: 'queued' });
  }

  return { start, run, get, list, continueRun, refundOnce };
}

module.exports = { createBlueprintService, defaultDeps, publicView, applyLogo, ACTION, MSG };
