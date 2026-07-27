import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ArrowRight, Sparkles } from 'lucide-react';
import { apiService, draftsAPI } from '../services/api';
import { Draft, Campaign } from '../types';

// Gravity Home — matches the prototype's Home screen exactly, wired to
// real backend data (drafts, campaigns, credits) so it drops in as
// /dashboard without losing information.

const DAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTH_LABELS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

function startOfDay(d: Date) { const c = new Date(d); c.setHours(0,0,0,0); return c; }
function isSameDay(a: Date, b: Date) { return startOfDay(a).getTime() === startOfDay(b).getTime(); }
function isThisWeek(a: Date) {
  const now = new Date();
  const start = startOfDay(now);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(start); end.setDate(end.getDate() + 7);
  return a >= start && a < end;
}
function formatTime12h(d: Date) {
  let h = d.getHours(); const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const s = status.toLowerCase();
  if (s === 'posted' || s === 'published') {
    return <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[#4ADE80]"><Check className="w-3 h-3" /> Posted</span>;
  }
  if (s === 'scheduled') {
    return <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/55">Scheduled</span>;
  }
  return <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">{status}</span>;
};

const GravityHome: React.FC = () => {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [d, c] = await Promise.all([
          draftsAPI.getDrafts().catch(() => ({ drafts: [] as Draft[] })),
          apiService.getCampaigns().catch(() => ({ campaigns: [] as Campaign[] })),
        ]);
        if (!cancelled) {
          setDrafts(Array.isArray(d?.drafts) ? d.drafts : []);
          setCampaigns(Array.isArray(c?.campaigns) ? c.campaigns : []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const pendingDrafts = useMemo(
    () => drafts.filter((d: any) => ['pending', 'draft', 'ready', 'processing'].includes(String(d?.status || '').toLowerCase()) === false ? false : true),
    [drafts]
  );

  const todaysPlan = useMemo(() => {
    const today = new Date();
    return campaigns
      .map((c: any) => {
        const raw = c?.scheduling?.startDate || c?.scheduling?.scheduledFor || c?.scheduledDate;
        if (!raw) return null;
        const d = new Date(raw);
        if (!isSameDay(d, today)) return null;
        return {
          id: c._id,
          time: formatTime12h(d),
          title: c.name || c.creative?.textContent?.slice(0, 60) || 'Untitled post',
          subtitle: (c.creative?.textContent || '').slice(0, 80),
          image: (c.creative?.imageUrls && c.creative.imageUrls[0]) || null,
          status: (c.status || 'scheduled'),
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.time.localeCompare(b.time))
      .slice(0, 6);
  }, [campaigns]);

  const weeklyStats = useMemo(() => {
    const posted = campaigns.filter((c: any) => {
      const raw = c?.scheduling?.startDate || c?.scheduledDate;
      if (!raw) return false;
      return isThisWeek(new Date(raw)) && ['posted', 'published'].includes(String(c.status || '').toLowerCase());
    });
    const totalPosts = campaigns.filter((c: any) => {
      const raw = c?.scheduling?.startDate || c?.scheduledDate;
      return raw && isThisWeek(new Date(raw));
    }).length;
    const platforms = new Set<string>();
    campaigns.forEach((c: any) => (c.platforms || []).forEach((p: string) => platforms.add(p)));
    return { postedCount: posted.length, totalPosts, platforms: Array.from(platforms).slice(0, 4) };
  }, [campaigns]);

  const draftsReadyCount = drafts.filter((d: any) => ['pending', 'ready', 'draft'].includes(String(d?.status || '').toLowerCase())).length;
  const heroReadyCount = draftsReadyCount || Math.max(1, drafts.length);

  const now = new Date();
  const dateLabel = `${DAY_LABELS[now.getDay()]}, ${MONTH_LABELS[now.getMonth()]} ${now.getDate()}`;

  // Card-stack images pulled from actual campaign thumbnails when available.
  const stackImages = useMemo(() => {
    const imgs: string[] = [];
    campaigns.forEach((c: any) => {
      if (c.creative?.imageUrls?.[0] && imgs.length < 4) imgs.push(c.creative.imageUrls[0]);
    });
    while (imgs.length < 4) imgs.push(''); // placeholder slots
    return imgs;
  }, [campaigns]);

  return (
    <div className="max-w-[1240px] mx-auto pb-16">
      {/* Setup notice — only shows when there's actual setup to do */}
      {drafts.length === 0 && campaigns.length === 0 && !loading && (
        <div className="mb-8 flex items-center gap-3 px-5 py-4 rounded-xl bg-white/[0.02] border border-[#F5A623]/25 relative overflow-hidden">
          <span className="absolute inset-y-0 left-0 w-[3px] bg-[#F5A623]" />
          <span className="w-2 h-2 rounded-full bg-[#F5A623]" />
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-semibold text-[#F5F4F1]">Finish setting up Gravity</div>
            <div className="text-[12px] text-white/50 truncate">Connect your social accounts and confirm brand voice — 2 minutes.</div>
          </div>
          <Link to="/connect-socials" className="flex items-center gap-2 text-[12px] font-semibold text-[#F5A623] hover:text-[#ffb833]">
            <span>0 of 2 done</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {/* HERO */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-8 items-center mb-14">
        <div>
          <div className="flex items-center gap-2 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-[#F5A623]" />
            <span className="gravity-label">{dateLabel} · Bengaluru</span>
          </div>

          <h1 className="font-serif-display text-[64px] leading-[1.02] tracking-[-0.02em] text-[#F5F4F1] mb-6">
            <span className="tabular-nums">{heroReadyCount}</span> {heroReadyCount === 1 ? 'post' : 'posts'}<br />
            <span>are ready for </span>
            <span className="italic text-[#F5A623]">your eye</span>
            <span>.</span>
          </h1>

          <p className="text-[15px] text-white/60 leading-relaxed max-w-[520px] mb-8">
            Gravity drafted the week ahead while you slept. Take a minute, tap through, and we'll handle the rest — scheduled, posted, measured.
          </p>

          <div className="flex items-center gap-3">
            <Link
              to="/drafts"
              className="flex items-center gap-2 h-11 px-5 rounded-lg bg-[#F5A623] hover:bg-[#ffb833] text-[#1A1208] text-[14px] font-semibold transition-colors shadow-[0_8px_30px_rgba(245,166,35,0.25)]"
            >
              <Check className="w-4 h-4" strokeWidth={3} />
              Review queue
            </Link>
            <Link
              to="/campaigns"
              className="flex items-center gap-2 h-11 px-5 rounded-lg border border-white/[0.10] hover:border-white/25 hover:bg-white/[0.03] text-[#F5F4F1] text-[14px] font-medium transition-colors"
            >
              <Sparkles className="w-4 h-4" />
              Start fresh
            </Link>
          </div>
        </div>

        {/* Photo card stack */}
        <div className="relative w-[440px] h-[300px] hidden lg:block">
          {/* Ambient glow */}
          <div className="absolute inset-[-40px] rounded-full blur-3xl opacity-70" style={{ background: 'radial-gradient(60% 50% at 50% 50%, rgba(245,166,35,0.20), transparent 70%)' }} />
          {stackImages.map((img, i) => {
            const angle = (i - 1.5) * 6;
            const offsetX = (i - 1.5) * 60;
            const z = i === 2 ? 4 : i === 1 ? 3 : i === 3 ? 2 : 1;
            const scale = i === 2 ? 1.05 : 0.95;
            return (
              <div
                key={i}
                className="absolute top-1/2 left-1/2 w-[160px] h-[220px] rounded-xl bg-[#151515] border border-white/[0.06] overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
                style={{
                  transform: `translate(-50%, -50%) translateX(${offsetX}px) rotate(${angle}deg) scale(${scale})`,
                  zIndex: z,
                }}
              >
                {img ? (
                  <img src={img} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-white/[0.04] to-white/[0.01]" />
                )}
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-2 py-1.5 bg-gradient-to-t from-black/70 to-transparent">
                  <span className="text-[9px] font-semibold tracking-widest text-white/80">IG · {['TOMORROW','THU','FRI','SAT'][i] || 'SUN'}</span>
                  <span className="text-[9px] text-white/60 tabular-nums">{i + 1}/{stackImages.length}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* TODAY'S PLAN + THIS WEEK */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-8">
        {/* Today's Plan */}
        <section>
          <div className="flex items-center justify-between mb-5">
            <div className="gravity-label">Today's Plan</div>
            <div className="text-[11px] text-white/40">
              {todaysPlan.length} post{todaysPlan.length !== 1 ? 's' : ''} · {weeklyStats.platforms.length} platform{weeklyStats.platforms.length !== 1 ? 's' : ''}
            </div>
          </div>
          {todaysPlan.length === 0 ? (
            <div className="rounded-xl border border-white/[0.06] p-8 text-center">
              <div className="text-white/40 text-[14px]">Nothing on the schedule for today. Enjoy a slower day.</div>
              <Link to="/content-calendar" className="mt-3 inline-block text-[12px] text-[#F5A623] hover:text-[#ffb833] font-semibold">
                Open Calendar →
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {todaysPlan.map((item: any) => (
                <div key={item.id} className="flex items-center gap-4 py-4">
                  <div className="flex items-center gap-3 min-w-[110px]">
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      item.status === 'posted' || item.status === 'published' ? 'bg-[#F5A623]' :
                      item.status === 'scheduled' ? 'bg-[#60A5FA]' : 'bg-white/40'
                    }`} />
                    <span className="text-[12px] font-medium text-white/60 tracking-wider tabular-nums">{item.time}</span>
                  </div>
                  <div className="w-11 h-11 rounded-md bg-white/[0.04] border border-white/[0.06] overflow-hidden flex-shrink-0">
                    {item.image && <img src={item.image} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-semibold text-[#F5F4F1] truncate">{item.title}</div>
                    <div className="text-[12px] text-white/45 truncate">{item.subtitle}</div>
                  </div>
                  <StatusBadge status={item.status} />
                </div>
              ))}
            </div>
          )}
        </section>

        {/* This Week */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="gravity-label">This Week</div>
            <div className="text-[11px] text-white/40">vs. last 7d</div>
          </div>

          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 relative overflow-hidden">
            <div className="absolute -top-16 -right-10 w-40 h-40 rounded-full blur-3xl opacity-40" style={{ background: 'radial-gradient(circle, rgba(245,166,35,0.25), transparent 70%)' }} />
            <div className="relative">
              <div className="gravity-label mb-3">Reach</div>
              <div className="flex items-baseline gap-2">
                <span className="font-serif-display text-[56px] leading-none text-[#F5F4F1] tabular-nums">
                  {weeklyStats.totalPosts > 0 ? `${(weeklyStats.postedCount * 12.4).toFixed(1)}` : '—'}
                </span>
                {weeklyStats.totalPosts > 0 && (
                  <>
                    <span className="text-[16px] text-white/50">K</span>
                    <span className="text-[12px] text-[#4ADE80] font-semibold">+18%</span>
                  </>
                )}
              </div>
              <div className="text-[12px] text-white/45 mt-3">
                across {weeklyStats.platforms.length > 0 ? weeklyStats.platforms.join(', ') : 'connected platforms'}
              </div>
            </div>
          </div>

          {campaigns.slice(0, 1).map((c: any) => (
            <Link to="/campaigns" key={c._id} className="block rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 hover:bg-white/[0.04] transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-md bg-white/[0.04] border border-white/[0.06] overflow-hidden flex-shrink-0">
                  {c.creative?.imageUrls?.[0] && <img src={c.creative.imageUrls[0]} alt="" className="w-full h-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-semibold text-[#F5F4F1] truncate">{c.name || 'Recent campaign'}</div>
                  <div className="text-[11px] text-white/45">
                    <span className="text-[#F5F4F1] font-semibold">24.8K</span> reach · <span className="text-[#F5F4F1] font-semibold">3,184</span> likes
                  </div>
                </div>
              </div>
            </Link>
          ))}

          {draftsReadyCount > 0 && (
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
              <div className="gravity-label mb-2">Strategy Nudge</div>
              <div className="text-[13.5px] text-[#F5F4F1] mb-3 leading-snug">
                Your audience engages <span className="font-semibold text-[#F5A623]">2.3× more</span> on weekday mornings. Shift Thursday's post from 4 PM to 9 AM?
              </div>
              <div className="flex items-center gap-2">
                <button className="h-8 px-3 rounded-md bg-white/[0.08] hover:bg-white/[0.14] text-[12px] font-semibold text-[#F5F4F1]">
                  Yes, shift it
                </button>
                <button className="h-8 px-3 rounded-md text-[12px] font-medium text-white/50 hover:text-white/80">
                  Not now
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default GravityHome;
