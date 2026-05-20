const API_BASE_URL =
  typeof window !== 'undefined' && window.location.hostname !== 'localhost'
    ? ''
    : 'http://localhost:5000';

export interface CustomerDetails {
  name: string;
  email: string;
  mobileNumber: string;
  shopName: string;
}

export interface PlanCycleInfo {
  planId: string;
  amount: number;
  label: string;
  per: string;
}

export interface PlanInfo {
  name: string;
  description: string;
  features: string[];
  cycles: {
    monthly: PlanCycleInfo;
    quarterly: PlanCycleInfo;
    annual: PlanCycleInfo;
  };
}

export interface PlansResponse {
  success: boolean;
  plans: {
    pro: PlanInfo;
    growth: PlanInfo;
    scale: PlanInfo;
  };
}

export interface CreateSubscriptionResponse {
  success: boolean;
  subscription_id: string;
  key: string;
  amount: number;
  customer_id: string;
  prefill: { name: string; email: string; contact: string };
  message?: string;
}

export interface VerifySubscriptionResponse {
  success: boolean;
  message: string;
  customer?: {
    name: string;
    email: string;
    plan: { tier: string; cycle: string; amount: number };
  };
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || 'Request failed');
  }
  return res.json();
}

export const apiService = {
  getPlans: () => request<PlansResponse>('/payment/plans'),

  createSubscription: (data: CustomerDetails & { planId: string }) =>
    request<CreateSubscriptionResponse>('/payment/create-subscription', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  verifySubscription: (data: {
    razorpay_payment_id: string;
    razorpay_subscription_id: string;
    razorpay_signature: string;
  }) =>
    request<VerifySubscriptionResponse>('/payment/verify-subscription', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
