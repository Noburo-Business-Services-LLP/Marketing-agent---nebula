import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, BarChart3, Brain, CalendarDays, Check, Clock, Film, Hash, History, LayoutGrid, Loader2, MousePointerClick,
  Palette, Pencil, RefreshCw, Trash2, Type, X,
} from 'lucide-react';
import { aiMemoryAPI } from '../services/api';
import { useConfirm } from '../context/ConfirmContext';
import { MemoryArt } from '../components/art/Memory';
import { MemoryGrowArt } from '../components/art/memory/Grow';
import { PlanSparkleArt } from '../components/art/plan/Sparkle';
import { fillRows } from '../utils/rowSpans';
import { CATEGORY_INFO, STRENGTH_LABEL, groupNotes, trackedLabel, waitingHint } from '../utils/memoryView';
import type { LearnedNote, MemoryCategory, PatternGroup } from '../utils/memoryView';
import '../components/memory/memory.css';
import PageHeader from '../components/PageHeader';

/**
 * Brand memory: what Nebulaa has learned from how the published posts did. A cream and gold hero with the count of
 * tracked posts and Refresh now, the learned notes as colour-coded pattern tiles (one per stored category, each note
 * with its stored strength), a welcoming empty state while nothing is learned, and the three history pages as small
 * tiles. Only stored notes are shown; nothing is made up.
 */

const ICON: Record<MemoryCategory, React.FC<{ className?: string; 'aria-hidden'?: boolean }>> = {
  timing: Clock, format: LayoutGrid, copy: Type, cta: MousePointerClick, hashtags: Hash, visual: Palette,
};

const LINKS = [
  { to: '/ai-history', label: 'Campaign history', line: 'Every campaign made for you, ready to reuse.', Icon: History, tone: 'coral' },
  { to: '/ai-history?type=video', label: 'Video history', line: 'Every video made for you, with its scenes.', Icon: Film, tone: 'lilac' },
  { to: '/ai-performance', label: 'Performance log', line: 'How each tracked post did.', Icon: BarChart3, tone: 'teal' },
];

const dayMonth = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' });
};

const NoteRow: React.FC<{
  note: PatternGroup['notes'][number];
  onSave: (id: string, text: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}> = ({ note, onSave, onDelete }) => {
  const confirm = useConfirm();
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
      // The page shows the error; editing stays open so the draft is not lost.
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="nb-mem-note">
      {editing ? (
        <div className="nb-mem-edit">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setDraft(note.text); setEditing(false); } }}
            aria-label="Edit this note"
            autoFocus
          />
          <button type="button" className="nb-mem-icon" onClick={save} disabled={busy} aria-label="Save">
            {busy ? <Loader2 className="nb-mem-spin" aria-hidden /> : <Check aria-hidden />}
          </button>
          <button type="button" className="nb-mem-icon" onClick={() => { setDraft(note.text); setEditing(false); }} aria-label="Cancel">
            <X aria-hidden />
          </button>
        </div>
      ) : (
        <>
          <p className="nb-mem-note-text">{note.text}</p>
          <div className="nb-mem-note-foot">
            <span className="nb-mem-strength" data-strength={note.strength} title={`${note.pct}% sure`}>
              <span className="nb-mem-bar" aria-hidden="true"><span style={{ width: `${note.pct}%` }} /></span>
              {STRENGTH_LABEL[note.strength]}
            </span>
            <span className="nb-mem-note-tools">
              <button type="button" className="nb-mem-icon" onClick={() => setEditing(true)} aria-label={`Edit: ${note.text}`}><Pencil aria-hidden /></button>
              <button
                type="button"
                className="nb-mem-icon is-danger"
                aria-label={`Delete: ${note.text}`}
                onClick={async () => { if (await confirm('This removes it from what Nebulaa uses to plan future posts.', { title: 'Delete this note?', confirmLabel: 'Delete', danger: true })) onDelete(note._id); }}
              >
                <Trash2 aria-hidden />
              </button>
            </span>
          </div>
        </>
      )}
    </li>
  );
};

