import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ImagePlus, Sparkles, Loader2, X } from 'lucide-react';
import PostPreview from './PostPreview';
import { brandAssetsAPI, apiService } from '../services/api';
import { PostDesign, PostDetails, referenceFileProblem } from '../utils/postDesign';

const input = 'w-full rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-3 py-2.5 text-[14px] text-[var(--gv-text-primary)] placeholder:text-[var(--gv-text-tertiary)] focus:outline-none focus:border-[var(--gv-accent)]';
const label = 'block text-[12.5px] font-semibold text-[var(--gv-text-primary)] mb-1.5';
const sectionTitle = 'text-[13px] font-semibold uppercase tracking-[0.12em] text-[var(--gv-text-secondary)]';

const DETAIL_NOTE: Record<string, string> = {
  single: 'Only what you type is put on the design. A box you leave empty is left out.',
  carousel: 'Headline, offer and items go on the first slide. Phone, address, hours and tagline go on the last.',
  campaign: 'Phone, address, hours and tagline repeat on every post. Each post\'s own headline and offer come from its idea.',
};

const Field: React.FC<{ id: string; text: string; children: React.ReactNode }> = ({ id, text, children }) => (
  <div><label htmlFor={id} className={label}>{text}</label>{children}</div>
);

/** The look of a post: a design style with sample pictures, the exact text to show, a picture to copy, and a saved header and footer. */
const PostDesignPanel: React.FC<{
  design: PostDesign;
  onChange: (next: PostDesign) => void;
  mode: 'single' | 'carousel' | 'campaign';
  aspect: string;
  logoUrl?: string;
  logoPosition?: string;
  /** what the person wrote and the language chosen, so suggestions can be made from them */
  idea?: string;
  language?: string;
}> = ({ design, onChange, mode, aspect, logoUrl, logoPosition, idea = '', language = 'English' }) => {
  const navigate = useNavigate();
  const [headers, setHeaders] = useState<any[]>([]);
  const [footers, setFooters] = useState<any[]>([]);
  const [refNote, setRefNote] = useState('');
  const [open, setOpen] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState('');
  const touched = useRef(false);
  const designRef = useRef(design);
  designRef.current = design;

  useEffect(() => {
    let live = true;
    brandAssetsAPI.getFrames().then((r) => {
      if (!live || !r?.success) return;
      setHeaders(r.headers || []); setFooters(r.footers || []);
      // The saved defaults are chosen for you once; picking "None" afterwards sticks.
      if (!touched.current) {
        const h = (r.headers || []).find((x: any) => x.isPrimary)?.url || '';
        const f = (r.footers || []).find((x: any) => x.isPrimary)?.url || '';
        if (h || f) onChange({ ...designRef.current, headerUrl: designRef.current.headerUrl || h, footerUrl: designRef.current.footerUrl || f });
      }
    }).catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (patch: Partial<PostDesign>) => onChange({ ...design, ...patch });
  const setDetail = (k: keyof PostDetails, v: string) => set({ details: { ...design.details, [k]: v } });
  const chooseFrame = (k: 'headerUrl' | 'footerUrl', url: string) => { touched.current = true; set({ [k]: url } as any); };

  const pickReference = (file?: File) => {
    const problem = referenceFileProblem(file);
    if (problem) { setRefNote(problem); return; }
    setRefNote('');
    const r = new FileReader();
    r.onload = () => set({ referenceImage: String(r.result || '') });
    r.readAsDataURL(file as File);
  };

  const designed = true;

  // What has been added, in one line, for when the section is closed.
  const filled = Object.values(design.details).filter((v) => String(v || '').trim()).length;
  const summary = [
    filled ? `${filled} text ${filled === 1 ? 'field' : 'fields'}` : '',
    design.referenceImage ? 'a reference picture' : '',
    design.headerUrl ? 'a header' : '',
    design.footerUrl ? 'a footer' : '',
  ].filter(Boolean).join(' · ') || 'Nothing added. Nebulaa designs from your idea.';

  const suggest = async () => {
    setSuggesting(true); setSuggestNote('');
    try {
      const r = await apiService.suggestPostDetails({ idea, mode, language });
      if (!r.success || !r.details) { setSuggestNote(r.message || 'Could not suggest details right now.'); return; }
      const d = r.details;
      const mine = design.details;
      const pick = (current: string, next: string) => (String(current || '').trim() ? current : String(next || ''));
      const items = Array.isArray(d.items) ? d.items.join('\n') : String(d.items || '');
      set({ details: {
        headline: pick(mine.headline, d.headline), offer: pick(mine.offer, d.offer), items: pick(mine.items, items),
        phone: pick(mine.phone, d.phone), address: pick(mine.address, d.address), hours: pick(mine.hours, d.hours), tagline: pick(mine.tagline, d.tagline),
      } });
      setSuggestNote(r.phoneFromAccount
        ? 'Suggested from your idea and profile. Please check the phone number is the one customers should call.'
        : 'Suggested from your idea and profile. Please check everything, and change what is not right.');
    } catch {
      setSuggestNote('Could not suggest details right now. You can type them in.');
    } finally { setSuggesting(false); }
  };

  const FrameChoice: React.FC<{ title: string; items: any[]; value: string; k: 'headerUrl' | 'footerUrl' }> = ({ title, items, value, k }) => (
    <div>
      <p className={label}>{title}</p>
      <div className="space-y-2" role="radiogroup" aria-label={title}>
        <button type="button" role="radio" aria-checked={!value} onClick={() => chooseFrame(k, '')}
          className={`w-full flex items-center gap-3 rounded-lg border px-3 h-11 text-left text-[13px] font-semibold ${!value ? 'border-[var(--gv-accent)] bg-[var(--gv-accent-fill)] text-[var(--gv-text-primary)]' : 'border-[var(--gv-border-default)] text-[var(--gv-text-secondary)] hover:border-[var(--gv-border-strong)]'}`}>
          <span className={`w-4 h-4 rounded-full border flex items-center justify-center ${!value ? 'border-[var(--gv-accent)]' : 'border-[var(--gv-border-strong)]'}`}>{!value && <span className="w-2 h-2 rounded-full bg-[var(--gv-accent)]" />}</span>
          None
        </button>
        {items.map((a) => {
          const on = value === a.url;
          return (
            <button key={a._id} type="button" role="radio" aria-checked={on} onClick={() => chooseFrame(k, a.url)}
              className={`w-full flex items-center gap-3 rounded-lg border p-2 text-left ${on ? 'border-[var(--gv-accent)] bg-[var(--gv-accent-fill)]' : 'border-[var(--gv-border-default)] hover:border-[var(--gv-border-strong)]'}`}>
              <span className={`shrink-0 w-4 h-4 rounded-full border flex items-center justify-center ml-1 ${on ? 'border-[var(--gv-accent)]' : 'border-[var(--gv-border-strong)]'}`}>{on && <span className="w-2 h-2 rounded-full bg-[var(--gv-accent)]" />}</span>
              <img src={a.url} alt="" className="h-9 w-32 shrink-0 object-cover rounded border border-[var(--gv-border-subtle)] bg-white" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--gv-text-primary)]">{a.name}</span>
            </button>
          );
        })}
        {items.length === 0 && (
          <p className="text-[12.5px] text-[var(--gv-text-tertiary)]">
            None saved yet.{' '}
            <button type="button" onClick={() => navigate('/brand-assets?tab=frames')} className="font-semibold text-[var(--gv-accent-text)] underline underline-offset-2">Add one in Brand assets</button>
          </p>
        )}
      </div>
    </div>
  );

  return (
    <section className="rounded-2xl border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)]" aria-label="Advanced options">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="advanced-options-body"
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span>
          <span className="block text-[16px] font-semibold text-[var(--gv-text-primary)]">Advanced options <span className="text-[13px] font-normal text-[var(--gv-text-tertiary)]">· optional</span></span>
          <span className="block mt-0.5 text-[13px] text-[var(--gv-text-secondary)]">{open ? 'Exact words, a reference picture, a header and footer. Leave empty and nothing is invented.' : summary}</span>
        </span>
        <ChevronDown className={`w-5 h-5 shrink-0 text-[var(--gv-text-tertiary)] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
      <div id="advanced-options-body" className="border-t border-[var(--gv-border-subtle)] p-5 sm:p-6 space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={suggest} disabled={suggesting}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--gv-accent)] bg-[var(--gv-accent-fill)] px-3.5 py-2 text-[13px] font-semibold text-[var(--gv-accent-text)] disabled:opacity-60">
          {suggesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Suggest with AI
        </button>
        <span className="text-[12.5px] text-[var(--gv-text-tertiary)]">Fills the empty boxes from your idea and your profile. You can change anything.</span>
        {suggestNote && <p role="status" className="basis-full text-[12.5px] text-[var(--gv-text-primary)]">{suggestNote}</p>}
      </div>

      {designed && (
        <div>
          <p className={sectionTitle}>1 · Exact text on the design</p>
          <p className="mt-1 text-[12.5px] text-[var(--gv-text-tertiary)]">{DETAIL_NOTE[mode]}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field id="pd-headline" text="Headline"><input id="pd-headline" className={input} value={design.details.headline} maxLength={90} onChange={(e) => setDetail('headline', e.target.value)} placeholder="For example: Festive Home Sale" /></Field>
            <Field id="pd-offer" text="Offer"><input id="pd-offer" className={input} value={design.details.offer} maxLength={120} onChange={(e) => setDetail('offer', e.target.value)} placeholder="For example: Up to 30% off this October" /></Field>
            <div className="md:col-span-2">
              <Field id="pd-items" text="Items and prices, one per line"><textarea id="pd-items" className={input} rows={3} value={design.details.items} onChange={(e) => setDetail('items', e.target.value)} placeholder={'Sofa sets from Rs 24,999\nSteel vessels from Rs 599'} /></Field>
            </div>
            <Field id="pd-phone" text="Phone"><input id="pd-phone" className={input} value={design.details.phone} maxLength={60} onChange={(e) => setDetail('phone', e.target.value)} placeholder="93442 83333" /></Field>
            <Field id="pd-hours" text="Opening hours"><input id="pd-hours" className={input} value={design.details.hours} maxLength={80} onChange={(e) => setDetail('hours', e.target.value)} placeholder="9:00 AM to 9:00 PM" /></Field>
            <div className="md:col-span-2">
              <Field id="pd-address" text="Address"><input id="pd-address" className={input} value={design.details.address} maxLength={200} onChange={(e) => setDetail('address', e.target.value)} placeholder="Shop name, road, town" /></Field>
            </div>
            <div className="md:col-span-2">
              <Field id="pd-tagline" text="Tagline"><input id="pd-tagline" className={input} value={design.details.tagline} maxLength={80} onChange={(e) => setDetail('tagline', e.target.value)} placeholder="All household items under one roof" /></Field>
            </div>
          </div>
        </div>
      )}

      <div className="border-t border-[var(--gv-border-subtle)] pt-6">
        <p className={sectionTitle}>2 · Reference picture <span className="normal-case tracking-normal font-normal text-[var(--gv-text-tertiary)]">(optional)</span></p>
        <div className="mt-3 flex flex-col sm:flex-row gap-4 sm:items-center">
          {design.referenceImage ? (
            <div className="flex items-center gap-4">
              <img src={design.referenceImage} alt="Your reference" className="h-28 w-[88px] object-cover rounded-lg border border-[var(--gv-border-default)]" />
              <button type="button" onClick={() => set({ referenceImage: '' })} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--gv-accent-text)]"><X className="w-4 h-4" />Remove</button>
            </div>
          ) : (
            <label className="shrink-0 w-full sm:w-56 h-28 rounded-xl border-2 border-dashed border-[var(--gv-border-strong)] flex flex-col items-center justify-center gap-1.5 text-[var(--gv-text-secondary)] cursor-pointer hover:border-[var(--gv-accent)]">
              <ImagePlus className="w-6 h-6" />
              <span className="text-[13px] font-semibold">Add a picture you like</span>
              <span className="text-[11.5px] text-[var(--gv-text-tertiary)]">PNG, JPG or WebP, up to 5 MB</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => { pickReference(e.target.files?.[0]); e.target.value = ''; }} aria-label="Reference picture" />
            </label>
          )}
          <p className="text-[13px] leading-relaxed text-[var(--gv-text-secondary)]">Found a post you like on Instagram or Pinterest? Add it and Nebulaa copies its layout and mood with your brand, products and text. It never copies their logo or words.</p>
        </div>
        {refNote && <p role="alert" className="mt-2 text-[12.5px] text-[var(--gv-text-primary)]">{refNote}</p>}
      </div>

      <div className="border-t border-[var(--gv-border-subtle)] pt-6">
        <p className={sectionTitle}>3 · Header and footer <span className="normal-case tracking-normal font-normal text-[var(--gv-text-tertiary)]">(optional)</span></p>
        <p className="mt-1 text-[12.5px] text-[var(--gv-text-tertiary)]">Strips laid over the top and bottom of the finished post, such as your address, GST number or branches. Your logo goes on top of them.</p>
        <div className="mt-4 grid gap-6 md:grid-cols-[1fr_1fr_190px]">
          <FrameChoice title="Header" items={headers} value={design.headerUrl} k="headerUrl" />
          <FrameChoice title="Footer" items={footers} value={design.footerUrl} k="footerUrl" />
          <div>
            <p className={label}>Preview</p>
            <PostPreview aspect={aspect} headerUrl={design.headerUrl} footerUrl={design.footerUrl} logoUrl={logoUrl} logoPosition={logoPosition} className="w-full max-w-[190px]" />
          </div>
        </div>
      </div>
      </div>
      )}
    </section>
  );
};

export default PostDesignPanel;
