import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ArrowRight, Sparkles } from 'lucide-react';
import { apiService, draftsAPI } from '../services/api';
import { Draft, Campaign } from '../types';
import { GravityHero, GravityEmphasis } from '../components/gravity';

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
    return <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--gv-text-tertiary)]">Scheduled</span>;
  }
  return <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--gv-text-muted)]">{status}</span>;
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

  // Must match what the Approve page counts, or the hero and the sidebar
  // badge disagree. Anything already published/scheduled/rejected is done.
  const AWAITING = new Set(['pending', 'draft', 'ready', 'processing', 'failed', 'completed']);
  const heroReadyCount = drafts.filter((d: any) => {
    const status = String(d?.status || 'draft').toLowerCase();
    const source = String(d?.sourceType || d?.contentType || 'post').toLowerCase();
    if (source === 'reel' || source === 'video') return false;
    return AWAITING.has(status);
  }).length;

  const now = new Date();
  const dateLabel = `${DAY_LABELS[now.getDay()]}, ${MONTH_LABELS[now.getMonth()]} ${now.getDate()}`;

  // Shown only when the account has made nothing yet. Deliberately marked as
  // examples on the card: an unlabelled stack of stock imagery on a personal
  // dashboard reads as "these are your posts", which would be a lie.
  const SAMPLE_STACK = [
    'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&q=80&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&q=80&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1600185365483-26d7a4cc7519?w=400&q=80&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=400&q=80&auto=format&fit=crop',
  ];

  // Card stack — real artwork, real platform, real date. Previously the
  // labels were hardcoded to "IG · TOMORROW/THU/FRI/SAT" regardless of what
  // was actually scheduled, which made the whole panel decorative.
  //
  // Drafts come first and campaigns second: the artwork this account actually
  // generated lives on drafts, so sourcing campaigns alone left the stack as
  // four empty gradient blocks for anyone who had made posts but not yet run
  // a scheduled campaign.
  const stackCards = useMemo(() => {
    // While the fetch is still in flight, drafts/campaigns are both still
    // their initial empty arrays — indistinguishable from a genuinely empty
    // account. Rendering SAMPLE_STACK here was a real bug, not the
    // documented empty-state fallback: on every mount (including navigating
    // back to this tab, which remounts the component and resets this state
    // to []) it flashed real stock photography for however long the fetch
    // took, before snapping to the actual state. Four blank placeholder
    // cards keep the layout stable without claiming to be anyone's content.
    if (loading) {
      return [{ img: '', tag: '', sample: false }, { img: '', tag: '', sample: false }, { img: '', tag: '', sample: false }, { img: '', tag: '', sample: false }];
    }

    const fromDrafts = drafts
      .map((d: any) => ({
        img: d?.imageUrl || d?.creative?.imageUrls?.[0] || '',
        platform: (d?.platforms?.[0] || '').toString(),
        when: d?.scheduledDate || d?.createdAt || null,
      }))
      .filter((d: any) => d.img);

    const fromCampaigns = campaigns
      .map((c: any) => ({
        img: c?.creative?.imageUrls?.[0] || '',
        platform: (c?.platforms?.[0] || '').toString(),
        when: c?.scheduling?.startDate || c?.scheduledDate || null,
      }))
      .filter((c: any) => c.img);

    const real = [...fromDrafts, ...fromCampaigns];

    if (real.length === 0) {
      return SAMPLE_STACK.map((img) => ({ img, tag: 'EXAMPLE', sample: true }));
    }

    const upcoming = real
      .sort((a: any, b: any) => new Date(b.when || 0).getTime() - new Date(a.when || 0).getTime())
      .slice(0, 4);

    return upcoming.map((c: any) => {
      let label = '';
      if (c.when) {
        const d = new Date(c.when);
        if (!isNaN(d.getTime())) {
          const today = new Date(); today.setHours(0, 0, 0, 0);
          const day = new Date(d); day.setHours(0, 0, 0, 0);
          const diff = Math.round((day.getTime() - today.getTime()) / 86400000);
          label = diff === 0 ? 'TODAY' : diff === 1 ? 'TOMORROW' : DAY_LABELS[d.getDay()];
        }
      }
      const platform = c.platform ? c.platform.slice(0, 2).toUpperCase() : '';
      return { img: c.img, tag: [platform, label].filter(Boolean).join(' · '), sample: false };
    });
  }, [drafts, campaigns, loading]);

  return (
    <div className="max-w-[1240px] mx-auto pb-16">
      {/* Setup notice — only shows when there's actual setup to do */}
      {drafts.length === 0 && campaigns.length === 0 && !loading && (
        <div className="mb-8 flex items-center gap-3 px-5 py-4 rounded-xl bg-[var(--gv-surface-1)] border border-[rgb(var(--gv-accent-rgb)/0.25)] relative overflow-hidden">
          <span className="absolute inset-y-0 left-0 w-[3px] bg-[var(--gv-accent)]" />
          <span className="w-2 h-2 rounded-full bg-[var(--gv-accent)]" />
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-semibold text-[var(--gv-text-primary)]">Finish setting up Gravity</div>
            <div className="text-[12px] text-[var(--gv-text-tertiary)] truncate">Connect your social accounts and confirm brand voice — 2 minutes.</div>
          </div>
          <Link to="/connect-socials" className="flex items-center gap-2 text-[12px] font-semibold text-[var(--gv-accent-text)] hover:text-[var(--gv-accent-hover)]">
            <span>0 of 2 done</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {/* HERO */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-8 items-center mb-14">
        <div>
          <GravityHero
            align="left"
            eyebrow={`${dateLabel} · Bengaluru`}
            headline={
              <>
                <span className="tabular-nums">{heroReadyCount}</span> {heroReadyCount === 1 ? 'post' : 'posts'}<br />
                <span>{heroReadyCount === 1 ? 'is' : 'are'} ready for </span>
                <GravityEmphasis>your eye</GravityEmphasis>
                <span>.</span>
              </>
            }
            subcopy="Gravity drafted the week ahead while you slept. Take a minute, tap through, and we'll handle the rest — scheduled, posted, measured."
            className="!mb-8"
          />

          <div className="flex items-center gap-3">
            <Link
              to="/drafts"
              className="flex items-center gap-2 h-11 px-5 rounded-lg bg-[var(--gv-accent)] hover:bg-[var(--gv-accent-hover)] text-[var(--gv-accent-ink)] text-[14px] font-semibold transition-colors shadow-[0_8px_30px_rgba(245,166,35,0.25)]"
            >
              <Check className="w-4 h-4" strokeWidth={3} />
              Review queue
            </Link>
            <Link
              to="/campaigns"
              className="flex items-center gap-2 h-11 px-5 rounded-lg border border-[var(--gv-border-default)] hover:border-[var(--gv-border-strong)] hover:bg-[var(--gv-surface-1)] text-[var(--gv-text-primary)] text-[14px] font-medium transition-colors"
            >
              <Sparkles className="w-4 h-4" />
              Start fresh
            </Link>
          </div>
        </div>

        {/* Photo card stack */}
        <div className="relative w-[440px] h-[300px] hidden lg:block">
          {/* Ambient glow — gold-toned, unchanged by theme */}
          <div className="absolute inset-[-40px] rounded-full blur-3xl opacity-70" style={{ background: 'radial-gradient(60% 50% at 50% 50%, rgba(245,166,35,0.20), transparent 70%)' }} />
          {stackCards.map(({ img, tag, sample }: any, i) => {
            const angle = (i - 1.5) * 6;
            const offsetX = (i - 1.5) * 60;
            const z = i === 2 ? 4 : i === 1 ? 3 : i === 3 ? 2 : 1;
            const scale = i === 2 ? 1.05 : 0.95;
            return (
              <div
                key={i}
                className="absolute top-1/2 left-1/2 w-[160px] h-[220px] rounded-xl bg-[var(--gv-panel)] border border-[var(--gv-border-subtle)] overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
                style={{
                  transform: `translate(-50%, -50%) translateX(${offsetX}px) rotate(${angle}deg) scale(${scale})`,
                  zIndex: z,
                }}
              >
                {img ? (
                  <img src={img} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-[var(--gv-surface-2)] to-[var(--gv-surface-1)]" />
                )}
                {tag && (
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-2 py-1.5 bg-gradient-to-t from-black/70 to-transparent">
                    <span className={`text-[9px] font-semibold tracking-widest ${sample ? 'text-white/55' : 'text-white/80'}`}>{tag}</span>
                    {!sample && (
                      <span className="text-[9px] text-white/60 tabular-nums">{i + 1}/{stackCards.length}</span>
                    )}
                  </div>
                )}
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
            <div className="text-[11px] text-[var(--gv-text-muted)]">
              {todaysPlan.length} post{todaysPlan.length !== 1 ? 's' : ''} · {weeklyStats.platforms.length} platform{weeklyStats.platforms.length !== 1 ? 's' : ''}
            </div>
          </div>
          {todaysPlan.length === 0 ? (
            <div className="rounded-xl border border-[var(--gv-border-subtle)] p-8 text-center">
              <div className="text-[var(--gv-text-muted)] text-[14px]">Nothing on the schedule for today. Enjoy a slower day.</div>
              <Link to="/content-calendar" className="mt-3 inline-block text-[12px] text-[var(--gv-accent-text)] hover:text-[var(--gv-accent-hover)] font-semibold">
                Open Calendar →
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-[var(--gv-border-subtle)]">
              {todaysPlan.map((item: any) => (
                <div key={item.id} className="flex items-center gap-4 py-4">
                  <div className="flex items-center gap-3 min-w-[110px]">
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      item.status === 'posted' || item.status === 'published' ? 'bg-[var(--gv-accent)]' :
                      item.status === 'scheduled' ? 'bg-[#60A5FA]' : 'bg-[var(--gv-text-muted)]'
                    }`} />
                    <span className="text-[12px] font-medium text-[var(--gv-text-tertiary)] tracking-wider tabular-nums">{item.time}</span>
                  </div>
                  <div className="w-11 h-11 rounded-md bg-[var(--gv-surface-2)] border border-[var(--gv-border-subtle)] overflow-hidden flex-shrink-0">
                    {item.image && <img src={item.image} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-semibold text-[var(--gv-text-primary)] truncate">{item.title}</div>
                    <div className="text-[12px] text-[var(--gv-text-tertiary)] truncate">{item.subtitle}</div>
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
            <div className="text-[11px] text-[var(--gv-text-muted)]">vs. last 7d</div>
          </div>

          <div className="rounded-2xl border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] p-6 relative overflow-hidden">
            <div className="absolute -top-16 -right-10 w-40 h-40 rounded-full blur-3xl opacity-40" style={{ background: 'radial-gradient(circle, rgba(245,166,35,0.25), transparent 70%)' }} />
            <div className="relative">
              {/* Posts published — a number we can actually count. Reach and
                  engagement need real analytics; inventing them (this used to
                  render postedCount * 12.4 as "reach") is worse than blank. */}
              <div className="gravity-label mb-3">Published this week</div>
              <div className="flex items-baseline gap-2">
                <span className="font-serif-display text-[56px] leading-none text-[var(--gv-text-primary)] tabular-nums">
                  {weeklyStats.postedCount}
                </span>
                {weeklyStats.totalPosts > 0 && (
                  <span className="text-[15px] text-[var(--gv-text-tertiary)]">of {weeklyStats.totalPosts} planned</span>
                )}
              </div>
              <div className="text-[12px] text-[var(--gv-text-tertiary)] mt-3">
                {weeklyStats.platforms.length > 0
                  ? `across ${weeklyStats.platforms.join(', ')}`
                  : 'No platforms connected yet'}
              </div>
            </div>
          </div>

          {campaigns.slice(0, 1).map((c: any) => (
            <Link to="/campaigns" key={c._id} className="block rounded-2xl border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] p-4 hover:bg-[var(--gv-surface-2)] transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-md bg-[var(--gv-surface-2)] border border-[var(--gv-border-subtle)] overflow-hidden flex-shrink-0">
                  {c.creative?.imageUrls?.[0] && <img src={c.creative.imageUrls[0]} alt="" className="w-full h-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-semibold text-[var(--gv-text-primary)] truncate">{c.name || 'Recent campaign'}</div>
                  {/* Real fields only. This line used to read "24.8K reach ·
                      3,184 likes" for every campaign — both hardcoded. */}
                  <div className="text-[11px] text-[var(--gv-text-tertiary)] capitalize">
                    {[c.status, (c.platforms || []).join(', ')].filter(Boolean).join(' · ') || 'No platforms set'}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </section>
      </div>
    </div>
  );
};

export default GravityHome;
