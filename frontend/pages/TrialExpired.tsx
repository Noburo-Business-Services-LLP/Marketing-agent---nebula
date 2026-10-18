import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { CheckCircle, Check, Loader2, Shield, Plus, AlertCircle } from 'lucide-react';
import { apiService, PlansResponse } from '../services/api';
import { useQuarkCosts } from '../hooks/useQuarkCosts';
import PlanArt from '../components/PlanArt';
import { PLANS_INTRO, addonBlurb, currentPlanLine, formatInr, formatPaise, leftText, orderedPlans, planLines, plainMessage, renewalText, topupLine } from '../utils/plans';
import {
  AGENCY_BADGE, AGENCY_BADGE_LINE, agencyCardNote, agencyCardState, showsAgencyHint, agencyExtraClientLine, agencyFeatureLines, agencyHeadline, canCancelExtraClient, extraClientEndingNote, insideClientBillingNotice, poolText, slotAvailability,
} from '../utils/agencyPlan';
import BillingDetailsForm from '../components/BillingDetailsForm';
import ExtraClientDialog from '../components/ExtraClientDialog';
import CancelExtraClientDialog from '../components/CancelExtraClientDialog';
import LegalLinks from '../components/LegalLinks';
import { returnHashAfterActing } from '../utils/staffHome';

declare global {
  interface Window {
    Razorpay: any;
  }
}

