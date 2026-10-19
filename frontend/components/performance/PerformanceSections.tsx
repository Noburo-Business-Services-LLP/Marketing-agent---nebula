import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarClock, ExternalLink, Film, Image as ImageIcon, Layers, Lightbulb, Sparkles, Type, X as Close } from 'lucide-react';
import { PlatformMark } from '../plan/PlanMarks';
import { SinglePostArt } from '../art';
import { setPrefill } from '../../utils/prefill';
import { sparkPath } from '../../utils/performanceView';
import {
  compareBars, heatStrip, insightHandoff, markOf, platformTile, postChips, shortDate, RANGES, TOP_TABS,
  type PerformanceView, type PvCompare, type PvInsight, type PvPost, type RangeKey, type TopKey,
} from '../../utils/performanceInsights';

// Sections of the Performance page below the KPI tiles: the range switch, one tile per platform, the top posts gallery
// and "What works". Everything is drawn from the one server answer (see utils/performanceInsights.ts).

export const Spark: React.FC<{ points: number[] | null; className?: string }> = ({ points, className }) => {
  const d = points ? sparkPath(points, 120, 32) : '';
  if (!d) return null;
  const last = d.split(' L').pop() || '';
  const [x, y] = last.replace(/^M/, '').split(' ').map(Number);
  return (
    <svg className={className || 'nb-perf-line'} viewBox="0 0 120 32" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d={d} />
      {Number.isFinite(x) && Number.isFinite(y) && <circle cx={x} cy={y} r="2.4" />}
    </svg>
  );
};

export const RangeSwitch: React.FC<{ value: RangeKey; onChange: (r: RangeKey) => void; disabled?: boolean }> = ({ value, onChange, disabled }) => (
  <div className="nb-pv-range" role="group" aria-label="Period">
    {RANGES.map((r) => (
      <button key={r.key} type="button" aria-pressed={value === r.key} disabled={disabled} onClick={() => onChange(r.key)}>{r.label}</button>
    ))}
  </div>
);

// ---- platforms ----------------------------------------------------------------------------------------------------------
const STATE_WORD: Record<string, string> = { ready: 'Connected', nodata: 'No data yet', notconnected: 'Not connected', error: 'Could not load' };

