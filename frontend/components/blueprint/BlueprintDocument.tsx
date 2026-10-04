import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { GravityButton } from '../gravity';
import TagChip from './TagChip';
import { apiService } from '../../services/api';
import { BLUEPRINT_COPY } from '../../constants/blueprintCopy';
import {
  BlueprintView, BlueprintTag, COVER_STRIPE_PX, isFreeTier, calendarFocusFrom, calendarTiles, claimLabel, coverStyle, documentFileName, factTextMap,
} from '../../utils/blueprint';
import type { User } from '../../types';

const D = BLUEPRINT_COPY.document;
const LEGEND = BLUEPRINT_COPY.landing.legend;
const LEGEND_TAGS: BlueprintTag[] = ['verified', 'inference', 'proposed', 'unverified'];

// A4 portrait pages, 794 px wide on screen. Colours come from the --gv-* tokens and the visitor's own colours.
const CSS = `
@page { size: A4; margin: 12mm; }
.bp-doc { --bp-gap: 24px; }
.bp-cal { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
.bp-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.bp-phases { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.bp-page { background: var(--gv-panel); border: 1px solid var(--gv-border-subtle); border-radius: 16px; max-width: 794px; margin: 0 auto var(--bp-gap); padding: 40px; box-shadow: var(--gv-shadow-card); }
@media (max-width: 640px) { .bp-page { padding: 20px; border-radius: 12px; } .bp-cal { grid-template-columns: repeat(2, minmax(0, 1fr)); } .bp-phases { grid-template-columns: 1fr; } }
@media print {
  html, body { background: #fff !important; }
  .bp-doc, .bp-doc * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .bp-noprint { display: none !important; }
  .bp-page { break-after: page; break-inside: avoid; max-width: none; margin: 0; padding: 0; border: 0; border-radius: 0; box-shadow: none; }
  .bp-page:last-child { break-after: auto; }
  .bp-cal { grid-template-columns: repeat(7, minmax(0, 1fr)); }
}
.bp-printonly { display: none; }
@media print { .bp-printonly { display: inline; } .bp-tile, .bp-card { break-inside: avoid; } }
/* The app shell is a fixed-height scroll container on screen; on paper only the document is printed. */
@media print {
  aside, header, nav { display: none !important; }
  .h-screen { height: auto !important; display: block !important; }
  .overflow-hidden, .overflow-y-auto { overflow: visible !important; height: auto !important; }
  main { padding: 0 !important; }
  .bp-doc { padding: 0; }
}
.bp-doc a { overflow-wrap: anywhere; }
@media (max-width: 640px) { .bp-two { grid-template-columns: 1fr; } }
`;

const PILLAR_FILLS = ['var(--gv-peach)', 'var(--gv-mint)', 'var(--gv-sky)', 'var(--gv-lav)', 'var(--gv-panel-2)'];
const INK = { color: 'var(--gv-text-primary)' } as const;
const QUIET = { color: 'var(--gv-text-secondary)' } as const;

type Claim = { text?: string | null; tag?: BlueprintTag; factIds?: Array<string | number>; reason?: string | null; label?: string | null };

/** One statement followed by its spelled-out tag. A missing field renders nothing. */
const ClaimLine: React.FC<{ c?: Claim | null; facts: Record<string, string>; big?: boolean; label?: string }> = ({ c, facts, big = false, label }) => {
  if (!c || typeof c.text !== 'string' || !c.text.trim()) return null;
  const tag = (c.tag || 'unverified') as BlueprintTag;
  const ids = Array.isArray(c.factIds) ? c.factIds.map(String) : [];
  const rests = tag === 'inference' && ids.length ? `${D.factsRestOn}: ${ids.map((id) => facts[id] || id).join('; ')}` : undefined;
  return (
    <p className={`${big ? 'text-[15.5px]' : 'text-[14px]'} leading-relaxed break-words`} style={INK} title={rests}>
      {label && <span className="font-semibold">{label}: </span>}
      <span>{c.text}</span>{' '}
      <TagChip tag={tag} className="align-middle" />
      {ids.length > 0 && tag === 'inference' && (
        <span className="bp-printonly text-[10px]" style={QUIET}> {D.factIdsLabel} {ids.join(', ')}</span>
      )}
      {tag === 'unverified' && c.reason && <span className="block text-[12.5px]" style={QUIET}>{c.reason}</span>}
    </p>
  );
};

