'use strict';
// The one rule every claim-then-pay refund follows (see DECISIONS-LOG D17, D19 and the Photoshoot sweep):
//   1. CLAIM the row into an intermediate state ('refunding'), recording the payer, the amount and the time in the SAME
//      atomic update, so a crash after the claim leaves everything needed to finish the job;
//   2. PAY with a `ref`, so the Quark ledger / chargeProof(ref) can see the refund;
//   3. MARK the row 'refunded';
//   4. a bounded sweep takes rows stuck in 'refunding' for more than SWEEP_AFTER_MS and calls settleRefund here.
// settleRefund is the sweep's decision: it pays only when the proof says the charge landed and no refund has, never
// more than the proven spend, to the recorded payer. It never marks anything: the caller does, from the outcome.

const SWEEP_AFTER_MS = 2 * 60 * 1000;
const ALERT_COOLDOWN_MS = 6 * 3600000;

/**
 * @param {object} a
 * @param {string} a.ref        the ref the charge (and the refund) carries
 * @param {string} a.userId     the account the job belongs to
 * @param {number} a.quarks     the amount recorded at claim time
 * @param {string} [a.payerId]  the wallet recorded at claim time (falls back to the proven payer)
 * @param {Function} a.pay      async ({ amount, payerId }) => truthy when the refund landed
 * @param {Function} a.chargeProof  quarkBuckets.chargeProof (throws when the lookup fails)
 * @param {Function} [a.alert]  async ({ key, subject, text, cooldownMs })
 * @param {string} [a.label]
 * @returns {Promise<'paid'|'already'|'nocharge'|'unproven'|'over'|'unknown'|'failed'>}
 */
async function settleRefund({ ref, userId, quarks, payerId = '', pay, chargeProof, alert, label = 'refund', quietNoCharge = false }) {
  const tell = async (rule, text) => {
    console.error(`[${label}] ${text}`);
    try { if (alert) await alert({ key: `${label}_${rule}:${ref}`, cooldownMs: ALERT_COOLDOWN_MS, subject: `Nebulaa alert: ${label} refund needs attention`, text }); } catch (_) { /* alerting never blocks */ }
  };
  let proof;
  try { proof = await chargeProof(String(ref), { userId: String(userId), payerId: payerId || '' }); } catch (_) { return 'unknown'; } // left for the next sweep
  if (proof && proof.refunded) return 'already';
  // quietNoCharge: the row was claimed only because the charge MIGHT have landed (a crash between charge and record);
  // finding no charge is then the normal answer and nothing needs a person.
  if ((!proof || !proof.spend) && quietNoCharge) return 'nocharge';
  if (!proof || !proof.spend) { await tell('unproven', `${label} ${ref}: a refund of ${quarks} Quarks is recorded but no charge was found for it, so nothing was paid. Check by hand.`); return 'unproven'; }
  const recorded = Number(quarks) || 0;
  const proven = Math.max(0, Number(proof.spend.quarks) || 0);
  if (!(recorded > 0) || proven < recorded) { await tell('over', `${label} ${ref}: the recorded refund (${recorded} Quarks) is more than the proven charge (${proven}), so nothing was paid. Check by hand.`); return 'over'; }
  let ok = false;
  try { ok = Boolean(await pay({ amount: recorded, payerId: payerId || proof.spend.payer || '' })); } catch (_) { ok = false; }
  if (ok) return 'paid';
  await tell('failed', `${label} ${ref}: the refund of ${recorded} Quarks was recorded but did not land. It will be tried again.`);
  return 'failed';
}

module.exports = { settleRefund, SWEEP_AFTER_MS };