export const PlatformSection: React.FC<{ view: PerformanceView; selected: string | null; onSelect: (p: string | null) => void }> = ({ view, selected, onSelect }) => {
  const tiles = view.platforms.map((p) => platformTile(p, view.range.key, view.account.clientWorkspace));
  return (
    <section className="nb-pv-sec" aria-labelledby="nb-pv-platforms">
      <div className="nb-pv-sechead">
        <h2 id="nb-pv-platforms">By platform</h2>
        <p>{selected ? 'Everything below shows this platform only.' : 'Choose a platform to see only its numbers and posts.'}</p>
        {selected && (
          <button type="button" className="nb-pv-clear" onClick={() => onSelect(null)}><Close aria-hidden />All platforms</button>
        )}
      </div>
      <ul className="nb-pv-plats" data-count={tiles.length}>
        {tiles.map((t, i) => {
          const body = (
            <>
              <span className="nb-pv-plat-top">
                <PlatformMark platform={t.mark} size={30} />
                <span className="nb-pv-plat-name">{t.label}</span>
                <span className="nb-pv-state" data-state={t.state}>{STATE_WORD[t.state]}</span>
              </span>
              {t.state === 'notconnected' ? (
                <span className="nb-pv-plat-empty">
                  <span className="nb-pv-plat-reason">{t.reason}</span>
                </span>
              ) : (
                <>
                  <span className="nb-pv-plat-head">
                    {t.headline ? <span className="nb-pv-plat-big">{t.headline}</span> : null}
                    <span className="nb-pv-plat-unit">{t.headlineNote}</span>
                    {t.chip && <span className="nb-perf-chip" data-dir={t.chip.dir}>{t.chip.text}</span>}
                  </span>
                  <span className="nb-pv-plat-spark">{t.spark ? <Spark points={t.spark} /> : <span className="nb-perf-note">{t.state === 'ready' ? 'The line appears after two days of numbers.' : t.reason}</span>}</span>
                  <span className="nb-pv-stats">
                    {t.stats.map((s) => (
                      <span key={s.key} className="nb-pv-stat" title={s.reason || undefined}>
                        <span className="nb-pv-stat-label">{s.label}</span>
                        {s.value !== null ? <span className="nb-pv-stat-val">{s.value}</span> : <span className="nb-pv-stat-none">Not yet<span className="nb-sr">. {s.reason}</span></span>}
                      </span>
                    ))}
                  </span>
                </>
              )}
            </>
          );
          return (
            <li key={t.platform} className="nb-perf-in" style={{ ['--i' as any]: i + 5 }} data-platform={t.platform}>
              {t.selectable ? (
                <button type="button" className="nb-pv-plat" data-state={t.state} aria-pressed={selected === t.platform} aria-label={t.aria}
                  onClick={() => onSelect(selected === t.platform ? null : t.platform)}>{body}</button>
              ) : (
                <div className="nb-pv-plat" data-state={t.state} aria-label={t.aria} role="group">
                  {body}
                  {t.action && <Link className="nb-pv-plat-cta" to={t.action.to}>{t.action.text}<span className="nb-sr"> {t.label}</span><ArrowRight aria-hidden /></Link>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};

// ---- top posts ----------------------------------------------------------------------------------------------------------
const FORMAT_ICON: Record<string, typeof ImageIcon> = { video: Film, carousel: Layers, text: Type, image: ImageIcon };
const FORMAT_LABEL: Record<string, string> = { video: 'Video', carousel: 'Carousel', text: 'Text', image: 'Image' };

const PostCard: React.FC<{ post: PvPost; rank: number }> = ({ post, rank }) => {
  const Icon = FORMAT_ICON[post.format] || ImageIcon;
  const [broken, setBroken] = useState(false);
  const date = shortDate(post.date || post.publishedAt);
  return (
    <li className="nb-pv-post" data-format={post.format}>
      <span className="nb-pv-post-pic">
        {post.thumbnail && !broken
          ? <img src={post.thumbnail} alt="" width={320} height={200} loading="lazy" decoding="async" onError={() => setBroken(true)} />
          : <span className="nb-pv-post-art" aria-hidden="true"><SinglePostArt /></span>}
        <span className="nb-pv-rank" aria-label={`Number ${rank}`}>{rank}</span>
        <span className="nb-pv-post-mark"><PlatformMark platform={markOf(post.platform)} size={24} /></span>
        <span className="nb-pv-post-fmt"><Icon aria-hidden />{FORMAT_LABEL[post.format] || 'Post'}</span>
      </span>
      <span className="nb-pv-post-body">
        <span className="nb-pv-post-title">{post.title}</span>
        <span className="nb-pv-post-when">{post.platformLabel}{date ? `, ${date}` : ''}</span>
        <span className="nb-pv-chips">
          {postChips(post).map((c) => <span key={c.key} className="nb-pv-chip" data-lead={c.lead || undefined}>{c.text}</span>)}
        </span>
        {post.url
          ? <a className="nb-pv-open" href={post.url} target="_blank" rel="noopener noreferrer">Open post<ExternalLink aria-hidden /><span className="nb-sr"> (opens {post.platformLabel} in a new tab)</span></a>
          : <span className="nb-pv-open nb-pv-open-none">No link was stored for this post</span>}
      </span>
    </li>
  );
};

export const TopPostsSection: React.FC<{ view: PerformanceView }> = ({ view }) => {
  const [tab, setTab] = useState<TopKey>('engagement');
  const list = view.topPosts.lists[tab] || { posts: [], reason: view.topPosts.reason };
  const empties = Math.max(0, 3 - list.posts.length);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const n = TOP_TABS.length;
    const go = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (go < 0) return;
    e.preventDefault();
    setTab(TOP_TABS[go].key);
    (document.getElementById(`nb-pv-tab-${TOP_TABS[go].key}`) as HTMLButtonElement | null)?.focus();
  };
  return (
    <section className="nb-pv-sec" aria-labelledby="nb-pv-top">
      <div className="nb-pv-sechead">
        <h2 id="nb-pv-top">Top posts {view.range.words}</h2>
        <p>{view.topPosts.measured ? `From ${view.topPosts.measured} measured ${view.topPosts.measured === 1 ? 'post' : 'posts'}. Each post is measured a day, three days and a week after it goes out.` : 'Posts show here once they have been measured.'}</p>
      </div>
      <div className="nb-pv-tabs" role="tablist" aria-label="Rank posts by">
        {TOP_TABS.map((t, i) => (
          <button key={t.key} id={`nb-pv-tab-${t.key}`} type="button" role="tab" aria-selected={tab === t.key} aria-controls="nb-pv-gallery" tabIndex={tab === t.key ? 0 : -1}
            onClick={() => setTab(t.key)} onKeyDown={(e) => onKey(e, i)}>{t.label}</button>
        ))}
      </div>
      <div id="nb-pv-gallery" role="tabpanel" aria-labelledby={`nb-pv-tab-${tab}`}>
        {list.posts.length === 0 ? (
          <div className="nb-pv-empty">
            <span className="nb-pv-empty-art" aria-hidden="true"><SinglePostArt /></span>
            <p>{list.reason || view.topPosts.reason || 'No measured post in this period yet.'}</p>
            <Link to="/campaigns" className="nb-perf-cta">Create a post <ArrowRight aria-hidden /></Link>
          </div>
        ) : (
          <ul className="nb-pv-gallery">
            {list.posts.map((p, i) => <PostCard key={`${tab}-${p.id}`} post={p} rank={i + 1} />)}
            {[...Array(empties)].map((_, i) => (
              <li key={`slot-${i}`} className="nb-pv-post nb-pv-slot" aria-hidden="true">
                <span className="nb-pv-slot-in"><Sparkles aria-hidden /><span>Room for your next measured post</span></span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};

// ---- what works ---------------------------------------------------------------------------------------------------------
const Bars: React.FC<{ c: PvCompare; unit: string }> = ({ c, unit }) => {
  const bars = compareBars(c);
  return (
    <ul className="nb-pv-bars" aria-label={`Average ${unit} by format`}>
      {bars.map((b) => {
        const Icon = FORMAT_ICON[b.format || 'image'] || ImageIcon;
        return (
          <li key={b.label} data-best={b.best || undefined}>
            <span className="nb-pv-bar-label"><Icon aria-hidden />{b.label}<span className="nb-pv-bar-n">{b.posts} {b.posts === 1 ? 'post' : 'posts'}</span></span>
            <span className="nb-pv-bar-track"><span className="nb-pv-bar-fill" style={{ width: `${b.width}%` }} /></span>
            <span className="nb-pv-bar-val">{Math.round(b.average as number)} {unit}</span>
          </li>
        );
      })}
    </ul>
  );
};

const Heat: React.FC<{ c: PvCompare; label: string; short?: (r: any) => string }> = ({ c, label, short }) => (
  <ul className="nb-pv-heat" aria-label={label} style={{ ['--n' as any]: c.rows.length || 7 }}>
    {heatStrip(c).map((h) => (
      <li key={h.label} data-level={h.level} data-best={c.best && c.best.label === h.label ? 'true' : undefined}
        title={h.posts ? `${h.label}: ${Math.round(h.average as number)} on average from ${h.posts} ${h.posts === 1 ? 'post' : 'posts'}` : `${h.label}: no post`}>
        <span className="nb-pv-heat-cell" aria-hidden="true" />
        <span className="nb-pv-heat-label">{short ? short(h) : h.label}</span>
        <span className="nb-sr">{h.posts ? `${Math.round(h.average as number)} on average from ${h.posts} posts` : 'no post'}</span>
      </li>
    ))}
  </ul>
);

const InsightCard: React.FC<{ insight: PvInsight; index: number }> = ({ insight, index }) => {
  const navigate = useNavigate();
  const h = insightHandoff(insight.action);
  const posts = Number((insight.evidence as any)?.posts) || 0;
  const days = Number((insight.evidence as any)?.days) || 0;
  const make = () => {
    if (!h) return;
    if (h.target === 'video') setPrefill('video', h.data); else setPrefill('carousel', h.data);
    navigate(h.route);
  };
  return (
    <li className="nb-pv-insight nb-perf-in" data-tone={insight.tone} style={{ ['--i' as any]: index + 12 }}>
      <span className="nb-pv-insight-icon" aria-hidden="true"><Lightbulb /></span>
      <p className="nb-pv-insight-text">{insight.text}</p>
      <span className="nb-pv-insight-foot">
        <span className="nb-pv-evidence">{posts ? `Based on ${posts} ${posts === 1 ? 'post' : 'posts'}` : days ? `Based on ${days} daily numbers` : 'From your stored numbers'}</span>
        {h && <button type="button" className="nb-pv-make" onClick={make}>Make a post like this<ArrowRight aria-hidden /></button>}
      </span>
    </li>
  );
};

export const WhatWorksSection: React.FC<{ view: PerformanceView }> = ({ view }) => {
  const unit = view.byFormat.metric === 'likes' ? 'likes' : 'engagement';
  const dayShort = (r: any) => String(r.label).slice(0, 3);
  return (
    <section className="nb-pv-sec" aria-labelledby="nb-pv-works">
      <div className="nb-pv-sechead">
        <h2 id="nb-pv-works">What works</h2>
        <p>Worked out from your measured posts {view.range.words}. A finding shows only when enough posts back it.</p>
      </div>
      <div className="nb-pv-works">
        <div className="nb-pv-card" data-tone="gold">
          <h3><Layers aria-hidden />Formats</h3>
          {view.byFormat.available ? <Bars c={view.byFormat} unit={unit === 'likes' ? 'likes' : 'engagement'} /> : (
            <>
              {compareBars(view.byFormat).length > 0 && <Bars c={view.byFormat} unit={unit} />}
              <p className="nb-perf-reason">{view.byFormat.reason}</p>
            </>
          )}
        </div>
        <div className="nb-pv-card" data-tone="teal">
          <h3><CalendarClock aria-hidden />Best day and time</h3>
          {view.byDay.available ? (
            <>
              <Heat c={view.byDay} label="Average engagement by day of the week" short={dayShort} />
              <Heat c={view.byTime} label="Average engagement by time of day" short={(r) => r.label} />
              <p className="nb-pv-best">
                {view.byDay.best ? <><strong>{view.byDay.best.label}</strong> is your best day</> : view.byDay.reason}
                {view.byTime.best ? <>, the <strong>{String(view.byTime.best.label).toLowerCase()}</strong> ({view.byTime.best.hours}) your best time.</> : view.byDay.best ? '.' : ''}
              </p>
              <p className="nb-perf-note">India time. Darker means more engagement on average.</p>
            </>
          ) : <p className="nb-perf-reason">{view.byDay.reason}</p>}
        </div>
      </div>
      <h3 className="nb-pv-subhead"><Lightbulb aria-hidden />What to try next</h3>
      {view.insights.length ? (
        <ul className="nb-pv-insights">{view.insights.map((x, i) => <InsightCard key={x.id} insight={x} index={i} />)}</ul>
      ) : (
        <div className="nb-pv-empty nb-pv-empty-inline"><p>{view.insightsReason}</p></div>
      )}
    </section>
  );
};