const Claims: React.FC<{ items?: Claim[]; facts: Record<string, string>; className?: string }> = ({ items, facts, className = 'space-y-2.5' }) => (
  <div className={className}>
    {(Array.isArray(items) ? items : []).map((c, i) => <ClaimLine key={i} c={c} facts={facts} label={c?.label || undefined} />)}
  </div>
);

const H3: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="text-[15px] font-semibold mb-3" style={INK}>{children}</h3>
);

const PageShell: React.FC<{ n?: number; id: string; title: string; purpose?: string; children: React.ReactNode }> = ({ n, id, title, purpose, children }) => (
  <section className="bp-page" aria-labelledby={`bp-h-${id}`} data-page={id}>
    <header className="mb-6 pb-4" style={{ borderBottom: '1px solid var(--gv-border-subtle)' }}>
      {typeof n === 'number' && <p className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: 'var(--gv-accent-text)' }}>{D.pageLabel} {n}</p>}
      <h2 id={`bp-h-${id}`} className="text-[26px] font-semibold leading-tight mt-1" style={INK}>{title}</h2>
      {purpose && <p className="text-[14px] mt-1.5" style={QUIET}>{purpose}</p>}
    </header>
    {children}
  </section>
);

const sectionOf = (page: any, heading: string) => (page.sections || []).find((s: any) => s.heading === heading);

const GenericSections: React.FC<{ page: any; facts: Record<string, string>; skip?: string[] }> = ({ page, facts, skip = [] }) => (
  <>
    {(page.sections || []).filter((s: any) => !skip.includes(s.heading)).map((s: any, i: number) => (
      <div key={i} className="mt-6 first:mt-0">
        <H3>{s.heading}</H3>
        <Claims items={s.items} facts={facts} />
      </div>
    ))}
  </>
);

// ---------- cover ----------

const Cover: React.FC<{ view: BlueprintView; result: any; facts: Record<string, string> }> = ({ view, result, facts }) => {
  const cover = result.cover || {};
  const band = coverStyle(cover);
  const name = cover.businessName || view.businessName || '';
  const when = result.generatedAt ? new Date(result.generatedAt) : null;
  const prepared = when && !Number.isNaN(when.valueOf()) ? when.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  return (
    <section className="bp-page" aria-labelledby="bp-h-cover" data-page="cover">
      <div className="rounded-xl p-6 sm:p-8" style={{ background: band.background, color: band.color, paddingBottom: COVER_STRIPE_PX + 24 }}>
        <div className="flex items-center gap-4 mb-6">
          {cover.logo?.url ? (
            <span className="inline-flex rounded-lg p-2" style={{ background: 'var(--gv-panel)' }}>
              <img src={cover.logo.url} alt={`${name} logo`} style={{ objectFit: 'contain', height: 64, width: 'auto', maxWidth: 180 }} />
            </span>
          ) : (
            <span className="text-[13px] font-semibold">{cover.logoNote || D.logoNotProvided}</span>
          )}
        </div>
        <h1 id="bp-h-cover" className="font-semibold leading-[1.05] tracking-tight break-words" style={{ fontSize: 'clamp(34px, 7vw, 60px)' }}>{name}</h1>
        <p className="mt-3 text-[15px] font-semibold uppercase tracking-wider">{D.coverLabel}</p>
      </div>
      <div className="mt-6 space-y-4">
        {cover.promise && <ClaimLine c={typeof cover.promise === 'string' ? { text: cover.promise, tag: 'proposed' } : cover.promise} facts={facts} big />}
        {cover.limitedNote && <p className="text-[14px] font-semibold" style={INK}>{cover.limitedNote}</p>}
        {(cover.warnings || []).map((w: any, i: number) => (
          <p key={i} role="status" className="rounded-lg px-3 py-2 text-[13.5px]" style={{ background: 'var(--gv-peach)', border: '1px solid var(--gv-border-default)', ...INK }}>{w.message}</p>
        ))}
      </div>
      <div className="mt-8">
        <H3>{D.legendTitle}</H3>
        <p className="text-[13.5px] mb-3" style={QUIET}>{D.legendIntro}</p>
        <ul className="space-y-2">
          {LEGEND_TAGS.map((t, i) => (
            <li key={t} data-tag={claimLabel(t)} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px]" style={INK}>
              <TagChip tag={t} />
              <span className="min-w-0 flex-1">{LEGEND[i]?.meaning}</span>
            </li>
          ))}
        </ul>
      </div>
      <footer className="mt-10 flex items-center justify-between gap-4">
        <img src="/assets/logo-nebulaa.png" alt="Nebulaa" style={{ objectFit: 'contain', height: 30, width: 'auto' }} />
        {prepared && <p className="text-[12.5px]" style={QUIET}>{D.preparedOn} {prepared}</p>}
      </footer>
    </section>
  );
};

