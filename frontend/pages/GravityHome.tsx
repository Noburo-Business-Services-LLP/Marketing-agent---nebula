import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Sparkles } from 'lucide-react';
import { apiService } from '../services/api';
import { HomeSummary, User } from '../types';
import AgencyUsage from '../components/AgencyUsage';
import SetupCard from '../components/SetupCard';
import ThisWeekCard from '../components/ThisWeekCard';
import { isAgencyUser } from '../utils/agency';
import { GravityHero, GravityEmphasis } from '../components/gravity';
import { isHomeSummary, readCachedSummary, writeCachedSummary, todayRows, stackCards, weekPostsLine, platformsLine } from '../utils/home';
import { changeText, formatCount } from '../utils/formatCount';

// Gravity Home. The page reads ONE small answer, GET /api/home/summary (numbers, this week, today's posts, recent
// artwork), instead of downloading every draft and campaign. Weeks are Monday to Sunday in India time, counted by the
// server. The control-room layout is the next task; this keeps the existing structure on real data.

const DAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTH_LABELS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

// Today's date as the India calendar shows it (not the browser's own timezone).
function istDateLabel(now: Date) {
  const d = new Date(now.getTime() + 330 * 60000);
  return `${DAY_LABELS[d.getUTCDay()]}, ${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCDate()}`;
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

const GravityHome: React.FC<{ user?: User | null }> = ({ user }) => {
  const userId = String((user as any)?._id || (user as any)?.id || '');
  const [summary, setSummary] = useState<HomeSummary | null>(() => readCachedSummary(userId));
  const [loading, setLoading] = useState(() => !readCachedSummary(userId));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Show the last answer at once when there is a fresh one, then read the latest quietly.
    const cached = readCachedSummary(userId);
    if (cached) { setSummary(cached); setLoading(false); }
    (async () => {
      try {
        const res = await apiService.getHomeSummary();
        if (cancelled) return;
        // An answer that is not a summary (an old server) counts as a failed load, never as numbers.
        if (!isHomeSummary(res)) throw new Error('unexpected answer');
        setSummary(res);
        setFailed(false);
        writeCachedSummary(userId, res);
      } catch {
        if (!cancelled) setFailed(!cached);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const todaysPlan = useMemo(() => todayRows(summary?.today), [summary]);

  const published = summary?.numbers.postsPublishedThisWeek;
  const planned = summary?.week.posts.planned ?? null;
  const readyCount = summary?.numbers.draftsWaiting.available ? summary.numbers.draftsWaiting.value : null;
  const heroReadyCount = readyCount ?? 0;
  const platformCount = summary?.connected.platforms.length ?? 0;
  const lastWeek = published?.available ? changeText(published.changePct) : '';

  const now = new Date();
  const dateLabel = istDateLabel(now);

  // The artwork stack shows the customer's own recent posts only. With none, it is left out: no stock photos.
  // While the first answer is on its way, four blank cards keep the layout steady.
  const stack = useMemo(() => (loading ? [{ img: '', tag: '' }, { img: '', tag: '' }, { img: '', tag: '' }, { img: '', tag: '' }] : stackCards(summary?.recent, new Date())), [summary, loading]);

  // A CSM pass shows the client's account: the This week card shows, the Setup card does not. Staff see neither.
  const csmPass = (() => { try { return Boolean(localStorage.getItem('csmReturnToken')); } catch { return false; } })();
  const isStaffSelf = Boolean(user && (user.staffRole || user.isCsm)) && !csmPass;
  const showWeek = Boolean(user) && !isStaffSelf;
  const showSetup = showWeek && !csmPass && !user?.actingAgency;

  return (
    <div className="max-w-[1240px] mx-auto pb-16">
      {isAgencyUser(user) && <AgencyUsage />}

      {showSetup && <SetupCard />}
      {showWeek && <ThisWeekCard language={user?.businessProfile?.contentLanguage} />}

      {/* HERO */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-8 items-center mb-14">
        <div>
          <GravityHero
            align="left"
            eyebrow={dateLabel}
            headline={
              readyCount === null ? (
                <>
                  <span>Review and approve</span><br />
                  <GravityEmphasis>your posts</GravityEmphasis>
                  <span>.</span>
                </>
              ) : (
                <>
                  {heroReadyCount === 0 ? <span>No</span> : <span className="tabular-nums">{heroReadyCount}</span>} {heroReadyCount === 1 ? 'post' : 'posts'}<br />
                  <span>{heroReadyCount === 1 ? 'is' : 'are'} waiting for </span>
                  <GravityEmphasis>your review</GravityEmphasis>
                  <span>.</span>
                </>
              )
            }
            subcopy="Nebulaa prepares your content for the week ahead. Review each post, approve the ones you want, and Nebulaa schedules and publishes them for you."
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
              Create content
            </Link>
          </div>
        </div>

        {/* Photo card stack: the customer's own recent posts only; left out when there are none */}
        {stack.length > 0 && (
        <div className="relative w-[440px] h-[300px] hidden lg:block">
          {/* Ambient glow — gold-toned, unchanged by theme */}
          <div className="absolute inset-[-40px] rounded-full blur-3xl opacity-70" style={{ background: 'radial-gradient(60% 50% at 50% 50%, rgba(245,166,35,0.20), transparent 70%)' }} />
          {stack.map(({ img, tag }, i) => {
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
                    <span className="text-[9px] font-semibold tracking-widest text-white bg-black/75 rounded px-1.5 py-0.5">{tag}</span>
                    <span className="text-[9px] text-white bg-black/75 rounded px-1.5 py-0.5 tabular-nums">{i + 1}/{stack.length}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        )}
      </div>

      {/* TODAY'S PLAN + THIS WEEK */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-8">
        {/* Today's Plan */}
        <section>
          <div className="flex items-center justify-between mb-5">
            <div className="gravity-label">Today's plan</div>
            <div className="text-[11px] text-[var(--gv-text-muted)]">
              {todaysPlan.length} post{todaysPlan.length !== 1 ? 's' : ''} · {platformCount} platform{platformCount !== 1 ? 's' : ''}
            </div>
          </div>
          {todaysPlan.length === 0 ? (
            <div className="rounded-xl border border-[var(--gv-border-subtle)] p-8 text-center">
              <div className="text-[var(--gv-text-muted)] text-[14px]">No posts are scheduled for today. Open the calendar to schedule one.</div>
              <Link to="/content-calendar" className="mt-3 inline-block text-[12px] text-[var(--gv-accent-text)] hover:text-[var(--gv-accent-hover)] font-semibold">
                Open calendar →
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
            <div className="gravity-label">This week</div>
            <div className="text-[11px] text-[var(--gv-text-muted)]">{lastWeek ? `${lastWeek} compared with last week` : 'Monday to Sunday'}</div>
          </div>

          <div className="rounded-2xl border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] p-6 relative overflow-hidden">
            <div className="absolute -top-16 -right-10 w-40 h-40 rounded-full blur-3xl opacity-40" style={{ background: 'radial-gradient(circle, rgba(245,166,35,0.25), transparent 70%)' }} />
            <div className="relative">
              {/* Posts published — a number we can actually count. Reach and
                  engagement need real analytics; inventing them (this used to
                  render postedCount * 12.4 as "reach") is worse than blank. */}
              <div className="gravity-label mb-3">Published this week</div>
              <div className="flex items-baseline gap-2">
                {published?.available ? (
                  <span className="font-serif-display text-[56px] leading-none text-[var(--gv-text-primary)] tabular-nums">
                    {formatCount(published.value)}
                  </span>
                ) : (
                  <span className="text-[14px] text-[var(--gv-text-tertiary)]">
                    {loading ? 'Loading' : failed ? 'We could not load this. Please try again.' : (published?.reason || '')}
                  </span>
                )}
                {published?.available && planned !== null && planned > 0 && (
                  <span className="text-[15px] text-[var(--gv-text-tertiary)]">of {formatCount(planned)} planned</span>
                )}
              </div>
              <div className="text-[12px] text-[var(--gv-text-tertiary)] mt-3">
                {[weekPostsLine(summary?.week.posts), platformsLine(summary?.connected.platforms)].filter(Boolean).join(' · ')}
              </div>
            </div>
          </div>

        </section>
      </div>
    </div>
  );
};

export default GravityHome;
