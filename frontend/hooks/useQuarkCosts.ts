import { useEffect, useState } from 'react';
import { apiService } from '../services/api';

/**
 * The Quark cost of each generation action, for showing a price right on
 * the button that spends it — "Build my carousel · 7" — rather than making
 * someone find out by clicking and seeing their balance drop.
 *
 * Module-level cache: several pages want this at once (Create, Videos), and
 * it changes only when CREDIT_COSTS itself changes on the backend, so one
 * fetch per session is enough rather than one per page mount.
 */
export interface QuarkPricing {
  costs: Record<string, number>;
  /** What one unit of each action is: "per slide", "per scene", "per post". */
  units: Record<string, string>;
}

const EMPTY: QuarkPricing = { costs: {}, units: {} };

let cache: QuarkPricing | null = null;
let inFlight: Promise<QuarkPricing> | null = null;

async function loadCosts(): Promise<QuarkPricing> {
  if (cache) return cache;
  if (!inFlight) {
    inFlight = apiService.getCredits()
      .then((res) => {
        cache = { costs: res?.costs || {}, units: res?.units || {} };
        return cache;
      })
      .catch(() => EMPTY)
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

/**
 * Just the per-unit numbers, for the small badges on generate buttons.
 * Those already multiply by slide/scene count themselves.
 */
export function useQuarkCosts() {
  return useQuarkPricing().costs;
}

/** Numbers AND their units, for anywhere that shows a price list. */
export function useQuarkPricing(): QuarkPricing {
  const [pricing, setPricing] = useState<QuarkPricing>(cache || EMPTY);

  useEffect(() => {
    let cancelled = false;
    loadCosts().then((p) => { if (!cancelled) setPricing(p); });
    return () => { cancelled = true; };
  }, []);

  return pricing;
}