// ---------- pages ----------

const Page1: React.FC<{ page: any; facts: Record<string, string>; sources: any[] }> = ({ page, facts, sources }) => {
  const got = sectionOf(page, 'What we confirmed');
  const lacking = sectionOf(page, 'What we could not confirm');
  const read = sources.filter((s) => s && s.ok && s.url);
  return (
    <>
      <div className="bp-two">
        <div>
          <H3>{D.confirmedHeading}</H3>
          {got?.items?.length ? <Claims items={got.items} facts={facts} /> : <p className="text-[13.5px]" style={QUIET}>{D.nothingListed}</p>}
        </div>
        <div>
          <H3>{D.unconfirmedHeading}</H3>
          {lacking?.items?.length ? <Claims items={lacking.items} facts={facts} /> : <p className="text-[13.5px]" style={QUIET}>{D.nothingListed}</p>}
        </div>
      </div>
      <GenericSections page={page} facts={facts} skip={[got?.heading, lacking?.heading].filter(Boolean) as string[]} />
      <div className="mt-8 pt-4" style={{ borderTop: '1px solid var(--gv-border-subtle)' }}>
        <p className="text-[12.5px] font-semibold" style={INK}>{D.sourcesTitle}</p>
        {read.length ? (
          <ul className="mt-1 space-y-0.5 text-[12.5px]" style={QUIET}>
            {read.map((s, i) => <li key={i} className="break-all">{s.url}</li>)}
          </ul>
        ) : <p className="mt-1 text-[12.5px]" style={QUIET}>{D.sourcesNone}</p>}
      </div>
    </>
  );
};

const Page2: React.FC<{ page: any; facts: Record<string, string> }> = ({ page, facts }) => {
  const terr = sectionOf(page, 'The territory');
  const who = sectionOf(page, 'Who you speak to');
  const line = sectionOf(page, 'Your line');
  const [head, ...rest] = (terr?.items || []) as Claim[];
  return (
    <>
      <div className="bp-two">
        <div className="rounded-xl p-5" style={{ background: 'var(--gv-peach)', border: '1px solid var(--gv-border-subtle)' }}>
          <p className="text-[12px] font-semibold uppercase tracking-wider mb-2" style={QUIET}>{D.territoryLabel}</p>
          {head && (
            <p className="text-[28px] font-semibold leading-tight break-words" style={INK}>
              {head.text} <TagChip tag={(head.tag || 'proposed') as BlueprintTag} className="align-middle" />
            </p>
          )}
          <Claims items={rest} facts={facts} className="mt-4 space-y-2.5" />
        </div>
        <div>
          <H3>{D.audienceLabel}</H3>
          <Claims items={who?.items} facts={facts} />
        </div>
      </div>
      {line && (
        <div className="mt-6">
          <H3>{line.heading}</H3>
          <Claims items={(line.items || []).map((c: Claim) => ({ ...c, label: undefined }))} facts={facts} />
        </div>
      )}
      <GenericSections page={page} facts={facts} skip={['The territory', 'Who you speak to', 'Your line']} />
    </>
  );
};

