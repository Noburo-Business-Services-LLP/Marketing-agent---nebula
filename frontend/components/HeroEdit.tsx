import React, { useState } from 'react';
import { Loader2, Wand2 } from 'lucide-react';
import { GravityLabel, GravityButton } from './gravity';
import { heroVideoAPI } from '../services/api';

const field =
  'w-full rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-3 py-2.5 text-[14px] text-[var(--gv-text-primary)] placeholder:text-[var(--gv-text-tertiary)] focus:outline-none';

const FONTS = [{ v: 'modern', l: 'Modern' }, { v: 'classic', l: 'Classic' }, { v: 'friendly', l: 'Friendly' }];
const SIZES = [{ v: 'small', l: 'Small' }, { v: 'medium', l: 'Medium' }, { v: 'large', l: 'Large' }];
const THEMES = [{ v: 'brand', l: 'Your colour' }, { v: 'dark', l: 'Dark' }, { v: 'light', l: 'Light' }];

const Choice: React.FC<{ label: string; options: { v: string; l: string }[]; value?: string; onPick: (v: string) => void }> = ({ label, options, value, onPick }) => (
  <div>
    <p className="text-[13px] font-semibold text-[var(--gv-text-primary)] mb-1.5">{label}</p>
    <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.v} type="button" aria-pressed={value === o.v} onClick={() => onPick(o.v)}
          className={`h-9 px-4 rounded-full text-[13px] font-semibold border ${value === o.v ? 'bg-[var(--gv-accent-fill)] border-[var(--gv-accent)] text-[var(--gv-text-primary)]' : 'border-[var(--gv-border-default)] text-[var(--gv-text-secondary)]'}`}>
          {o.l}
        </button>
      ))}
    </div>
  </div>
);

const Toggle: React.FC<{ label: string; hint?: string; value?: boolean; onChange: (v: boolean) => void }> = ({ label, hint, value, onChange }) => (
  <label className="flex items-start justify-between gap-4 py-1.5 cursor-pointer">
    <span>
      <span className="block text-[13.5px] font-semibold text-[var(--gv-text-primary)]">{label}</span>
      {hint && <span className="block text-[12px] text-[var(--gv-text-tertiary)]">{hint}</span>}
    </span>
    <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="mt-1 w-5 h-5 accent-[var(--gv-accent)]" />
  </label>
);

/**
 * Change how a finished video ends and looks, without making a new video: end card text, font, size, colours,
 * logo, captions. Only what you change is sent. Free; the original clip is kept.
 */
const HeroEdit: React.FC<{ jobId: string; current?: any; onUpdated: (videoUrl: string) => void }> = ({ jobId, current, onUpdated }) => {
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState<Record<string, any>>({});
  const [top, setTop] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [failed, setFailed] = useState(false);
  const changed = Object.keys(card).length + Object.keys(top).length > 0;
  const curCard = (current && current.endCard) || {};
  const cv = (k: string, dflt?: any) => (k in card ? card[k] : (curCard[k] !== undefined ? curCard[k] : dflt));
  const tv = (k: string, dflt?: any) => (k in top ? top[k] : (current && current[k] !== undefined ? current[k] : dflt));
  const setC = (k: string, v: any) => setCard((c) => ({ ...c, [k]: v }));
  const setT = (k: string, v: any) => setTop((c) => ({ ...c, [k]: v }));

  const apply = async () => {
    if (busy || !changed) return;
    setBusy(true); setNote(''); setFailed(false);
    try {
      const r = await heroVideoAPI.refinish(jobId, { ...top, ...(Object.keys(card).length ? { endCard: card } : {}) });
      if (!r?.success || !r.videoUrl) throw new Error(r?.message || 'We could not update the video this time. Please try again.');
      onUpdated(r.videoUrl);
      setCard({}); setTop({});
      setNote('Your video is updated. The earlier version is kept.');
    } catch (e: any) {
      setFailed(true);
      setNote(e?.message || 'We could not update the video this time. Please try again.');
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3 pt-2 border-t border-[var(--gv-border-subtle)]">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-2 text-[13px] font-semibold text-[var(--gv-accent-text)]">
        <Wand2 className="w-4 h-4" /> {open ? 'Hide editing' : 'Edit the ending, logo and captions'}
      </button>
      {open && (
        <div className="space-y-4">
          <p className="text-[12.5px] text-[var(--gv-text-tertiary)]">Change only what you want. This is free and keeps your original video. To change the story itself, make a new version from the prompt.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <GravityLabel className="mb-1.5">Closing card</GravityLabel>
              <input className={field} placeholder="Main line, for example: Book your free demo" maxLength={300} value={cv('ctaText', '')} onChange={(e) => setC('ctaText', e.target.value)} aria-label="Closing card main line" />
            </div>
            <input className={field} placeholder="Website, for example: nebulaa.ai" maxLength={200} value={cv('website', '')} onChange={(e) => setC('website', e.target.value)} aria-label="Website" />
            <input className={field} placeholder="Short tagline (optional)" maxLength={80} value={cv('tagline', '')} onChange={(e) => setC('tagline', e.target.value)} aria-label="Tagline" />
            <input className={`${field} sm:col-span-2`} placeholder="More details, such as phone or address (optional)" maxLength={200} value={cv('details', '')} onChange={(e) => setC('details', e.target.value)} aria-label="More details" />
          </div>
          <Choice label="Font" options={FONTS} value={cv('font', 'modern')} onPick={(v) => setC('font', v)} />
          <Choice label="Text size" options={SIZES} value={cv('size', 'medium')} onPick={(v) => setC('size', v)} />
          <Choice label="Card colour" options={THEMES} value={cv('theme', 'brand')} onPick={(v) => setC('theme', v)} />
          <div className="divide-y divide-[var(--gv-border-subtle)]">
            <Toggle label="Show the closing card" value={cv('enabled', true)} onChange={(v) => setC('enabled', v)} />
            <Toggle label="Logo on the closing card" value={cv('showLogo', true)} onChange={(v) => setC('showLogo', v)} />
            <Toggle label="Logo on the video" hint="Places your logo on the clip itself." value={tv('brandMark', false)} onChange={(v) => setT('brandMark', v)} />
            <Toggle label="Captions" hint="Adds the spoken lines as on-screen text." value={tv('captions', false)} onChange={(v) => setT('captions', v)} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <GravityButton onClick={apply} disabled={busy || !changed}>
              {busy ? (<><Loader2 className="w-4 h-4 animate-spin" /> Updating…</>) : 'Update my video'}
            </GravityButton>
            {!changed && <span className="text-[12.5px] text-[var(--gv-text-tertiary)]">Change something first.</span>}
          </div>
          {note && <p role={failed ? 'alert' : 'status'} className="text-[13px] text-[var(--gv-text-primary)]">{note}</p>}
        </div>
      )}
    </div>
  );
};

export default HeroEdit;
