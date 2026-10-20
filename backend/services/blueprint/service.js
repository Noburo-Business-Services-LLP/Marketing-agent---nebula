'use strict';
// Brand Growth Blueprint service: start (limits, free slot, one charge), the background run, polling with
// stale-job reconcile, guided checkpoints, and refund-once. Mirrors the Hero money path (heroVideoFlow.js) without
// importing it: the charge is taken before work starts and refunded at most once, claimed atomically.
const { LIMITS, PLAN_RUNS_PER_DAY_MAX } = require('../../config/blueprint');
const { QUARK_COSTS } = require('../../config/apiCosts');
const { normaliseInput, emailKey, businessKeysOf } = require('./input');
const { resolveTier } = require('../../config/entitlements');
const { settleRefund, SWEEP_AFTER_MS } = require('../refundSettle');

const ACTION = 'blueprint';
const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE = ['queued', 'processing'];

const MSG = {
  verify: 'Please verify your email address before you create your Blueprint.',
  fields: 'Please correct the highlighted fields.',
  usedOther: 'This business has already used its free Blueprint.',
  used: 'You have already created your free Brand Growth Blueprint for this business. Open it, or upgrade to create more.',
  limit: 'You have reached the daily limit for Blueprints. Please try again tomorrow.',
  logo: 'The logo could not be uploaded. Try again, or continue without it.',
  quarks: 'You do not have enough Quarks for this. Please upgrade your plan, or buy an add-on pack or Quarks.',
  notFound: 'This Blueprint was not found.',
  notWaiting: 'This Blueprint is not waiting for your approval.',
  choose: 'Choose one of the directions to continue.',
  qa: 'We could not check this Blueprint well enough to share it. Please try again.',
  failed: 'We could not finish your Blueprint. Please try again.',
  notStarted: 'We could not start your Blueprint. Your Quarks were returned.',
  stale: 'This Blueprint took too long, so we stopped it. Please try again.',
  busy: 'We are busy right now, please try again later.'
};

const idOf = (user) => (!user ? '' : user._id ? String(user._id) : user.id ? String(user.id) : '');
const reply = (status, json) => ({ status, json });

// Every real dependency is loaded on first use so requiring this file starts nothing.
function defaultDeps() {
  const crypto = require('crypto');
  const { isPublicHttpsUrl } = require('../heroVideoService');
  return {
    Blueprint: require('../../models/Blueprint'),
    freeBlueprintIsFree: true,
    deletedBefore: async (email) => !!(await require('../../models/DeletedAccount').exists({ emailHash: { $in: require('../accountDeletion').emailHashes(email) } })),
    deduct: (...a) => require('../../middleware/trialGuard').deductCredits(...a),
    refund: (...a) => require('../../middleware/trialGuard').refundCredits(...a),
    chargeProof: (...a) => require('../quarkBuckets').chargeProof(...a),
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
    recordSpend: (...a) => require('../spendGuard').record(...a),
    spendCheck: (...a) => require('../spendGuard').check(...a),
    alertOwner: (a) => require('../opsAlerts').notify(a),
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
    result: doc.status === 'completed' ? doc.result : undefined,
    designed: doc.status === 'completed' ? require('./designedService').publicDesigned(doc.designed) : undefined
  };
}

