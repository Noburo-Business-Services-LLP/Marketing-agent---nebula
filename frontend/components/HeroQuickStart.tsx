import React, { useEffect, useState } from 'react';
import { Loader2, Check, CalendarDays } from 'lucide-react';
import CalendarIdeaPicker from './CalendarIdeaPicker';
import { GravityPanel, GravityLabel, GravityButton } from './gravity';
import GenerationTimer from './GenerationTimer';
import { heroVideoAPI, type HeroBrief } from '../services/api';
import { CONTENT_LANGUAGES } from '../constants/languages';

type Concept = { title: string; emotion: string; hook: string; beats: string[]; dialogue: string[]; cta: string; look: string; brief: HeroBrief };

const DIALOGUE: { value: 'none' | 'little' | 'full'; label: string }[] = [
  { value: 'little', label: 'A little' },
  { value: 'none', label: 'None, music and visuals only' },
  { value: 'full', label: 'Let them talk' },
];
const FALLBACK_STYLES = [{ slug: 'cinematic-commercial', label: 'Cinematic Commercial', blurb: 'Filmic grade, shallow depth, dramatic light' }];
type StyleCard = { slug: string; label: string; blurb: string; coverUrl?: string };
const ASPECTS: { value: '9:16' | '16:9' | '1:1'; label: string }[] = [
  { value: '9:16', label: 'Vertical (Reels, Shorts)' },
  { value: '1:1', label: 'Square' },
  { value: '16:9', label: 'Wide' },
];

const field =
  'w-full rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-3 py-2.5 text-[14px] text-[var(--gv-text-primary)] placeholder:text-[var(--gv-text-tertiary)] focus:outline-none';

/**
 * Quick Hero flow, step one and two: say what the video is about, pick a style,
 * then choose one of three crisp 15-second ideas. Free; nothing is charged here.
 */
