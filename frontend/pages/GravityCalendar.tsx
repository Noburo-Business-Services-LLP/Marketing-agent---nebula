import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Loader2 } from 'lucide-react';
import { apiService } from '../services/api';
import { Campaign } from '../types';
import { GravityHero } from '../components/gravity';

// Gravity Calendar — a real month grid: jump to any month, see every day at
// once, posts sit on the day they're actually scheduled for with a
// thumbnail. Previously a 2-week rolling window (±14 days); rebuilt to full
// months because a monthly client report needs "show me August," not a
// window that happens to include some of August.

const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const MONTH_LABELS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function startOfMondayWeek(d: Date) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  const dow = c.getDay(); // 0=Sun..6=Sat
  const diff = dow === 0 ? -6 : 1 - dow; // shift to Monday
  c.setDate(c.getDate() + diff);
  return c;
}

function addDays(d: Date, n: number) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const PLATFORM_DOT: Record<string, string> = {
  instagram: '#E1306C',
  facebook: '#1877F2',
  linkedin: '#0A66C2',
  x: '#F5F4F1',
  twitter: '#F5F4F1',
  youtube: '#FF0000',
};

const GravityCalendar: React.FC = () => {
  const navigate = useNavigate();
  const [anchorMonth, setAnchorMonth] = useState<Date>(() => startOfMonth(new Date()));
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

  // A calendar grid always shows whole weeks — the last few days of the
  // previous month and the first few of the next fill out the first/last
  // row rather than leaving a ragged edge. Those days still render (a post
  // scheduled on Aug 31 should be visible from September's view too) but
  // dimmed, so it's obvious at a glance which days belong to this month.
  const weeks = useMemo(() => {
    const monthStart = anchorMonth;
    const monthEnd = new Date(anchorMonth.getFullYear(), anchorMonth.getMonth() + 1, 0);
    const gridStart = startOfMondayWeek(monthStart);
    const gridEnd = addDays(startOfMondayWeek(monthEnd), 6);

    const days: Date[] = [];
    let cursor = gridStart;
    while (cursor.getTime() <= gridEnd.getTime()) {
      days.push(cursor);
      cursor = addDays(cursor, 1);
    }

    const rows: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
    return rows;
  }, [anchorMonth]);

  const monthLabel = MONTH_LABELS[anchorMonth.getMonth()];
  const yearLabel = anchorMonth.getFullYear();

  // Group campaigns by day
  const postsByDay = useMemo(() => {
    const map = new Map<string, any[]>();
    campaigns.forEach((c: any) => {
      const raw = c?.scheduling?.startDate || c?.scheduledDate;
      if (!raw) return;
      const d = new Date(raw);
      if (isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const arr = map.get(key) || [];
      arr.push({
        id: c._id,
        date: d,
        time: d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        title: c.name || c.creative?.textContent?.slice(0, 40) || 'Post',
        image: c.creative?.imageUrls?.[0] || null,
        platform: (c.platforms || [])[0] || 'instagram',
        status: c.status || 'scheduled',
      });
      map.set(key, arr);
    });
    // Sort within each day
    map.forEach((arr) => arr.sort((a, b) => a.date.getTime() - b.date.getTime()));
    return map;
  }, [campaigns]);

  const postsFor = (d: Date) => postsByDay.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`) || [];

  const totalPosts = useMemo(() => {
    const all = weeks.flat();
    return all.reduce((sum, d) => sum + postsFor(d).length, 0);
  }, [weeks, postsByDay]);

  const awaitingApproval = campaigns.filter((c: any) => String(c.status || '').toLowerCase() === 'draft').length;

  const today = new Date();

  return (
    <div className="max-w-[1440px] mx-auto pb-16">
      {/* Header */}
      <div className="flex items-start justify-between mb-8 gap-6">
        <GravityHero
          align="left"
          eyebrow="Schedule"
          headline={<>{monthLabel} <span className="italic text-[#F5A623]">{yearLabel}</span></>}
          className="!mb-0"
        />
        <div className="flex items-center gap-2 flex-shrink-0 mt-8">
          <button
            onClick={() => setAnchorMonth((m) => addMonths(m, -1))}
            title="Previous month"
            className="w-9 h-9 rounded-lg border border-white/[0.08] flex items-center justify-center text-white/60 hover:text-[#F5F4F1] hover:bg-white/[0.04]"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setAnchorMonth(startOfMonth(new Date()))}
            className="h-9 px-4 rounded-lg border border-white/[0.10] text-[13px] font-semibold text-[#F5F4F1] hover:bg-white/[0.04]"
          >
            Today
          </button>
          <button
            onClick={() => setAnchorMonth((m) => addMonths(m, 1))}
            title="Next month"
            className="w-9 h-9 rounded-lg border border-white/[0.08] flex items-center justify-center text-white/60 hover:text-[#F5F4F1] hover:bg-white/[0.04]"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Legend + totals */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          {['instagram','facebook','linkedin','x'].map((p) => (
            <div key={p} className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: PLATFORM_DOT[p] || '#F5F4F1' }} />
              <span className="text-[11.5px] text-white/55 capitalize">{p === 'x' ? 'X' : p}</span>
            </div>
          ))}
        </div>
        <div className="text-[11.5px] text-white/50">
          <span className="text-[#F5F4F1] font-semibold tabular-nums">{totalPosts}</span> posts this month
          {awaitingApproval > 0 && (
            <>
              <span className="mx-2 text-white/25">·</span>
              <span className="text-[#F5A623] font-semibold tabular-nums">{awaitingApproval}</span>
              <span> awaiting approval</span>
            </>
          )}
        </div>
      </div>

      {/* Weekday header row — the grid below has no per-day label once it
          spans 4-6 rows, so this anchors which column is which day. */}
      <div className="grid grid-cols-7 gap-3 mb-2">
        {DAY_LABELS.map((label) => (
          <div key={label} className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35 px-1">
            {label}
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-white/50">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading calendar…
        </div>
      ) : (
        <div className="space-y-3">
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 gap-3">
              {week.map((d) => {
                const posts = postsFor(d);
                const isToday = sameDay(d, today);
                const inMonth = d.getMonth() === anchorMonth.getMonth();
                return (
                  <div
                    key={d.toISOString()}
                    className={`rounded-xl border p-3 min-h-[150px] flex flex-col transition-colors ${
                      isToday
                        ? 'border-[#F5A623]/40 bg-[#F5A623]/[0.03]'
                        : inMonth
                          ? 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.03]'
                          : 'border-white/[0.03] bg-white/[0.005] opacity-40'
                    }`}
                  >
                    <div className="flex items-baseline justify-end mb-2">
                      <span className={`text-[14px] font-serif-display tabular-nums ${isToday ? 'text-[#F5A623]' : inMonth ? 'text-[#F5F4F1]' : 'text-white/40'}`}>
                        {d.getDate()}
                      </span>
                    </div>
                    <div className="flex-1 space-y-1.5">
                      {posts.slice(0, 3).map((p) => (
                        <button
                          key={p.id}
                          onClick={() => navigate('/drafts')}
                          className="w-full flex items-center gap-2 p-1.5 rounded-md bg-white/[0.03] hover:bg-white/[0.08] transition-colors text-left group"
                        >
                          <div className="w-7 h-7 rounded flex-shrink-0 bg-white/[0.05] overflow-hidden">
                            {p.image && <img src={p.image} alt="" className="w-full h-full object-cover" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[9px] font-semibold text-white/50 uppercase tracking-wider tabular-nums">
                              {p.time}
                            </div>
                            <div className="text-[10px] text-[#F5F4F1] truncate leading-tight">
                              {p.title}
                            </div>
                          </div>
                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: PLATFORM_DOT[String(p.platform).toLowerCase()] || '#F5F4F1' }} />
                        </button>
                      ))}
                      {posts.length > 3 && (
                        <div className="text-[9.5px] text-white/40 text-center pt-0.5">
                          +{posts.length - 3} more
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 flex justify-center">
        <button
          onClick={() => navigate('/campaigns')}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-white/[0.10] hover:border-[#F5A623]/50 hover:text-[#F5A623] text-white/70 text-[13px] font-medium transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New post
        </button>
      </div>
    </div>
  );
};

export default GravityCalendar;
