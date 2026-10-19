import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDownRight, ArrowRight, ArrowUpRight, CalendarCheck, Check, ClipboardCheck, Eye, Heart, ImageIcon, MessageCircle, Minus, Users, Wallet } from 'lucide-react';
import type { HomeSummary } from '../../types';
import CoverTile, { type CoverPalette } from '../CoverTile';
import TileGrid from '../TileGrid';
import { SinglePostArt, CarouselArt, CampaignArt, VideoArt, PhotoshootArt } from '../art';
import { PackProductArt, PackMarketplaceArt, PackFestivalArt, PackLifestyleArt, PackFlatLayArt, PackWhiteArt } from '../art/packs';
import { photoshootAPI } from '../../services/api';
import { PACK_PALETTE, type PhotoshootCatalogue } from '../../utils/photoshoot';
import { createPhoto, packPhoto } from '../../utils/samplePhotos';
import { setPrefill } from '../../utils/prefill';
import { todayRows } from '../../utils/home';
import {
  numberTiles, numbersMode, actionRows, balanceView, describeHandoff, createTileHandoff, statusWord, packRailItems,
  HOME_CREATE_TILES, HOME_DESCRIBE_TABS, DESCRIBE_MAX, type Banner, type HomeCreateKey, type NumberKey,
} from '../../utils/homeLayout';
import '../ideaBox.css';

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
    <section className="nb-home-next" aria-labelledby="home-next-title">
      <p className="nb-home-next-eyebrow">{isNew ? 'Start here' : 'Do this next'}</p>
      <div className="nb-home-dp-head">
        <h2 id="home-next-title">{isNew ? 'Your first steps' : rows.length ? 'What needs you' : summary.plan?.state === 'building' ? 'Nothing for now' : 'All caught up'}</h2>
        {rows.length > 1 && <span>{rows.length} things</span>}
      </div>
      {rows.length === 0 ? (
        <p className="nb-home-dp-empty"><Check size={16} strokeWidth={2.6} aria-hidden="true" />{summary.plan?.state === 'building' ? 'Nothing needs you while your plan is being built. Your next steps appear here when it is ready.' : 'You are up to date. New suggestions appear here as they come up.'}</p>
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
  single: <SinglePostArt />, carousel: <CarouselArt />, campaign: <CampaignArt />, video: <VideoArt />, photoshoot: <PhotoshootArt />,
};
// The same colour grade per kind as on Create content.
const HOME_PALETTE: Record<HomeCreateKey, CoverPalette> = { single: 'gold', carousel: 'teal', campaign: 'coral', video: 'ink', photoshoot: 'plum' };
const PACK_ART: Record<string, React.ReactNode> = {
  product: <PackProductArt />, marketplace: <PackMarketplaceArt />, festival: <PackFestivalArt />,
  lifestyle: <PackLifestyleArt />, flatlay: <PackFlatLayArt />, white: <PackWhiteArt />,
};

/** The Photoshoot packs from the server (prices from config/apiCosts.js), loaded once per visit. Null while loading or on failure. */
function usePhotoshootPacks(enabled: boolean): PhotoshootCatalogue | null {
  const [packs, setPacks] = useState<PhotoshootCatalogue | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    photoshootAPI.packs().then((c) => { if (live && c && Array.isArray(c.packs)) setPacks(c); }).catch(() => undefined);
    return () => { live = false; };
  }, [enabled]);
  return packs;
}

type DescribeTab = 'post' | 'video' | 'photoshoot';

