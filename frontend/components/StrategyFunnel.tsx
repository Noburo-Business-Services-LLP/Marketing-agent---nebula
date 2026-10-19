import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronDown, Gauge, Layers, MessageSquareQuote, Package, PieChart, Route, Share2, Store, Users } from 'lucide-react';
import { tagLabel } from '../utils/plan';
import { STATUS_TEXT, readyCount, type LevelId, type LevelItem, type LevelStatus, type StrategyLevel } from '../utils/strategyLevels';

/**
 * The strategy on one screen, read top to bottom: nine compact levels that narrow like a funnel and are joined by a
 * thin connector. Each level opens in place to show its details. The number badge is there because the order is the
 * point: the business comes first, the numbers to watch come last.
 */

const ICONS: Record<LevelId, React.FC<{ className?: string; style?: React.CSSProperties; 'aria-hidden'?: boolean }>> = {
  business: Store, products: Package, customers: Users, positioning: MessageSquareQuote, mix: PieChart,
  channels: Share2, content: Layers, roadmap: Route, numbers: Gauge,
};

const CHIP: Record<LevelStatus, { bg: string; text: string }> = {
  ready: { bg: 'var(--gv-mint)', text: STATUS_TEXT.ready },
  thin: { bg: 'var(--gv-peach)', text: STATUS_TEXT.thin },
  missing: { bg: 'var(--gv-surface-2)', text: STATUS_TEXT.missing },
};
const TAG_BG: Record<string, string> = { verified: 'var(--gv-mint)', inference: 'var(--gv-sky)', proposed: 'var(--gv-lav)', unverified: 'var(--gv-peach)' };
const PAID = '#7FA7D6';
const INK = { color: 'var(--gv-text-primary)' } as const;
const QUIET = { color: 'var(--gv-text-secondary)' } as const;

/** Ready is said quietly; a level that needs work gets a filled chip so it stands out. Always in words. */
const StatusChip: React.FC<{ status: LevelStatus }> = ({ status }) => (status === 'ready' ? (
  <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11.5px] font-medium leading-[18px]" style={{ color: 'var(--gv-text-secondary)' }}>
    <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#2E9D6A' }} aria-hidden="true" />{CHIP.ready.text}
  </span>
) : (
  <span
    className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-px text-[11px] font-semibold leading-[18px]"
    style={{ background: CHIP[status].bg, color: 'var(--gv-text-primary)', border: '1px solid var(--gv-border-subtle)' }}
  >{CHIP[status].text}</span>
));

const TagChip: React.FC<{ tag?: string }> = ({ tag }) => (tag ? (
  <span
    className="ml-1.5 inline-flex items-center whitespace-nowrap rounded-full px-1.5 text-[10.5px] font-semibold leading-[17px] align-[1px]"
    style={{ background: TAG_BG[tag] || TAG_BG.proposed, color: 'var(--gv-text-primary)' }}
  >{tagLabel(tag)}</span>
) : null);

const SplitBar: React.FC<{ organic: number; paid: number }> = ({ organic, paid }) => (
  <span className="flex h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--gv-surface-2)' }} aria-hidden="true">
    <span style={{ width: `${organic}%`, background: 'var(--gv-accent)' }} />
    <span style={{ width: `${paid}%`, background: PAID }} />
  </span>
);

const ItemBody: React.FC<{ it: LevelItem; first: boolean }> = ({ it, first }) => (
  <>
    <p className={`${first ? 'mt-0.5' : 'mt-1.5'} text-[13.5px] leading-relaxed break-words`} style={INK}>{it.text}<TagChip tag={it.tag} /></p>
    {it.bullets && it.bullets.length > 0 && (
      <ul className="mt-1 space-y-0.5">
        {it.bullets.map((b, i) => (
          <li key={i} className="flex gap-2 text-[13px] leading-relaxed break-words" style={INK}>
            <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full" style={{ background: 'var(--gv-accent)' }} aria-hidden="true" /><span className="min-w-0">{b}</span>
          </li>
        ))}
      </ul>
    )}
    {it.sub && it.sub.length > 0 && (
      <dl className={`mt-2 grid gap-x-4 gap-y-1.5 ${it.sub.length === 2 && it.sub[0].label === 'Nebulaa does' ? 'sm:grid-cols-2' : ''}`}>
        {it.sub.map((s, i) => (
          <div key={i} className="min-w-0">
            <dt className="text-[11px] font-semibold" style={{ color: 'var(--gv-accent-text)' }}>{s.label}</dt>
            <dd className="text-[13px] leading-relaxed break-words" style={INK}>{s.text}</dd>
          </div>
        ))}
      </dl>
    )}
  </>
);

