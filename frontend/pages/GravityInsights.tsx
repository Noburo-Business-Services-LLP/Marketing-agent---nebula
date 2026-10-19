import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowRight, ArrowUpRight, CalendarDays, Eye, Heart, Loader2, Minus, Send, UserPlus } from 'lucide-react';
import { apiService } from '../services/api';
import type { HomeSummary } from '../types';
import { PerformanceArt, SinglePostArt } from '../components/art';
import { PlanSparkleArt } from '../components/art/plan/Sparkle';
import {
  bestPostOfMonth, buildKpis, chartPaths, dayMonth, heroLine, reachDays, sparkPath,
  type BestPost, type KpiKey, type KpiTile,
} from '../utils/performanceView';
import { formatShort } from '../utils/formatCount';
import PageHeader from '../components/PageHeader';
import '../components/performance/performance.css';

// Performance: the four figures the owner asked for (reach, engagement, new followers, posts published), each with a
// line drawn from stored points only, a change chip in words, the best post of the month and reach over 30 days.
// Data: GET /api/home/summary (numbers with reasons), GET /api/analytics/history (stored daily snapshots) and
// GET /api/campaigns (published posts). Nothing is invented: a figure that is not stored shows its reason.
// Rules in utils/performanceView.ts, map in docs/superpowers/impact-maps/performance-brand.md.

const TONE: Record<KpiKey, string> = { reach: 'lilac', engagement: 'coral', followers: 'teal', posts: 'gold' };
const ICON: Record<KpiKey, typeof Eye> = { reach: Eye, engagement: Heart, followers: UserPlus, posts: Send };
const CHIP_ICON = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus } as const;

const Sparkline: React.FC<{ points: number[] }> = ({ points }) => {
  const d = sparkPath(points, 120, 36);
  if (!d) return null;
  const last = d.split(' L').pop() || '';
  const [x, y] = last.replace(/^M/, '').split(' ').map(Number);
  return (
    <svg className="nb-perf-line" viewBox="0 0 120 36" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d={d} />
      {Number.isFinite(x) && Number.isFinite(y) && <circle cx={x} cy={y} r="2.6" />}
    </svg>
  );
};