const PatternTile: React.FC<{ group: PatternGroup; span3: number; span2: number; index: number; onSave: (id: string, text: string) => Promise<void>; onDelete: (id: string) => Promise<void> }> = ({ group, span3, span2, index, onSave, onDelete }) => {
  const Icon = ICON[group.category];
  return (
    <li className="nb-mem-tile nb-mem-in" data-tone={group.tone} data-span3={span3} data-span2={span2} style={{ ['--i' as any]: index + 2 }}>
      <div className="nb-mem-tile-head">
        <span className="nb-mem-tile-icon" aria-hidden="true"><Icon /></span>
        <div className="nb-mem-tile-titles">
          <h3>{group.title}</h3>
          <p>{group.line}</p>
        </div>
        <span className="nb-mem-count" aria-label={`${group.notes.length} ${group.notes.length === 1 ? 'note' : 'notes'}`}>{group.notes.length}</span>
      </div>
      <ul className="nb-mem-notes">
        {group.notes.map((n) => <NoteRow key={n._id} note={n} onSave={onSave} onDelete={onDelete} />)}
      </ul>
    </li>
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
    } catch {
      setStatusMsg('We could not load what Nebulaa has learned. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const notes: LearnedNote[] = useMemo(() => data?.brandMemory?.learnedNotes || [], [data]);
  const groups = useMemo(() => groupNotes(notes), [notes]);
  const spans = useMemo(() => ({ three: fillRows(groups.map(() => 1), 3), two: fillRows(groups.map(() => 1), 2) }), [groups]);
  const notesUpdatedAt: string | null = data?.brandMemory?.learnedNotesUpdatedAt || null;
  const performanceCount: number = data?.summary?.performanceMemories || 0;
  const noteCount = groups.reduce((n, g) => n + g.notes.length, 0);
  const updated = dayMonth(notesUpdatedAt);
  const hint = waitingHint(performanceCount);

  const saveNote = async (id: string, text: string) => {
    try {
      await aiMemoryAPI.updateNote(id, { text });
      await load();
    } catch (err: any) {
      setStatusMsg(err?.message || 'The note could not be saved. Please try again.');
      window.setTimeout(() => setStatusMsg(''), 4000);
      throw err;
    }
  };

  const deleteNote = async (id: string) => {
    try {
      await aiMemoryAPI.deleteNote(id);
      await load();
    } catch (err: any) {
      setStatusMsg(err?.message || 'The note could not be deleted. Please try again.');
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
      setStatusMsg(err?.message || 'The notes could not be refreshed. Please try again.');
    } finally {
      setDistilling(false);
      window.setTimeout(() => setStatusMsg(''), 4000);
    }
  };

  if (loading && !data) {
    return (
      <div className="nb-mem-loading" role="status" aria-label="Loading brand memory">
        <Loader2 className="nb-mem-spin" aria-hidden />
      </div>
    );
  }

  return (
    <div className="nb-mem">
      <PageHeader
        eyebrow="Brand memory"
        title="What Nebulaa has"
        emphasis="learned"
        description="Nebulaa keeps a short list of patterns it has learned from how your published posts performed, and uses it when it plans your next posts."
      />
      <section className="nb-mem-hero nb-mem-in" style={{ ['--i' as any]: 0 }} aria-label="Brand memory at a glance">
        <div className="nb-mem-hero-id">
          <ul className="nb-mem-meta" aria-label="Brand memory in numbers">
            <li data-tone="gold"><Brain aria-hidden />Based on {trackedLabel(performanceCount)}</li>
            <li data-tone="teal"><b>{noteCount}</b>{noteCount === 1 ? 'pattern' : 'patterns'} learned</li>
            {updated && <li><CalendarDays aria-hidden />Last updated {updated}</li>}
          </ul>
        </div>
        <div className="nb-mem-hero-side">
          <span className="nb-mem-hero-art" aria-hidden="true">
            <MemoryArt />
            <PlanSparkleArt className="nb-mem-spark" />
          </span>
          <button type="button" className="nb-mem-btn" onClick={refreshNow} disabled={distilling}>
            {distilling ? <Loader2 className="nb-mem-spin" aria-hidden /> : <RefreshCw aria-hidden />}
            Refresh now
          </button>
        </div>
      </section>

      <div role="status" aria-live="polite" className={statusMsg ? 'nb-mem-status' : 'nb-mem-sr'}>{statusMsg}</div>

      <section aria-labelledby="mem-patterns-h" className="nb-mem-section">
        <header className="nb-mem-section-head">
          <p className="nb-mem-eyebrow">Learned patterns</p>
          <h2 id="mem-patterns-h">What works for your posts</h2>
          {groups.length > 0 && <p className="nb-mem-lede">Edit a note if it is not quite right, or delete it. Nebulaa keeps your edits.</p>}
        </header>

        {groups.length > 0 ? (
          <ul className="nb-mem-grid">
            {groups.map((g, i) => <PatternTile key={g.category} group={g} index={i} span3={spans.three[i]} span2={spans.two[i]} onSave={saveNote} onDelete={deleteNote} />)}
          </ul>
        ) : (
          <div className="nb-mem-empty nb-mem-in" style={{ ['--i' as any]: 2 }}>
            <span className="nb-mem-empty-art" aria-hidden="true"><MemoryGrowArt /></span>
            <div className="nb-mem-empty-body">
              <h3>{hint.title}</h3>
              <p>{hint.text}</p>
              <ol className="nb-mem-steps" aria-label="How Nebulaa learns">
                <li data-state={performanceCount > 0 ? 'done' : 'now'}><span aria-hidden="true">1</span>Your posts are published</li>
                <li data-state={performanceCount > 0 ? 'now' : 'next'}><span aria-hidden="true">2</span>Each one is tracked for a few days</li>
                <li data-state="next"><span aria-hidden="true">3</span>The patterns show here</li>
              </ol>
              <p className="nb-mem-preview-h" id="mem-preview-h">What will show here</p>
              <ul className="nb-mem-preview" aria-labelledby="mem-preview-h">
                {(['timing', 'format', 'copy', 'cta', 'hashtags', 'visual'] as MemoryCategory[]).map((c) => {
                  const Icon = ICON[c];
                  return <li key={c} data-tone={CATEGORY_INFO[c].tone}><Icon aria-hidden />{CATEGORY_INFO[c].title}</li>;
                })}
              </ul>
            </div>
          </div>
        )}
      </section>

      <div className="nb-mem-links-wrap">
      <nav aria-label="Memory history" className="nb-mem-links">
        {LINKS.map(({ to, label, line, Icon, tone }, i) => (
          <Link key={to} to={to} className="nb-mem-link nb-mem-in" data-tone={tone} style={{ ['--i' as any]: i + 3 }}>
            <span className="nb-mem-link-icon" aria-hidden="true"><Icon /></span>
            <span className="nb-mem-link-body"><b>{label}</b><span>{line}</span></span>
            <ArrowRight className="nb-mem-link-go" aria-hidden />
          </Link>
        ))}
      </nav>
      </div>
    </div>
  );
};

export default AIMemory;
