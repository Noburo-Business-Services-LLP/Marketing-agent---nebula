import React, { useState } from 'react';
import { priceWithWorth } from '../utils/plans';
import { useQuarkCosts } from '../hooks/useQuarkCosts';
import { Loader2, X, Check, RefreshCw, Wand2 } from 'lucide-react';
import { studioVideosAPI } from '../services/api';
import { GravityButton } from './gravity';
import type { PickedAsset } from './AssetPicker';

/**
 * Make a person (a reference sheet showing the same person from several angles) or a place with AI, look at it, and
 * keep it or ask for another. Each picture costs a few Quarks, shown before it is made. A kept picture is saved to the
 * brand assets so it can be used again in later videos.
 */
const ReferenceMaker: React.FC<{
  kind: 'person' | 'place';
  initialDescription: string;
  quarks: number;
  onUse: (asset: PickedAsset) => void;
  onClose: () => void;
}> = ({ kind, initialDescription, quarks, onUse, onClose }) => {
  const costs = useQuarkCosts();
  const [description, setDescription] = useState(initialDescription);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const person = kind === 'person';

  const make = async () => {
    setError(''); setBusy(true);
    try {
      const r = await studioVideosAPI.makeReference(kind, description);
      if (!r?.success || !r.url) { setError(r?.message || 'We could not make that picture. Please try again.'); return; }
      setUrl(r.url);
    } catch (e: any) {
      setError(e?.data?.message || e?.message || 'We could not make that picture. Please try again.');
    } finally { setBusy(false); }
  };

  const keep = async () => {
    setError(''); setBusy(true);
    try {
      const name = description.trim().slice(0, 50) || (person ? 'Person' : 'Place');
      const r = await studioVideosAPI.approveReference(kind, url, name);
      if (!r?.success || !r.asset) { setError(r?.message || 'We could not save that picture. Please try again.'); return; }
      onUse({ id: r.asset.id, name: r.asset.name, imageUrl: r.asset.url });
    } catch (e: any) {
      setError(e?.message || 'We could not save that picture. Please try again.');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={person ? 'Create a person' : 'Create a place'}>
      <div
        className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--gv-border-default)] p-5 shadow-2xl"
        // Solid, not the translucent panel colour: the page behind must not show through a dialog.
        style={{ background: typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? '#15171c' : '#fffdf8' }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-serif-display text-[22px] text-[var(--gv-text-primary)]">{person ? 'Create the person' : 'Create the place'}</h3>
            <p className="mt-1 text-[12.5px] text-[var(--gv-text-secondary)]">
              {person
                ? 'We make a reference sheet: the same person from the front, side and close up, so they look the same all through the video.'
                : 'We make a photo of the place, so the video is filmed there.'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-[var(--gv-text-tertiary)] hover:text-[var(--gv-text-primary)]"><X className="h-4 w-4" /></button>
        </div>

        <label className="gravity-label mb-1 mt-4 block" htmlFor="ref-desc">{person ? 'Describe the person' : 'Describe the place'}</label>
        <textarea
          id="ref-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={300}
          placeholder={person ? 'A smiling shopkeeper in her 40s in a cotton saree, glasses, warm and confident' : 'A busy sweet shop with glass counters, brass lamps and marigold garlands'}
          className="w-full rounded-xl border border-[var(--gv-border-default)] bg-[var(--gv-surface-2)] px-4 py-3 text-[14px] text-[var(--gv-text-primary)] outline-none focus:border-[var(--gv-accent)]"
        />

        {error && <p role="alert" className="mt-3 rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-surface-2)] px-3 py-2 text-[13px] text-[var(--gv-text-primary)]">{error}</p>}

        {url && (
          <div className="mt-4">
            <img src={url} alt={person ? 'The person from several angles' : 'The place'} className={`w-full rounded-xl border border-[var(--gv-border-default)] object-cover ${person ? 'aspect-video' : 'aspect-[9/12] max-h-[420px]'}`} />
            <p className="mt-2 text-[12.5px] text-[var(--gv-text-secondary)]">Happy with this? Use it. If not, change the description and make another.</p>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <span className="text-[12px] text-[var(--gv-text-tertiary)]">{quarks ? `${priceWithWorth(quarks, costs)} each time you make one` : ''}</span>
          <div className="flex gap-2">
            {url ? (
              <>
                <GravityButton variant="ghost" disabled={busy || !description.trim()} onClick={make}><RefreshCw className="h-4 w-4" /> Make another</GravityButton>
                <GravityButton disabled={busy} onClick={keep}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Use this</GravityButton>
              </>
            ) : (
              <GravityButton disabled={busy || description.trim().length < 5} onClick={make}>
                {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Making it…</> : <><Wand2 className="h-4 w-4" /> Create</>}
              </GravityButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReferenceMaker;
