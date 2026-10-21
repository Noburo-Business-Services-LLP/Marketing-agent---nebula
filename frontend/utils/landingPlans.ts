// The plan figures the public landing page shows. They come from the public plans answer
// (GET /api/payment/plans, the same answer the plans page reads). Until it arrives, or when it fails, the page shows
// PLANS_SNAPSHOT; tests/landing.test.mjs rebuilds the catalogue from backend/config/apiCosts.js and
// backend/config/plans.js and fails if this snapshot drifts. No price is typed anywhere else on the landing.
import type { PlansResponse } from '../services/api';

export type LandingPlanId = 'starter' | 'professional' | 'agency';
export type LandingAddonId = 'publish' | 'competitors' | 'inbox' | 'bundle';

export interface LandingPlan {
  id: LandingPlanId;
  name: string;
  description: string;
  /** Monthly price in rupees, before GST. */
  inr: number;
  /** Quarks the plan adds each month. */
  quarks: number;
  /** The feature lines as the server words them (posts and videos, team members, client brands). */
  features: string[];
}

export interface LandingFacts {
  plans: LandingPlan[];
  addons: Record<LandingAddonId, number>;
  agency: { includedClients: number; slotInr: number };
}

export const PLAN_ORDER: LandingPlanId[] = ['starter', 'professional', 'agency'];
const ADDON_IDS: LandingAddonId[] = ['publish', 'competitors', 'inbox', 'bundle'];

/** Checked against the backend config by tests/landing.test.mjs. Update it when a price or allowance changes. */
export const PLANS_SNAPSHOT: LandingFacts = {
  plans: [
    {
      id: 'starter', name: 'Starter', description: 'Marketing for one business, planned, made and improved every month.', inr: 999, quarks: 600,
      features: ['Up to 54 posts a month, or', 'up to 3 short videos with voice and music', 'Spend it on posts or videos, in any mix', 'Top up any time'],
    },
    {
      id: 'professional', name: 'Growth', description: 'More room each month, for businesses that market every day.', inr: 1999, quarks: 2000,
      features: ['Up to 181 posts a month, or', 'up to 12 short videos with voice and music', 'Spend it on posts or videos, in any mix', 'Top up any time', 'Up to 5 team members'],
    },
    {
      id: 'agency', name: 'Agency', description: 'Run the marketing of several client brands from one account, with one shared pool of Quarks.', inr: 6999, quarks: 6000,
      features: ['Up to 545 posts a month, or', 'up to 37 short videos with voice and music', 'Spend it on posts or videos, in any mix', 'Top up any time', '5 client brands included', 'Publishing, inbox and competitor insights included', 'Usage report for each client'],
    },
  ],
  addons: { publish: 1000, competitors: 500, inbox: 500, bundle: 1800 },
  agency: { includedClients: 5, slotInr: 1499 },
};

const whole = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && Math.round(n) === n ? n : null;
};

/** The landing facts from the server answer, or null when the answer is missing a plan or a price (the snapshot is shown then). */
export function factsFrom(res: Partial<PlansResponse> | null | undefined): LandingFacts | null {
  if (!res || !Array.isArray(res.plans)) return null;
  const plans: LandingPlan[] = [];
  for (const id of PLAN_ORDER) {
    const p = res.plans.find((x) => x && x.id === id);
    const inr = whole(p?.inr);
    const quarks = whole(p?.quarks);
    if (!p || !inr || !quarks || typeof p.name !== 'string' || !p.name) return null;
    plans.push({
      id, name: p.name, description: typeof p.description === 'string' ? p.description : '', inr, quarks,
      features: Array.isArray(p.features) ? p.features.filter((f): f is string => typeof f === 'string' && f.trim().length > 0) : [],
    });
  }
  const addons = {} as Record<LandingAddonId, number>;
  for (const id of ADDON_IDS) {
    const inr = whole((res.addons || []).find((a) => a && a.id === id)?.inr);
    if (!inr) return null;
    addons[id] = inr;
  }
  const includedClients = whole(res.agency?.includedClients);
  const slotInr = whole(res.agency?.slotInr);
  if (!includedClients || !slotInr) return null;
  return { plans, addons, agency: { includedClients, slotInr } };
}

/** Rupees as the app writes them: "₹1,999". */
export const rupees = (n: number): string => `₹${Math.round(n).toLocaleString('en-IN')}`;
/** A Quark amount as the app writes it: "2,000". */
export const amount = (n: number): string => Math.round(n).toLocaleString('en-IN');

export function planOf(facts: LandingFacts, id: LandingPlanId): LandingPlan {
  return facts.plans.find((p) => p.id === id) || PLANS_SNAPSHOT.plans.find((p) => p.id === id)!;
}

/** The plan whose price per Quark is lowest: the only plan the page may call "Best value". */
export function bestValueId(facts: LandingFacts): LandingPlanId {
  return [...facts.plans].sort((a, b) => a.inr / a.quarks - b.inr / b.quarks)[0].id;
}