/** One box per label: several claims under the same heading ("Where you are today") share it. */
const ItemGroup: React.FC<{ group: LevelItem[] }> = ({ group }) => {
  const head = group[0];
  return (
    <li
      className="min-w-0 rounded-lg px-3 py-2"
      style={head.current ? { background: 'var(--gv-accent-fill)', boxShadow: 'inset 2px 0 0 var(--gv-accent)' } : { background: 'rgb(var(--gv-ink-rgb) / 0.025)' }}
    >
      {head.label && (
        <p className="flex flex-wrap items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.04em] break-words" style={QUIET}>
          {head.label}
          {head.current && <span className="rounded-full px-1.5 text-[10.5px] normal-case tracking-normal leading-[17px]" style={{ background: 'var(--gv-accent)', color: 'var(--gv-accent-ink)' }}>You are here</span>}
          {head.offline && <span className="rounded-full px-1.5 text-[10.5px] normal-case tracking-normal leading-[17px]" style={{ background: 'var(--gv-surface-2)', color: 'var(--gv-text-primary)' }}>Offline</span>}
        </p>
      )}
      {group.map((it, i) => <ItemBody key={i} it={it} first={i === 0} />)}
    </li>
  );
};

function groupItems(items: LevelItem[]): LevelItem[][] {
  const out: LevelItem[][] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && it.label && last[0].label === it.label && !it.current && !it.offline) last.push(it);
    else out.push([it]);
  }
  return out;
}

