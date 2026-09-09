import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Brain, Pencil, Trash2, RefreshCw, Loader2, ArrowRight, Check, X } from 'lucide-react';
import { aiMemoryAPI } from '../services/api';
import {
  GravityHero,
  GravityEmphasis,
  GravityLabel,
  GravityButton,
} from '../components/gravity';

type LearnedNote = {
  _id: string;
  text: string;
  category: 'copy' | 'hashtags' | 'cta' | 'visual' | 'timing' | 'format';
  confidence: number;
  updatedAt?: string;
  createdAt?: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  copy: 'Copy',
  hashtags: 'Hashtags',
  cta: 'Calls to action',
  visual: 'Visual style',
  timing: 'Timing',
  format: 'Format'
};

const Panel: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <section className={`rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 ${className}`}>{children}</section>
);

const NoteRow: React.FC<{
  note: LearnedNote;
  onSave: (id: string, text: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}> = ({ note, onSave, onDelete }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!draft.trim() || draft.trim() === note.text) { setEditing(false); return; }
    setBusy(true);
    try {
      await onSave(note._id, draft.trim());
      setEditing(false);
    } catch {
      // error already surfaced via the parent's statusMsg; keep editing open so the draft isn't lost
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-white/[0.05] last:border-b-0">
      <span className="mt-0.5 inline-flex items-center rounded-full border border-[#F5A623]/25 bg-[#F5A623]/[0.08] px-2 py-0.5 text-[10.5px] font-semibold text-[#F5A623] flex-shrink-0">
        {CATEGORY_LABELS[note.category] || note.category}
      </span>
      {editing ? (
        <div className="flex-1 flex items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="flex-1 px-2.5 py-1.5 rounded-md bg-black/30 border border-white/[0.10] text-[13px] text-[#F5F4F1] outline-none focus:border-[#F5A623]/40"
            autoFocus
          />
          <button onClick={save} disabled={busy} title="Save" className="p-1.5 rounded-md text-emerald-400 hover:bg-white/[0.06] disabled:opacity-40">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => { setDraft(note.text); setEditing(false); }} title="Cancel" className="p-1.5 rounded-md text-white/40 hover:bg-white/[0.06]">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <>
          <p className="flex-1 text-[13px] text-[#F5F4F1] leading-relaxed">{note.text}</p>
          <button onClick={() => setEditing(true)} title="Edit" className="p-1.5 rounded-md text-white/40 hover:text-white hover:bg-white/[0.06] flex-shrink-0">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => { if (window.confirm('Delete this note?')) onDelete(note._id); }} title="Delete" className="p-1.5 rounded-md text-white/40 hover:text-red-400 hover:bg-white/[0.06] flex-shrink-0">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </div>
  );
};

const AIMemory: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [distilling, setDistilling] = useState(false);
  const [data, setData] = useState<any>(null);
  const [statusMsg, setStatusMsg] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await aiMemoryAPI.getSummary();
      setData(res);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const notes: LearnedNote[] = useMemo(() => data?.brandMemory?.learnedNotes || [], [data]);
  const notesUpdatedAt: string | null = data?.brandMemory?.learnedNotesUpdatedAt || null;
  const performanceCount: number = data?.summary?.performanceMemories || 0;

  const saveNote = async (id: string, text: string) => {
    try {
      await aiMemoryAPI.updateNote(id, { text });
      await load();
    } catch (err: any) {
      setStatusMsg(err?.message || 'Could not save the note. Please try again.');
      window.setTimeout(() => setStatusMsg(''), 4000);
      throw err;
    }
  };

  const deleteNote = async (id: string) => {
    try {
      await aiMemoryAPI.deleteNote(id);
      await load();
    } catch (err: any) {
      setStatusMsg(err?.message || 'Could not delete the note. Please try again.');
      window.setTimeout(() => setStatusMsg(''), 4000);
    }
  };

  const refreshNow = async () => {
    setDistilling(true);
    setStatusMsg('');
    try {
      const res = await aiMemoryAPI.distillNow();
      setStatusMsg(res.skipped ? 'No new performance data since the last update.' : 'Updated with the latest performance data.');
      await load();
    } catch (err: any) {
      setStatusMsg(err?.message || 'Could not refresh.');
    } finally {
      setDistilling(false);
      window.setTimeout(() => setStatusMsg(''), 4000);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#F5A623]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <GravityHero
          align="left"
          eyebrow="AI Memory"
          headline={<>What Gravity has <GravityEmphasis>learned</GravityEmphasis></>}
          subcopy="A small, curated set of patterns learned from your real published-post performance — not a raw log."
          className="!mb-0"
        />
        <GravityButton variant="ghost" onClick={refreshNow} disabled={distilling} className="flex-shrink-0">
          {distilling ? <Loader2 className="w-4 h-4 animate-spin text-[#F5A623]" /> : <RefreshCw className="w-4 h-4 text-[#F5A623]" />}
          Refresh now
        </GravityButton>
      </div>

      {statusMsg && (
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-[12.5px] text-white/70">
          {statusMsg}
        </div>
      )}

      <Panel>
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-[#F5A623]" />
            <GravityLabel gold>Learned patterns</GravityLabel>
          </div>
          <span className="text-[11px] text-white/40">
            Based on {performanceCount} tracked post{performanceCount === 1 ? '' : 's'}
            {notesUpdatedAt ? ` · last updated ${new Date(notesUpdatedAt).toLocaleDateString()}` : ''}
          </span>
        </div>
        {notes.length ? (
          <div className="mt-3">
            {notes.map((note) => (
              <NoteRow key={note._id} note={note} onSave={saveNote} onDelete={deleteNote} />
            ))}
          </div>
        ) : (
          <p className="mt-3 text-[13px] text-white/45">
            Nothing learned yet — this fills in once enough published posts have been tracked
            for at least a few days. Try "Refresh now" after some posts have been live for a while.
          </p>
        )}
      </Panel>

      <div className="grid gap-3 md:grid-cols-3">
        {[
          { to: '/ai-history', label: 'Campaign history' },
          { to: '/ai-history?type=video', label: 'Video history' },
          { to: '/ai-performance', label: 'Performance log' },
        ].map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="group flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-5 py-4 text-[13.5px] font-semibold text-[#F5F4F1] transition-all hover:bg-white/[0.05] hover:border-white/[0.12]"
          >
            {link.label}
            <ArrowRight className="w-4 h-4 text-white/30 group-hover:text-[#F5A623] transition-colors" />
          </Link>
        ))}
      </div>
    </div>
  );
};

export default AIMemory;