// The plans page. It sits inside the app shell like every other page. Customers see posts and videos here, never Quarks.
// (The file keeps its old name so that the /trial-expired route does not change.)
interface TrialExpiredProps {
  reason?: 'time' | 'credits' | 'migrated';
  daysUsed?: number;
  creditsUsed?: number;
  /** Working inside one of an agency's clients: plans and payments belong to the agency account. */
  insideClient?: boolean;
  onLogout?: () => void;
}

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gv-text-primary)]';
const BTN_MAIN = `w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--gv-accent)] px-4 min-h-[44px] text-[14px] font-semibold text-[var(--gv-accent-ink)] hover:bg-[var(--gv-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
const BTN = `w-full inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--gv-border-strong)] bg-[var(--gv-panel)] px-4 min-h-[44px] text-[14px] font-semibold text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`;
const LINK = `text-[14px] font-medium text-[var(--gv-text-primary)] underline underline-offset-2 hover:text-[var(--gv-accent-text)] rounded-sm ${FOCUS}`;
const CARD = 'rounded-2xl border border-[var(--gv-border-default)] bg-[var(--gv-panel)] shadow-[var(--gv-shadow-card)]';
const INK = { color: 'var(--gv-text-primary)' } as const;
const QUIET = { color: 'var(--gv-text-secondary)' } as const;

const Heading: React.FC<{ id: string; children: React.ReactNode; hint?: React.ReactNode }> = ({ id, children, hint }) => (
  <div className="mb-4">
    <h2 id={id} className="text-[20px] font-semibold leading-snug" style={INK}>{children}</h2>
    {hint && <p className="mt-1 text-[14px] leading-relaxed" style={QUIET}>{hint}</p>}
  </div>
);

const Spinner: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex justify-center py-16" role="status" aria-label={label}><Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none text-[var(--gv-accent-text)]" aria-hidden="true" /></div>
);

const TrialExpired: React.FC<TrialExpiredProps> = ({ insideClient }) => {
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const costs = useQuarkCosts();
  const [catalogue, setCatalogue] = useState<PlansResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [tier, setTier] = useState<string>('free');
  const [held, setHeld] = useState<string[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [renewsAt, setRenewsAt] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [accountLoaded, setAccountLoaded] = useState(false);
  // An Agency account: its client count and shared pool, shown in posts and videos.
  const [agencyNow, setAgencyNow] = useState<{ limit: number; used: number; poolPosts?: number; poolVideos?: number; extraSlots?: number; slotsEnding?: number; slotsEndAt?: string | null } | null>(null);
  const [slotOpen, setSlotOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [showGst, setShowGst] = useState(false);
  const agencyCardRef = useRef<HTMLDivElement>(null);

  const loadAgency = async () => {
    try {
      const [c, u] = await Promise.all([apiService.getAgencyClients(), apiService.getAgencyUsage().catch(() => null)]);
      setAgencyNow({ limit: c.limit || 0, used: c.used ?? (c.clients || []).length, poolPosts: u?.poolPosts, poolVideos: u?.poolVideos, extraSlots: c.extraSlots, slotsEnding: c.slotsEnding, slotsEndAt: c.slotsEndAt });
    } catch { setAgencyNow(null); }
  };

  const loadAccount = async () => {
    try {
      const b = await apiService.getBillingData();
      if (b?.plan?.tier) setTier(b.plan.tier);
      setHeld(Array.isArray(b?.plan?.addons) ? b.plan.addons : []);
      if (typeof b?.credits?.balance === 'number') setBalance(b.credits.balance);
      setRenewsAt(typeof b?.subscription?.endsAt === 'string' ? b.subscription.endsAt : null);
      setCancelling(!!b?.subscription?.cancelAtPeriodEnd);
      if (b?.plan?.tier === 'agency' && !insideClient) await loadAgency();
    } catch { /* the catalogue is still useful without the account details */ }
    setAccountLoaded(true);
  };

  useEffect(() => {
    if (insideClient) { setLoading(false); return; }
    apiService.getPlans()
      .then((res) => setCatalogue(res))
      .catch((e: any) => setLoadError(e?.message || 'The plans could not be loaded. Please try again.'))
      .finally(() => setLoading(false));
    loadAccount();
  }, []);

  const ownsAddon = (id: string) => held.includes(id) || held.includes('bundle');
  const onPaidPlan = tier === 'starter' || tier === 'professional';
  const isAgencyPlan = tier === 'agency';
  const agencyState = agencyCardState(tier);
  // Arrived from sign-up after saying they manage several brands: the Agency card carries a small "Suggested for you" badge.
  // The card order never changes.
  const agencyHint = showsAgencyHint(routerLocation.search, agencyState);
  const isManaged = tier === 'managed';
  const isFree = tier === 'free';
  const ready = !insideClient && !loading && accountLoaded && !loadError && !!catalogue;

  // ?for=agency: bring the Agency card into view and move focus to it, once the cards are on screen.
  useEffect(() => {
    if (!ready || !agencyHint) return;
    const el = agencyCardRef.current;
    if (!el) return;
    const calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
  }, [ready, agencyHint]);

  // One checkout runner for the three purchases. `verify` confirms the payment on the server.
  const checkout = async (key: string, create: () => Promise<any>, build: (d: any) => any, verify: (r: any) => Promise<any>) => {
    setBusy(key); setError(''); setNotice('');
    try {
      const data = await create();
      if (!data?.success) throw new Error(plainMessage(data?.message, 'The payment could not be started. Please try again.'));
      const rzp = new window.Razorpay({
        ...build(data),
        name: 'Nebulaa',
        prefill: data.prefill,
        theme: { color: '#F5A623', backdrop_color: 'rgba(20, 32, 58, 0.6)' },
        handler: async (response: any) => {
          try {
            const result = await verify(response);
            if (!result?.success) throw new Error(plainMessage(result?.message, 'The payment could not be confirmed.'));
            setNotice(plainMessage(result.message, 'Your payment is confirmed.'));
            if (typeof result.balance === 'number') {
              window.dispatchEvent(new CustomEvent('credits-updated', { detail: { creditsRemaining: result.balance } }));
            }
            await loadAccount();
          } catch (err: any) {
            setError(plainMessage(err?.message, 'The payment was received but could not be confirmed. Please contact support.'));
          } finally { setBusy(null); }
        },
        modal: { ondismiss: () => setBusy(null) },
      });
      rzp.on('payment.failed', (r: any) => { setBusy(null); setError(plainMessage(r?.error?.description, 'The payment failed. Please try again.')); });
      rzp.open();
    } catch (err: any) {
      setBusy(null);
      setError(plainMessage(err?.message, 'The payment could not be started. Please try again.'));
    }
  };

  const buyPlan = (id: 'starter' | 'professional' | 'agency', name: string, charge: number) =>
    checkout(`plan:${id}`, () => apiService.createSubscription(id),
      (d) => ({ key: d.key, subscription_id: d.subscription_id, description: `${name}, monthly, ${formatPaise(charge)} including GST` }),
      (r) => apiService.verifySubscription({ razorpay_payment_id: r.razorpay_payment_id, razorpay_subscription_id: r.razorpay_subscription_id, razorpay_signature: r.razorpay_signature }));

  const buyAddon = (id: 'publish' | 'competitors' | 'inbox' | 'bundle', label: string, charge: number) =>
    checkout(`addon:${id}`, () => apiService.createAddonSubscription(id),
      (d) => ({ key: d.key, subscription_id: d.subscription_id, description: `${label}, monthly, ${formatPaise(charge)} including GST` }),
      (r) => apiService.verifySubscription({ razorpay_payment_id: r.razorpay_payment_id, razorpay_subscription_id: r.razorpay_subscription_id, razorpay_signature: r.razorpay_signature }));

  const buyTopup = (inr: number, what: string) =>
    checkout(`topup:${inr}`, () => apiService.createPaymentOrder(inr),
      (d) => ({ key: d.key, order_id: d.order.id, amount: d.order.amount, currency: d.order.currency, description: `More posts and videos: ${what.toLowerCase()}` }),
      (r) => apiService.verifyPayment({ razorpay_order_id: r.razorpay_order_id, razorpay_payment_id: r.razorpay_payment_id, razorpay_signature: r.razorpay_signature }));

  if (insideClient) {
    const n = insideClientBillingNotice();
    return (
      <div className="mx-auto max-w-xl">
        <h1 className="sr-only">Plans</h1>
        <div className={`${CARD} p-6 text-center sm:p-8`}>
          <h2 className="mb-2 text-[20px] font-semibold" style={INK}>{n.title}</h2>
          <p className="mb-5 text-[14px] leading-relaxed" style={QUIET}>{n.body}</p>
          <button type="button" className={`${BTN_MAIN} sm:max-w-xs sm:mx-auto`} onClick={() => { const back = returnHashAfterActing(localStorage.getItem('csmReturnTo')); if (apiService.returnToCsmAccount()) { window.location.hash = back; window.location.reload(); } }}>{n.action}</button>
        </div>
      </div>
    );
  }
  // Wait for the account too, so an agency never sees the plan cards of a new account for a moment.
  if (loading || !accountLoaded) return <Spinner label="Loading the plans" />;
  if (loadError || !catalogue) {
    return (
      <div className="mx-auto max-w-xl">
        <h1 className="sr-only">Plans</h1>
        <div className={`${CARD} p-6 text-center`}><p role="alert" className="text-[14px]" style={INK}>{loadError || 'The plans could not be loaded. Please try again.'}</p></div>
      </div>
    );
  }

  const clientsLink = () => { window.location.hash = '#/agency/clients'; window.location.reload(); };
  const slotRoom = slotAvailability({ limit: agencyNow?.limit, used: agencyNow?.used, maxClients: catalogue.agency?.maxClients });
  const poolEmpty = isAgencyPlan && agencyNow?.poolPosts === 0 && !(agencyNow?.poolVideos);
  const poolNotice = agencyHeadline(true);
  const left = isAgencyPlan ? '' : leftText(balance, costs);
  const planLine = currentPlanLine({ tier, left, renews: renewalText(renewsAt), ending: cancelling });
  const cards = orderedPlans(catalogue.plans).filter((plan) => !isAgencyPlan || plan.id === 'agency');
  const showAddons = !isManaged && !isAgencyPlan;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-10 pb-10">
      <header>
        <h1 className="text-[28px] font-semibold leading-tight" style={INK}>Plans</h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed" style={QUIET}>{PLANS_INTRO}</p>
        <p className="mt-3 text-[15px] font-medium leading-relaxed" style={INK} data-testid="current-plan-line">{planLine}</p>
      </header>

      {notice && <p role="status" className="flex items-start gap-2 rounded-xl border border-[var(--gv-border-default)] px-4 py-3 text-[14px]" style={{ background: 'var(--gv-mint)', color: 'var(--gv-text-primary)' }}><CheckCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{notice}</p>}
      {error && <p role="alert" className="flex items-start gap-2 rounded-xl border border-[var(--gv-coral)] px-4 py-3 text-[14px]" style={{ background: 'var(--gv-peach)', color: 'var(--gv-text-primary)' }}><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{error}</p>}

      {isFree && (
        <section className={`${CARD} p-5 sm:p-6`} aria-labelledby="free-blueprint">
          <h2 id="free-blueprint" className="text-[18px] font-semibold" style={INK}>Your Brand Growth Blueprint is free</h2>
          <p className="mt-1 text-[14px] leading-relaxed" style={QUIET}>A plan for your business: who to reach, what to post and where to start. It takes a few minutes and costs nothing. Posts, campaigns and videos start with a plan below.</p>
          <button type="button" className={`${BTN} mt-4 sm:max-w-xs`} onClick={() => navigate('/blueprint')}>Make my free Blueprint</button>
        </section>
      )}

      {poolEmpty && (
        <p role="status" className="rounded-xl border border-[var(--gv-coral)] px-4 py-3 text-[14px]" style={{ background: 'var(--gv-peach)', color: 'var(--gv-text-primary)' }}><strong className="font-semibold">{poolNotice.title}.</strong> {poolNotice.body}</p>
      )}

      {isAgencyPlan && (
        <section className={`${CARD} p-5 sm:p-6`} aria-labelledby="your-agency-plan">
          <h2 id="your-agency-plan" className="mb-3 text-[20px] font-semibold" style={INK}>Your clients and shared pool</h2>
          {agencyNow ? (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div>
                <p className="text-[32px] font-semibold leading-none" style={INK}>{agencyNow.used} of {agencyNow.limit}<span className="text-[15px] font-normal" style={QUIET}> clients</span></p>
                {poolText(agencyNow.poolPosts, agencyNow.poolVideos) && <p className="mt-2 text-[14px]" style={QUIET}>{poolText(agencyNow.poolPosts, agencyNow.poolVideos)}</p>}
                <button type="button" onClick={clientsLink} className={`${LINK} mt-4`}>Go to my clients</button>
              </div>
              <div>
                <h3 className="mb-1 text-[16px] font-semibold" style={INK}>Extra clients</h3>
                <p className="mb-1 text-[14px]" style={QUIET}>{agencyExtraClientLine(catalogue.agency, catalogue.slot)}</p>
                {slotRoom.hint && <p className="mb-1 text-[14px]" style={QUIET}>{slotRoom.hint}</p>}
                {!slotRoom.canBuy && <p className="mb-3 text-[14px]" style={QUIET} role="status">{slotRoom.message}</p>}
                <button type="button" className={`${BTN_MAIN} mt-2 md:max-w-xs`} disabled={!slotRoom.canBuy || !!busy} onClick={() => { setNotice(''); setError(''); setSlotOpen(true); }}>
                  <Plus className="h-4 w-4" aria-hidden="true" /> Add an extra client
                </button>
                {extraClientEndingNote(agencyNow) && <p className="mt-3 text-[14px]" style={QUIET} role="status">{extraClientEndingNote(agencyNow)}</p>}
                {canCancelExtraClient(agencyNow) && (
                  <button type="button" disabled={!!busy} onClick={() => { setNotice(''); setError(''); setCancelOpen(true); }} className={`${LINK} mt-3 block`}>Cancel an extra client</button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[14px]" style={QUIET} role="status">Your client count could not be loaded just now. Please reload the page.</p>
          )}
        </section>
      )}

      {isManaged && (
        <section className={`${CARD} p-5 sm:p-6`} aria-labelledby="managed-plan">
          <h2 id="managed-plan" className="mb-1 text-[20px] font-semibold" style={INK}>Your plan is managed by Nebulaa</h2>
          <p className="max-w-2xl text-[14px] leading-relaxed" style={QUIET}>Your account is set up and looked after by Nebulaa, so you do not need to choose a plan or add-ons. You can add more posts and videos below at any time.</p>
        </section>
      )}

      {!isManaged && (
        <section aria-labelledby="monthly-plans">
          <Heading id="monthly-plans">{isAgencyPlan ? 'Your plan' : 'Monthly plans'}</Heading>
          <div className={isAgencyPlan ? 'grid max-w-md grid-cols-1 gap-5' : 'grid grid-cols-1 gap-5 lg:grid-cols-3'}>
            {cards.map((plan) => {
              const current = tier === plan.id;
              const isAgencyCard = plan.id === 'agency';
              const features = isAgencyCard ? agencyFeatureLines(plan, catalogue.agency) : planLines(plan.features);
              const note = isAgencyCard ? agencyCardNote(agencyState) : (onPaidPlan && !current ? 'You already have an active plan.' : '');
              const locked = isAgencyCard ? agencyState !== 'available' : (onPaidPlan && !current);
              const extraLine = isAgencyCard ? agencyExtraClientLine(catalogue.agency, catalogue.slot) : '';
              const suggested = isAgencyCard && agencyHint;
              return (
                <div
                  key={plan.id}
                  ref={isAgencyCard ? agencyCardRef : undefined}
                  tabIndex={isAgencyCard ? -1 : undefined}
                  aria-labelledby={`plan-${plan.id}`}
                  data-plan={plan.id}
                  className={`${CARD} flex min-w-0 flex-col overflow-hidden p-5 outline-none focus-visible:ring-2 focus-visible:ring-[var(--gv-text-primary)] sm:p-6 ${suggested ? '!border-2 !border-[var(--gv-accent)]' : ''}`}
                >
                  <PlanArt id={plan.id} className="-mx-5 -mt-5 mb-4 h-32 sm:-mx-6 sm:-mt-6" />
                  {suggested && <span className="mb-3 self-start rounded-full px-3 py-1 text-[12.5px] font-semibold" style={{ background: 'var(--gv-accent)', color: 'var(--gv-accent-ink)' }}>{AGENCY_BADGE}</span>}
                  <h3 id={`plan-${plan.id}`} className="text-[22px] font-semibold leading-tight" style={INK}>{plan.name}</h3>
                  {suggested && <p className="mt-1 text-[13.5px]" style={QUIET}>{AGENCY_BADGE_LINE}</p>}
                  <p className="mt-1 text-[14px] leading-relaxed" style={QUIET}>{plan.description}</p>
                  <p className="mt-5 text-[34px] font-semibold leading-none tabular-nums" style={INK}>{formatInr(plan.inr)}<span className="text-[14px] font-normal" style={QUIET}> a month plus GST</span></p>
                  <p className="mb-5 mt-2 text-[13px] leading-relaxed" style={QUIET}>{formatPaise(plan.chargePaise)} including 18 percent GST. Renews monthly and can be cancelled at any time.</p>
                  <p className="mb-2 text-[13px] font-semibold uppercase tracking-wide" style={QUIET}>What you get</p>
                  <ul className="mb-5 flex-1 space-y-2.5">
                    {features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-[14px] leading-snug" style={INK}>
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--gv-accent-text)]" aria-hidden="true" /><span className="min-w-0 break-words">{f}</span>
                      </li>
                    ))}
                  </ul>
                  {extraLine && <p className="mb-4 text-[13px] leading-relaxed" style={QUIET}>{extraLine}</p>}
                  <button type="button" className={BTN_MAIN} disabled={!!busy || !accountLoaded || current || locked} onClick={() => buyPlan(plan.id, plan.name, plan.chargePaise)}>
                    {busy === `plan:${plan.id}` ? <><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Processing</> : current ? (isAgencyCard ? 'Your plan' : 'Your current plan') : `Choose ${plan.name}`}
                  </button>
                  {note && <p className="mt-2 text-center text-[13px]" style={QUIET}>{note}</p>}
                </div>
              );
            })}
          </div>
          {isAgencyPlan && (
            <p className="mt-4 text-[14px]" style={QUIET}>Publishing, inbox and competitor insights are included in your Agency plan, so there are no add-ons to buy.</p>
          )}
        </section>
      )}

      {showAddons && (
        <section aria-labelledby="add-ons">
          <Heading id="add-ons" hint="Add-ons are available with the Starter and Growth plans and renew monthly. Prices are before GST.">Add-ons</Heading>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {catalogue.addons.map((a) => {
              const owned = ownsAddon(a.id);
              const missing = a.requires.find((r) => !ownsAddon(r));
              const blocked = !onPaidPlan || !!missing;
              const why = !onPaidPlan ? 'Choose a plan first.' : missing ? `Needs ${catalogue.addons.find((x) => x.id === missing)?.label || 'another add-on'}.` : '';
              return (
                <div key={a.id} className={`${CARD} flex min-w-0 flex-col overflow-hidden p-5`} aria-labelledby={`addon-${a.id}`}>
                  <PlanArt id={a.id} className="-mx-5 -mt-5 mb-4 h-24" />
                  <h3 id={`addon-${a.id}`} className="text-[17px] font-semibold leading-snug" style={INK}>{a.label}</h3>
                  <p className="mt-1 flex-1 text-[14px] leading-relaxed" style={QUIET}>{addonBlurb(a.id)}</p>
                  <p className="mt-4 text-[26px] font-semibold leading-none tabular-nums" style={INK}>{formatInr(a.inr)}<span className="mt-1 block text-[13px] font-normal leading-snug" style={QUIET}>a month plus GST</span></p>
                  <p className="mb-4 mt-1.5 text-[13px] leading-relaxed" style={QUIET}>{formatPaise(a.chargePaise)} including GST.{why ? ` ${why}` : ''}</p>
                  <button type="button" className={BTN} disabled={!!busy || owned || blocked} onClick={() => buyAddon(a.id, a.label, a.chargePaise)}>
                    {busy === `addon:${a.id}` ? <><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Processing</> : owned ? 'Active' : 'Add to my plan'}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section aria-labelledby="more-posts">
        <Heading
          id="more-posts"
          hint={`${isAgencyPlan ? 'Extra posts and videos go into the shared pool. ' : ''}They stay valid for 60 days from the purchase and are used after your monthly ones. Prices are before GST.`}
        >Add more posts and videos</Heading>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {catalogue.topups.map((t) => {
            const what = topupLine(t.outputs) || 'More posts and videos';
            return (
              <div key={t.inr} className={`${CARD} flex min-w-0 flex-col p-4`}>
                <p className="text-[17px] font-semibold leading-snug" style={INK}>{what}</p>
                <p className="mb-4 mt-2 flex-1 text-[13px] leading-relaxed" style={QUIET}>{formatInr(t.inr)} plus GST ({formatPaise(t.chargePaise)} including GST)</p>
                <button type="button" className={`${BTN} !px-2`} disabled={!!busy} onClick={() => buyTopup(t.inr, what)}>
                  {busy === `topup:${t.inr}` ? <><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Processing</> : `Add for ${formatInr(t.inr)}`}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <footer className="space-y-3">
        {!isManaged && (
          <div>
            <button type="button" onClick={() => setShowGst((v) => !v)} aria-expanded={showGst} aria-controls="gst-details" className={LINK}>
              {showGst ? 'Hide GST details' : 'Need a GST invoice in your business name? Add your GSTIN'}
            </button>
            {showGst && (
              <div id="gst-details" className={`${CARD} mt-3 max-w-2xl p-5`}>
                <BillingDetailsForm compact />
              </div>
            )}
          </div>
        )}
        {(onPaidPlan || isAgencyPlan) && (
          <p className="text-[14px]" style={QUIET}>
            To change or cancel your plan, open <button type="button" className={LINK} onClick={() => navigate('/settings')}>Settings</button> and choose Billing.
          </p>
        )}
        <p className="flex items-center gap-2 text-[13px]" style={QUIET}>
          <Shield className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Secured by Razorpay. UPI, cards and net banking are accepted.</span>
        </p>
        <LegalLinks className="text-[13px] text-[var(--gv-text-tertiary)]" linkClassName="underline underline-offset-2 hover:text-[var(--gv-text-primary)]" />
      </footer>

      {cancelOpen && (
        <CancelExtraClientDialog
          limit={agencyNow?.limit ?? 0}
          onClose={() => setCancelOpen(false)}
          onCancelled={() => { loadAgency(); }}
        />
      )}
      {slotOpen && (
        <ExtraClientDialog
          slot={catalogue.slot}
          agency={catalogue.agency}
          limit={agencyNow?.limit ?? 0}
          onClose={() => setSlotOpen(false)}
          onAdded={() => { loadAgency(); }}
        />
      )}
    </div>
  );
};

export default TrialExpired;