export const CreateToday: React.FC<{ language?: string | null; postsOnly?: boolean; showPacks?: boolean }> = ({ language, postsOnly = false, showPacks = true }) => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<DescribeTab>('post');
  const [text, setText] = useState('');
  const catalogue = usePhotoshootPacks(showPacks);
  const rail = packRailItems(catalogue, postsOnly);
  const open = (key: HomeCreateKey) => {
    const h = createTileHandoff(key);
    if (h.target && h.data) setPrefill(h.target, h.data);
    navigate(h.route);
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (tab === 'photoshoot') { navigate('/photoshoot'); return; }
    const h = describeHandoff(tab, text, language);
    if (!h) return;
    if (h.target === 'video') setPrefill('video', h.data); else setPrefill('carousel', h.data);
    navigate(h.route);
  };
  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = HOME_DESCRIBE_TABS.findIndex((t) => t.key === tab);
    const next = HOME_DESCRIBE_TABS[(i + (e.key === 'ArrowRight' ? 1 : HOME_DESCRIBE_TABS.length - 1)) % HOME_DESCRIBE_TABS.length].key;
    setTab(next);
    document.getElementById(`home-tab-${next}`)?.focus();
  };
  return (
    <section className="nb-home-card nb-home-create" aria-labelledby="home-create-title">
      <div className="nb-home-label"><h2 id="home-create-title">What will you create today?</h2></div>
      <TileGrid columns={5} size="small" label="Choose what to make">
        {/* Compact cover tiles with the same sample photos as Create content (the drawn art until a photo has loaded). */}
        {HOME_CREATE_TILES.map((t) => (
          t.key === 'video' || t.key === 'photoshoot'
            ? <CoverTile key={t.key} title={t.title} subtitle={t.subtitle} palette={HOME_PALETTE[t.key]} art={CREATE_ART[t.key]} image={createPhoto(t.key)} overlay={t.key === 'video' ? 'play' : undefined} to={createTileHandoff(t.key).route} />
            : <CoverTile key={t.key} title={t.title} subtitle={t.subtitle} palette={HOME_PALETTE[t.key]} art={CREATE_ART[t.key]} image={createPhoto(t.key)} overlay={t.key === 'carousel' ? 'slides' : undefined} onClick={() => open(t.key)} />
        ))}
      </TileGrid>
      <form className="nb-home-describe nb-ideabox" onSubmit={submit}>
        <div className="nb-home-tabs" role="tablist" aria-label="What to make from your idea">
          {HOME_DESCRIBE_TABS.map((t) => (
            <button key={t.key} id={`home-tab-${t.key}`} type="button" role="tab" className="nb-home-tab" aria-selected={tab === t.key} aria-controls="home-describe-panel" tabIndex={tab === t.key ? 0 : -1} onKeyDown={onTabKey} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
        <div id="home-describe-panel" role="tabpanel" aria-labelledby={`home-tab-${tab}`}>
        {tab === 'photoshoot' ? (
          <div className="nb-home-ps-tab">
            <p className="nb-home-quiet">Photoshoots use ready-made packs of your product photos, so there is nothing to type. Pick a pack to start.</p>
            {rail.length > 0 && (
              <div className="nb-home-ps-chips" role="group" aria-label="Photoshoot packs">
                {rail.map((r) => <Link key={r.key} to={r.to} className="nb-home-ps-chip">{r.title}</Link>)}
              </div>
            )}
          </div>
        ) : (
          <>
            <label htmlFor="home-describe" className="sr-only">Describe what you want</label>
            <textarea
              id="home-describe" className="nb-ideabox-field gravity-bare" value={text} maxLength={DESCRIBE_MAX} rows={2}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit(); } }}
              placeholder={tab === 'post' ? 'Describe what you want, for example a post about this weekend\'s offer' : 'Describe the video, for example a short look behind the counter'}
            />
          </>
        )}
        </div>
        <div className="nb-home-describe-foot">
          <span>{tab === 'post' ? 'Opens Create content with your idea filled in.' : tab === 'video' ? 'Opens Videos with your idea filled in.' : 'Opens Photoshoot, where you choose products and see the price first.'}</span>
          <button type="submit" className="nb-home-btn" data-primary="true" disabled={tab !== 'photoshoot' && !text.trim()}>{tab === 'photoshoot' ? 'Open Photoshoot' : 'Continue'}<ArrowRight size={14} aria-hidden="true" /></button>
        </div>
      </form>
      {rail.length > 0 && (
        <div className="nb-home-packs" aria-labelledby="home-packs-title">
          <div className="nb-home-label">
            <h2 id="home-packs-title">Ready-made photoshoot packs</h2>
            <Link to="/photoshoot" className="nb-home-link">See all</Link>
          </div>
          <div className="nb-home-packs-rail" role="list">
            {rail.map((r) => (
              <div key={r.key} role="listitem" className="nb-home-packs-item">
                <CoverTile title={r.title} subtitle={r.line} price={r.price || undefined} palette={PACK_PALETTE[r.key] || 'plum'} art={PACK_ART[r.key] || <PhotoshootArt />} image={packPhoto(r.key)} to={r.to} />
              </div>
            ))}
          </div>
        </div>
      )}
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
