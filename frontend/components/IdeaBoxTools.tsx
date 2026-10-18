import React, { useEffect, useRef, useState } from 'react';
import { Mic, Paperclip, Square, Loader2, X, FileText, Image as ImageIcon } from 'lucide-react';
import { apiService } from '../services/api';
import { ACCEPT, fileProblem, speechLanguage, referenceOfferFor, referenceOfferText, referenceAddedText, micProblemText } from '../utils/ideaFiles';

export interface ReadUpload { id: string; name: string; kind: string; url: string; summary: string; brief: string; details: Record<string, string>; notes: string }

const MAX_RECORD_SECONDS = 60;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(file);
  });
}

/** Large photos are shrunk before sending: a 12 MP phone picture reads exactly as well at 1800 pixels. */
async function shrinkImage(file: File): Promise<string> {
  const dataUrl = await readAsDataUrl(file);
  if (!/^image\/(png|jpe?g|webp)$/i.test(file.type) || file.size < 1.5 * 1024 * 1024) return dataUrl;
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
    const scale = Math.min(1, 1800 / Math.max(img.width, img.height));
    if (scale >= 1) return dataUrl;
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.88);
  } catch { return dataUrl; }
}

/**
 * Voice and file buttons for the idea box. Speech becomes text in the box; a dropped picture or PDF is read and its
 * facts are handed back so the brief and the optional fields can be filled in. Nothing is made up here: the server
 * only reports what is printed in the file.
 */
