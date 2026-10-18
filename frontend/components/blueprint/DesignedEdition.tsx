import React, { useEffect, useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import { GravityPanel, GravityLabel, GravityButton } from '../gravity';
import { apiService } from '../../services/api';
import { BlueprintView, designedActive, quarksNote } from '../../utils/blueprint';

/**
 * The designed PDF: one designed page for each part of the Blueprint, made as pictures, checked against your own
 * text, and merged into one PDF to share. The web Blueprint below stays as the instant version.
 */
const DesignedEdition: React.FC<{ view: BlueprintView; onStarted: () => void }> = ({ view, onStarted }) => {
  const d = view.designed;
  const [cost, setCost] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    apiService.getCredits().then((r: any) => { if (live && typeof r?.costs?.blueprint_pdf === 'number') setCost(r.costs.blueprint_pdf); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const start = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const r = await apiService.blueprintDesigned(view.id);
      if (!r?.success) throw new Error(r?.message || 'We could not start the designed PDF. Please try again.');
      onStarted();
    } catch (e: any) {
      setError(e?.data?.creditsExhausted ? 'You do not have enough Quarks for this. Please buy Quarks or upgrade your plan.' : (e?.message || 'We could not start the designed PDF. Please try again.'));
    } finally { setBusy(false); }
  };

  const thumbs = d && d.pages.length > 0 && (
    <ul className="grid grid-cols-4 sm:grid-cols-6 gap-2" aria-label="Pages of the designed PDF">
      {d.pages.map((p) => (
        <li key={p.n} className="rounded-lg overflow-hidden border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-2)] aspect-[3/4] flex items-center justify-center">
          {p.imageUrl
            ? <a href={p.imageUrl} target="_blank" rel="noreferrer" aria-label={`Page ${p.n}: ${p.title}`}><img src={p.imageUrl} alt="" loading="lazy" className="w-full h-full object-cover" /></a>
            : <span className="text-[11px] text-[var(--gv-text-tertiary)]">{String(p.n).padStart(2, '0')}</span>}
        </li>
      ))}
    </ul>
  );

  return (
    <GravityPanel contentClassName="space-y-4 bp-noprint">
      <div className="flex items-start gap-3">
        <FileText className="w-5 h-5 mt-0.5 text-[var(--gv-accent)] shrink-0" />
        <div>
          <GravityLabel gold>Designed PDF</GravityLabel>
          <p className="mt-1 text-[14px] leading-relaxed text-[var(--gv-text-secondary)]">
            A designed, shareable version of this Blueprint: a cover, one page for each part, and a closing page, in your brand colours with your logo. Each page is checked against your own text before it goes in.
          </p>
        </div>
      </div>

      {!d && (
        <div className="flex flex-wrap items-center gap-3">
          <GravityButton onClick={start} disabled={busy}>
            {busy ? (<><Loader2 className="w-4 h-4 animate-spin" /> Starting…</>) : `Make the designed PDF${cost ? ` · ${cost} Quarks` : ''}`}
          </GravityButton>
          <span className="text-[12.5px] text-[var(--gv-text-tertiary)]">{quarksNote(cost)} It takes about 5 to 10 minutes. You can leave this page.</span>
        </div>
      )}

      {designedActive(d) && d && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-[13.5px] text-[var(--gv-text-secondary)]">
            <Loader2 className="w-4 h-4 animate-spin text-[var(--gv-accent)]" />
            <span>Making your pages: {d.done} of {d.total} done. You can leave this page; it keeps going.</span>
          </div>
          {thumbs}
        </div>
      )}

      {d && d.status === 'completed' && (
        <div className="space-y-3">
          <a href={d.pdfUrl} target="_blank" rel="noreferrer" download className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-semibold bg-[var(--gv-accent)] text-[var(--gv-accent-ink)] hover:bg-[var(--gv-accent-hover)]">
            <Download className="w-4 h-4" /> Download the designed PDF
          </a>
          {d.pages.some((p) => p.status === 'fallback') && (
            <p className="text-[12.5px] text-[var(--gv-text-tertiary)]">A few pages are plain, made straight from your text, because the designed version could not be checked to match it.</p>
          )}
          {thumbs}
        </div>
      )}

      {d && d.status === 'failed' && (
        <div className="space-y-3">
          <p role="alert" className="text-[13.5px] text-[var(--gv-text-primary)]">{d.error || 'We could not make the designed PDF this time. Your Quarks were returned.'}</p>
          <GravityButton onClick={start} disabled={busy}>{busy ? 'Starting…' : 'Try again'}</GravityButton>
        </div>
      )}
      {error && <p role="alert" className="text-[13px] text-[var(--gv-text-primary)]">{error}</p>}
    </GravityPanel>
  );
};

export default DesignedEdition;
