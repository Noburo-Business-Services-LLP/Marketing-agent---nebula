import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Loader2, Download, Check } from 'lucide-react';
import { heroVideoAPI, videoGenerationAPI, HeroAspectRatio, HeroPlan, HeroJobSummary } from '../services/api';
import { useQuarkCosts } from '../hooks/useQuarkCosts';
import { GravityHero, GravityEmphasis, GravityPanel, GravityLabel, GravityButton } from '../components/gravity';

// Hero video: one premium ~15s clip built from a concept accepted in the Reels wizard.
// Concept + aspect ratio arrive via router state from ReelGenerator.

interface HeroConcept {
  title?: string;
  storySummary?: string;
  coreEmotion?: string;
  visualStyle?: string;
}
interface BrandImage { url: string; alt?: string; isLogo?: boolean }
interface QuotaInfo { used: number; limit: number; resetsOn: string }

const MAX_REFS = 4;
const POLL_MS = 5000;
// Server fails any job older than 60 min; stop client polling a little after that.
const MAX_POLL_MS = 65 * 60 * 1000;
const SLOW_COPY = 'This is taking longer than usual. Check back in a few minutes; it will appear in your history.';
const FAILED_COPY =
  "We couldn't finish this video. Your Quarks have been returned and this one doesn't count toward your monthly limit. Please try again.";
const ASPECTS: HeroAspectRatio[] = ['9:16', '16:9', '1:1'];
const ASPECT_CSS: Record<HeroAspectRatio, string> = { '9:16': '9 / 16', '16:9': '16 / 9', '1:1': '1 / 1' };

const fmtDate = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
};

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued', processing: 'Creating', completed: 'Ready', failed: 'Failed', cancelled: 'Cancelled'
};

