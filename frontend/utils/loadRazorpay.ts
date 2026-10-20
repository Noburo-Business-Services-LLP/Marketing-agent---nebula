const SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';
let pending: Promise<void> | null = null;

/** Loads the Razorpay payment window script the first time a payment starts. Resolves at once when it is already there. */
export function loadRazorpay(): Promise<void> {
  const w = window as any;
  if (w.Razorpay) return Promise.resolve();
  if (pending) return pending;
  pending = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { pending = null; s.remove(); reject(new Error('The payment window could not be loaded.')); };
    document.head.appendChild(s);
  });
  return pending;
}