const Level: React.FC<{ level: StrategyLevel; index: number; total: number; open: boolean; onToggle: () => void }> = ({ level, index, total, open, onToggle }) => {
  const Icon = ICONS[level.id];
  const panelId = `funnel-panel-${level.id}`;
  const missing = level.status === 'missing';
  const splits = level.items.filter((it) => it.split);
  const rest = level.items.filter((it) => !it.split);
  // The funnel narrows a little with each level on wider screens; on a phone every level is full width.
  const width = `${100 - Math.round((index * 22) / Math.max(1, total - 1))}%`;
  return (
    <li className="nb-funnel-level relative mx-auto w-full md:w-[var(--nb-funnel-w)]" style={{ ['--nb-funnel-w' as any]: width }}>
      {index > 0 && <span className="mx-auto block h-3 w-px" style={{ background: 'rgb(var(--gv-accent-rgb) / 0.55)' }} aria-hidden="true" />}
      <div
        className="rounded-xl transition-shadow"
        style={{
          background: missing ? 'transparent' : 'var(--gv-panel)',
          border: missing ? '1px dashed var(--gv-border-default)' : '1px solid var(--gv-border-subtle)',
          boxShadow: open ? '0 6px 20px rgb(var(--gv-ink-rgb) / 0.07)' : '0 1px 2px rgb(var(--gv-ink-rgb) / 0.04)',
        }}
      >
        <h3 className="m-0">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={panelId}
            className="flex w-full min-h-[52px] items-center gap-2.5 rounded-xl px-2.5 py-2.5 sm:gap-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gv-accent)] sm:px-4"
          >
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold tabular-nums"
              style={missing
                ? { background: 'transparent', color: 'var(--gv-text-tertiary)', border: '1px dashed var(--gv-border-strong)' }
                : { background: 'rgb(var(--gv-accent-rgb) / 0.16)', color: 'var(--gv-accent-text)', border: '1px solid rgb(var(--gv-accent-rgb) / 0.45)' }}
              aria-hidden="true"
            >{level.n}</span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="inline-flex items-center gap-1.5 text-[14.5px] font-semibold leading-snug" style={INK}>
                  <Icon className="h-[15px] w-[15px] shrink-0" style={{ color: missing ? 'var(--gv-text-tertiary)' : 'var(--gv-accent-text)' }} aria-hidden />{level.title}
                </span>
                <StatusChip status={level.status} />
              </span>
              <span className="mt-0.5 text-[13px] leading-snug line-clamp-2 break-words" style={QUIET} title={level.summary}>{level.summary}</span>
            </span>
            <ChevronDown className={`h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} style={QUIET} aria-hidden />
          </button>
        </h3>
        {open && (
          <div id={panelId} className="border-t px-3 pb-3 pt-2.5 sm:px-4" style={{ borderColor: 'var(--gv-border-subtle)' }}>
            {splits.length > 0 && (
              <div className="mb-1.5 rounded-lg px-3 py-2" style={{ background: 'rgb(var(--gv-ink-rgb) / 0.025)' }}>
                <p className="flex flex-wrap items-center gap-x-3 text-[11.5px] font-semibold uppercase tracking-[0.04em]" style={QUIET}>
                  Organic and paid, by channel
                  <span className="inline-flex items-center gap-1 normal-case tracking-normal font-medium"><span className="h-2 w-2 rounded-full" style={{ background: 'var(--gv-accent)' }} aria-hidden="true" />Organic</span>
                  <span className="inline-flex items-center gap-1 normal-case tracking-normal font-medium"><span className="h-2 w-2 rounded-full" style={{ background: PAID }} aria-hidden="true" />Paid</span>
                </p>
                <ul className="mt-1.5 space-y-1.5">
                  {splits.map((it, i) => (
                    <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[180px_minmax(0,1fr)_auto]">
                      <span className="col-span-2 min-w-0 break-words text-[13px] font-medium sm:col-span-1" style={INK}>{it.label}</span>
                      <span className="row-start-2 sm:row-start-auto"><SplitBar organic={it.split!.organic} paid={it.split!.paid} /></span>
                      <span className="row-start-2 text-[12.5px] tabular-nums whitespace-nowrap sm:row-start-auto" style={QUIET}>{it.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {rest.length > 0 && <ul className="space-y-1.5">{groupItems(rest).map((g, i) => <ItemGroup key={i} group={g} />)}</ul>}
            {level.note && <p className={`${level.items.length ? 'mt-2.5' : ''} text-[13px] leading-relaxed`} style={QUIET}>{level.note}</p>}
            {level.link && (
              <Link to={level.link.to} className="mt-2.5 inline-flex min-h-[36px] items-center gap-1.5 text-[13px] font-semibold hover:underline" style={{ color: 'var(--gv-accent-text)' }}>
                {level.link.label}<ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            )}
          </div>
        )}
      </div>
    </li>
  );
};

const StrategyFunnel: React.FC<{ levels: StrategyLevel[] }> = ({ levels }) => {
  const [open, setOpen] = useState<Set<LevelId>>(() => new Set());
  const toggle = (id: LevelId) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOpen = open.size === levels.length;
  return (
    <section
      aria-labelledby="funnel-h"
      className="relative overflow-hidden rounded-2xl border px-3 py-4 sm:p-6"
      style={{
        borderColor: 'var(--gv-border-subtle)',
        background: 'radial-gradient(90% 60% at 50% 0%, var(--gv-glow-gold), transparent 70%), var(--gv-panel)',
      }}
    >
      <header className="mb-4 px-1 sm:px-0 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--gv-accent-text)' }}>Your strategy</p>
          <h2 id="funnel-h" className="mt-0.5 text-[19px] font-semibold leading-tight" style={INK}>From your business to the numbers</h2>
          <p className="mt-1 text-[13px]" style={QUIET}>Read it top to bottom. Tap a level to see the details.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[12.5px] font-medium" style={QUIET}>{readyCount(levels)}</span>
          <button
            type="button"
            onClick={() => setOpen(allOpen ? new Set() : new Set(levels.map((l) => l.id)))}
            className="min-h-[36px] rounded-lg px-2.5 text-[12.5px] font-semibold hover:underline"
            style={{ color: 'var(--gv-accent-text)' }}
          >{allOpen ? 'Close all' : 'Open all'}</button>
        </div>
      </header>
      <ol className="m-0 list-none p-0">
        {levels.map((l, i) => <Level key={l.id} level={l} index={i} total={levels.length} open={open.has(l.id)} onToggle={() => toggle(l.id)} />)}
      </ol>
    </section>
  );
};

export default StrategyFunnel;
