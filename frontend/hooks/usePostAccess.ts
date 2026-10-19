import { useEffect, useState } from 'react';
import { apiService } from '../services/api';
import { PublishAccess, publishAccessOf } from '../utils/postActions';

/**
 * What the post actions need to know about the account: may it schedule and post (plan and Publish add-on), and is an
 * account connected. Loaded once per visit (two small reads already used by Settings and Connected accounts) and
 * shared by every screen. Unknown stays unknown: the buttons stay open and the server decides.
 */
export interface PostAccess { publish: PublishAccess; hasAccount: boolean | null }

const UNKNOWN: PostAccess = { publish: 'unknown', hasAccount: null };
let cache: PostAccess | null = null;
let inFlight: Promise<PostAccess> | null = null;

async function loadAccess(): Promise<PostAccess> {
  if (cache) return cache;
  if (!inFlight) {
    inFlight = Promise.allSettled([apiService.getBillingData(), apiService.getSocials()])
      .then(([billing, socials]) => {
        const plan = billing.status === 'fulfilled' ? (billing.value as any)?.plan : null;
        const list: any[] = socials.status === 'fulfilled' && Array.isArray((socials.value as any)?.connections) ? (socials.value as any).connections : [];
        const hasAccount = socials.status === 'fulfilled' ? list.some((c) => c && (c.connected === true || c.status === 'active')) : null;
        const out: PostAccess = { publish: plan ? publishAccessOf(plan) : 'unknown', hasAccount };
        cache = out;
        return out;
      })
      .catch(() => UNKNOWN)
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

/** Forget the cached answer (after connecting an account or buying the add-on). */
export function resetPostAccess(): void { cache = null; }

export function usePostAccess(): PostAccess {
  const [access, setAccess] = useState<PostAccess>(cache || UNKNOWN);
  useEffect(() => {
    let live = true;
    loadAccess().then((a) => { if (live) setAccess(a); });
    return () => { live = false; };
  }, []);
  return access;
}
