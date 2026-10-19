import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDownRight, ArrowRight, ArrowUpRight, CalendarCheck, Check, ClipboardCheck, Eye, Heart, ImageIcon, MessageCircle, Minus, Swords, Users, Wallet } from 'lucide-react';
import type { HomeSummary } from '../../types';
import Tile from '../Tile';
import TileGrid from '../TileGrid';
import { SinglePostArt, CarouselArt, CampaignArt, VideoArt } from '../art';
import { setPrefill } from '../../utils/prefill';
import { todayRows } from '../../utils/home';
import {
  numberTiles, numbersMode, actionRows, balanceView, competitorsStrip, describeHandoff, createTileHandoff, statusWord,
  HOME_CREATE_TILES, DESCRIBE_MAX, type Banner, type HomeCreateKey, type NumberKey,
} from '../../utils/homeLayout';

// The blocks of the Home control room. Each block renders from the summary alone and fails alone.

const NUMBER_ICON: Record<NumberKey, React.FC<{ 'aria-hidden'?: boolean | 'true' }>> = {
  reach: Eye, engagement: Heart, followers: Users, posts: CalendarCheck, drafts: ClipboardCheck, messages: MessageCircle,
};
const CHIP_ICON = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus } as const;

export const BalanceChip: React.FC<{ summary: HomeSummary }> = ({ summary }) => {
  const b = balanceView(summary);
  return (
    <div className="nb-home-balance" role="group" aria-label="Your balance">
      <span className="nb-home-balance-mark" aria-hidden="true"><Wallet size={15} strokeWidth={2.2} /></span>
      <span style={{ minWidth: 0 }}>
        <span className="nb-home-balance-label">{b.label}</span>
        <span className="nb-home-balance-main">
          {b.main}
          {b.side && <span className="nb-home-balance-side">{b.side}</span>}
        </span>
      </span>
      {b.link && <Link to={b.link.to} className="nb-home-link">{b.link.text}</Link>}
    </div>
  );
};

export const PlanBanner: React.FC<{ banner: Banner }> = ({ banner }) => (
  <div className="nb-home-banner" data-tone={banner.tone} role="status">
    <p>{banner.text}</p>
    {banner.action && <Link to={banner.action.to} className="nb-home-btn">{banner.action.label}</Link>}
  </div>
);

