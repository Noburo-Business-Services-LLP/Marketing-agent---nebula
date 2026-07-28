import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Loader2 } from 'lucide-react';
import { apiService } from '../services/api';
import { Campaign } from '../types';

// Gravity Calendar — two-week grid matching the prototype exactly.
// Header shows the range in serif with italic gold week-numbers.

const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const MONTH_LABELS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const NUMBER_WORDS = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen','twenty'];

function numberToWord(n: number): string {
  if (n < 21) return NUMBER_WORDS[n];
  if (n < 30) return `twenty-${NUMBER_WORDS[n - 20]}`;
  if (n < 40) return `thirty-${NUMBER_WORDS[n - 30]}`;
  return String(n);
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
  const [anchorMonday, setAnchorMonday] = useState<Date>(() => startOfMondayWeek(new Date()));
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

  const weeks = useMemo(() => {
    const w1 = Array.from({ length: 7 }, (_, i) => addDays(anchorMonday, i));
    const w2 = Array.from({ length: 7 }, (_, i) => addDays(anchorMonday, 7 + i));
    return [w1, w2];
  }, [anchorMonday]);

  const rangeStart = weeks[0][0];
  const rangeEnd = weeks[1][6];

  const monthLabel = MONTH_LABELS[rangeStart.getMonth()];
  const startWord = numberToWord(rangeStart.getDate());
  const endWord = numberToWord(rangeEnd.getDate());
  const startEndSameMonth = rangeStart.getMonth() === rangeEnd.getMonth();
  const endMonthLabel = MONTH_LABELS[rangeEnd.getMonth()];

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
    const all = [...weeks[0], ...weeks[1]];
    return all.reduce((sum, d) => sum + postsFor(d).length, 0);
  }, [weeks, postsByDay]);

  const awaitingApproval = campaigns.filter((c: any) => String(c.status || '').toLowerCase() === 'draft').length;

  const today = new Date();

  return (
    <div className="max-w-[1440px] mx-auto pb-16">
      {/* Header */}
      <div className="flex items-start justify-between mb-8 gap-6">
        <h1 className="font-serif-display text-[42px] leading-[1.05] tracking-[-0.02em] text-[#F5F4F1]">
          {monthLabel} <span className="italic text-[#F5A623]">{startWord}</span>
          {' '}through{' '}
          {startEndSameMonth ? '' : `${endMonthLabel} `}
          <span className="italic text-[#F5A623]">{endWord}</span>
        </h1>
        <div className="flex items-center gap-2 flex-shrink-0 mt-3">
          <button
            onClick={() => setAnchorMonday(addDays(anchorMonday, -14))}
            className="w-9 h-9 rounded-lg border border-white/[0.08] flex items-center justify-center text-white/60 hover:text-[#F5F4F1] hover:bg-white/[0.04]"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setAnchorMonday(startOfMondayWeek(new Date()))}
            className="h-9 px-4 rounded-lg border border-white/[0.10] text-[13px] font-semibold text-[#F5F4F1] hover:bg-white/[0.04]"
          >
            Today
          </button>
          <button
            onClick={() => setAnchorMonday(addDays(anchorMonday, 14))}
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
          <span className="text-[#F5F4F1] font-semibold tabular-nums">{totalPosts}</span> posts
          {awaitingApproval > 0 && (
            <>
              <span className="mx-2 text-white/25">·</span>
              <span className="text-[#F5A623] font-semibold tabular-nums">{awaitingApproval}</span>
              <span> awaiting approval</span>
            </>
          )}
        </div>
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
                return (
                  <div
                    key={d.toISOString()}
                    className={`rounded-xl border p-3 min-h-[220px] flex flex-col ${
                      isToday
                        ? 'border-[#F5A623]/40 bg-[#F5A623]/[0.03]'
                        : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.03]'
                    } transition-colors`}
                  >
                    <div className="flex items-baseline justify-between mb-3">
                      <span className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${
                        isToday ? 'text-[#F5A623]' : 'text-white/45'
                      }`}>
                        {DAY_LABELS[(d.getDay() + 6) % 7]}
                      </span>
                      <span className={`text-[16px] font-serif-display tabular-nums ${isToday ? 'text-[#F5A623]' : 'text-[#F5F4F1]'}`}>
                        {d.getDate()}
                      </span>
                    </div>
                    <div className="flex-1 space-y-1.5">
                      {posts.slice(0, 4).map((p) => (
                        <button
                          key={p.id}
                          onClick={() => navigate('/drafts')}
                          className="w-full flex items-center gap-2 p-1.5 rounded-md bg-white/[0.03] hover:bg-white/[0.08] transition-colors text-left group"
                        >
                          <div className="w-8 h-8 rounded flex-shrink-0 bg-white/[0.05] overflow-hidden">
                            {p.image && <img src={p.image} alt="" className="w-full h-full object-cover" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[9px] font-semibold text-white/50 uppercase tracking-wider tabular-nums">
                              {p.time}
                            </div>
                            <div className="text-[10.5px] text-[#F5F4F1] truncate leading-tight">
                              {p.title}
                            </div>
                          </div>
                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: PLATFORM_DOT[String(p.platform).toLowerCase()] || '#F5F4F1' }} />
                        </button>
                      ))}
                      {posts.length > 4 && (
                        <div className="text-[9.5px] text-white/40 text-center pt-0.5">
                          +{posts.length - 4} more
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
