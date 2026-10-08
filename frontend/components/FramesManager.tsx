import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Trash2, Upload, Star } from 'lucide-react';
import { GravityLabel, GravityButton } from './gravity';
import PostPreview from './PostPreview';
import { brandAssetsAPI } from '../services/api';
import { FRAME_SPECS, referenceFileProblem } from '../utils/postDesign';

type Kind = 'header' | 'footer';
const field = 'w-full rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-3 py-2.5 text-[14px] text-[var(--gv-text-primary)] placeholder:text-[var(--gv-text-tertiary)] focus:outline-none';

const readFile = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result || ''));
  r.onerror = () => reject(new Error('We could not read that file.'));
  r.readAsDataURL(file);
});

/** Save headers and footers (an address and GST strip, the branches) once, then add them to any post. */
const FramesManager: React.FC<{ logoUrl?: string; logoPosition?: string }> = ({ logoUrl, logoPosition }) => {
  const [headers, setHeaders] = useState<any[]>([]);
  const [footers, setFooters] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<Kind>('footer');
  const [name, setName] = useState('');
  const [focus, setFocus] = useState<'north' | 'centre' | 'south'>('centre');
  const [file, setFile] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [previewHeader, setPreviewHeader] = useState('');
  const [previewFooter, setPreviewFooter] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await brandAssetsAPI.getFrames();
      setHeaders(r.headers || []); setFooters(r.footers || []);
      setPreviewHeader((p) => p || (r.headers || [])[0]?.url || '');
      setPreviewFooter((p) => p || (r.footers || [])[0]?.url || '');
    } catch { setNote('We could not load your headers and footers.'); setFailed(true); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const pick = async (f?: File) => {
    const problem = referenceFileProblem(f);
    if (problem) { setNote(problem); setFailed(true); return; }
    setNote(''); setFailed(false);
    setFile(await readFile(f as File));
    if (!name && f) setName(f.name.replace(/\.[^.]+$/, '').slice(0, 60));
  };

  const save = async () => {
    if (busy) return;
    if (!file) { setNote('Choose a picture first.'); setFailed(true); return; }
    if (!name.trim()) { setNote('Give it a name.'); setFailed(true); return; }
    setBusy(true); setNote(''); setFailed(false);
    try {
      const r = await brandAssetsAPI.addFrame({ kind, imageData: file, name: name.trim(), position: focus });
      if (!r?.success) throw new Error(r?.message || 'We could not save your picture.');
      setFile(''); setName(''); if (input.current) input.current.value = '';
      setNote(`Saved. It is now in your ${kind}s.`);
      await load();
    } catch (e: any) { setNote(e?.message || 'We could not save your picture. Please try again.'); setFailed(true); }
    setBusy(false);
  };

  const makeDefault = async (id: string) => { try { await brandAssetsAPI.setDefaultFrame(id); await load(); } catch { setNote('Could not change the default.'); setFailed(true); } };
  const remove = async (id: string) => { try { await brandAssetsAPI.delete(id); await load(); } catch { setNote('Could not delete it.'); setFailed(true); } };

  const spec = FRAME_SPECS[kind];
  const Row: React.FC<{ title: string; items: any[]; k: Kind }> = ({ title, items, k }) => (
    <div className="space-y-2">
      <GravityLabel>{title}</GravityLabel>
      {items.length === 0 ? <p className="text-[13px] text-[var(--gv-text-tertiary)]">None yet.</p> : (
        <ul className="space-y-2">
          {items.map((a) => (
            <li key={a._id} className="flex items-center gap-3 rounded-lg border border-[var(--gv-border-subtle)] p-2">
              <img src={a.url} alt={a.name} className="h-10 w-40 object-cover rounded border border-[var(--gv-border-subtle)] bg-white cursor-pointer" onClick={() => (k === 'header' ? setPreviewHeader(a.url) : setPreviewFooter(a.url))} />
              <span className="flex-1 min-w-0 truncate text-[13.5px] font-semibold text-[var(--gv-text-primary)]">{a.name}{a.isPrimary && <span className="ml-2 text-[11px] font-semibold text-[var(--gv-accent-text)]">Default</span>}</span>
              {!a.isPrimary && <button type="button" onClick={() => makeDefault(a._id)} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-[var(--gv-accent-text)]"><Star className="w-3.5 h-3.5" />Make default</button>}
              <button type="button" onClick={() => remove(a._id)} aria-label={`Delete ${a.name}`} className="text-[var(--gv-coral-text)]"><Trash2 className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="grid lg:grid-cols-[1fr_260px] gap-6">
      <div className="space-y-6">
        <p className="text-[13.5px] text-[var(--gv-text-secondary)]">A header or footer is a strip laid over the top or bottom of a post, for your address, GST number, phone or branches. Keep several, for example one per branch, and choose one for each post. Parts you leave transparent show the post underneath.</p>
        <div className="rounded-xl border border-[var(--gv-border-subtle)] p-4 space-y-3">
          <GravityLabel gold>Add a header or footer</GravityLabel>
          <div className="flex gap-2" role="group" aria-label="Kind">
            {(['footer', 'header'] as Kind[]).map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={`h-9 px-4 rounded-full text-[13px] font-semibold border ${kind === k ? 'bg-[var(--gv-accent-fill)] border-[var(--gv-accent)]' : 'border-[var(--gv-border-default)] text-[var(--gv-text-secondary)]'}`}>{k === 'footer' ? 'Footer' : 'Header'}</button>
            ))}
          </div>
          <p className="text-[12.5px] text-[var(--gv-text-tertiary)]">Best size: {spec.width} × {spec.height} pixels. Any other picture is cut to that shape; choose which part to keep below.</p>
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => pick(e.target.files?.[0])} className="text-[13px]" aria-label="Choose a picture" />
          {file && <img src={file} alt="Chosen picture" className="max-h-24 rounded border border-[var(--gv-border-subtle)]" />}
          <div className="flex flex-wrap gap-2" role="group" aria-label="Which part to keep">
            {([['north', 'Keep the top'], ['centre', 'Keep the middle'], ['south', 'Keep the bottom']] as const).map(([v, l]) => (
              <button key={v} type="button" aria-pressed={focus === v} onClick={() => setFocus(v)} className={`h-8 px-3 rounded-full text-[12.5px] font-semibold border ${focus === v ? 'bg-[var(--gv-accent-fill)] border-[var(--gv-accent)]' : 'border-[var(--gv-border-default)] text-[var(--gv-text-secondary)]'}`}>{l}</button>
            ))}
          </div>
          <input className={field} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Name, for example: Vadalur branch" aria-label="Name" />
          <GravityButton onClick={save} disabled={busy}>{busy ? (<><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>) : (<><Upload className="w-4 h-4" /> Save {kind}</>)}</GravityButton>
          {note && <p role={failed ? 'alert' : 'status'} className="text-[13px] text-[var(--gv-text-primary)]">{note}</p>}
        </div>
        {loading ? <Loader2 className="w-5 h-5 animate-spin text-[var(--gv-accent)]" /> : (<><Row title="Headers" items={headers} k="header" /><Row title="Footers" items={footers} k="footer" /></>)}
      </div>
      <div>
        <GravityLabel className="mb-2">Preview</GravityLabel>
        <PostPreview aspect="4:5" headerUrl={previewHeader} footerUrl={previewFooter} logoUrl={logoUrl} logoPosition={logoPosition} />
        <p className="mt-2 text-[12px] text-[var(--gv-text-tertiary)]">Click a saved strip to preview it. The logo shows where it goes on a post.</p>
      </div>
    </div>
  );
};

export default FramesManager;
