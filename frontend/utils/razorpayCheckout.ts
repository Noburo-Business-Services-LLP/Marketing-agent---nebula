/** Opens the payment window for a subscription the server has already created, then asks the server to confirm it. */
export interface CheckoutOptions {
  /** The server's answer to the create call: key, subscription_id and prefill. */
  data: { key: string; subscription_id: string; prefill?: unknown };
  description: string;
  /** Called with the three values the server needs to confirm the payment. */
  verify: (r: { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }) => Promise<{ success?: boolean; message?: string }>;
  onConfirmed: (message: string) => void;
  onProblem: (message: string) => void;
  onClosed: () => void;
}

export function openSubscriptionCheckout(o: CheckoutOptions): void {
  const Razorpay = (window as any).Razorpay;
  if (!Razorpay) { o.onProblem('The payment window could not be opened. Please check your connection and try again.'); return; }
  const rzp = new Razorpay({
    key: o.data.key,
    subscription_id: o.data.subscription_id,
    description: o.description,
    name: 'Nebulaa',
    prefill: o.data.prefill,
    theme: { color: '#ffcc29', backdrop_color: 'rgba(7, 10, 18, 0.9)' },
    handler: async (response: any) => {
      try {
        const result = await o.verify({ razorpay_payment_id: response.razorpay_payment_id, razorpay_subscription_id: response.razorpay_subscription_id, razorpay_signature: response.razorpay_signature });
        if (!result?.success) throw new Error(result?.message || 'The payment could not be confirmed.');
        o.onConfirmed(result.message || 'Your payment is confirmed.');
      } catch (err: any) {
        o.onProblem(err?.message || 'The payment was received but could not be confirmed. Please contact support.');
      }
    },
    modal: { ondismiss: o.onClosed },
  });
  rzp.on('payment.failed', (r: any) => o.onProblem(r?.error?.description || 'The payment failed. Please try again.'));
  rzp.open();
}
