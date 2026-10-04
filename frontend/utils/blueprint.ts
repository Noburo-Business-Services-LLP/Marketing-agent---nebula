// Pure helpers for the Brand Growth Blueprint pages: form rules, status text, polling pace and
// the sign-up deep link. No React, no browser APIs, no enums: Node runs this file directly in
// tests (like utils/plans.ts). Every sentence follows the app voice rules.

export type BlueprintStatusName = 'queued' | 'processing' | 'awaiting_approval' | 'completed' | 'stopped' | 'failed';
export type BlueprintTag = 'verified' | 'inference' | 'proposed' | 'unverified';
export type BlueprintMode = 'auto' | 'guided';

export interface BlueprintClaim { text: string; tag: BlueprintTag; label?: string | null }
export interface BlueprintFact { id: string | number; text: string; source?: unknown }
export interface BlueprintUnverified { id: string | number; text: string; reason?: string }
export interface BlueprintDiscovery {
  facts: BlueprintFact[];
  unverified: BlueprintUnverified[];
  missing: string[];
  warnings?: Array<{ reason?: string; message: string }>;
  basis?: 'full' | 'limited';
}
export interface BlueprintDirection { id: number; name: string; rationale?: BlueprintClaim | null; risk?: BlueprintClaim | null }

/** What GET /api/blueprint/:id returns (flat, with `success`). */
export interface BlueprintView {
  success?: boolean;
  id: string;
  status: BlueprintStatusName;
  step?: string;
  progress?: number;
  mode?: BlueprintMode;
  checkpoint?: number | null;
  businessName?: string;
  createdAt?: string;
  refunded?: boolean;
  stop?: { reason: 'unreachable' | 'thin' | 'identity_mismatch' | string; message: string } | null;
  error?: string | null;
  discovery?: BlueprintDiscovery;
  directions?: BlueprintDirection[];
  result?: any;
}

export interface BlueprintCompetitorForm { name: string; url: string }
export interface BlueprintOfferForm { name: string; price: string }
export interface BlueprintInputForm {
  businessName: string;
  website: string;
  instagram: string;
  whatYouSell: string;
  whoItsFor: string;
  goal: string;
  city: string;
  competitors: BlueprintCompetitorForm[];
  offers: BlueprintOfferForm[];
  colours: string[];
  logoDataUrl: string;
  mode: BlueprintMode;
}

export const GOALS = [
  { value: 'enquiries', label: 'More enquiries' },
  { value: 'sales', label: 'More sales' },
  { value: 'followers', label: 'More followers' },
  { value: 'launch', label: 'A launch' },
];

export const MAX_COMPETITORS = 3;
export const MAX_OFFERS = 3;
export const MAX_COLOURS = 3;
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** The sign-up link used by the landing page and the ad. */
export const BLUEPRINT_SIGNUP_PATH = '/login?mode=signup&intent=blueprint';
export const BLUEPRINT_NEW_PATH = '/blueprint/new';

export function emptyForm(): BlueprintInputForm {
  return {
    businessName: '', website: '', instagram: '', whatYouSell: '', whoItsFor: '', goal: '',
    city: '', competitors: [], offers: [], colours: [], logoDataUrl: '', mode: 'auto',
  };
}

// ---------- deep link ----------

/** 'blueprint' when the address carries intent=blueprint, else null. Accepts '?a=b' or 'a=b'. */
export function intentFromSearch(search: string | null | undefined): 'blueprint' | null {
  try {
    const p = new URLSearchParams(String(search || ''));
    return p.get('intent') === 'blueprint' ? 'blueprint' : null;
  } catch {
    return null;
  }
}

/** Where a signed-in visitor goes after login or email verification. */
export function postAuthTarget(search: string | null | undefined): string {
  return intentFromSearch(search) === 'blueprint' ? BLUEPRINT_NEW_PATH : '/dashboard';
}

// ---------- form validation (same rules and sentences as the backend) ----------

