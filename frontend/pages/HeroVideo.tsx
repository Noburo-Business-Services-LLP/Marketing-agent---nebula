import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Loader2, Download, Check, X } from 'lucide-react';
import {
  apiService, heroVideoAPI, HeroAspectRatio, HeroAudioMode, HeroBrandSummary, HeroBrief, HeroJobSummary, HeroPlan, HeroReference,
} from '../services/api';
import { GravityHero, GravityEmphasis, GravityPanel, GravityLabel, GravityButton } from '../components/gravity';

// Hero Studio: one premium 15-second clip built from the Reels wizard's story, cast and place,
// plus the client's brand (loaded server-side). The wizard sends a compact brief via router
// state ({ brief }); the server validates it and stages the reference images (/brief), writes
// the prompt (/plan), and charges + generates only on /generate.

interface QuotaInfo { used: number; limit: number; resetsOn: string }

const POLL_MS = 5000;
// Server fails any job older than 60 min; stop client polling a little after that.
const MAX_POLL_MS = 65 * 60 * 1000;
const SLOW_COPY = 'This is taking longer than usual. Check back in a few minutes; it will appear in your history.';
const FAILED_COPY =
  "We couldn't finish this video. Your Quarks have been returned and this one doesn't count toward your monthly limit. Please try again.";
const FINISH_NOTE =
  "We couldn't add the finishing touches (colour grade, logo and end card) this time, so this is the original clip.";
const ASPECTS: HeroAspectRatio[] = ['9:16', '16:9', '1:1'];
const ASPECT_CSS: Record<HeroAspectRatio, string> = { '9:16': '9 / 16', '16:9': '16 / 9', '1:1': '1 / 1' };
const MAX_CTA = 60;
const SOUND_OPTIONS: { value: HeroAudioMode; label: string }[] = [
  { value: 'native', label: 'Music and effects from the video model' },
  { value: 'sfx_only', label: 'Effects only' },
];

const fmtDate = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
};

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued', processing: 'Creating', completed: 'Ready', failed: 'Failed', cancelled: 'Cancelled'
};

// What each staged reference is used for, in plain words.
const roleLabel = (r: HeroReference) => {
  switch (r.source) {
    case 'cast-portrait': return `Cast: ${r.label}`;
    case 'cast-sheet': return 'Cast sheet';
    case 'environment': return `Place: ${r.label}`;
    case 'brand-product': return `Product: ${r.label}`;
    case 'brand-logo': return 'Logo';
    case 'scene-keyframe': return `Scene frame: ${r.label}`;
    default: return r.label || r.kind;
  }
};

const isBrief = (b: any): b is HeroBrief =>
  !!b && typeof b === 'object' && Array.isArray(b.cast) && Array.isArray(b.scenes);

const retag = (refs: HeroReference[]) => refs.map((r, i) => ({ ...r, tag: `@image${i + 1}` }));