const HeroVideo: React.FC = () => {
  const location = useLocation();
  const state = (location.state || {}) as { concept?: HeroConcept; aspectRatio?: string };
  const concept = state.concept && (state.concept.title || state.concept.storySummary) ? state.concept : null;
  const initialAspect: HeroAspectRatio = ASPECTS.includes(state.aspectRatio as HeroAspectRatio)
    ? (state.aspectRatio as HeroAspectRatio)
    : '9:16';

  const costs = useQuarkCosts();
  const price = costs.hero_video_clip; // omitted when the cost list has no entry

  const [aspectRatio, setAspectRatio] = useState<HeroAspectRatio>(initialAspect);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [brandImages, setBrandImages] = useState<BrandImage[]>([]);
  const [refs, setRefs] = useState<string[]>([]);
  const [plan, setPlan] = useState<HeroPlan | null>(null);
  const [prompt, setPrompt] = useState('');
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [genError, setGenError] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string>('');
  const [videoUrl, setVideoUrl] = useState('');
  const [jobError, setJobError] = useState('');
  const [polling, setPolling] = useState(false);
  const [history, setHistory] = useState<HeroJobSummary[]>([]);

  const timerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
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
  // so a slow response (the server may be copying the clip) never overlaps another poll.
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
          if (j.videoUrl) setVideoUrl(j.videoUrl);
          else setJobError(SLOW_COPY);
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
  }, [stopPolling, refreshQuota, refreshHistory]);

  useEffect(() => {
    mountedRef.current = true;
    refreshQuota();
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
    (async () => {
      try {
        const resp: any = await videoGenerationAPI.listBrandAssetImages();
        if (mountedRef.current && resp?.success && Array.isArray(resp.images)) setBrandImages(resp.images);
      } catch { /* references are optional */ }
    })();
    return () => {
      mountedRef.current = false;
      stopPolling();
    };
  }, [refreshQuota, refreshHistory, stopPolling, startPolling]);

  const toggleRef = (url: string) =>
    setRefs((prev) => (prev.includes(url) ? prev.filter((u) => u !== url) : prev.length >= MAX_REFS ? prev : [...prev, url]));

  const buildPrompt = async () => {
    if (!concept) return;
    setPlanning(true);
    setPlanError('');
    try {
      const r = await heroVideoAPI.plan({ concept, aspectRatio, refImageUrls: refs });
      if (!r?.success || !r.plan) throw new Error(r?.message || 'Could not build a prompt. Please try again.');
      setPlan(r.plan);
      setPrompt(r.plan.prompt);
    } catch (e: any) {
      setPlanError(e?.message || 'Could not build a prompt. Please try again.');
    } finally {
      setPlanning(false);
    }
  };

  const quotaUsedUp = !!quota && quota.used >= quota.limit;
  // Only an active submit or poll loop counts as in flight; every poll exit path clears it.
  const inFlight = submitting || polling;
  const canGenerate = !!prompt.trim() && !quotaUsedUp && !inFlight;

  const generate = async () => {
    if (!canGenerate) return;
    setSubmitting(true);
    setGenError('');
    setJobError('');
    setVideoUrl('');
    // apiCall throws a status-less Error for credit/trial 403s but first fires
    // 'trial-expired'; catch that to detect it without reading message wording.
    let outOfCredits = false;
    const onExpired = (ev: Event) => { if ((ev as CustomEvent).detail?.reason === 'credits') outOfCredits = true; };
    window.addEventListener('trial-expired', onExpired);
    try {
      const r = await heroVideoAPI.generate({ prompt: prompt.trim(), refImageUrls: refs, aspectRatio });
      if (!r?.success || !r.jobId) throw new Error(r?.message || 'Could not start your Hero video.');
      setJobId(r.jobId);
      setJobStatus('queued');
      startPolling(r.jobId);
    } catch (e: any) {
      const d = e?.data;
      if (d?.quotaExhausted) {
        setQuota((q) => ({ used: d.used ?? q?.used ?? 0, limit: d.limit ?? q?.limit ?? 0, resetsOn: q?.resetsOn || '' }));
        setGenError('You have used all your Hero videos for this month.');
      } else if (d?.creditsExhausted || outOfCredits || e?.status === 403) {
        setGenError("You're out of Quarks. Top up to make a Hero video.");
      } else {
        setGenError(e?.message || 'Could not start your Hero video. Please try again.');
      }
    } finally {
      window.removeEventListener('trial-expired', onExpired);
      setSubmitting(false);
    }
  };

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
          <a
            href={videoUrl}
            download
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-[13px] font-semibold text-[var(--gv-accent-text)] hover:underline"
          >
            <Download className="w-4 h-4" />Download video
          </a>
        </div>
      ) : jobError ? (
        <p role="alert" className="text-[13px] text-[var(--gv-text-primary)]">{jobError}</p>
      ) : (
        <div className="flex items-center gap-3 text-[13px] text-[var(--gv-text-secondary)]">
          <Loader2 className="w-4 h-4 animate-spin text-[var(--gv-accent)]" />
          {STATUS_LABEL[jobStatus] || 'Working'}… this usually takes a few minutes. You can leave this page; it will keep going.
        </div>
      )}
    </GravityPanel>
  ) : null;

  const inputCls =
    'w-full rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-surface-1)] text-[var(--gv-text-primary)] text-[13.5px] leading-relaxed p-3 focus:outline-none focus:border-[var(--gv-accent)]';

  if (!concept) {
    return (
      <div className="max-w-[760px] mx-auto pb-16 pt-6">
        <GravityHero
          eyebrow="Hero video"
          headline={<>Pick a concept in <GravityEmphasis>Reels</GravityEmphasis> first</>}
          subcopy="A Hero video is built from a concept you accept in the Reels wizard. Choose one there, then come back with “Make a Hero video instead”."
        />
        <div className="text-center">
          <Link
            to="/reels"
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-semibold bg-[var(--gv-accent)] text-[var(--gv-accent-ink)] hover:bg-[var(--gv-accent-hover)] transition-all"
          >
            Go to Reels
          </Link>
        </div>
        {jobPanel && <div className="mt-8">{jobPanel}</div>}
      </div>
    );
  }

  return (
    <div className="max-w-[960px] mx-auto pb-16 pt-2">
      <GravityHero
        size="md"
        align="left"
        eyebrow="Hero video"
        headline={<>Your <GravityEmphasis>Hero video</GravityEmphasis></>}
        subcopy="One premium 15-second clip, built from your accepted concept."
      />

      <div className="space-y-5">
        <GravityPanel contentClassName="space-y-3">
          <GravityLabel>Concept</GravityLabel>
          <div className="text-[16px] font-semibold text-[var(--gv-text-primary)]">{concept.title}</div>
          {concept.storySummary && (
            <p className="text-[13.5px] leading-relaxed text-[var(--gv-text-secondary)]">{concept.storySummary}</p>
          )}
          {(concept.coreEmotion || concept.visualStyle) && (
            <p className="text-[12px] text-[var(--gv-text-tertiary)]">
              {[concept.coreEmotion, concept.visualStyle].filter(Boolean).join(' · ')}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1" role="group" aria-label="Aspect ratio">
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
        </GravityPanel>

        {brandImages.length > 0 && (
          <GravityPanel contentClassName="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <GravityLabel>Reference images</GravityLabel>
              <span className="text-[12px] text-[var(--gv-text-tertiary)]">{refs.length} of {MAX_REFS} selected</span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {brandImages.map((img) => {
                const on = refs.includes(img.url);
                const full = !on && refs.length >= MAX_REFS;
                return (
                  <button
                    key={img.url}
                    type="button"
                    onClick={() => toggleRef(img.url)}
                    disabled={full}
                    aria-pressed={on}
                    title={img.alt || 'Reference image'}
                    className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                      on ? 'border-[var(--gv-accent)]' : 'border-[var(--gv-border-subtle)] hover:border-[var(--gv-border-strong)]'
                    }`}
                  >
                    <img src={img.url} alt={img.alt || ''} className="w-full h-full object-cover" loading="lazy" />
                    {on && (
                      <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-[var(--gv-accent)] text-[var(--gv-accent-ink)] flex items-center justify-center">
                        <Check className="w-3 h-3" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </GravityPanel>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <GravityButton onClick={buildPrompt} disabled={planning || inFlight} variant={plan ? 'ghost' : 'primary'}>
            {planning ? <><Loader2 className="w-4 h-4 animate-spin" />Building prompt…</> : plan ? 'Rebuild prompt' : 'Build prompt'}
          </GravityButton>
          {planError && <span role="alert" className="text-[12.5px] text-[var(--gv-text-primary)]">{planError}</span>}
        </div>

        {plan && (
          <GravityPanel contentClassName="space-y-5">
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

            {plan.beatSheet.length > 0 && (
              <div>
                <GravityLabel className="mb-2">Beat sheet</GravityLabel>
                <ol className="space-y-2">
                  {plan.beatSheet.map((b, i) => (
                    <li key={i} className="flex gap-3 text-[13px] leading-relaxed">
                      <span className="w-20 flex-shrink-0 text-[var(--gv-accent-text)] font-semibold tabular-nums">{b.time}</span>
                      <span className="text-[var(--gv-text-secondary)]">{b.beat}</span>
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
          </GravityPanel>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <GravityButton onClick={generate} disabled={!canGenerate}>
            {inFlight ? <><Loader2 className="w-4 h-4 animate-spin" />Generating…</> : 'Generate'}
            {!inFlight && price !== undefined && <span className="opacity-70">· {price} Quarks</span>}
          </GravityButton>
          {quota && (
            <span className="text-[12.5px] text-[var(--gv-text-tertiary)]">
              {quota.used} of {quota.limit} Hero videos used this month
              {fmtDate(quota.resetsOn) && <> · resets {fmtDate(quota.resetsOn)}</>}
            </span>
          )}
        </div>
        {quotaUsedUp && (
          <p role="alert" className="text-[12.5px] text-[var(--gv-text-primary)]">
            You have used all your Hero videos for this month.{fmtDate(quota?.resetsOn) && ` More unlock on ${fmtDate(quota?.resetsOn)}.`}
          </p>
        )}
        {!plan && !prompt.trim() && (
          <p className="text-[12px] text-[var(--gv-text-muted)]">Build a prompt first, then generate.</p>
        )}
        {genError && <p role="alert" className="text-[12.5px] text-[var(--gv-text-primary)]">{genError}</p>}

        {jobPanel}

        {history.length > 0 && (
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
        )}
      </div>
    </div>
  );
};

export default HeroVideo;