const IdeaBoxTools: React.FC<{
  languageLabel: string;
  onText: (text: string) => void;
  onRead: (uploads: ReadUpload[]) => void;
  /** a saved file chosen again from the recent list: no new reading is needed */
  onReuse?: (upload: ReadUpload) => void;
  /** where a photo with no text can go instead, for example a person, place or product reference */
  referenceChoices?: Array<{ label: string; onPick: (asset: { name: string; dataUrl: string }) => void | string }>;
}> = ({ languageLabel, onText, onRead, onReuse, referenceChoices }) => {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState('');
  const [offers, setOffers] = useState<Array<{ name: string; dataUrl: string }>>([]);
  const [added, setAdded] = useState('');
  const [attached, setAttached] = useState<ReadUpload[]>([]);
  const [recent, setRecent] = useState<ReadUpload[]>([]);
  const [dragging, setDragging] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const supportsVoice = typeof window !== 'undefined' && typeof (window as any).MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => {
    apiService.createAssistUploads().then((r) => setRecent((r.uploads || []) as ReadUpload[])).catch(() => undefined);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); streamRef.current?.getTracks().forEach((t) => t.stop()); };
  }, []);

  const stopRecording = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
  };

  const startRecording = async () => {
    setNote('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) => (window as any).MediaRecorder.isTypeSupported?.(m)) || '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || mime || 'audio/webm' });
        if (blob.size < 1500) { setNote('That was too short. Tap the mic and speak for a few seconds.'); return; }
        setTranscribing(true);
        try {
          const audio = await readAsDataUrl(new File([blob], 'voice', { type: blob.type }));
          const r = await apiService.createAssistTranscribe({ audio, language: speechLanguage(languageLabel) });
          if (r.success && r.text) onText(r.text); else setNote(r.message || 'Could not turn that into text. Please try again, or type it.');
        } catch {
          setNote('Could not turn that into text. Please try again, or type it.');
        } finally { setTranscribing(false); }
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
      timerRef.current = setTimeout(stopRecording, MAX_RECORD_SECONDS * 1000);
    } catch (e: any) {
      setNote(micProblemText(e?.name, typeof window === 'undefined' || window.isSecureContext !== false));
    }
  };

  const addFiles = async (list: FileList | File[]) => {
    const files = Array.from(list);
    setNote(''); setOffers([]); setAdded('');
    const accepted: File[] = [];
    let count = attached.length;
    for (const f of files) {
      const problem = fileProblem(f, count);
      if (problem) { setNote(problem); continue; }
      accepted.push(f); count += 1;
    }
    if (!accepted.length) return;
    setReading(true);
    try {
      const payload = await Promise.all(accepted.map(async (f) => ({ name: f.name, data: await shrinkImage(f) })));
      const r = await apiService.createAssistReadFiles({ files: payload, language: languageLabel });
      if (!r.success || !r.results) { setNote(r.message || 'Could not read the files. You can type the details in.'); return; }
      const ok = r.results.filter((x) => x.ok && x.upload).map((x) => x.upload as ReadUpload);
      const bad = r.results.filter((x) => !x.ok);
      const offered = bad.filter((b) => { const f = accepted.find((a) => a.name === b.name); return referenceOfferFor({ file: f, message: b.message, hasChoices: !!referenceChoices?.length }); });
      const rest = bad.filter((b) => !offered.includes(b));
      if (offered.length) setOffers(offered.map((b) => ({ name: b.name, dataUrl: payload.find((p) => p.name === b.name)?.data || '' })).filter((o) => o.dataUrl));
      if (ok.length) { setAttached((a) => [...a, ...ok]); setRecent((rc) => [...ok, ...rc.filter((x) => !ok.some((o) => o.id === x.id))].slice(0, 6)); onRead(ok); }
      if (rest.length) setNote(rest.map((b) => `${b.name}: ${b.message}`).join(' '));
    } catch {
      setNote('Could not read the files. You can type the details in.');
    } finally { setReading(false); }
  };

  const removeSaved = async (u: ReadUpload) => {
    setRecent((r) => r.filter((x) => x.id !== u.id));
    setAttached((a) => a.filter((x) => x.id !== u.id));
    try { await apiService.createAssistDeleteUpload(u.id); } catch { /* the list reloads next time */ }
  };

  const busy = reading || transcribing;
  return (
    <div
      className={`mt-3 rounded-xl border border-dashed px-3 py-2.5 transition-colors ${dragging ? 'border-[var(--gv-accent)] bg-[var(--gv-accent-fill)]' : 'border-[var(--gv-border-default)]'}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {supportsVoice && (
          <button
            type="button"
            onClick={recording ? stopRecording : startRecording}
            disabled={busy}
            aria-pressed={recording}
            className={`inline-flex items-center gap-2 h-10 px-3.5 rounded-lg border text-[13px] font-semibold disabled:opacity-60 ${recording ? 'border-red-500 bg-red-500/10 text-red-600' : 'border-[var(--gv-border-default)] bg-[var(--gv-surface-1)] text-[var(--gv-text-primary)]'}`}
          >
            {recording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            {recording ? 'Stop' : 'Speak your idea'}
          </button>
        )}
        <label className={`inline-flex items-center gap-2 h-10 px-3.5 rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-surface-1)] text-[13px] font-semibold text-[var(--gv-text-primary)] cursor-pointer ${busy ? 'opacity-60 pointer-events-none' : ''}`}>
          <Paperclip className="w-4 h-4" />
          Add a picture or PDF
          <input type="file" accept={ACCEPT} multiple className="sr-only" aria-label="Add a picture or PDF" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
        </label>
        {recording && <span className="inline-flex items-center gap-2 text-[12.5px] text-red-600" role="status"><span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />Listening… tap Stop when you finish</span>}
        {transcribing && <span className="inline-flex items-center gap-2 text-[12.5px] text-[var(--gv-text-secondary)]" role="status"><Loader2 className="w-4 h-4 animate-spin" />Writing it down…</span>}
        {reading && <span className="inline-flex items-center gap-2 text-[12.5px] text-[var(--gv-text-secondary)]" role="status"><Loader2 className="w-4 h-4 animate-spin" />Reading your file…</span>}
        {!recording && !busy && <span className="text-[12px] text-[var(--gv-text-tertiary)]">Or drop a pamphlet, poster or price list here.</span>}
      </div>

      {offers.map((o) => (
        <div key={o.name} className="mt-2" role="alert">
          <p className="text-[12.5px] text-[var(--gv-text-primary)]">{referenceOfferText(o.name)}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {(referenceChoices || []).map((c) => (
              <button key={c.label} type="button" onClick={() => { const full = c.onPick({ name: o.name, dataUrl: o.dataUrl }); if (typeof full === 'string') { setAdded(full); return; } setOffers((x) => x.filter((y) => y.name !== o.name)); setAdded(referenceAddedText(c.label)); }} className="h-8 px-3 rounded-full border border-[var(--gv-border-default)] bg-[var(--gv-surface-1)] text-[12.5px] font-semibold text-[var(--gv-text-primary)]">{c.label}</button>
            ))}
          </div>
        </div>
      ))}
      {added && <p role="status" className="mt-2 text-[12.5px] text-[var(--gv-text-primary)]">{added}</p>}
      {note && <p role="alert" className="mt-2 text-[12.5px] text-[var(--gv-text-primary)]">{note}</p>}

      {attached.length > 0 && (
        <ul className="mt-2.5 space-y-1.5">
          {attached.map((u) => (
            <li key={u.id} className="flex items-start gap-2 rounded-lg bg-[var(--gv-surface-1)] px-2.5 py-2 text-[12.5px]">
              {/\.pdf$/i.test(u.name) ? <FileText className="w-4 h-4 mt-0.5 shrink-0" /> : <ImageIcon className="w-4 h-4 mt-0.5 shrink-0" />}
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-[var(--gv-text-primary)] truncate">{u.name}</span>
                <span className="block text-[var(--gv-text-secondary)]">{u.summary || 'Read. The idea and details were filled in below: please check them.'}</span>
                {u.notes && <span className="block text-[var(--gv-text-tertiary)]">Note: {u.notes}</span>}
              </span>
              <button type="button" onClick={() => setAttached((a) => a.filter((x) => x.id !== u.id))} aria-label={`Remove ${u.name} from this post`} className="p-1 text-[var(--gv-text-tertiary)] hover:text-[var(--gv-text-primary)]"><X className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
      )}

      {recent.filter((r) => !attached.some((a) => a.id === r.id)).length > 0 && onReuse && (
        <div className="mt-2.5">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-[var(--gv-text-tertiary)]">Use a saved file</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {recent.filter((r) => !attached.some((a) => a.id === r.id)).slice(0, 5).map((u) => (
              <span key={u.id} className="inline-flex items-center rounded-full border border-[var(--gv-border-default)] bg-[var(--gv-surface-1)] text-[12px]">
                <button type="button" onClick={() => { setAttached((a) => [...a, u]); onReuse(u); }} className="pl-2.5 pr-1.5 py-1 font-semibold text-[var(--gv-text-primary)] max-w-[180px] truncate">{u.name}</button>
                <button type="button" onClick={() => removeSaved(u)} aria-label={`Delete ${u.name}`} className="pr-2 pl-0.5 py-1 text-[var(--gv-text-tertiary)] hover:text-[var(--gv-text-primary)]"><X className="w-3.5 h-3.5" /></button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default IdeaBoxTools;
