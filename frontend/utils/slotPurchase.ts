/** Buying one more client slot: create the subscription, open the payment window, confirm, and say what happened in plain words. The promise settles when the purchase ends one way or another. */
import { openSubscriptionCheckout } from './razorpayCheckout.ts';
import { slotConfirmedText, slotCreateMessage, slotVerifyMessage } from './agencyPlan.ts';

export interface SlotApi {
  createSlotSubscription: () => Promise<any>;
  verifySubscription: (r: { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }) => Promise<any>;
}

export interface SlotPurchaseHandlers {
  description: string;
  /** The message to show, and the new client limit when the server sent it. */
  onConfirmed: (message: string, clientLimit: number | null) => void;
  /** `paymentTaken` is true when the money was taken and only the confirming failed: the person must not be invited to pay again. */
  onProblem: (message: string, paymentTaken: boolean) => void;
  onClosed: () => void;
}

export async function startSlotPurchase(api: SlotApi, h: SlotPurchaseHandlers): Promise<void> {
  let data: any;
  try {
    data = await api.createSlotSubscription();
    if (!data?.success) throw data || new Error('');
  } catch (err) {
    h.onProblem(slotCreateMessage(err), false);
    return;
  }
  let limit: number | null = null;
  let paymentTaken = false;
  // Settles when the person is done: confirmed, a problem, or the window closed.
  await new Promise<void>((done) => openSubscriptionCheckout({
    data,
    description: h.description,
    verify: async (r) => {
      paymentTaken = true;
      let result: any;
      try { result = await api.verifySubscription(r); }
      catch (err) { throw new Error(slotVerifyMessage(err)); }
      if (!result?.success) throw new Error(slotVerifyMessage({ message: result?.message }));
      const n = Number(result.clientLimit);
      limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
      return { success: true, message: slotConfirmedText(result) };
    },
    onConfirmed: (message) => { h.onConfirmed(message, limit); done(); },
    onProblem: (m) => { h.onProblem(m, paymentTaken); done(); },
    onClosed: () => { h.onClosed(); done(); },
  }));
}