const Page3: React.FC<{ page: any; facts: Record<string, string> }> = ({ page, facts }) => (
  <>
    {(page.sections || []).map((s: any, i: number) => (
      <div key={i} className="mt-6 first:mt-0">
        <H3>{s.heading}</H3>
        {s.kind === 'competitors' ? (
          <div className="space-y-3">
            {(s.items || []).map((c: any, j: number) => (
              <div key={j} className="bp-card rounded-xl p-4" style={{ background: 'var(--gv-panel-2)', border: '1px solid var(--gv-border-subtle)' }}>
                <p className="text-[16px] font-semibold" style={INK}>{c.name}</p>
                {c.url && <p className="text-[12.5px] mb-2 break-all" style={QUIET}>{D.competitorSource}: {c.url}</p>}
                <Claims items={c.observations} facts={facts} />
              </div>
            ))}
          </div>
        ) : <Claims items={s.items} facts={facts} />}
      </div>
    ))}
  </>
);

const Page4: React.FC<{ page: any; facts: Record<string, string> }> = ({ page, facts }) => (
  <>
    {(page.sections || []).map((s: any, i: number) => (
      <div key={i} className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {(s.items || []).map((p: any, j: number) => (
          <div key={j} className="bp-card rounded-xl p-5" style={{ background: PILLAR_FILLS[j % PILLAR_FILLS.length], border: '1px solid var(--gv-border-subtle)' }}>
            <p className="text-[12px] font-semibold uppercase tracking-wider" style={QUIET}>{j + 1}</p>
            <p className="text-[19px] font-semibold leading-snug mb-3 break-words" style={INK}>{p.name}</p>
            <div className="space-y-2.5">
              <ClaimLine c={p.why} facts={facts} label={D.pillarWhy} />
              <ClaimLine c={p.example} facts={facts} label={D.pillarExample} />
            </div>
          </div>
        ))}
      </div>
    ))}
  </>
);

const Page5: React.FC<{ page: any }> = ({ page }) => (
  <>
    {(page.sections || []).map((s: any, i: number) => (
      <div key={i} className="bp-cal" role="list">
        {calendarTiles(s.items).map(({ day, item }) => (
          <div key={day} role="listitem" className="bp-tile rounded-lg p-2 flex flex-col gap-1 min-w-0" style={{ background: item ? PILLAR_FILLS[(day - 1) % 4] : 'var(--gv-panel-2)', border: '1px solid var(--gv-border-subtle)', ...INK, minHeight: 112 }}>
            <p className="text-[11px] font-semibold" style={INK}>{D.dayLabel} {day}</p>
            {item ? (
              <>
                <p className="text-[11px] font-semibold leading-tight break-words">{item.pillar}</p>
                <p className="text-[10.5px] leading-tight" style={QUIET}>{item.format}</p>
                {item.hook?.text && <p className="text-[10.5px] leading-snug break-words">{item.hook.text}</p>}
                {item.hook?.text && <TagChip tag={(item.hook.tag || 'proposed') as BlueprintTag} className="self-start !text-[9.5px] !px-1.5 !py-0 !leading-4" />}
              </>
            ) : <p className="text-[11px]" style={QUIET}>{D.openDay}</p>}
          </div>
        ))}
      </div>
    ))}
  </>
);