function createBlueprintService(depsIn) {
  const deps = depsIn || defaultDeps();
  const { Blueprint } = deps;
  const at = () => new Date(deps.now());
  let designedSvc = null;
  const designedService = () => (designedSvc = designedSvc || (deps.designed || require('./designedService').createDesignedService(deps.designedDeps)));
  let capAlertDay = '';
  const noteFlag = (rule, detail) => ({ level: 'note', rule, where: 'run', detail });

  async function findExisting(key, keys) {
    return (await Blueprint.findOne({ freeSlot: true, emailKey: key }))
      || (keys.length ? await Blueprint.findOne({ freeSlot: true, businessKeys: { $in: keys } }) : null);
  }
  // The id is returned only to the account that owns that Blueprint; anyone else gets the same 409 with no id.
  const alreadyUsed = (ex, userId) => (ex && String(ex.userId) === String(userId)
    ? reply(409, { success: false, alreadyUsed: true, id: ex.blueprintId, message: MSG.used })
    : reply(409, { success: false, alreadyUsed: true, message: MSG.usedOther }));

  // Refunds follow one rule (see refundSettle.js): CLAIM into 'refunding' (payer, amount and time recorded in the same
  // atomic update), PAY with the blueprint id as `ref`, MARK 'refunded'. A crash or a failed payment leaves the row in
  // 'refunding'; settleStuck (get, the sweep) pays it later, once, and only when chargeProof says nobody has.
  const refundOk = (res) => !(res && res.success === false);
  const payRefund = (doc, payerId) => deps.refund(String(doc.userId), ACTION, 1, 'Refund: Brand Growth Blueprint', { ref: doc.blueprintId, ...(payerId ? { payerId } : {}) });
  const finishRefund = (blueprintId, state) => Blueprint.updateOne({ blueprintId, 'charge.state': 'refunding' }, { $set: { 'charge.state': state } });
  const claimRefund = (doc, from) => {
    const c = doc.charge || {};
    return Blueprint.findOneAndUpdate(
      { blueprintId: doc.blueprintId, 'charge.state': from },
      { $set: { 'charge.state': 'refunding', 'charge.refundAt': at(), 'charge.refundQuarks': Number(c.quarks) || QUARK_COSTS[ACTION], 'charge.refundPayer': c.payerId || '', 'charge.refundFrom': from } }
    );
  };

  async function refundOnce(doc) {
    const claimed = await claimRefund(doc, 'charged');
    if (!claimed) return false;
    try {
      const res = await payRefund(doc, claimed.charge && claimed.charge.payerId);
      if (!refundOk(res)) throw new Error((res && res.error) || 'refund returned success:false');
      await finishRefund(doc.blueprintId, 'refunded');
      return true;
    } catch (err) {
      console.error(`[blueprint] refund failed for ${doc.blueprintId}:`, err && err.message);
      return false; // stays 'refunding': never released to 'charged' (a refund that landed would then be paid twice)
    }
  }

  // Decides a claimed row from the proof, then marks it. `held` is the row as it was just claimed or re-held.
  async function settleHeld(held) {
    const c = held.charge || {};
    const out = await settleRefund({
      ref: held.blueprintId, userId: String(held.userId), quarks: Number(c.refundQuarks) || Number(c.quarks) || QUARK_COSTS[ACTION], payerId: c.refundPayer || c.payerId || '',
      chargeProof: deps.chargeProof || (async () => { throw new Error('no proof source'); }), alert: deps.alertOwner, label: 'blueprint',
      quietNoCharge: c.refundFrom === 'pending',
      pay: async ({ payerId }) => refundOk(await payRefund(held, payerId))
    });
    if (out === 'paid' || out === 'already') await finishRefund(held.blueprintId, 'refunded');
    else if (out === 'nocharge') await finishRefund(held.blueprintId, 'none');
    else if (out === 'unproven' || out === 'over') await finishRefund(held.blueprintId, 'unproven');
    return out === 'paid';
  }

  // A row stuck in 'refunding' for over two minutes. The hold (refundAt moved forward in one conditional update) means
  // two sweeps or pollers never both pay.
  async function settleStuck(doc) {
    const older = new Date(deps.now() - SWEEP_AFTER_MS);
    const held = await Blueprint.findOneAndUpdate({ blueprintId: doc.blueprintId, 'charge.state': 'refunding', 'charge.refundAt': { $lt: older } }, { $set: { 'charge.refundAt': at() } });
    return held ? settleHeld(held) : false;
  }

  // The job ended while its charge was still 'pending': a crash fell between the debit and the record. The ref on the
  // debit answers whether the customer paid; only a proven, unrefunded charge is paid back.
  async function settlePending(doc) {
    if (!(await claimRefund(doc, 'pending'))) return false;
    const fresh = await Blueprint.findOne({ blueprintId: doc.blueprintId });
    return fresh ? settleHeld(fresh) : false;
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

    // Someone who deleted their account and signed up again does not get a second free Blueprint.
    if (tier === 'free' && deps.deletedBefore && await deps.deletedBefore(user.email).catch(() => false)) return reply(409, { success: false, alreadyUsed: true, message: MSG.usedOther });

    const n = normaliseInput(body, { allowGuided: tier !== 'free' });
    if (!n.ok) return reply(400, { success: false, errors: n.errors, message: MSG.fields });
    const { input } = n;
    const key = emailKey(user.email);
    const keys = businessKeysOf(input);

    if (tier === 'free') {
      const ex = await findExisting(key, keys);
      if (ex) return alreadyUsed(ex, userId);
    }

    const ipHash = deps.hashIp(ip);
    const since = new Date(deps.now() - DAY_MS);
    const ipCap = tier === 'free' ? LIMITS.FREE_PER_IP_PER_DAY : LIMITS.PAID_PER_IP_PER_DAY;
    if ((await Blueprint.countDocuments({ ipHash, kind: { $ne: 'plan' }, createdAt: { $gte: since } })) >= ipCap) return reply(429, { success: false, message: MSG.limit });
    if (tier !== 'free' && (await Blueprint.countDocuments({ userId, kind: { $ne: 'plan' }, createdAt: { $gte: since } })) >= LIMITS.PAID_PER_ACCOUNT_PER_DAY) {
      return reply(429, { success: false, message: MSG.limit });
    }

    if (n.logoDataUrl) {
      try { input.logoUrl = await deps.uploadLogo(n.logoDataUrl); } catch (_) {
        return reply(400, { success: false, errors: { logo: MSG.logo }, message: MSG.fields });
      }
    }

    const blueprintId = deps.uuid();
    const now = at();
    // The free Blueprint (one per business) is made without Quarks, so a new account can use it before paying.
    const noCharge = tier === 'free' && deps.freeBlueprintIsFree === true;
    try {
      await Blueprint.create({
        blueprintId, userId, emailKey: key, tierAtStart: tier, mode: n.mode, status: 'queued', step: 'queued', progress: 0,
        checkpoint: null, heartbeatAt: now, input, businessKeys: keys, freeSlot: tier === 'free', ipHash, approvals: [], qaFlags: [],
        charge: noCharge ? { state: 'none', quarks: 0 } : { state: 'pending', quarks: QUARK_COSTS.blueprint }, createdAt: now
      });
    } catch (err) {
      if (err && err.code === 11000) return alreadyUsed(await findExisting(key, keys), userId);
      throw err;
    }

    // The free Blueprint (one per business) costs nothing: no charge is taken, so there is nothing to refund either.
    if (noCharge) {
      deps.enqueue(() => run(blueprintId));
      return reply(202, { success: true, id: blueprintId, status: 'queued' });
    }

    let paid = null;
    try { paid = await deps.deduct(userId, ACTION, 1, 'Brand Growth Blueprint', { ref: blueprintId }); } catch (err) {
      console.error('[blueprint] deduct failed:', err && err.message);
    }
    if (!paid || paid.success !== true) {
      // Nothing was taken, so nothing is refunded; the slot is released.
      await Blueprint.updateOne({ blueprintId }, { $set: { status: 'failed', step: 'failed', freeSlot: false, 'charge.state': 'none', error: { message: 'no_quarks' }, heartbeatAt: at() } });
      return reply(403, { success: false, creditsExhausted: true, upgradeRequired: true, reason: 'quarks', message: MSG.quarks });
    }
    // The customer has paid. If recording that fails twice, refund directly (with the same ref). The row is still
    // 'pending'; if even that refund fails it stays 'pending' and the stale path settles it from the proof (settlePending).
    // The write is conditional on 'pending', so it can never overwrite a refund claim.
    const markCharged = () => Blueprint.findOneAndUpdate({ blueprintId, 'charge.state': 'pending' }, { $set: { 'charge.state': 'charged', heartbeatAt: at(), ...(paid.workspaceId ? { 'charge.payerId': paid.payerId } : {}) } });
    try {
      if (!(await markCharged())) return reply(500, { success: false, message: MSG.notStarted }); // already claimed for a refund by the sweep
    } catch (first) {
      console.error('[blueprint] charge write failed, retrying:', first && first.message);
      try { if (!(await markCharged())) return reply(500, { success: false, message: MSG.notStarted }); } catch (second) {
        console.error('[blueprint] charge write failed again, refunding:', second && second.message);
        let refunded = false;
        try {
          const res = await deps.refund(String(userId), ACTION, 1, 'Refund: Brand Growth Blueprint', { ref: blueprintId, ...(paid.workspaceId ? { payerId: paid.payerId } : {}) });
          refunded = !(res && res.success === false);
        } catch (err) { console.error('[blueprint] direct refund failed:', err && err.message); }
        try {
          await Blueprint.updateOne({ blueprintId }, { $set: { status: 'failed', step: 'failed', freeSlot: false, 'charge.state': refunded ? 'refunded' : 'pending', error: { message: MSG.notStarted }, heartbeatAt: at() } });
        } catch (_) { /* best effort: the doc may stay pending */ }
        return reply(500, { success: false, message: MSG.notStarted });
      }
    }
    deps.enqueue(() => run(blueprintId));
    return reply(202, { success: true, id: blueprintId, status: 'queued' });
  }

  // A run the system starts for an account (its plan): no Quarks, no free slot, no per-account daily cap. It still
  // obeys the provider switches and the daily spend ceiling, and a global cap on how many plan runs one day can hold.
  // Spend is recorded when the planner is actually called (see run), so a run that stops early costs nothing.
  async function startSystem({ user, input, kind = 'plan' }) {
    const userId = idOf(user);
    const g = await (deps.spendCheck ? deps.spendCheck(ACTION) : { ok: true });
    if (g && g.ok === false) return { ok: false, reason: 'busy', message: g.message };
    const n = normaliseInput(input, { allowGuided: true, allowLearned: true });
    if (!n.ok) return { ok: false, reason: 'invalid_input', errors: n.errors, message: MSG.fields };
    if (kind === 'plan') {
      const since = new Date(deps.now() - DAY_MS);
      if ((await Blueprint.countDocuments({ kind: 'plan', createdAt: { $gte: since } })) >= PLAN_RUNS_PER_DAY_MAX) {
        const day = new Date(deps.now()).toISOString().slice(0, 10);
        if (capAlertDay !== day) {
          capAlertDay = day;
          try { if (deps.alertOwner) await deps.alertOwner({ key: 'plan_runs_cap', cooldownMs: 6 * 3600000, subject: 'Nebulaa alert: the daily limit on plan runs was reached', text: `The system has started ${PLAN_RUNS_PER_DAY_MAX} plan runs in the last 24 hours, which is the safety limit. No more plans will be started until older runs fall out of the window. If this is not expected, check the plan scheduler and the backfill script for a loop.` }); } catch (_) { /* alerting never stops the refusal */ }
        }
        return { ok: false, reason: 'daily_cap', message: MSG.busy };
      }
    }
    const blueprintId = deps.uuid();
    const now = at();
    await Blueprint.create({
      blueprintId, userId, emailKey: emailKey(user.email), tierAtStart: resolveTier(user), mode: 'auto', status: 'queued', step: 'queued', progress: 0,
      checkpoint: null, heartbeatAt: now, input: n.input, businessKeys: businessKeysOf(n.input), freeSlot: false, ipHash: '', approvals: [], qaFlags: [],
      kind, charge: { state: 'none', quarks: 0 }, createdAt: now
    });
    deps.enqueue(() => run(blueprintId), undefined, kind === 'plan' ? 'plan' : undefined);
    return { ok: true, id: blueprintId };
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
      // A plan run is not charged to anyone, so the model call is counted against the daily ceiling here, when it is made.
      // It is recorded before EVERY model call (a second try is a second call), never after.
      const beforeCall = doc.kind === 'plan' && deps.recordSpend ? async () => { try { await deps.recordSpend(ACTION, 1); } catch (_) { /* cost tracking is best effort */ } } : undefined;
      const built = await deps.plan.build({ input: doc.input, sheet, direction, mode: doc.mode, now: at(), sources: sources || [], ...(beforeCall ? { beforeCall } : {}) });
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
      // What Nebulaa learned reads the finished plan or Blueprint (debounced, code only; never throws).
      require('../brandMemory/runner').refreshSoon(doc.userId, 'blueprint');
    } catch (err) {
      console.error(`[blueprint] run failed for ${id}:`, err && err.message);
      await failAndRefund(doc, MSG.failed);
    }
  }

  // Ends a run that stopped reporting and settles any money still open on it. Every step is guarded, so polling a
  // Blueprint (or the sweep reaching it) any number of times never pays more than once.
  async function reconcile(doc) {
    const key = doc.blueprintId;
    const reload = async (d) => (await Blueprint.findOne({ blueprintId: key })) || d;
    if (ACTIVE.includes(doc.status) && deps.now() - new Date(doc.heartbeatAt).getTime() > LIMITS.STALE_MS) {
      await failAndRefund(doc, MSG.stale);
      doc = await reload(doc);
    }
    const state = doc.charge && doc.charge.state;
    const ended = doc.status === 'failed' || doc.status === 'stopped';
    if (ended && state === 'charged') { await refundOnce(doc); doc = await reload(doc); }
    else if (ended && state === 'pending') { await settlePending(doc); doc = await reload(doc); }
    else if (state === 'refunding') { await settleStuck(doc); doc = await reload(doc); }
    return doc;
  }

  // A bounded pass over refunds a crash or an outage left open: rows stuck in 'refunding' and runs that died with the
  // charge still 'pending'. Returns how many it looked at.
  async function sweepUnsettled(limit = 10) {
    const older = new Date(deps.now() - SWEEP_AFTER_MS);
    const staleBefore = new Date(deps.now() - LIMITS.STALE_MS);
    const rows = [];
    try { rows.push(...(await Blueprint.find({ 'charge.state': 'refunding', 'charge.refundAt': { $lt: older } }).limit(limit).lean())); } catch (_) { /* next pass */ }
    try { rows.push(...(await Blueprint.find({ 'charge.state': 'pending', heartbeatAt: { $lt: staleBefore } }).limit(limit).lean())); } catch (_) { /* next pass */ }
    let looked = 0;
    for (const r of rows.slice(0, limit * 2)) {
      try { await reconcile(r); looked += 1; } catch (e) { console.error('[blueprint] settle sweep failed:', e && e.message); }
    }
    try { looked += await designedService().sweepUnsettled(limit); } catch (e) { console.error('[blueprint] designed settle sweep failed:', e && e.message); }
    return looked;
  }

  async function get({ userId, id }) {
    const uid = String(userId);
    const key = String(id);
    let doc = await Blueprint.findOne({ blueprintId: key, userId: uid });
    if (!doc || doc.kind === 'plan') return reply(404, { success: false, message: MSG.notFound });
    doc = (await reconcile(doc)) || doc;
    if (doc.designed && doc.designed.status) {
      // A designed edition that stopped reporting is ended and refunded here, like the Blueprint itself.
      doc = await designedService().reconcile(doc);
    }
    return reply(200, { success: true, ...publicView(doc) });
  }

  async function list({ userId }) {
    const rows = await Blueprint.find({ userId: String(userId), kind: { $ne: 'plan' } }).sort({ createdAt: -1 }).limit(20).lean();
    return reply(200, { success: true, blueprints: rows.map((d) => ({ id: d.blueprintId, businessName: d.input && d.input.businessName, status: d.status, createdAt: d.createdAt })) });
  }

  async function continueRun({ userId, id, body }) {
    const key = String(id);
    const doc = await Blueprint.findOne({ blueprintId: key, userId: String(userId) });
    if (!doc || doc.kind === 'plan') return reply(404, { success: false, message: MSG.notFound });
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

  const startDesigned = async (args) => {
    const doc = await Blueprint.findOne({ blueprintId: String(args.id), userId: String(args.userId) });
    if (doc && doc.kind === 'plan') return reply(404, { success: false, message: MSG.notFound });
    return designedService().start(args);
  };

  return { start, startSystem, run, get, list, continueRun, refundOnce, startDesigned, sweepUnsettled, reconcile };
}

module.exports = { createBlueprintService, defaultDeps, publicView, applyLogo, ACTION, MSG };
