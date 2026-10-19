import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, CalendarDays, Eye, Heart, Loader2, Minus, RefreshCw, Send, UserPlus } from 'lucide-react';
import { apiService } from '../services/api';
import { PerformanceArt } from '../components/art';
import { PlanSparkleArt } from '../components/art/plan/Sparkle';
import { type KpiKey, type KpiTile } from '../utils/performanceView';
import {
  heroSentence, isPerformanceView, kpisFromView, rangeSpan, type PerformanceView, type RangeKey,
} from '../utils/performanceInsights';
import PageHeader from '../components/PageHeader';
import { PlatformSection, RangeSwitch, Spark, TopPostsSection, WhatWorksSection } from '../components/performance/PerformanceSections';
import '../components/performance/performance.css';

// Performance (Insights, first tab): a range switch, the four KPI tiles, one tile per platform (choosing one filters the
// whole page), the top posts of the period and "What works" (formats, best day and time, findings with a hand-over to
// Create). One call: GET /api/analytics/performance (backend/services/performance/view.js). Nothing is invented: a
// figure that is not stored shows its reason. Rules in utils/performanceInsights.ts, notes in docs/superpowers/ops/performance-view.md.

const TONE: Record<KpiKey, string> = { reach: 'lilac', engagement: 'coral', followers: 'teal', posts: 'gold' };
const ICON: Record<KpiKey, typeof Eye> = { reach: Eye, engagement: Heart, followers: UserPlus, posts: Send };
const CHIP_ICON = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus } as const;
const RANGE_STORE = 'nebulaa:perf-range';

const readRange = (): RangeKey => {
  try { const v = sessionStorage.getItem(RANGE_STORE); return v === 'week' || v === '90d' ? v : 'month'; } catch { return 'month'; }
};

const KpiCard: React.FC<{ tile: KpiTile; index: number }> = ({ tile, index }) => {
  const Icon = ICON[tile.key];
  const ChipIcon = tile.chip ? CHIP_ICON[tile.chip.dir] : null;
  return (
    <li className="nb-perf-card nb-perf-in" data-tone={TONE[tile.key]} data-kpi={tile.key} style={{ ['--i' as any]: index + 1 }} aria-label={tile.label}>
      <div className="nb-perf-head">
        <span className="nb-perf-icon" aria-hidden="true"><Icon aria-hidden /></span>
        <h2>{tile.title}</h2>
        {tile.value !== null && tile.spark && tile.sparkNote && <span className="nb-perf-note">{tile.sparkNote}</span>}
      </div>
      {tile.value !== null ? (
        <p className="nb-perf-valrow">
          <span className="nb-perf-value">{tile.value}</span>
          {tile.detail && <span className="nb-perf-detail">{tile.detail}</span>}
        </p>
      ) : (
        <p className="nb-perf-reason">
          {tile.reason}
          {tile.link && <><br /><Link to={tile.link.to}>{tile.link.text}</Link></>}
        </p>
      )}
      {tile.value !== null && (
        <div className="nb-perf-foot">
          {tile.spark && <Spark points={tile.spark} />}
          {(tile.chip || !tile.spark) && (
            <div className="nb-perf-footrow">
              {tile.chip && ChipIcon && <span className="nb-perf-chip" data-dir={tile.chip.dir}><ChipIcon aria-hidden />{tile.chip.text}</span>}
              {!tile.spark && tile.sparkNote && <span className="nb-perf-note">{tile.sparkNote}</span>}
            </div>
          )}
        </div>
      )}
    </li>
  );
};

/** `embedded`: the Performance tab of Insights; the page header and tab bar sit above it. */
const GravityInsights: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const [range, setRange] = useState<RangeKey>(readRange);
  const [platform, setPlatform] = useState<string | null>(null);
  const [view, setView] = useState<PerformanceView | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const first = useRef(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (first.current) setLoading(true); else setBusy(true);
      try {
        const r = await apiService.getPerformanceView(range, platform);
        if (cancelled) return;
        if (isPerformanceView(r)) { setView(r); setFailed(false); } else setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) { setLoading(false); setBusy(false); first.current = false; }
      }
    })();
    return () => { cancelled = true; };
  }, [range, platform, retry]);

  const pickRange = (r: RangeKey) => {
    setRange(r);
    try { sessionStorage.setItem(RANGE_STORE, r); } catch { /* the choice is only kept for this visit */ }
  };
  const tiles = useMemo(() => kpisFromView(view, failed && !view), [view, failed]);

  if (loading) {
    return (
      <div className="nb-perf-loading" role="status" aria-label="Loading performance">
        <Loader2 className="nb-perf-spin" aria-hidden />
      </div>
    );
  }

  const span = rangeSpan(view);
  const chosen = view && view.platform ? view.platforms.find((p) => p.platform === view.platform) : null;
  const connected = view ? view.connected.count : null;

  return (
    <div className="nb-perf" aria-busy={busy || undefined}>
      <header className="nb-perf-hero nb-perf-in" style={{ ['--i' as any]: 0 }}>
        <div className="nb-perf-hero-id">
          {embedded
            ? <p className="nb-perf-hero-line">{heroSentence(view, failed && !view)}</p>
            : <PageHeader eyebrow="Performance" title="How your posts are" emphasis="doing" description={heroSentence(view, failed && !view)} />}
          <ul className="nb-perf-meta" aria-label="About these numbers">
            {span && <li data-tone="lilac"><CalendarDays aria-hidden />{span}</li>}
            {chosen && <li data-tone="gold">{chosen.label} only</li>}
            {connected !== null && <li>{connected === 0 ? 'No account connected' : `${connected} ${connected === 1 ? 'account' : 'accounts'} connected`}</li>}
            {failed && view && <li data-tone="coral">The last change could not load. These are the previous numbers.</li>}
          </ul>
          <div className="nb-pv-hero-actions">
            <RangeSwitch value={range} onChange={pickRange} disabled={busy} />
            {failed && <button type="button" className="nb-pv-retry" onClick={() => setRetry((n) => n + 1)}><RefreshCw aria-hidden />Try again</button>}
          </div>
        </div>
        <span className="nb-perf-hero-art" aria-hidden="true">
          <PerformanceArt />
          <PlanSparkleArt className="nb-perf-spark-deco" />
        </span>
      </header>

      <section className="nb-perf-wrap" aria-label="Your numbers">
        <ul className="nb-perf-grid nb-pv-kpis">
          {tiles.map((t, i) => <KpiCard key={t.key} tile={t} index={i} />)}
        </ul>
      </section>

      {view && (
        <>
          <PlatformSection view={view} selected={view.platform} onSelect={setPlatform} />
          <TopPostsSection key={`${view.range.key}-${view.platform || 'all'}`} view={view} />
          <WhatWorksSection view={view} />
        </>
      )}

      <p className="nb-perf-source">
        Followers, reach and engagement rate come from your connected accounts and are updated twice a day. Likes, comments and shares come from the posts Nebulaa published for you, measured a day, three days, a week, two weeks and a month after each one goes out. Changes compare with the period of the same length just before.
      </p>
    </div>
  );
};

export default GravityInsights;
