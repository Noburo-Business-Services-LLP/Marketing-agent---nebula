'use strict';
/**
 * A fake Razorpay SDK with the shape the check's client wrapper expects, and a tiny subscription lifecycle:
 * create -> (pay) -> active with a paid invoice and a captured payment -> cancel. No network.
 */
function createFakeRazorpay({ shortUrlBase = 'https://rzp.io/i/fake' } = {}) {
  const plans = {}; const subs = {}; const payments = {}; const invoices = {};
  const calls = [];
  let n = 0;
  const err = (statusCode, description, code = 'BAD_REQUEST_ERROR') => Object.assign(new Error(description), { statusCode, error: { code, description } });
  const api = {
    calls, plans, subs, payments, invoices,
    failOn: {}, // { 'subscriptions.create': Error } makes that call fail
    sdk: {
      plans: { create: async (body) => { calls.push(['plans.create']); if (api.failOn['plans.create']) throw api.failOn['plans.create']; const id = `plan_fake${++n}`; plans[id] = { id, ...body }; return plans[id]; } },
      subscriptions: {
        create: async (body) => {
          calls.push(['subscriptions.create']);
          if (api.failOn['subscriptions.create']) throw api.failOn['subscriptions.create'];
          const id = `sub_fake${++n}`;
          subs[id] = { id, entity: 'subscription', plan_id: body.plan_id, status: 'created', notes: body.notes, short_url: `${shortUrlBase}${n}`, current_end: null, charge_at: null };
          return { ...subs[id] };
        },
        fetch: async (id) => { calls.push(['subscriptions.fetch', id]); if (!subs[id]) throw err(400, 'The id provided does not exist'); return { ...subs[id] }; },
        cancel: async (id, atEnd) => {
          calls.push(['subscriptions.cancel', id, atEnd]);
          const s = subs[id]; if (!s) throw err(400, 'The id provided does not exist');
          if (['cancelled', 'completed', 'expired'].includes(s.status)) throw err(400, `Subscription is not cancellable in ${s.status} status`);
          if (atEnd) { s.cancel_at_cycle_end = 1; return { ...s }; }
          s.status = 'cancelled'; return { ...s };
        }
      },
      payments: { fetch: async (id) => { calls.push(['payments.fetch', id]); if (!payments[id]) throw err(400, 'The id provided does not exist'); return { ...payments[id] }; } },
      invoices: {
        all: async ({ subscription_id: sid }) => { calls.push(['invoices.all', sid]); return { items: Object.values(invoices).filter((i) => i.subscription_id === sid) }; },
        fetch: async (id) => ({ ...invoices[id] })
      }
    },
    /** What the customer's payment on the hosted page does at Razorpay. `amount` overrides the plan amount (a wrong-price plan). */
    pay(subId, { amount } = {}) {
      const s = subs[subId]; const plan = plans[s.plan_id];
      const paise = amount !== undefined ? amount : (plan ? plan.item.amount : 0);
      const pid = `pay_fake${++n}`;
      payments[pid] = { id: pid, entity: 'payment', amount: paise, currency: 'INR', status: 'captured' };
      const iid = `inv_fake${n}`;
      invoices[iid] = { id: iid, subscription_id: subId, payment_id: pid, status: 'paid' };
      s.status = 'active'; s.current_end = Math.floor(Date.now() / 1000) + 30 * 86400; s.charge_at = s.current_end;
      return pid;
    },
    pendingSubscriptionIds: () => Object.values(subs).filter((s) => s.status === 'created').map((s) => s.id)
  };
  return api;
}
module.exports = { createFakeRazorpay };