const Page6: React.FC<{ page: any; facts: Record<string, string> }> = ({ page, facts }) => (
  <>
    {(page.sections || []).map((s: any, i: number) => (
      <div key={i} className="mt-6 first:mt-0">
        {s.kind === 'offers' ? (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            {(s.items || []).map((o: any, j: number) => (
              <div key={j} className="bp-card rounded-xl p-5" style={{ background: PILLAR_FILLS[j % PILLAR_FILLS.length], border: '1px solid var(--gv-border-subtle)' }}>
                <p className="text-[12px] font-semibold uppercase tracking-wider" style={QUIET}>{D.offerLabel}</p>
                <p className="text-[17px] font-semibold break-words" style={INK}>{o.name}</p>
                {o.price && <p className="text-[34px] font-semibold leading-tight my-2 break-words" style={INK}>{o.price}</p>}
                <ClaimLine c={o.fact ? { ...o.fact, text: D.typedNote } : null} facts={facts} />
                <div className="mt-3 space-y-2.5">
                  <ClaimLine c={o.hook} facts={facts} label={D.hookLabel} />
                  <ClaimLine c={o.cta} facts={facts} label={D.ctaLabel} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            <H3>{s.heading}</H3>
            <Claims items={s.items} facts={facts} />
          </>
        )}
      </div>
    ))}
  </>
);

const Page7: React.FC<{ page: any; facts: Record<string, string> }> = ({ page, facts }) => (
  <>
    {(page.sections || []).map((s: any, i: number) => (
      <ol key={i} className="space-y-3">
        {[...(s.items || [])].sort((a: any, b: any) => (a.priority || 0) - (b.priority || 0)).map((c: any, j: number) => (
          <li key={j} className="bp-card flex items-start gap-4 rounded-xl p-4" style={{ background: 'var(--gv-panel-2)', border: '1px solid var(--gv-border-subtle)' }}>
            <span className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-[16px] font-semibold" style={{ background: PILLAR_FILLS[j % 4], ...INK }} aria-label={`${D.priorityLabel} ${c.priority}`}>{c.priority}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-semibold" style={INK}>{c.channel}</p>
              <ClaimLine c={c.role} facts={facts} />
            </div>
          </li>
        ))}
      </ol>
    ))}
  </>
);

const Page8: React.FC<{ page: any; facts: Record<string, string> }> = ({ page, facts }) => (
  <>
    {(page.sections || []).map((s: any, i: number) => (
      <div key={i} className="bp-phases">
        {(s.items || []).map((ph: any, j: number) => (
          <div key={j} className="bp-card rounded-xl p-4 min-w-0" style={{ background: PILLAR_FILLS[j % 4], border: '1px solid var(--gv-border-subtle)' }}>
            <p className="text-[12px] font-semibold uppercase tracking-wider" style={QUIET}>{ph.label}</p>
            <p className="text-[17px] font-semibold leading-snug mb-3" style={INK}>{ph.title}</p>
            <div className="space-y-3">
              <ClaimLine c={ph.focus} facts={facts} label={D.focusLabel} />
              {Array.isArray(ph.actions) && ph.actions.length > 0 && (
                <div><p className="text-[13px] font-semibold mb-1.5" style={INK}>{D.actionsLabel}</p><Claims items={ph.actions} facts={facts} /></div>
              )}
              {Array.isArray(ph.measure) && ph.measure.length > 0 && (
                <div><p className="text-[13px] font-semibold mb-1.5" style={INK}>{D.measureLabel}</p><Claims items={ph.measure} facts={facts} /></div>
              )}
            </div>
          </div>
        ))}
      </div>
    ))}
  </>
);

const Page9: React.FC<{ page: any; facts: Record<string, string> }> = ({ page, facts }) => (
  <>
    {(page.sections || []).map((s: any, i: number) => (
      <ol key={i} className="space-y-3">
        {(s.items || []).map((c: Claim, j: number) => (
          <li key={j} className="flex items-start gap-4">
            <span className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-[15px] font-semibold" style={{ background: PILLAR_FILLS[j % 4], ...INK }}>{j + 1}</span>
            <div className="min-w-0 flex-1 pt-1"><ClaimLine c={c} facts={facts} big /></div>
          </li>
        ))}
      </ol>
    ))}
  </>
);

// ---------- closing ----------

const CONTACT_ORDER: Array<'email' | 'website' | 'phone' | 'instagram' | 'facebook'> = ['email', 'website', 'phone', 'instagram', 'facebook'];

const Closing: React.FC<{ closing: any }> = ({ closing }) => {
  const navigate = useNavigate();
  const contact = closing?.contact || {};
  return (
    <section className="bp-page" aria-labelledby="bp-h-closing" data-page="closing">
      <h2 id="bp-h-closing" className="text-[30px] font-semibold leading-tight" style={INK}>{closing?.heading}</h2>
      <p className="mt-3 text-[15px] leading-relaxed" style={QUIET}>{closing?.body}</p>
      <dl className="mt-8 space-y-2">
        {CONTACT_ORDER.filter((k) => typeof contact[k] === 'string' && contact[k]).map((k) => (
          <div key={k} className="flex flex-wrap gap-x-3 text-[14px]">
            <dt className="w-24 shrink-0 font-semibold" style={INK}>{D.contact[k]}</dt>
            <dd className="min-w-0 flex-1 break-words" style={INK}>{contact[k]}</dd>
          </div>
        ))}
      </dl>
      {closing?.cta?.label && (
        <div className="bp-noprint mt-8">
          <GravityButton onClick={() => navigate('/dashboard')}>{closing.cta.label}</GravityButton>
        </div>
      )}
    </section>
  );
};

// ---------- the document ----------

const BlueprintDocument: React.FC<{ view: BlueprintView; user?: User | null }> = ({ view, user }) => {
  const navigate = useNavigate();
  const result = view.result;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const facts = useMemo(() => factTextMap(result), [result]);
  const focus = useMemo(() => calendarFocusFrom(result), [result]);
  const name = (result?.cover?.businessName || view.businessName || '') as string;

  // The print dialog proposes the document title as the file name.
  useEffect(() => {
    const previous = document.title;
    document.title = documentFileName(name);
    return () => { document.title = previous; };
  }, [name]);

  if (!result || !Array.isArray(result.pages)) return null;

  const isFree = isFreeTier(user as any);
  const canUseCalendar = !!user?.onboardingCompleted && !!focus;

  const toCalendar = async () => {
    setBusy(true); setError('');
    try {
      await apiService.regenerateCalendar({ focus });
      navigate('/content-calendar');
    } catch {
      setError(D.calendarError);
      setBusy(false);
    }
  };

  const body = (page: any) => {
    switch (page.id) {
      case 'where-today': return <Page1 page={page} facts={facts} sources={result.sources || []} />;
      case 'audience-positioning': return <Page2 page={page} facts={facts} />;
      case 'competitor-read': return <Page3 page={page} facts={facts} />;
      case 'content-pillars': return <Page4 page={page} facts={facts} />;
      case 'calendar-preview': return <Page5 page={page} />;
      case 'offers-hooks': return <Page6 page={page} facts={facts} />;
      case 'channel-plan': return <Page7 page={page} facts={facts} />;
      case 'roadmap-90': return <Page8 page={page} facts={facts} />;
      case 'first-steps': return <Page9 page={page} facts={facts} />;
      default: return <GenericSections page={page} facts={facts} />;
    }
  };

  return (
    <div className="bp-doc">
      <style>{CSS}</style>
      <div className="bp-noprint max-w-[794px] mx-auto mb-5 space-y-3" role="toolbar" aria-label={D.toolbarLabel}>
        <div className="flex flex-wrap items-center gap-2.5">
          <GravityButton onClick={() => window.print()}>{D.print}</GravityButton>
          {canUseCalendar && (
            <GravityButton variant="ghost" onClick={toCalendar} disabled={busy}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {busy ? D.usingInCalendar : D.useInCalendar}
            </GravityButton>
          )}
          {!isFree && (
            <Link to="/blueprint/new" className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg text-[13px] font-semibold border border-[var(--gv-border-default)] text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)]">{D.another}</Link>
          )}
        </div>
        {canUseCalendar && <p className="text-[12.5px]" style={QUIET}>{D.calendarNote}</p>}
        {error && <p role="alert" className="text-[13px]" style={{ color: 'var(--gv-coral-text)' }}>{error}</p>}
        {isFree && (
          <p className="text-[13px]" style={INK}>
            {D.freeUsed}{' '}
            <Link to="/trial-expired" className="font-semibold underline underline-offset-2" style={{ color: 'var(--gv-accent-text)' }}>{D.viewPlans}</Link>
          </p>
        )}
      </div>

      <Cover view={view} result={result} facts={facts} />
      {result.pages.map((page: any) => (
        <PageShell key={page.id} n={page.n} id={page.id} title={page.title} purpose={page.purpose}>
          {body(page)}
        </PageShell>
      ))}
      <Closing closing={result.closing} />
    </div>
  );
};

export default BlueprintDocument;