const Switch: React.FC<{ on: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }> = ({
  on, onChange, label, hint, disabled,
}) => (
  <div className="flex items-start justify-between gap-4 py-2">
    <div className="min-w-0">
      <div className="text-[13.5px] font-semibold text-[var(--gv-text-primary)]">{label}</div>
      {hint && <div className="text-[12px] text-[var(--gv-text-tertiary)] mt-0.5">{hint}</div>}
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-40 ${
        on ? 'bg-[var(--gv-accent)]' : 'bg-[var(--gv-surface-3)] border border-[var(--gv-border-default)]'
      }`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  </div>
);

const SectionTitle: React.FC<{ n: number; title: string; aside?: React.ReactNode }> = ({ n, title, aside }) => (
  <div className="flex items-baseline justify-between gap-3 mb-3">
    <GravityLabel>{n} · {title}</GravityLabel>
    {aside && <span className="text-[12px] text-[var(--gv-text-tertiary)]">{aside}</span>}
  </div>
);

// The global gravity-shell layer (index.html) still paints form fields and .gravity-label with
// dark-theme colours in light mode, which leaves them unreadable there. Scoped to this page so
// nothing else changes; dark mode is untouched.
const LIGHT_FIX = `
html:not(.dark) body.gravity-shell .hero-studio input[type="text"],
html:not(.dark) body.gravity-shell .hero-studio textarea,
html:not(.dark) body.gravity-shell .hero-studio select {
  color: var(--gv-text-primary) !important;
  background-color: var(--gv-surface-1) !important;
  border-color: var(--gv-border-default) !important;
}
html:not(.dark) .hero-studio .gravity-label:not([class*="gv-accent-text"]) { color: var(--gv-text-tertiary); }
`;

const HeroVideo: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const incoming = (location.state || {}) as { brief?: unknown };
  const incomingBrief = isBrief(incoming.brief) ? incoming.brief : null;

  // ---- brief, brand and references (from /brief) ----
  const [preparing, setPreparing] = useState(!!incomingBrief);
  const [prepError, setPrepError] = useState('');
  const [brief, setBrief] = useState<HeroBrief | null>(null);
  const [brand, setBrand] = useState<HeroBrandSummary | null>(null);
  const [refs, setRefs] = useState<HeroReference[]>([]);
  const [dropped, setDropped] = useState<Array<{ label?: string; reason?: string }>>([]);
  const [aspectRatio, setAspectRatio] = useState<HeroAspectRatio>(
    incomingBrief && ASPECTS.includes(incomingBrief.aspectRatio) ? incomingBrief.aspectRatio : '9:16'
  );
  // Scenes kept in the hero cut. `cutTouched` = the user (or a plan) chose; untouched sends no preference.
  const [keptIds, setKeptIds] = useState<string[]>([]);
  const [cutTouched, setCutTouched] = useState(false);

  // ---- plan ----
  const [plan, setPlan] = useState<HeroPlan | null>(null);
  const [planKey, setPlanKey] = useState('');
  const [prompt, setPrompt] = useState('');
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState('');

  // ---- brand + finish options ----
  const [ctaText, setCtaText] = useState('');
  const [ctaEdited, setCtaEdited] = useState(false);
  const [website, setWebsite] = useState('');
  const [endCard, setEndCard] = useState(true);
  const [captions, setCaptions] = useState(false);
  const [realism, setRealism] = useState(true);
  const [audioMode, setAudioMode] = useState<HeroAudioMode>('native');

  // ---- credits, quota, job ----
  const [balance, setBalance] = useState<number | undefined>(undefined);
  const [price, setPrice] = useState<number | undefined>(undefined);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [genError, setGenError] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string>('');
  const [videoUrl, setVideoUrl] = useState('');
  const [rawVideoUrl, setRawVideoUrl] = useState('');
  const [finishError, setFinishError] = useState('');
  const [jobError, setJobError] = useState('');
  const [polling, setPolling] = useState(false);
  const [history, setHistory] = useState<HeroJobSummary[]>([]);

  const timerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const briefRequestedRef = useRef(false);
  // Bumped on every start/stop so a request that settles after a stop never reschedules.
  const pollGenRef = useRef(0);

  const stopPolling = useCallback(() => {
    pollGenRef.current += 1;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (mountedRef.current) setPolling(false);
  }, []);

  const refreshQuota = useCallback(async () => {
    try {
      const q = await heroVideoAPI.quota();
      if (mountedRef.current && q?.success) setQuota({ used: q.used, limit: q.limit, resetsOn: q.resetsOn });
    } catch { /* quota line simply stays hidden */ }
  }, []);

  // Price and balance both come from the server's credits endpoint; nothing is hardcoded here.
  const refreshCredits = useCallback(async () => {
    const res = await apiService.getCredits();
    if (!mountedRef.current || !res?.success) return;
    if (typeof res.credits?.balance === 'number') setBalance(res.credits.balance);
    const p = res.costs?.hero_video_clip;
    if (typeof p === 'number') setPrice(p);
  }, []);

  const refreshHistory = useCallback(async (): Promise<HeroJobSummary[]> => {
    try {
      const r = await heroVideoAPI.list();
      if (mountedRef.current && r?.success) {
        const jobs = Array.isArray(r.jobs) ? r.jobs : [];
        setHistory(jobs);
        return jobs;
      }
    } catch { /* history is optional */ }
    return [];
  }, []);

  // Chained setTimeout: the next poll is scheduled only after the previous request settles,
  // so a slow response (the server may be finishing the clip) never overlaps another poll.
  const startPolling = useCallback((id: string) => {
    stopPolling();
    const gen = pollGenRef.current;
    const startedAt = Date.now();
    const live = () => mountedRef.current && pollGenRef.current === gen;
    setPolling(true);

    const giveUp = (msg: string) => {
      stopPolling();
      setJobError(msg);
      refreshQuota();
      refreshCredits();
      refreshHistory();
    };

    const tick = async () => {
      timerRef.current = null;
      if (!live()) return;
      if (Date.now() - startedAt > MAX_POLL_MS) { giveUp(SLOW_COPY); return; }
      try {
        const j = await heroVideoAPI.job(id);
        if (!live()) return;
        if (j?.status) setJobStatus(j.status);
        if (j?.status === 'completed') {
          stopPolling();
          if (j.videoUrl) {
            setVideoUrl(j.videoUrl);
            setRawVideoUrl(j.rawVideoUrl || '');
            setFinishError(j.finishError || '');
          } else setJobError(SLOW_COPY);
          refreshQuota();
          refreshHistory();
          return;
        }
        if (j?.status === 'failed' || j?.status === 'cancelled') {
          if (j.error) console.warn('[HeroVideo] job failed:', j.error);
          giveUp(j.status === 'cancelled' ? 'This video was cancelled. Please try again.' : FAILED_COPY);
          return;
        }
      } catch (e: any) {
        if (!live()) return;
        if (e?.status === 404) { giveUp(SLOW_COPY); return; }
        /* transient network error: keep polling */
      }
      if (live()) timerRef.current = window.setTimeout(tick, POLL_MS);
    };

    timerRef.current = window.setTimeout(tick, POLL_MS);
  }, [stopPolling, refreshQuota, refreshCredits, refreshHistory]);

  useEffect(() => {
    mountedRef.current = true;
    refreshQuota();
    refreshCredits();
    // Resume an in-flight job (the user left and came back): the list call also nudges
    // the server to reconcile it.
    const genAtMount = pollGenRef.current;
    refreshHistory().then((jobs) => {
      const newest = jobs[0];
      if (!mountedRef.current || !newest || (newest.status !== 'queued' && newest.status !== 'processing')) return;
      if (pollGenRef.current !== genAtMount) return; // a generate already started (or stopped) polling
      setJobId(newest.jobId);
      setJobStatus(newest.status);
      setVideoUrl('');
      setJobError('');
      startPolling(newest.jobId);
    });
    const onCredits = (e: Event) => {
      const left = (e as CustomEvent).detail?.creditsRemaining;
      if (typeof left === 'number' && left >= 0) setBalance(left);
    };
    window.addEventListener('credits-updated', onCredits);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('credits-updated', onCredits);
      stopPolling();
    };
  }, [refreshQuota, refreshCredits, refreshHistory, stopPolling, startPolling]);

  // Validate the brief, load the brand and stage the references (no charge). Once per visit:
  // staging may upload environment photos, so a re-render must not repeat it.
  useEffect(() => {
    if (!incomingBrief || briefRequestedRef.current) return;
    briefRequestedRef.current = true;
    (async () => {
      try {
        const r = await heroVideoAPI.brief(incomingBrief);
        if (!mountedRef.current) return;
        if (!r?.success || !r.brief) throw new Error(r?.message || 'We could not read this story. Go back to Reels and try again.');
        setBrief(r.brief);
        setBrand(r.brand || null);
        setRefs(retag(r.references || []));
        setDropped(Array.isArray(r.dropped) ? r.dropped : []);
        setKeptIds(r.brief.scenes.map((s) => s.sceneId));
        setWebsite(r.brand?.website || '');
      } catch (e: any) {
        if (mountedRef.current) setPrepError(e?.message || 'We could not read this story. Go back to Reels and try again.');
      } finally {
        if (mountedRef.current) setPreparing(false);
      }
    })();
  }, [incomingBrief]);

  // The CTA input shows the planner's CTA, else the brand name, until the user types their own.
  const ctaValue = ctaEdited ? ctaText : (plan?.story.cta || brand?.name || '').slice(0, MAX_CTA);

  // What the current prompt was written from; any change makes it out of date.
  const inputsKey = useMemo(
    () => JSON.stringify({ refs: refs.map((r) => r.url), kept: cutTouched ? keptIds : null, audioMode, aspectRatio }),
    [refs, keptIds, cutTouched, audioMode, aspectRatio]
  );
  const planStale = !!plan && planKey !== inputsKey;

  const toggleScene = (id: string) => {
    setCutTouched(true);
    setKeptIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const removeRef = (url: string) => setRefs((prev) => retag(prev.filter((r) => r.url !== url)));

  const buildPrompt = async () => {
    if (!brief) return;
    if (cutTouched && keptIds.length === 0) {
      setPlanError('Keep at least one scene in the hero cut.');
      return;
    }
    setPlanning(true);
    setPlanError('');
    try {
      const keptInOrder = brief.scenes.map((s) => s.sceneId).filter((id) => keptIds.includes(id));
      const r = await heroVideoAPI.plan({
        brief: { ...brief, aspectRatio },
        audioMode,
        ctaText: ctaEdited ? ctaText.trim() : undefined,
        references: refs.map((x) => x.url),
        keptSceneIds: cutTouched ? keptInOrder : undefined,
      });
      if (!mountedRef.current) return;
      if (!r?.success || !r.plan) throw new Error(r?.message || 'Could not build a prompt. Please try again.');
      const nextRefs = retag(r.references || refs);
      // The planner's hero cut becomes the scene selection, so the prompt and the toggles agree.
      const cutKept = r.plan.heroCut.filter((h) => h.keep).map((h) => h.sceneId);
      const nextKept = cutKept.length ? cutKept : keptIds;
      const nextTouched = cutKept.length ? true : cutTouched;
      setPlan(r.plan);
      setPrompt(r.plan.prompt);
      setRefs(nextRefs);
      setKeptIds(nextKept);
      setCutTouched(nextTouched);
      setPlanKey(JSON.stringify({ refs: nextRefs.map((x) => x.url), kept: nextTouched ? nextKept : null, audioMode, aspectRatio }));
    } catch (e: any) {
      if (mountedRef.current) setPlanError(e?.message || 'Could not build a prompt. Please try again.');
    } finally {
      if (mountedRef.current) setPlanning(false);
    }
  };

  const quotaUsedUp = !!quota && quota.used >= quota.limit;
  // Affordability preflight: with a known price and balance, an unaffordable clip never calls /generate.
  const cannotAfford = price !== undefined && balance !== undefined && balance < price;
  // Only an active submit or poll loop counts as in flight; every poll exit path clears it.
  const inFlight = submitting || polling;
  const canGenerate = !!plan && !!prompt.trim() && !planStale && !quotaUsedUp && !inFlight && !cannotAfford;

  const generate = async () => {
    if (!canGenerate || !plan) return;
    setSubmitting(true);
    setGenError('');
    setJobError('');
    setVideoUrl('');
    setRawVideoUrl('');
    setFinishError('');
    // apiCall throws a status-less Error for credit 403s but first fires
    // 'trial-expired'; catch that to detect it without reading message wording.
    let outOfCredits = false;
    const onExpired = (ev: Event) => { if ((ev as CustomEvent).detail?.reason === 'credits') outOfCredits = true; };
    window.addEventListener('trial-expired', onExpired);
    try {
      const r = await heroVideoAPI.generate({
        prompt: prompt.trim(),
        aspectRatio,
        refImageUrls: refs.map((x) => x.url),
        references: refs,
        finish: {
          realism,
          captions,
          endCard: { enabled: endCard, ctaText: ctaValue.trim(), website: website.trim() },
        },
        beatSheet: plan.beatSheet,
        dialogue: plan.dialogue || undefined,
      });
      if (!r?.success || !r.jobId) throw new Error(r?.message || 'Could not start your Hero video.');
      setJobId(r.jobId);
      setJobStatus('queued');
      startPolling(r.jobId);
    } catch (e: any) {
      const d = e?.data;
      if (d?.quotaExhausted) {
        setQuota((q) => ({ used: d.used ?? q?.used ?? 0, limit: d.limit ?? q?.limit ?? 0, resetsOn: d.resetsOn || q?.resetsOn || '' }));
        setGenError('You have used all your Hero videos for this month.');
      } else if (d?.creditsExhausted || outOfCredits || e?.status === 403) {
        setGenError("You don't have enough Quarks for a Hero video. Top up to make one.");
      } else {
        setGenError(e?.message || 'Could not start your Hero video. Please try again.');
      }
    } finally {
      window.removeEventListener('trial-expired', onExpired);
      refreshCredits();
      if (mountedRef.current) setSubmitting(false);
    }
  };

  const inputCls =
    'w-full rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-surface-1)] text-[var(--gv-text-primary)] text-[13.5px] leading-relaxed p-3 focus:outline-none focus:border-[var(--gv-accent)]';
  const linkCls = 'inline-flex items-center gap-2 text-[13px] font-semibold text-[var(--gv-accent-text)] hover:underline';
  const goldLinkBtn =
    'inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-semibold bg-[var(--gv-accent)] text-[var(--gv-accent-ink)] hover:bg-[var(--gv-accent-hover)] transition-all';

  const jobPanel = jobId ? (
    <GravityPanel contentClassName="space-y-3">
      <GravityLabel>Your Hero video</GravityLabel>
      {videoUrl ? (
        <div className="space-y-3">
          <video
            src={videoUrl}
            controls
            playsInline
            className="w-full max-h-[70vh] rounded-xl bg-black"
            style={{ aspectRatio: ASPECT_CSS[aspectRatio] }}
          />
          {finishError && <p className="text-[12.5px] text-[var(--gv-text-secondary)]">{FINISH_NOTE}</p>}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <a href={videoUrl} download target="_blank" rel="noreferrer" className={linkCls}>
              <Download className="w-4 h-4" />Download video
            </a>
            {rawVideoUrl && rawVideoUrl !== videoUrl && (
              <a href={rawVideoUrl} download target="_blank" rel="noreferrer" className={linkCls}>
                <Download className="w-4 h-4" />Download raw clip
              </a>
            )}
          </div>
        </div>
      ) : jobError ? (
        <p role="alert" className="text-[13px] text-[var(--gv-text-primary)]">{jobError}</p>
      ) : (
        <div className="flex items-center gap-3 text-[13px] text-[var(--gv-text-secondary)]">
          <Loader2 className="w-4 h-4 animate-spin text-[var(--gv-accent)] flex-shrink-0" />
          <span>{STATUS_LABEL[jobStatus] || 'Working'}… this usually takes a few minutes. You can leave this page; it will keep going.</span>
        </div>
      )}
    </GravityPanel>
  ) : null;

  const historyList = history.length > 0 ? (
    <div>
      <GravityLabel className="mb-3">Recent Hero videos</GravityLabel>
      <ul className="space-y-2">
        {history.slice(0, 8).map((h) => (
          <li
            key={h.jobId}
            className="flex items-center gap-3 rounded-lg border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] px-3 py-2"
          >
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--gv-text-tertiary)] w-20 flex-shrink-0">
              {STATUS_LABEL[h.status] || h.status}
            </span>
            <span className="flex-1 min-w-0 truncate text-[12.5px] text-[var(--gv-text-secondary)]">
              {h.prompt || fmtDate(h.createdAt)}
            </span>
            <span className="text-[11.5px] text-[var(--gv-text-muted)] hidden sm:inline">{fmtDate(h.createdAt)}</span>
            {h.videoUrl && (
              <a href={h.videoUrl} target="_blank" rel="noreferrer" className="text-[12.5px] font-semibold text-[var(--gv-accent-text)] hover:underline">
                Open
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  // ---- no brief: explain where a Hero video comes from ----
  if (!incomingBrief || prepError) {
    return (
      <div className="hero-studio max-w-[760px] mx-auto pb-16 pt-6 space-y-8">
        <style>{LIGHT_FIX}</style>
        <GravityHero
          eyebrow="Hero Studio"
          headline={prepError ? <>Let's go back to <GravityEmphasis>Reels</GravityEmphasis></> : <>Start from your <GravityEmphasis>Reels</GravityEmphasis> story</>}
          subcopy={
            prepError ||
            'A Hero video is one premium 15-second clip made from the story you build in Reels: your concept, your cast and your place. Finish the cast and the script there, then press “Make this a Hero video”.'
          }
          className="!mb-0"
        />
        <div className="text-center">
          <Link to="/reels" className={goldLinkBtn}>Go to Reels</Link>
        </div>
        {jobPanel}
        {historyList}
      </div>
    );
  }

  if (preparing || !brief) {
    return (
      <div className="max-w-[760px] mx-auto pb-16 pt-16 flex flex-col items-center gap-3 text-[13px] text-[var(--gv-text-secondary)]">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--gv-accent)]" />
        Preparing your story, cast and brand…
      </div>
    );
  }

  const cutById = new Map((plan?.heroCut || []).map((h) => [h.sceneId, h]));
  const castNames = new Map(brief.cast.map((c) => [c.id, c.name || 'Unnamed']));
  const products = refs.filter((r) => r.source === 'brand-product');
  const swatch = (brand?.colors || []).filter((c) => /^#?[0-9a-f]{3,8}$/i.test(c.trim()));
  const brandEmpty = !brand || (!brand.name && !brand.logoUrl && !brand.heroProduct && !brand.colors.length);

  return (
    <div className="hero-studio max-w-[960px] mx-auto pb-16 pt-2">
      <style>{LIGHT_FIX}</style>
      <GravityHero
        size="md"
        align="left"
        eyebrow="Hero Studio"
        headline={<>Your <GravityEmphasis>Hero video</GravityEmphasis></>}
        subcopy="One premium 15-second clip, cut from your story with your cast, your place and your brand. Check each part, build the prompt, then generate."
      />

      <div className="space-y-5">
        {/* 1 · Story */}
        <GravityPanel>
          <SectionTitle n={1} title="Story" aside={`${keptIds.length} of ${brief.scenes.length} scenes in the cut`} />
          <div className="text-[16px] font-semibold text-[var(--gv-text-primary)]">{brief.concept.title || 'Untitled story'}</div>
          {brief.concept.storySummary && (
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--gv-text-secondary)]">{brief.concept.storySummary}</p>
          )}
          {(brief.concept.coreEmotion || brief.concept.visualStyle) && (
            <p className="mt-1 text-[12px] text-[var(--gv-text-tertiary)]">
              {[brief.concept.coreEmotion, brief.concept.visualStyle].filter(Boolean).join(' · ')}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-3" role="group" aria-label="Aspect ratio">
            {ASPECTS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAspectRatio(a)}
                aria-pressed={aspectRatio === a}
                className={`px-3 py-1.5 rounded-md text-[12px] font-semibold border transition-colors ${
                  aspectRatio === a
                    ? 'border-[var(--gv-accent)] bg-[var(--gv-accent-fill)] text-[var(--gv-accent-text)]'
                    : 'border-[var(--gv-border-default)] text-[var(--gv-text-secondary)] hover:bg-[var(--gv-surface-2)]'
                }`}
              >
                {a}
              </button>
            ))}
          </div>

          <div className="mt-4">
            <div className="text-[12px] text-[var(--gv-text-tertiary)] mb-2">
              Hero cut: the scenes that carry the story into 15 seconds. Untick a scene to leave it out, then rebuild the prompt.
            </div>
            <ul className="space-y-2">
              {brief.scenes.map((s, i) => {
                const on = keptIds.includes(s.sceneId);
                const cut = cutById.get(s.sceneId);
                const who = (s.charactersRequired || []).map((id) => castNames.get(id)).filter(Boolean).join(', ');
                return (
                  <li key={s.sceneId}>
                    <label
                      className={`flex gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                        on ? 'border-[rgb(var(--gv-accent-rgb)/0.35)] bg-[var(--gv-surface-1)]' : 'border-[var(--gv-border-subtle)] opacity-70'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleScene(s.sceneId)}
                        className="mt-1 h-4 w-4 flex-shrink-0 accent-[var(--gv-accent)]"
                      />
                      {s.imageUrl && (
                        <img src={s.imageUrl} alt="" className="w-12 h-12 rounded-md object-cover flex-shrink-0 hidden sm:block" loading="lazy" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-[13px] font-semibold text-[var(--gv-text-primary)]">
                            {i + 1}. {s.title || `Scene ${i + 1}`}
                          </span>
                          {!!s.durationSeconds && <span className="text-[11.5px] text-[var(--gv-text-muted)]">{s.durationSeconds}s</span>}
                          {cut?.time && on && <span className="text-[11.5px] font-semibold text-[var(--gv-accent-text)] tabular-nums">{cut.time}</span>}
                        </span>
                        {s.script && <span className="block text-[12.5px] text-[var(--gv-text-secondary)] mt-0.5">{s.script}</span>}
                        {who && <span className="block text-[11.5px] text-[var(--gv-text-tertiary)] mt-0.5">With {who}</span>}
                        {cut?.reason && <span className="block text-[11.5px] italic text-[var(--gv-text-tertiary)] mt-0.5">{cut.reason}</span>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        </GravityPanel>

        {/* 2 · Cast */}
        <GravityPanel>
          <SectionTitle n={2} title="Cast" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {brief.cast.map((c) => (
              <div key={c.id} className="rounded-lg border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] overflow-hidden">
                {c.portraitUrl ? (
                  <img src={c.portraitUrl} alt={c.name || 'Cast member'} className="w-full aspect-square object-cover" loading="lazy" />
                ) : (
                  <div className="w-full aspect-square flex items-center justify-center text-[12px] text-[var(--gv-text-muted)] bg-[var(--gv-surface-2)]">
                    No portrait
                  </div>
                )}
                <div className="px-2.5 py-2">
                  <div className="text-[13px] font-semibold text-[var(--gv-text-primary)] truncate">{c.name || 'Unnamed'}</div>
                  {c.role && <div className="text-[11.5px] text-[var(--gv-text-tertiary)] line-clamp-2">{c.role}</div>}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[12px] text-[var(--gv-text-tertiary)]">
            These people are AI-generated characters from your cast, not real customers, and the video should never present them as
            customers or reviewers. If you added a photo of a real person, make sure you have their permission.
          </p>
        </GravityPanel>

        {/* 3 · Place */}
        <GravityPanel>
          <SectionTitle n={3} title="Place" />
          {brief.environment.enabled ? (
            <>
              {brief.environment.images.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-3">
                  {brief.environment.images.map((im, i) => (
                    <img
                      key={(im.url || '') + i}
                      src={im.url}
                      alt={im.alt || 'Location photo'}
                      className="w-full aspect-square rounded-lg object-cover border border-[var(--gv-border-subtle)]"
                      loading="lazy"
                    />
                  ))}
                </div>
              )}
              {brief.environment.notes ? (
                <p className="text-[13px] leading-relaxed text-[var(--gv-text-secondary)] whitespace-pre-wrap">{brief.environment.notes}</p>
              ) : (
                brief.environment.images.length === 0 && (
                  <p className="text-[13px] text-[var(--gv-text-tertiary)]">No photos or notes were added for the place.</p>
                )
              )}
            </>
          ) : (
            <p className="text-[13px] text-[var(--gv-text-tertiary)]">
              No place was chosen in Reels, so the video will use one believable real place that fits the story.
            </p>
          )}
        </GravityPanel>

        {/* 4 · Brand */}
        <GravityPanel>
          <SectionTitle n={4} title="Brand" />
          {brandEmpty ? (
            <p className="text-[13px] text-[var(--gv-text-tertiary)] mb-4">
              No brand details on file yet. Add your logo and colours in{' '}
              <Link to="/brand-assets" className="font-semibold text-[var(--gv-accent-text)] hover:underline">Brand Assets</Link>.
            </p>
          ) : (
            <div className="flex flex-wrap items-start gap-5 mb-4">
              {brand?.logoUrl && (
                <div>
                  <div className="text-[11.5px] text-[var(--gv-text-tertiary)] mb-1.5">Logo</div>
                  <img
                    src={brand.logoUrl}
                    alt={`${brand.name || 'Brand'} logo`}
                    className="h-14 max-w-[140px] object-contain rounded-md border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] p-1.5"
                  />
                </div>
              )}
              {(brand?.heroProduct || products.length > 0) && (
                <div className="min-w-0">
                  <div className="text-[11.5px] text-[var(--gv-text-tertiary)] mb-1.5">Product</div>
                  <div className="flex items-center gap-2">
                    {products.slice(0, 2).map((p) => (
                      <img key={p.url} src={p.url} alt={p.label} className="h-14 w-14 rounded-md object-cover border border-[var(--gv-border-subtle)]" />
                    ))}
                    {brand?.heroProduct && <span className="text-[13px] text-[var(--gv-text-primary)]">{brand.heroProduct}</span>}
                  </div>
                </div>
              )}
              {swatch.length > 0 && (
                <div>
                  <div className="text-[11.5px] text-[var(--gv-text-tertiary)] mb-1.5">Colour</div>
                  <div className="flex items-center gap-1.5">
                    {swatch.slice(0, 4).map((c) => (
                      <span
                        key={c}
                        title={c}
                        className="w-7 h-7 rounded-md border border-[var(--gv-border-default)]"
                        style={{ background: c.startsWith('#') ? c : `#${c}` }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[12px] text-[var(--gv-text-tertiary)] mb-1.5">Call to action (end card)</span>
              <input
                type="text"
                value={ctaValue}
                maxLength={MAX_CTA}
                onChange={(e) => { setCtaEdited(true); setCtaText(e.target.value); }}
                placeholder="e.g. Book a free consultation"
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="block text-[12px] text-[var(--gv-text-tertiary)] mb-1.5">Website (end card)</span>
              <input
                type="text"
                value={website}
                maxLength={200}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="yourbrand.com"
                className={inputCls}
              />
            </label>
          </div>
        </GravityPanel>

        {/* 5 · References */}
        <GravityPanel>
          <SectionTitle n={5} title="References" aside={`${refs.length} of 9`} />
          <p className="text-[12px] text-[var(--gv-text-tertiary)] mb-3">
            The images the video is built from. Remove any that should not be used, then rebuild the prompt.
          </p>
          {refs.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {refs.map((r) => (
                <div key={r.url} className="relative rounded-lg border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] overflow-hidden">
                  <img src={r.url} alt={roleLabel(r)} className="w-full aspect-square object-cover" loading="lazy" />
                  <button
                    type="button"
                    onClick={() => removeRef(r.url)}
                    disabled={inFlight || planning}
                    aria-label={`Remove ${roleLabel(r)}`}
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 disabled:opacity-40"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                  <div className="px-2 py-1.5">
                    <div className="text-[11px] font-semibold text-[var(--gv-accent-text)] tabular-nums">{r.tag}</div>
                    <div className="text-[11.5px] text-[var(--gv-text-secondary)] truncate" title={roleLabel(r)}>{roleLabel(r)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-[var(--gv-text-tertiary)]">No reference images. The prompt will describe the people, place and product in words.</p>
          )}
          {dropped.length > 0 && (
            <ul className="mt-3 space-y-1 text-[12px] text-[var(--gv-text-tertiary)]">
              {dropped.map((d, i) => (
                <li key={i}>Not used: {d.label || 'an image'}. {d.reason}</li>
              ))}
            </ul>
          )}
        </GravityPanel>

        {/* 6 · Prompt */}
        <GravityPanel contentClassName="space-y-4">
          <SectionTitle n={6} title="Prompt" />
          <div className="flex flex-wrap items-center gap-3">
            <GravityButton onClick={buildPrompt} disabled={planning || inFlight} variant={plan && !planStale ? 'ghost' : 'primary'}>
              {planning ? <><Loader2 className="w-4 h-4 animate-spin" />Building prompt…</> : plan ? 'Rebuild prompt' : 'Build prompt'}
            </GravityButton>
            {planError && <span role="alert" className="text-[12.5px] text-[var(--gv-text-primary)]">{planError}</span>}
          </div>
          {planStale && (
            <p role="status" className="text-[12.5px] text-[var(--gv-text-primary)]">
              You changed the scenes, references, sound or frame since this prompt was written. Rebuild it so they match.
            </p>
          )}
          {plan && (
            <>
              <div>
                <GravityLabel className="mb-2">Prompt (edit freely)</GravityLabel>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={10}
                  className={inputCls}
                  aria-label="Hero video prompt"
                />
              </div>

              {(plan.story.hook || plan.story.payoff) && (
                <div>
                  <GravityLabel className="mb-2">Story</GravityLabel>
                  <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 text-[13px] leading-relaxed">
                    {([['Hook', plan.story.hook], ['Tension', plan.story.tension], ['Turn', plan.story.turn], ['Payoff', plan.story.payoff], ['Call to action', plan.story.cta]] as const)
                      .filter(([, v]) => v)
                      .map(([k, v]) => (
                        <React.Fragment key={k}>
                          <dt className="text-[var(--gv-text-tertiary)]">{k}</dt>
                          <dd className="text-[var(--gv-text-secondary)]">{v}</dd>
                        </React.Fragment>
                      ))}
                  </dl>
                </div>
              )}

              {plan.shotList.length > 0 && (
                <div>
                  <GravityLabel className="mb-2">Shot list</GravityLabel>
                  <ol className="space-y-2">
                    {plan.shotList.map((s, i) => (
                      <li key={i} className="flex gap-3 text-[13px] leading-relaxed">
                        <span className="w-16 flex-shrink-0 text-[var(--gv-accent-text)] font-semibold tabular-nums">{s.time}</span>
                        <span className="text-[var(--gv-text-secondary)] min-w-0">
                          {s.shot}
                          {s.purpose && <span className="text-[var(--gv-text-tertiary)]"> · {s.purpose}</span>}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {plan.dialogue && (
                <div>
                  <GravityLabel className="mb-2">Dialogue</GravityLabel>
                  <p className="text-[13px] leading-relaxed text-[var(--gv-text-secondary)] whitespace-pre-wrap">{plan.dialogue}</p>
                </div>
              )}

              {plan.qaChecklist.length > 0 && (
                <div>
                  <GravityLabel className="mb-2">Check before you generate</GravityLabel>
                  <ul className="space-y-1.5">
                    {plan.qaChecklist.map((q, i) => (
                      <li key={i} className="flex gap-2 text-[13px] text-[var(--gv-text-secondary)]">
                        <Check className="w-4 h-4 mt-0.5 flex-shrink-0 text-[var(--gv-accent-text)]" />
                        <span>{q}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {plan.assumptions.length > 0 && (
                <div>
                  <GravityLabel className="mb-2">Assumptions we made</GravityLabel>
                  <ul className="list-disc pl-5 space-y-1 text-[13px] text-[var(--gv-text-tertiary)]">
                    {plan.assumptions.map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                </div>
              )}
            </>
          )}
        </GravityPanel>

        {/* 7 · Finish */}
        <GravityPanel>
          <SectionTitle n={7} title="Finish" />
          <div className="divide-y divide-[var(--gv-border-subtle)]">
            <Switch on={endCard} onChange={setEndCard} label="End card" hint="A closing card with your logo, call to action and website." />
            <Switch on={captions} onChange={setCaptions} label="Captions" hint="Burn the spoken lines into the video." />
            <Switch on={realism} onChange={setRealism} label="Realism grade" hint="A natural film look: softer contrast and fine grain." />
            <label className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold text-[var(--gv-text-primary)]">Sound</span>
                <span className="block text-[12px] text-[var(--gv-text-tertiary)] mt-0.5">Used when the prompt is built.</span>
              </span>
              <select
                value={audioMode}
                onChange={(e) => setAudioMode(e.target.value as HeroAudioMode)}
                className={`${inputCls} sm:max-w-[320px]`}
              >
                {SOUND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>
        </GravityPanel>

        {/* 8 · Generate */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {cannotAfford ? (
              <GravityButton onClick={() => navigate('/trial-expired')}>Top up Quarks</GravityButton>
            ) : (
              <GravityButton onClick={generate} disabled={!canGenerate}>
                {inFlight ? <><Loader2 className="w-4 h-4 animate-spin" />Generating…</> : 'Generate'}
                {!inFlight && price !== undefined && <span className="opacity-70">· {price} Quarks</span>}
              </GravityButton>
            )}
            {(price !== undefined || balance !== undefined) && (
              <span className="text-[12.5px] text-[var(--gv-text-tertiary)]">
                {price !== undefined && <>Price {price} Quarks</>}
                {price !== undefined && balance !== undefined && ' · '}
                {balance !== undefined && <>Your balance {balance} Quarks</>}
              </span>
            )}
          </div>
          {quota && (
            <p className="text-[12.5px] text-[var(--gv-text-tertiary)]">
              {quota.used} of {quota.limit} Hero videos used this month
              {fmtDate(quota.resetsOn) && <> · resets {fmtDate(quota.resetsOn)}</>}
            </p>
          )}
          {cannotAfford && (
            <p role="status" className="text-[12.5px] text-[var(--gv-text-primary)]">
              A Hero video costs {price} Quarks and you have {balance}. Top up to make one; nothing is charged until you generate.
            </p>
          )}
          {quotaUsedUp && (
            <p role="alert" className="text-[12.5px] text-[var(--gv-text-primary)]">
              You have used all your Hero videos for this month.{fmtDate(quota?.resetsOn) && ` More unlock on ${fmtDate(quota?.resetsOn)}.`}
            </p>
          )}
          {!plan && !cannotAfford && (
            <p className="text-[12px] text-[var(--gv-text-muted)]">Build the prompt first, then generate.</p>
          )}
          {genError && <p role="alert" className="text-[12.5px] text-[var(--gv-text-primary)]">{genError}</p>}
        </div>

        {jobPanel}
        {historyList}
      </div>
    </div>
  );
};

export default HeroVideo;