const KpiCard: React.FC<{ tile: KpiTile; index: number }> = ({ tile, index }) => {
  const Icon = ICON[tile.key];
  const ChipIcon = tile.chip ? CHIP_ICON[tile.chip.dir] : null;
  return (
    <li className="nb-perf-card nb-perf-in" data-tone={TONE[tile.key]} data-kpi={tile.key} style={{ ['--i' as any]: index + 1 }} aria-label={tile.label}>
      <div className="nb-perf-head">
        <span className="nb-perf-icon" aria-hidden="true"><Icon aria-hidden /></span>
        <h2>{tile.title}</h2>
        {tile.value !== null && tile.spark && <span className="nb-perf-note" title={tile.key === 'posts' ? 'Weeks the line covers' : 'Days with stored numbers the line covers'}>{tile.sparkNote}</span>}
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
          {tile.spark && <Sparkline points={tile.spark} />}
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

const BestPostCard: React.FC<{ best: BestPost; index: number }> = ({ best, index }) => {
  const when = best.when ? dayMonth(best.when) : null;
  return (
    <li className="nb-perf-card nb-perf-best nb-perf-in" data-tone="gold" data-wide="true" data-card="best" style={{ ['--i' as any]: index }}>
      <span className="nb-perf-best-pic" aria-hidden={best.image ? undefined : true}>
        {best.image
          ? <img src={best.image} alt={best.name ? `Picture of ${best.name}` : 'Picture of the post'} width={132} height={132} loading="lazy" decoding="async" />
          : <SinglePostArt />}
      </span>
      <div className="nb-perf-best-body">
        <p className="nb-perf-eyebrow">{best.title}</p>
        {best.kind === 'none' ? (
          <>
            <p className="nb-perf-reason">{best.note}</p>
            <div className="nb-perf-foot">
              <Link to="/campaigns" className="nb-perf-cta">Create a post <ArrowRight aria-hidden /></Link>
            </div>
          </>
        ) : (
          <>
            <h2 className="nb-perf-best-name">{best.name}</h2>
            {best.stats && best.stats.length > 0 && (
              <ul className="nb-perf-stats" aria-label="Numbers for this post">{best.stats.map((s) => <li key={s}>{s}</li>)}</ul>
            )}
            {(when || best.platform) && (
              <p className="nb-perf-when">Published{when ? ` ${when}` : ''}{best.platform ? ` on ${best.platform.charAt(0).toUpperCase()}${best.platform.slice(1)}` : ''}</p>
            )}
            <p className="nb-perf-note nb-perf-foot">{best.note}</p>
          </>
        )}
      </div>
    </li>
  );
};

const ReachChart: React.FC<{ days: Array<{ date: string; value: number }>; reason: string | null; index: number }> = ({ days, reason, index }) => {
  const { line, area } = chartPaths(days, 300, 110);
  const max = days.length ? Math.max(...days.map((d) => d.value)) : 0;
  return (
    <li className="nb-perf-card nb-perf-in" data-tone="lilac" data-wide="true" data-card="chart" style={{ ['--i' as any]: index }}>
      <div className="nb-perf-head">
        <span className="nb-perf-icon" aria-hidden="true"><CalendarDays aria-hidden /></span>
        <h2>Reach, last 30 days</h2>
      </div>
      {line ? (
        <div className="nb-perf-chart">
          <svg viewBox="0 0 300 110" preserveAspectRatio="none" role="img" aria-label={`Reach on ${days.length} days with numbers, highest ${formatShort(max)}`}>
            <defs>
              <linearGradient id="nb-perf-area" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#7B5CC4" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#7B5CC4" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path className="nb-perf-area" d={area} />
            <path className="nb-perf-stroke" d={line} />
          </svg>
          <div className="nb-perf-axis">
            <span>{dayMonth(days[0].date)}</span>
            <span>Highest {formatShort(max)}</span>
            <span>{dayMonth(days[days.length - 1].date)}</span>
          </div>
        </div>
      ) : (
        <div className="nb-perf-empty">
          <span className="nb-perf-empty-art" aria-hidden="true"><PerformanceArt /></span>
          <p className="nb-perf-reason">{reason || 'The chart appears after two days of numbers.'}</p>
        </div>
      )}
    </li>
  );
};

const GravityInsights: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [history, setHistory] = useState<unknown[]>([]);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [campaigns, setCampaigns] = useState<unknown[]>([]);
  const [campaignsFailed, setCampaignsFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Each source fails on its own: the others still show.
      const [s, h, c] = await Promise.allSettled([
        apiService.getHomeSummary(),
        apiService.getAnalyticsHistory(35),
        apiService.getCampaigns(),
      ]);
      if (cancelled) return;
      if (s.status === 'fulfilled' && s.value && (s.value as any).numbers) setSummary(s.value as HomeSummary); else setSummaryFailed(true);
      if (h.status === 'fulfilled' && Array.isArray(h.value?.history)) setHistory(h.value.history); else setHistoryFailed(true);
      // getCampaigns() answers an empty list when the call fails, so an empty list while the summary counts published
      // posts is treated as a failure rather than "nothing published".
      const sv: any = s.status === 'fulfilled' ? s.value : null;
      const pub = sv?.numbers?.postsPublishedThisWeek;
      const summaryHasPosts = Boolean(pub && pub.available && ((pub.value || 0) > 0 || (pub.previous || 0) > 0));
      if (c.status === 'fulfilled' && Array.isArray(c.value?.campaigns) && !(c.value.campaigns.length === 0 && summaryHasPosts)) setCampaigns(c.value.campaigns);
      else setCampaignsFailed(true);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const now = useMemo(() => new Date(), [loading]);
  const tiles = useMemo(() => buildKpis({ summary, summaryFailed, history, historyFailed, campaigns, campaignsFailed, now }), [summary, summaryFailed, history, historyFailed, campaigns, campaignsFailed, now]);
  const best = useMemo<BestPost>(() => (campaignsFailed
    ? { kind: 'none', title: 'Best post of the month', note: 'We could not load your posts just now. Please try again in a moment.' }
    : bestPostOfMonth(campaigns, now)), [campaigns, campaignsFailed, now]);
  const disconnected = Boolean(summary && summary.connected && summary.connected.count === 0);
  const days = useMemo(() => (historyFailed ? [] : reachDays(history, disconnected).slice(-30)), [history, historyFailed, disconnected]);
  const reachTile = tiles[0];

  if (loading) {
    return (
      <div className="nb-perf-loading" role="status" aria-label="Loading performance">
        <Loader2 className="nb-perf-spin" aria-hidden />
      </div>
    );
  }

  const asOf = summary?.numbers?.reach?.asOf || summary?.numbers?.followers?.asOf || null;
  const stale = Boolean(summary?.numbers?.reach?.stale || summary?.numbers?.followers?.stale);
  const connected = summary?.connected?.count ?? null;
  const chartReason = historyFailed ? 'We could not load this just now.' : reachTile.value === null ? reachTile.reason : null;

  return (
    <div className="nb-perf">
      <header className="nb-perf-hero nb-perf-in" style={{ ['--i' as any]: 0 }}>
        <div className="nb-perf-hero-id">
          <PageHeader eyebrow="Performance" title="How your posts are" emphasis="doing" description={heroLine(tiles)} />
          <ul className="nb-perf-meta" aria-label="About these numbers">
            {asOf && <li data-tone={stale ? 'coral' : 'lilac'}><CalendarDays aria-hidden />{stale ? `Last update ${dayMonth(asOf)}, waiting for newer numbers` : `Updated ${dayMonth(asOf)}`}</li>}
            {connected !== null && <li>{connected === 0 ? 'No account connected' : `${connected} ${connected === 1 ? 'account' : 'accounts'} connected`}</li>}
          </ul>
        </div>
        <span className="nb-perf-hero-art" aria-hidden="true">
          <PerformanceArt />
          <PlanSparkleArt className="nb-perf-spark-deco" />
        </span>
      </header>

      <section className="nb-perf-wrap" aria-label="Your numbers">
        <ul className="nb-perf-grid">
          {tiles.map((t, i) => <KpiCard key={t.key} tile={t} index={i} />)}
          <BestPostCard best={best} index={5} />
          <ReachChart days={days} reason={chartReason} index={6} />
        </ul>
      </section>

      <p className="nb-perf-source">
        Reach, engagement and followers come from your connected accounts and are updated twice a day. Changes compare with the numbers from a week earlier. Posts published counts the posts Nebulaa published for you, by India week.
      </p>
    </div>
  );
};

export default GravityInsights;