const HeroQuickStart: React.FC<{ onPick: (brief: HeroBrief, styleSlug: string, cta: string) => void }> = ({ onPick }) => {
  const [idea, setIdea] = useState('');
  const [styles, setStyles] = useState<StyleCard[]>(FALLBACK_STYLES);
  const [style, setStyle] = useState('cinematic-commercial');
  const [dialogue, setDialogue] = useState<'none' | 'little' | 'full'>('little');
  const [lookNote, setLookNote] = useState('');
  useEffect(() => {
    let live = true;
    heroVideoAPI.styles().then((r: any) => {
      if (live && r?.success && Array.isArray(r.styles) && r.styles.length) setStyles(r.styles);
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  const [aspect, setAspect] = useState<'9:16' | '16:9' | '1:1'>('9:16');
  const [language, setLanguage] = useState('english');
  const [cta, setCta] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fromPlan, setFromPlan] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [styleSlug, setStyleSlug] = useState('');

  const write = async (mode: 'three' | 'asis' = 'three') => {
    if (busy) return;
    if (idea.trim().length < 5) { setError('Write your idea, a sentence or a full concept, or pull one from your content plan.'); return; }
    setBusy(true); setError(''); setConcepts([]);
    try {
      const label = CONTENT_LANGUAGES.find((l) => l.value === language)?.label || 'English';
      const r = await heroVideoAPI.concepts({ idea: idea.trim(), mode, style, dialogue, lookNote: lookNote.trim() || undefined, language: label, aspectRatio: aspect, ctaText: cta.trim() || undefined });
      if (!r?.success || !r.concepts?.length) throw new Error(r?.message || 'We could not come up with ideas this time. Please try again.');
      if (mode === 'asis') { onPick(r.concepts[0].brief, r.style || style, r.concepts[0].cta || cta.trim()); return; }
      setConcepts(r.concepts);
      setStyleSlug(r.style || '');
    } catch (e: any) {
      setError(e?.message || 'We could not come up with ideas this time. Please try again.');
    } finally { setBusy(false); }
  };

  const applyPlanIdea = (i: any) => {
    setIdea(String(i.creativeConcept || i.headline || '').slice(0, 600));
    setFromPlan(String(i.headline || ''));
    setConcepts([]);
    setPickerOpen(false);
  };

  return (
    <div className="space-y-6">
      <CalendarIdeaPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={applyPlanIdea} type="reel" />
      <GravityPanel>
        <GravityLabel className="mb-3">1 · What is it about?</GravityLabel>
        <div className="space-y-4">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
              <label htmlFor="hq-idea" className="block text-[13px] font-semibold text-[var(--gv-text-primary)]">Your idea</label>
              <button type="button" onClick={() => setPickerOpen(true)}
                className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--gv-accent-text)] underline underline-offset-2">
                <CalendarDays className="w-4 h-4" /> Pull an idea from your content plan
              </button>
            </div>
            {fromPlan && <p className="text-[12.5px] text-[var(--gv-text-tertiary)] mb-1.5">Loaded from your plan: {fromPlan}. Edit it if you like.</p>}
            <textarea id="hq-idea" rows={3} maxLength={2000} value={idea} onChange={(e) => setIdea(e.target.value)} className={field}
              placeholder="For example: launching our new festive collection, or why small shops should plan a month of posts in one sitting" />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-[var(--gv-text-primary)] mb-1.5">Style</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {styles.map((s) => (
                <button key={s.slug} type="button" onClick={() => setStyle(s.slug)} aria-pressed={style === s.slug}
                  className={`text-left rounded-xl border px-3.5 py-2.5 ${style === s.slug ? 'border-[var(--gv-accent)] bg-[var(--gv-accent-fill)]' : 'border-[var(--gv-border-default)]'}`}>
                  {s.coverUrl && <img src={s.coverUrl} alt="" loading="lazy" className="w-full aspect-video object-cover rounded-lg mb-2 bg-[var(--gv-surface-2)]" />}
                  <span className="block text-[13.5px] font-semibold text-[var(--gv-text-primary)]">{s.label}</span>
                  <span className="block text-[12px] text-[var(--gv-text-tertiary)] mt-0.5">{s.blurb}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="hq-look" className="block text-[13px] font-semibold text-[var(--gv-text-primary)] mb-1.5">Any look or reference? (optional)</label>
            <input id="hq-look" value={lookNote} maxLength={240} onChange={(e) => setLookNote(e.target.value)} className={field}
              placeholder="For example: a premium festive saree-store ad, or a classic suiting ad with a family moment" />
          </div>
          <label className="block text-[13px] font-semibold text-[var(--gv-text-primary)] sm:max-w-[320px]">Dialogue
            <select value={dialogue} onChange={(e) => setDialogue(e.target.value as any)} className={`${field} mt-1.5`}>
              {DIALOGUE.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </label>
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="block text-[13px] font-semibold text-[var(--gv-text-primary)]">Language
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className={`${field} mt-1.5`}>
                {CONTENT_LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </label>
            <label className="block text-[13px] font-semibold text-[var(--gv-text-primary)]">Shape
              <select value={aspect} onChange={(e) => setAspect(e.target.value as any)} className={`${field} mt-1.5`}>
                {ASPECTS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </label>
            <label className="block text-[13px] font-semibold text-[var(--gv-text-primary)]">Call to action (optional)
              <input value={cta} maxLength={60} onChange={(e) => setCta(e.target.value)} className={`${field} mt-1.5`} placeholder="For example: Book a free demo" />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <GravityButton onClick={() => write('asis')} disabled={busy}>
              {busy ? (<><Loader2 className="w-4 h-4 animate-spin" /> Working…</>) : 'Bring my idea to life'}
            </GravityButton>
            <GravityButton variant="ghost" onClick={() => write('three')} disabled={busy}>
              {concepts.length ? 'Show me three new ideas' : 'Show me three ideas'}
            </GravityButton>
            <span className="text-[12.5px] text-[var(--gv-text-tertiary)]">Free. Nothing is charged until you generate.</span>
          </div>
          {busy && <GenerationTimer minSeconds={10} maxSeconds={30} />}
          {error && <p role="alert" className="text-[13px] text-[var(--gv-text-primary)]">{error}</p>}
        </div>
      </GravityPanel>

      {concepts.length > 0 && (
        <div className="space-y-3">
          <GravityLabel>2 · Choose your idea</GravityLabel>
          <div className="grid md:grid-cols-3 gap-4">
            {concepts.map((c, i) => (
              <GravityPanel key={i} contentClassName="space-y-3 h-full flex flex-col">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--gv-text-tertiary)]">{c.emotion}</p>
                  <h3 className="text-[16px] font-semibold text-[var(--gv-text-primary)]">{c.title}</h3>
                </div>
                <p className="text-[13px] text-[var(--gv-text-secondary)]"><span className="font-semibold text-[var(--gv-text-primary)]">Hook. </span>{c.hook}</p>
                <ol className="space-y-1.5 text-[13px] text-[var(--gv-text-secondary)] list-decimal pl-5">
                  {c.beats.map((b, j) => <li key={j}>{b}</li>)}
                </ol>
                {c.dialogue.length > 0 && (
                  <p className="text-[12.5px] italic text-[var(--gv-text-tertiary)]">{c.dialogue.map((d) => `“${d}”`).join(' ')}</p>
                )}
                {c.cta && <p className="text-[12.5px] text-[var(--gv-text-secondary)]"><span className="font-semibold">Ends with: </span>{c.cta}</p>}
                <div className="mt-auto pt-2">
                  <GravityButton onClick={() => onPick(c.brief, styleSlug, c.cta)}><Check className="w-4 h-4" /> Use this idea</GravityButton>
                </div>
              </GravityPanel>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default HeroQuickStart;
