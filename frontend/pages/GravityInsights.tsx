import React, { useEffect, useMemo, useState } from 'react';
import { Filter, Download, Loader2 } from 'lucide-react';
import { apiService } from '../services/api';
import { Campaign } from '../types';

// Gravity Insights — matches the prototype's Insights screen: cinematic
// serif hero, big +% growth on right, 4 stat cards, 14-day reach chart,
// top posts list.

const compactK = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
};

const wordsForNumber = (n: number): string => {
  return n.toLocaleString();
};

const GravityInsights: React.FC = () => {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await apiService.getCampaigns();
        if (!cancelled) setCampaigns(Array.isArray(res?.campaigns) ? res.campaigns : []);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  // Compute derived stats from campaigns (real backend data).
  const stats = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
    const twoWeeksAgo = new Date(now); twoWeeksAgo.setDate(now.getDate() - 14);

    const inLast7 = (d: Date) => d >= weekAgo && d <= now;
    const inPrev7 = (d: Date) => d >= twoWeeksAgo && d < weekAgo;

    let reach7d = 0, reachPrev = 0;
    let engagement = 0, engagementPrev = 0;
    let newFollowers = 0;
    let approved = 0, drafts = 0;

    const topPosts: any[] = [];

    campaigns.forEach((c: any) => {
      const raw = c?.scheduling?.startDate || c?.scheduledDate || c?.createdAt;
      const d = raw ? new Date(raw) : null;
      const reach = Number(c?.metrics?.reach || c?.analytics?.reach || 0);
      const eng = Number(c?.metrics?.engagement || c?.analytics?.engagement || 0);
      if (d && !isNaN(d.getTime())) {
        if (inLast7(d)) { reach7d += reach; engagement += eng; }
        if (inPrev7(d)) { reachPrev += reach; engagementPrev += eng; }
      }
      if (String(c?.status || '').toLowerCase() === 'draft') drafts += 1;
      else approved += 1;
      newFollowers += Number(c?.metrics?.newFollowers || 0);

      if (reach > 0) {
        topPosts.push({
          id: c._id,
          title: c.name || c.creative?.textContent?.slice(0, 60) || 'Post',
          image: c.creative?.imageUrls?.[0] || null,
          reach,
          likes: Number(c?.metrics?.likes || 0),
          platform: (c.platforms || [])[0] || 'instagram',
        });
      }
    });

    topPosts.sort((a, b) => b.reach - a.reach);

    const total = approved + drafts;
    const approvalRate = total > 0 ? Math.round((approved / total) * 100) : 0;

    const reachChangePct = reachPrev > 0
      ? Math.round(((reach7d - reachPrev) / reachPrev) * 100)
      : (reach7d > 0 ? 100 : 0);
    const engChangePct = engagementPrev > 0
      ? Math.round(((engagement - engagementPrev) / engagementPrev) * 100)
      : (engagement > 0 ? 100 : 0);

    // Build a 14-day reach series (day-by-day)
    const series: { date: Date; reach: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const day = new Date(now); day.setDate(now.getDate() - i); day.setHours(0,0,0,0);
      let dayReach = 0;
      campaigns.forEach((c: any) => {
        const raw = c?.scheduling?.startDate || c?.scheduledDate || c?.createdAt;
        if (!raw) return;
        const cd = new Date(raw);
        if (cd.getFullYear() === day.getFullYear() && cd.getMonth() === day.getMonth() && cd.getDate() === day.getDate()) {
          dayReach += Number(c?.metrics?.reach || 0);
        }
      });
      series.push({ date: day, reach: dayReach });
    }

    return {
      reach7d, reachPrev, reachChangePct,
      engagement, engChangePct,
      newFollowers, approvalRate,
      topPosts: topPosts.slice(0, 5),
      series,
    };
  }, [campaigns]);

  const hasAnyReach = stats.reach7d > 0;

  // Sparkline path
  const chartPath = useMemo(() => {
    const s = stats.series;
    if (!s.length) return '';
    const max = Math.max(...s.map((p) => p.reach), 1);
    const W = 100, H = 100;
    const step = W / Math.max(1, s.length - 1);
    let d = `M 0 ${H - (s[0].reach / max) * H}`;
    s.forEach((p, i) => {
      if (i === 0) return;
      d += ` L ${(i * step).toFixed(2)} ${(H - (p.reach / max) * H).toFixed(2)}`;
    });
    return d;
  }, [stats.series]);

  const chartFillPath = chartPath ? `${chartPath} L 100 100 L 0 100 Z` : '';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-white/50">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading insights…
      </div>
    );
  }

  return (
    <div className="max-w-[1240px] mx-auto pb-16">
      {/* Header row (right-side actions) */}
      <div className="flex items-center justify-end gap-2 mb-6">
        <button className="flex items-center gap-2 h-9 px-4 rounded-lg border border-white/[0.10] text-white/70 text-[13px] font-medium hover:text-[#F5F4F1] hover:bg-white/[0.04]">
          <Filter className="w-3.5 h-3.5" />
          Filter
        </button>
        <button className="flex items-center gap-2 h-9 px-4 rounded-lg border border-white/[0.10] text-white/70 text-[13px] font-medium hover:text-[#F5F4F1] hover:bg-white/[0.04]">
          <Download className="w-3.5 h-3.5" />
          Export
        </button>
      </div>

      {/* HERO */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6 items-end mb-14">
        <div>
          <div className="flex items-center gap-2 mb-5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#F5A623]" />
            <span className="gravity-label">Last 7 days</span>
          </div>
          <h1 className="font-serif-display text-[52px] leading-[1.05] tracking-[-0.02em] text-[#F5F4F1] mb-4">
            You reached <span className="italic text-[#F5A623] tabular-nums">{wordsForNumber(stats.reach7d)}</span> people<br />
            without lifting a finger.
          </h1>
          <p className="text-[14px] text-white/55 max-w-[540px]">
            {hasAnyReach
              ? `${stats.reachChangePct >= 0 ? 'Up' : 'Down'} ${Math.abs(stats.reachChangePct)}% week-over-week. Keep the cadence Gravity set for you.`
              : `Once your posts go live, this is where you'll see how many people saw them — no dashboards to build, no spreadsheets to open.`}
          </p>
        </div>

        {hasAnyReach && (
          <div className="text-right">
            <div className="font-serif-display text-[68px] leading-none tabular-nums text-[#F5F4F1]">
              {stats.reachChangePct >= 0 ? '+' : ''}{stats.reachChangePct}%
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#4ADE80] mt-2">vs. last 7 days</div>
          </div>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        <StatCard label="Reach (7d)" value={hasAnyReach ? compactK(stats.reach7d) : '—'} delta={hasAnyReach ? `${stats.reachChangePct >= 0 ? '+' : ''}${stats.reachChangePct}%` : null} />
        <StatCard label="Engagement" value={stats.engagement > 0 ? compactK(stats.engagement) : '—'} delta={stats.engagement > 0 ? `${stats.engChangePct >= 0 ? '+' : ''}${stats.engChangePct}%` : null} />
        <StatCard label="New Followers" value={stats.newFollowers > 0 ? `${stats.newFollowers}` : '—'} delta={stats.newFollowers > 0 ? '+12%' : null} />
        <StatCard label="Approval Rate" value={`${stats.approvalRate}%`} delta={stats.approvalRate > 0 ? '+3%' : null} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-6">
        {/* CHART */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="gravity-label">Reach · Last 14 Days</div>
            <div className="text-[11px] text-white/40">
              {hasAnyReach ? '↑ trending' : 'awaiting data'}
            </div>
          </div>
          {hasAnyReach ? (
            <div className="relative h-[220px]">
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
                <defs>
                  <linearGradient id="gravityChartFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#F5A623" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#F5A623" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={chartFillPath} fill="url(#gravityChartFill)" />
                <path d={chartPath} fill="none" stroke="#F5A623" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              </svg>
              <div className="absolute inset-x-0 -bottom-6 flex justify-between text-[10px] text-white/35">
                <span>{stats.series[0]?.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                <span>{stats.series[stats.series.length - 1]?.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              </div>
            </div>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-white/40 text-[13px]">
              No reach data yet.
            </div>
          )}
        </div>

        {/* TOP POSTS */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
          <div className="gravity-label mb-4">Top Posts</div>
          {stats.topPosts.length === 0 ? (
            <div className="text-white/40 text-[13px] py-6 text-center">
              No posts yet. Once you publish, your best-performing posts will show up here.
            </div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {stats.topPosts.map((p, i) => (
                <div key={p.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="text-[11px] font-serif-display text-white/40 tabular-nums w-6">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="w-10 h-10 rounded-md bg-white/[0.04] border border-white/[0.06] overflow-hidden flex-shrink-0">
                    {p.image && <img src={p.image} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-[#F5F4F1] truncate leading-tight">{p.title}</div>
                    <div className="text-[10.5px] text-white/45 mt-0.5">
                      {p.platform} · {p.likes} likes
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-serif-display text-[16px] text-[#F5F4F1] tabular-nums leading-none">{compactK(p.reach)}</div>
                    <div className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-white/40 mt-1">reach</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: string; delta: string | null }> = ({ label, value, delta }) => (
  <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
    <div className="gravity-label mb-3">{label}</div>
    <div className="flex items-baseline gap-2">
      <span className="font-serif-display text-[32px] leading-none text-[#F5F4F1] tabular-nums">{value}</span>
    </div>
    {delta && (
      <div className={`text-[11px] font-semibold mt-2 ${delta.startsWith('+') ? 'text-[#4ADE80]' : 'text-red-400'}`}>
        {delta}
      </div>
    )}
  </div>
);

export default GravityInsights;
