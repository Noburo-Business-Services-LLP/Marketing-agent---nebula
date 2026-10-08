import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ImagePlus, X } from 'lucide-react';
import { GravityLabel } from './gravity';
import PostPreview from './PostPreview';
import { brandAssetsAPI } from '../services/api';
import { POST_STYLE_OPTIONS, PostDesign, PostDetails, referenceFileProblem } from '../utils/postDesign';

const field = 'w-full rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-3 py-2 text-[13.5px] text-[var(--gv-text-primary)] placeholder:text-[var(--gv-text-tertiary)] focus:outline-none';

const DETAIL_NOTE: Record<string, string> = {
  single: 'Only the text you type here is put on the design. Leave a box empty and it is left out.',
  carousel: 'The headline, offer and items go on the first slide. Phone, address, hours and tagline go on the last slide.',
  campaign: 'Phone, address, hours and tagline repeat on every post. The headline and offer of each post come from its own idea.',
};

/** The look of a post: a design style with sample pictures, the exact text to show, a picture to copy, and a saved header and footer. */
const PostDesignPanel: React.FC<{
  design: PostDesign;
  onChange: (next: PostDesign) => void;
  mode: 'single' | 'carousel' | 'campaign';
  aspect: string;
  logoUrl?: string;
  logoPosition?: string;
}> = ({ design, onChange, mode, aspect, logoUrl, logoPosition }) => {
  const navigate = useNavigate();
  const [headers, setHeaders] = useState<any[]>([]);
  const [footers, setFooters] = useState<any[]>([]);
  const [refNote, setRefNote] = useState('');
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

  const designed = design.style !== 'plain';
  const FrameRow: React.FC<{ label: string; items: any[]; value: string; k: 'headerUrl' | 'footerUrl' }> = ({ label, items, value, k }) => (
    <div>
      <div className="gravity-label mb-2">{label}</div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <button type="button" onClick={() => chooseFrame(k, '')} aria-pressed={!value} className={`rounded-lg border px-3 py-2 text-[12px] font-semibold ${!value ? 'border-[var(--gv-accent)] bg-[var(--gv-accent-fill)] text-[var(--gv-accent-text)]' : 'border-[var(--gv-border-default)] text-[var(--gv-text-tertiary)]'}`}>None</button>
        {items.map((a) => (
          <button key={a._id} type="button" onClick={() => chooseFrame(k, a.url)} aria-pressed={value === a.url} title={a.name} className={`h-11 w-28 rounded-lg border overflow-hidden bg-white ${value === a.url ? 'border-[var(--gv-accent)]' : 'border-[var(--gv-border-default)]'}`}>
            <img src={a.url} alt={a.name} className="w-full h-full object-cover" />
          </button>
        ))}
        {items.length === 0 && <button type="button" onClick={() => navigate('/brand-assets?tab=frames')} className="text-[11.5px] text-[var(--gv-text-muted)] hover:text-[var(--gv-accent-text)] underline underline-offset-2">Add one in Brand assets</button>}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <div className="gravity-label mb-2">Post style</div>
        <div className="grid grid-cols-2 gap-2.5" role="radiogroup" aria-label="Post style">
          {POST_STYLE_OPTIONS.map((s) => {
            const on = design.style === s.id;
            return (
              <button key={s.id} type="button" role="radio" aria-checked={on} onClick={() => set({ style: s.id })}
                className={`text-left rounded-xl overflow-hidden border-2 transition-colors ${on ? 'border-[var(--gv-accent)]' : 'border-[var(--gv-border-default)] hover:border-[var(--gv-border-strong)]'}`}>
                <img src={s.sample} alt="" loading="lazy" className="w-full aspect-[4/5] object-cover bg-[var(--gv-surface-2)]" />
                <span className="block px-2.5 py-2">
                  <span className="block text-[12.5px] font-semibold text-[var(--gv-text-primary)]">{s.label}</span>
                  <span className="block text-[11px] text-[var(--gv-text-tertiary)] leading-snug">{s.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11.5px] text-[var(--gv-text-muted)]">The pictures are examples of the look, not your own products.</p>
      </div>

      {designed && (
        <div className="space-y-2.5">
          <div className="gravity-label">Text to show on the design</div>
          <p className="text-[12px] text-[var(--gv-text-tertiary)]">{DETAIL_NOTE[mode]}</p>
          <input className={field} value={design.details.headline} maxLength={90} onChange={(e) => setDetail('headline', e.target.value)} placeholder="Headline, for example: Festive Home Sale" aria-label="Headline" />
          <input className={field} value={design.details.offer} maxLength={120} onChange={(e) => setDetail('offer', e.target.value)} placeholder="The offer, for example: Up to 30% off this October" aria-label="Offer" />
          <textarea className={field} rows={3} value={design.details.items} onChange={(e) => setDetail('items', e.target.value)} placeholder={'Items and prices, one per line\nSofa sets from Rs 24,999\nSteel vessels from Rs 599'} aria-label="Items and prices" />
          <div className="grid sm:grid-cols-2 gap-2.5">
            <input className={field} value={design.details.phone} maxLength={60} onChange={(e) => setDetail('phone', e.target.value)} placeholder="Phone" aria-label="Phone" />
            <input className={field} value={design.details.hours} maxLength={80} onChange={(e) => setDetail('hours', e.target.value)} placeholder="Opening hours" aria-label="Opening hours" />
            <input className={field} value={design.details.address} maxLength={200} onChange={(e) => setDetail('address', e.target.value)} placeholder="Address" aria-label="Address" />
            <input className={field} value={design.details.tagline} maxLength={80} onChange={(e) => setDetail('tagline', e.target.value)} placeholder="Tagline" aria-label="Tagline" />
          </div>
        </div>
      )}

      <div>
        <div className="gravity-label mb-2">Reference picture <span className="text-[var(--gv-text-muted)] normal-case">· optional</span></div>
        {design.referenceImage ? (
          <div className="flex items-center gap-3">
            <img src={design.referenceImage} alt="Your reference" className="h-20 w-16 object-cover rounded-lg border border-[var(--gv-border-default)]" />
            <button type="button" onClick={() => set({ referenceImage: '' })} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-[var(--gv-accent-text)]"><X className="w-3.5 h-3.5" />Remove</button>
          </div>
        ) : (
          <label className="inline-flex items-center gap-2 rounded-lg border border-dashed border-[var(--gv-border-strong)] px-3 py-2 text-[12.5px] font-semibold text-[var(--gv-text-secondary)] cursor-pointer">
            <ImagePlus className="w-4 h-4" />Add a picture you like
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { pickReference(e.target.files?.[0]); e.target.value = ''; }} aria-label="Reference picture" />
          </label>
        )}
        <p className="mt-1.5 text-[11.5px] text-[var(--gv-text-muted)]">Found a post you like on Instagram or Pinterest? Add it and Nebulaa copies its layout and mood with your brand, products and text. It never copies their logo or words.</p>
        {refNote && <p role="alert" className="mt-1 text-[12px] text-[var(--gv-text-primary)]">{refNote}</p>}
      </div>

      <div className="space-y-3">
        <FrameRow label="Header" items={headers} value={design.headerUrl} k="headerUrl" />
        <FrameRow label="Footer" items={footers} value={design.footerUrl} k="footerUrl" />
        {(design.headerUrl || design.footerUrl || logoUrl) && (
          <div>
            <div className="gravity-label mb-1.5 text-[var(--gv-text-muted)]">Preview</div>
            <PostPreview aspect={aspect} headerUrl={design.headerUrl} footerUrl={design.footerUrl} logoUrl={logoUrl} logoPosition={logoPosition} className="w-40" />
          </div>
        )}
      </div>
    </div>
  );
};

export default PostDesignPanel;