const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** 'empty' | 'bad' | 'ok' for a typed website address (example.com or a full https address). */
export function websiteState(raw: string): 'empty' | 'bad' | 'ok' {
  const s = String(raw || '').trim();
  if (!s) return 'empty';
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https:\/\//i.test(s)) return 'bad';
  const rest = s.replace(/^https:\/\//i, '');
  if (/\s/.test(rest)) return 'bad';
  const authority = rest.split(/[/?#]/)[0];
  if (!authority || authority.includes('@') || authority.includes(':')) return 'bad';
  if (IPV4_RE.test(authority) || authority.toLowerCase() === 'localhost') return 'bad';
  return HOST_RE.test(authority) ? 'ok' : 'bad';
}

/** 'empty' | 'bad' | 'ok' for an Instagram page typed as @name or as its web address. */
export function instagramState(raw: string): 'empty' | 'bad' | 'ok' {
  const s = String(raw || '').trim();
  if (!s) return 'empty';
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#\s]+)\/?(?:[?#].*)?$/i);
  const handle = m ? m[1] : s.replace(/^@/, '');
  if (m && ['p', 'reel', 'reels', 'explore', 'accounts', 'stories', 'tv', 'direct'].includes(handle.toLowerCase())) return 'bad';
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? 'ok' : 'bad';
}

export function validateForm(form: Partial<BlueprintInputForm>): { ok: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const f = form || {};
  const businessName = String(f.businessName || '').trim();
  if (businessName.length < 2) errors.businessName = 'Enter your business name.';

  const w = websiteState(String(f.website || ''));
  const ig = instagramState(String(f.instagram || ''));
  if (w === 'bad') errors.website = 'Enter your website as example.com or as a full address that starts with https://.';
  if (ig === 'bad') errors.instagram = 'Enter your Instagram page as @name or as its web address.';
  if (w === 'empty' && ig === 'empty') errors.website = 'Enter your website address or your Instagram page, or both.';

  if (String(f.whatYouSell || '').trim().length < 10) errors.whatYouSell = 'Describe what you sell in one sentence of at least ten characters.';
  if (String(f.whoItsFor || '').trim().length < 5) errors.whoItsFor = 'Describe who it is for in a few words.';
  if (!GOALS.some((g) => g.value === f.goal)) errors.goal = 'Choose your main goal.';

  const competitors = Array.isArray(f.competitors) ? f.competitors : [];
  const filledCompetitors = competitors.filter((c) => String(c?.name || '').trim() || String(c?.url || '').trim());
  if (filledCompetitors.length > MAX_COMPETITORS) errors.competitors = 'You can add up to three competitors.';
  else if (filledCompetitors.some((c) => String(c.url || '').trim() && websiteState(c.url) !== 'ok')) {
    errors.competitors = 'One competitor address could not be read. Check it or remove it.';
  }

  const offers = Array.isArray(f.offers) ? f.offers : [];
  const filledOffers = offers.filter((o) => String(o?.name || '').trim() || String(o?.price || '').trim());
  if (filledOffers.length > MAX_OFFERS) errors.offers = 'You can add up to three offers.';
  else if (filledOffers.some((o) => !String(o.name || '').trim())) errors.offers = 'Give each offer a name, or leave its price empty.';

  return { ok: Object.keys(errors).length === 0, errors };
}

/** The request body for POST /api/blueprint: trimmed, empty rows dropped, nothing the form did not define. */
export function buildStartBody(form: BlueprintInputForm, allowGuided: boolean): Record<string, any> {
  const body: Record<string, any> = {
    businessName: form.businessName.trim(),
    website: form.website.trim(),
    instagram: form.instagram.trim(),
    whatYouSell: form.whatYouSell.trim(),
    whoItsFor: form.whoItsFor.trim(),
    goal: form.goal,
    mode: allowGuided && form.mode === 'guided' ? 'guided' : 'auto',
  };
  if (form.city.trim()) body.city = form.city.trim();
  const competitors = form.competitors
    .map((c) => ({ name: c.name.trim(), url: c.url.trim() }))
    .filter((c) => c.name || c.url)
    .slice(0, MAX_COMPETITORS);
  if (competitors.length) body.competitors = competitors;
  const offers = form.offers
    .map((o) => ({ name: o.name.trim(), price: o.price.trim() }))
    .filter((o) => o.name || o.price)
    .slice(0, MAX_OFFERS);
  if (offers.length) body.offers = offers;
  if (form.colours.length) body.colours = form.colours.slice(0, MAX_COLOURS);
  if (form.logoDataUrl) body.logoDataUrl = form.logoDataUrl;
  return body;
}

/** Guided mode is offered to every account except a free one (accounts without a plan record are older paid ones). */
export function canChooseMode(user: { plan?: { tier?: string } | null } | null | undefined): boolean {
  const tier = user?.plan?.tier;
  return !tier || tier !== 'free';
}

/** Checks a chosen logo file before it is read. Returns a plain sentence, or null when it is fine. */
export function logoFileProblem(file: { type?: string; size?: number } | null | undefined): string | null {
  if (!file) return null;
  if (!LOGO_TYPES.includes(String(file.type || '').toLowerCase())) return 'Upload your logo as a PNG, JPG or WebP file.';
  if (Number(file.size || 0) > LOGO_MAX_BYTES) return 'The logo file is larger than 2 MB. Upload a smaller file.';
  return null;
}

export type StartFailure =
  | { kind: 'already'; id: string; message: string }
  | { kind: 'upgrade' }
  | { kind: 'fields'; errors: Record<string, string>; message: string }
  | { kind: 'message'; message: string };

/** Reads a failed POST /api/blueprint (the error object carries `.status` and `.data`). */
export function startFailureOf(err: any): StartFailure {
  const d = err?.data && typeof err.data === 'object' ? err.data : {};
  const message = typeof d.message === 'string' && d.message ? d.message : (typeof err?.message === 'string' && err.message ? err.message : 'We could not start your Blueprint. Please try again.');
  if (err?.status === 409 && d.alreadyUsed) return { kind: 'already', id: typeof d.id === 'string' ? d.id : '', message };
  if (err?.status === 403 && (d.upgradeRequired || d.creditsExhausted) && !d.verificationRequired) return { kind: 'upgrade' };
  if (err?.status === 400 && d.errors && typeof d.errors === 'object') return { kind: 'fields', errors: d.errors, message };
  return { kind: 'message', message };
}

// ---------- status text ----------

export function isTerminal(status: string | undefined): boolean {
  return status === 'completed' || status === 'stopped' || status === 'failed';
}

/** Polling stops at a terminal state and at a checkpoint that waits for the visitor. */
export function shouldPoll(view: Pick<BlueprintView, 'status'> | null | undefined): boolean {
  return !view || !(isTerminal(view.status) || view.status === 'awaiting_approval');
}

export const STEP_LABELS = ['Reading', 'Checking', 'Planning', 'Ready'];

/** Which of the four stepper stages is current (0 to 3). */
export function stepIndex(view: Pick<BlueprintView, 'status' | 'step' | 'checkpoint'>): number {
  if (view.status === 'completed') return 3;
  if (view.status === 'awaiting_approval') return view.checkpoint === 1 ? 2 : 1;
  switch (view.step) {
    case 'reading': return 0;
    case 'checking': return 1;
    case 'approval': return 1;
    case 'planning': return 2;
    case 'done': return 3;
    default: return 0;
  }
}

const withStop = (s: string): string => {
  const t = String(s || '').trim();
  return !t || /[.]$/.test(t) ? t : `${t}.`;
};
const RETURNED = 'Your Quarks were returned.';

export function statusHeading(view: Pick<BlueprintView, 'status' | 'checkpoint'>): string {
  switch (view.status) {
    case 'queued':
    case 'processing': return 'Your Blueprint is being prepared.';
    case 'awaiting_approval': return view.checkpoint === 1 ? 'Choose a direction.' : 'Check what Nebulaa found.';
    case 'completed': return 'Your Blueprint is ready.';
    case 'stopped': return 'We could not build this Blueprint.';
    case 'failed': return 'Your Blueprint could not be completed.';
    default: return 'Your Blueprint is being prepared.';
  }
}

export function progressText(view: Pick<BlueprintView, 'status' | 'step' | 'checkpoint' | 'stop' | 'error' | 'refunded'>): string {
  switch (view.status) {
    case 'queued': return 'Your Blueprint is in the queue. This usually takes a few minutes.';
    case 'processing':
      if (view.step === 'reading') return 'Nebulaa is reading the pages you pointed to.';
      if (view.step === 'checking') return 'Nebulaa is checking what it found.';
      if (view.step === 'planning') return 'Nebulaa is writing your plan.';
      return 'Nebulaa is working on your Blueprint.';
    case 'awaiting_approval':
      return view.checkpoint === 1
        ? 'Please choose the direction for your plan.'
        : 'Please check what Nebulaa found before it writes your plan.';
    case 'completed': return 'Your Blueprint is ready.';
    case 'stopped': {
      const m = withStop(view.stop?.message || 'We could not build a reliable Blueprint from the information given.');
      return view.refunded ? `${m} ${RETURNED}` : m;
    }
    case 'failed': {
      const m = withStop(view.error || 'We could not complete your Blueprint.');
      return view.refunded ? `${m} ${RETURNED}` : m;
    }
    default: return 'Nebulaa is working on your Blueprint.';
  }
}

/** Milliseconds before the next poll: every 3 seconds at first, then every 6. */
export function pollDelayMs(attempt: number): number {
  return attempt < 20 ? 3000 : 6000;
}

export function quarksNote(cost?: number | null): string {
  return typeof cost === 'number' && cost > 0
    ? `This uses ${cost} of your Quarks.`
    : 'This uses a small number of your Quarks.';
}
