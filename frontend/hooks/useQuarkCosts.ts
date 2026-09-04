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
let cache: Record<string, number> | null = null;
let inFlight: Promise<Record<string, number>> | null = null;

async function loadCosts(): Promise<Record<string, number>> {
  if (cache) return cache;
  if (!inFlight) {
    inFlight = apiService.getCredits()
      .then((res) => {
        cache = res?.costs || {};
        return cache;
      })
      .catch(() => ({}))
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

export function useQuarkCosts() {
  const [costs, setCosts] = useState<Record<string, number>>(cache || {});

  useEffect(() => {
    let cancelled = false;
    loadCosts().then((c) => { if (!cancelled) setCosts(c); });
    return () => { cancelled = true; };
  }, []);

  return costs;
}