export const NumbersStrip: React.FC<{ summary: HomeSummary }> = ({ summary }) => {
  if (numbersMode(summary) === 'quiet') {
    const free = summary.account?.free;
    const client = summary.account?.clientWorkspace;
    return (
      <section aria-label="Your numbers" className="nb-home-card nb-home-numbers-quiet">
        <span className="nb-home-mark" data-mark="reach" aria-hidden="true"><Eye /></span>
        <p>{free && !client
          ? 'Reach, followers and engagement appear here once your accounts are connected. Connecting accounts comes with a paid plan.'
          : 'Reach, followers and engagement appear here once your accounts are connected.'}</p>
        {free && !client
          ? <Link to="/trial-expired" className="nb-home-btn">See plans</Link>
          : <Link to="/connect-socials" className="nb-home-btn">Connect an account</Link>}
      </section>
    );
  }
  const tiles = numberTiles(summary);
  return (
    <section aria-label="Your numbers this week">
      <ul className="nb-home-numbers">
        {tiles.map((t) => {
          const Icon = NUMBER_ICON[t.key];
          const top = (
            <span className="nb-home-num-top">
              <span className="nb-home-mark" data-mark={t.key} aria-hidden="true"><Icon aria-hidden="true" /></span>
              <span className="nb-home-num-title">{t.title}</span>
            </span>
          );
          if (t.value === null) {
            return (
              <li key={t.key}>
                <div className="nb-home-num" aria-label={t.label} role="group">
                  {top}
                  <p className="nb-home-num-why">{t.prompt?.text}</p>
                  {t.prompt?.link && <Link to={t.prompt.link.to} className="nb-home-link">{t.prompt.link.text}</Link>}
                </div>
              </li>
            );
          }
          const ChipIcon = t.chip ? CHIP_ICON[t.chip.dir] : null;
          const body = (
            <>
              {top}
              <span className="nb-home-num-row" aria-hidden="true">
                <span className="nb-home-num-value">{t.value}</span>
                {t.chip && ChipIcon && <span className="nb-home-chip" data-dir={t.chip.dir}><ChipIcon aria-hidden="true" />{t.chip.text}</span>}
              </span>
            </>
          );
          return (
            <li key={t.key}>
              {t.to
                ? <Link to={t.to} className="nb-home-num" aria-label={t.label}>{body}</Link>
                : <div className="nb-home-num" role="group" aria-label={t.label}>{body}</div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export const DoThisNext: React.FC<{ summary: HomeSummary; planBannerShown: boolean; isNew: boolean }> = ({ summary, planBannerShown, isNew }) => {
  const rows = actionRows(summary.nextActions, { planBanner: planBannerShown });
  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    let smooth = true;
    try { smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* default */ }
    el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
    const focusable = el.querySelector<HTMLElement>('h2') || el;
    if (!focusable.hasAttribute('tabindex')) focusable.setAttribute('tabindex', '-1');
    focusable.focus({ preventScroll: true });
  };
  return (
    <section className="nb-darkpanel nb-home-darkpanel" data-nb-surface="dark" aria-labelledby="home-next-title">
      <p className="nb-darkpanel-eyebrow">{isNew ? 'Start here' : 'Do this next'}</p>
      <div className="nb-home-dp-head">
        <h2 id="home-next-title">{isNew ? 'Your first steps' : rows.length ? 'What needs you' : summary.plan?.state === 'building' ? 'Nothing for now' : 'All caught up'}</h2>
        {rows.length > 1 && <span>{rows.length} things</span>}
      </div>
      {rows.length === 0 ? (
        <p className="nb-home-dp-empty"><Check size={16} strokeWidth={2.6} aria-hidden="true" style={{ color: '#FFCB2E' }} />{summary.plan?.state === 'building' ? 'Nothing needs you while your plan is being built. Your next steps appear here when it is ready.' : 'You are up to date. New suggestions appear here as they come up.'}</p>
      ) : (
        <ol className="nb-home-actions">
          {rows.map((r, i) => (
            <li key={r.id} className="nb-home-action" data-primary={r.primary ? 'true' : undefined}>
              <span className="nb-home-action-num" aria-hidden="true">{i + 1}</span>
              <div className="nb-home-action-body">
                <div className="nb-home-action-title">
                  <span>{r.title}</span>
                  {r.count !== null && <span className="nb-home-action-count" aria-hidden="true">{r.count > 99 ? '99+' : r.count}</span>}
                </div>
                {r.detail && <p className="nb-home-action-detail">{r.detail}</p>}
              </div>
              {r.to && <Link to={r.to} className="nb-home-btn" data-primary={r.primary ? 'true' : undefined} aria-label={`${r.button}: ${r.title}`}><span className="nb-home-btn-text">{r.button}</span><ArrowRight className="nb-home-btn-icon" size={16} aria-hidden="true" /></Link>}
              {r.scrollTo && <button type="button" className="nb-home-btn" data-primary={r.primary ? 'true' : undefined} onClick={() => scrollTo(r.scrollTo as string)} aria-label={`${r.button}: ${r.title}`}><span className="nb-home-btn-text">{r.button}</span><ArrowRight className="nb-home-btn-icon" size={16} aria-hidden="true" /></button>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};

const CREATE_ART: Record<HomeCreateKey, React.ReactNode> = {
  single: <SinglePostArt />, carousel: <CarouselArt />, campaign: <CampaignArt />, video: <VideoArt />,
};

export const CreateToday: React.FC<{ language?: string | null }> = ({ language }) => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'post' | 'video'>('post');
  const [text, setText] = useState('');
  const open = (key: HomeCreateKey) => {
    const h = createTileHandoff(key);
    if (h.target && h.data) setPrefill(h.target, h.data);
    navigate(h.route);
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const h = describeHandoff(tab, text, language);
    if (!h) return;
    if (h.target === 'video') setPrefill('video', h.data); else setPrefill('carousel', h.data);
    navigate(h.route);
  };
  const tabs: Array<{ key: 'post' | 'video'; label: string }> = [{ key: 'post', label: 'Post' }, { key: 'video', label: 'Video' }];
  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = tab === 'post' ? 'video' : 'post';
    setTab(next);
    document.getElementById(`home-tab-${next}`)?.focus();
  };
  return (
    <section className="nb-home-card nb-home-create" aria-labelledby="home-create-title">
      <div className="nb-home-label"><h2 id="home-create-title">What will you create today?</h2></div>
      <TileGrid columns={4} size="small" label="Choose what to make">
        {HOME_CREATE_TILES.map((t) => (
          t.key === 'video'
            ? <Tile key={t.key} variant="choice" title={t.title} subtitle={t.subtitle} accent={t.accent} art={CREATE_ART[t.key]} to="/reels" />
            : <Tile key={t.key} variant="choice" title={t.title} subtitle={t.subtitle} accent={t.accent} art={CREATE_ART[t.key]} onClick={() => open(t.key)} />
        ))}
      </TileGrid>
      <form className="nb-home-describe" onSubmit={submit}>
        <div className="nb-home-tabs" role="tablist" aria-label="What to make from your idea">
          {tabs.map((t) => (
            <button key={t.key} id={`home-tab-${t.key}`} type="button" role="tab" className="nb-home-tab" aria-selected={tab === t.key} aria-controls="home-describe-panel" tabIndex={tab === t.key ? 0 : -1} onKeyDown={onTabKey} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
        <div id="home-describe-panel" role="tabpanel" aria-labelledby={`home-tab-${tab}`}>
        <label htmlFor="home-describe" className="sr-only">Describe what you want</label>
        <textarea
          id="home-describe" value={text} maxLength={DESCRIBE_MAX} rows={2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit(); } }}
          placeholder={tab === 'post' ? 'Describe what you want, for example a post about this weekend\'s offer' : 'Describe the video, for example a short look behind the counter'}
        />
        </div>
        <div className="nb-home-describe-foot">
          <span>{tab === 'post' ? 'Opens Create content with your idea filled in.' : 'Opens Videos with your idea filled in.'}</span>
          <button type="submit" className="nb-home-btn" data-primary="true" disabled={!text.trim()}>Continue<ArrowRight size={14} aria-hidden="true" /></button>
        </div>
      </form>
    </section>
  );
};

export const TodayPlan: React.FC<{ summary: HomeSummary; failed: boolean }> = ({ summary, failed }) => {
  const rows = todayRows(summary.today);
  const platforms = summary.connected?.platforms?.length || 0;
  return (
    <section className="nb-home-card" aria-labelledby="home-today-title">
      <div className="nb-home-label">
        <h2 id="home-today-title">Today's plan</h2>
        {!failed && rows.length > 0 && <span>{rows.length} {rows.length === 1 ? 'post' : 'posts'}{platforms ? `, ${platforms} ${platforms === 1 ? 'platform' : 'platforms'}` : ''}</span>}
      </div>
      {failed ? (
        <p className="nb-home-quiet" role="status">We could not load today's posts just now. Please try again in a moment.</p>
      ) : rows.length === 0 ? (
        <p className="nb-home-quiet">Nothing is scheduled for today. <Link to="/content-calendar" className="nb-home-link">Open the calendar</Link></p>
      ) : (
        <ul className="nb-home-today">
          {rows.map((r) => {
            const word = statusWord(r.status);
            return (
              <li key={r.id}>
                <span className="nb-home-today-time">{r.time}</span>
                <span className="nb-home-thumb" aria-hidden="true">
                  {r.image ? <img src={r.image} alt="" width={36} height={36} loading="lazy" decoding="async" /> : <ImageIcon size={15} />}
                </span>
                <span className="nb-home-today-text">
                  <span className="nb-home-today-title" title={r.title}>{r.title}</span>
                  {r.subtitle && <span className="nb-home-today-sub" title={r.subtitle}>{r.subtitle}</span>}
                </span>
                <span className="nb-home-status" data-status={word}>{word}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export const CompetitorsStrip: React.FC<{ summary: HomeSummary }> = ({ summary }) => {
  if ((summary.degraded || []).includes('competitors')) return null;
  const c = competitorsStrip(summary.competitors);
  if (!c) return null;
  return (
    <Link to={c.to} className="nb-home-card nb-home-strip">
      <span className="nb-home-mark" data-mark="competitors" aria-hidden="true"><Swords /></span>
      <span className="nb-home-strip-text">
        <span className="nb-home-strip-title">{c.title}</span>
        <span className="nb-home-strip-sub">{c.detail}</span>
      </span>
      <ArrowRight size={16} className="nb-home-go" aria-hidden="true" />
    </Link>
  );
};

/** Fixed-size grey shapes in the place of each block while the first answer is on its way, so nothing moves when it arrives. */
export const Skeleton: React.FC<{ kind: 'numbers' | 'next' | 'today' }> = ({ kind }) => {
  if (kind === 'numbers') {
    return (
      <ul className="nb-home-numbers" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => <li key={i}><div className="nb-home-skel" style={{ height: 96 }} /></li>)}
      </ul>
    );
  }
  return <div className="nb-home-skel" aria-hidden="true" style={kind === 'next' ? { height: 300, borderRadius: 18 } : { height: 150, borderRadius: 16 }} />;
};
