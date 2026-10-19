import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, BarChart3, Binoculars, Brain, CalendarDays, Check, FileText, Film, History, Layers, Loader2,
  Map as MapIcon, Package, Pencil, RefreshCw, Trash2, Users, X,
} from 'lucide-react';
import { aiMemoryAPI } from '../services/api';
import { useConfirm } from '../context/ConfirmContext';
import { MemoryArt } from '../components/art/Memory';
import { PlanSparkleArt } from '../components/art/plan/Sparkle';
import { PlanMapArt } from '../components/art/PlanMap';
import { BlueprintArt } from '../components/art/Blueprint';
import { PlanPeopleArt } from '../components/art/plan/People';
import { ProductArt } from '../components/art/Product';
import { PerformanceArt } from '../components/art/Performance';
import { CompetitorsArt } from '../components/art/Competitors';
import { fillRows } from '../utils/rowSpans';
import {
  CONFIDENCE_LABEL, MAX_SHOWN, SOURCE_INFO, chipStatus, confidenceOf, cooldownWords, heroCounts, itemFoot, shownItems, sourceLine,
  sourcesInOrder, whenWords,
} from '../utils/memorySources';
import type { LearnedItem, LearnedView, SourceBlock, SourceKey } from '../utils/memorySources';
import '../components/memory/memory.css';
import PageHeader from '../components/PageHeader';

/**
 * What Nebulaa learned: what the memory holds from SIX sources (the plan, the Blueprint, the customers, the products,
 * the post results and the competitors), each with its items, the evidence behind each one, when it was learned and a
 * confidence word, and an honest sentence where a source has nothing yet. Refresh now looks again (once every ten
 * minutes). Items are computed in code from stored data (backend services/brandMemory); nothing here makes one up.
 * The old performance notes show under "your results" and keep their own Edit and Delete.
 */

const ICON: Record<SourceKey, React.FC<{ className?: string; 'aria-hidden'?: boolean }>> = {
  plan: MapIcon, blueprint: FileText, customers: Users, products: Package, results: BarChart3, competitors: Binoculars,
};
const ART: Record<SourceKey, React.FC> = {
  plan: PlanMapArt, blueprint: BlueprintArt, customers: PlanPeopleArt, products: ProductArt, results: PerformanceArt, competitors: CompetitorsArt,
};

const LINKS = [
  { to: '/ai-history', label: 'Campaign history', line: 'Every campaign made for you, ready to reuse.', Icon: History, tone: 'coral' },
  { to: '/ai-history?type=video', label: 'Video history', line: 'Every video made for you, with its scenes.', Icon: Film, tone: 'lilac' },
  { to: '/ai-performance', label: 'Performance log', line: 'How each tracked post did.', Icon: BarChart3, tone: 'teal' },
];

const ItemRow: React.FC<{
  item: LearnedItem;
  onSave: (item: LearnedItem, text: string) => Promise<void>;
  onDelete: (item: LearnedItem) => Promise<void>;
}> = ({ item, onSave, onDelete }) => {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const [busy, setBusy] = useState(false);
  const conf = confidenceOf(item.confidence);

  const save = async () => {
    if (!draft.trim() || draft.trim() === item.text) { setEditing(false); return; }
    setBusy(true);
    try {
      await onSave(item, draft.trim());
      setEditing(false);
    } catch {
      // The page shows the error; editing stays open so the words are not lost.
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
            maxLength={200}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setDraft(item.text); setEditing(false); } }}
            aria-label="Edit what Nebulaa learned"
            autoFocus
          />
          <button type="button" className="nb-mem-icon" onClick={save} disabled={busy} aria-label="Save">
            {busy ? <Loader2 className="nb-mem-spin" aria-hidden /> : <Check aria-hidden />}
          </button>
          <button type="button" className="nb-mem-icon" onClick={() => { setDraft(item.text); setEditing(false); }} aria-label="Cancel">
            <X aria-hidden />
          </button>
        </div>
      ) : (
        <>
          <p className="nb-mem-note-text">{item.text}</p>
          <div className="nb-mem-note-foot">
            <span className="nb-mem-foot">
              <span className="nb-mem-conf" data-conf={conf}>{CONFIDENCE_LABEL[conf]}</span>
              <span className="nb-mem-evidence">{itemFoot(item)}</span>
            </span>
            <span className="nb-mem-note-tools">
              <button type="button" className="nb-mem-icon" onClick={() => setEditing(true)} aria-label={`Edit: ${item.text}`}><Pencil aria-hidden /></button>
              <button
                type="button"
                className="nb-mem-icon is-danger"
                aria-label={`Delete: ${item.text}`}
                onClick={async () => { if (await confirm('Nebulaa stops using it when it makes your next posts, and does not learn it again.', { title: 'Delete this?', confirmLabel: 'Delete', danger: true })) onDelete(item); }}
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

const SourceTile: React.FC<{
  block: SourceBlock; index: number; span3: number; span2: number;
  onSave: (item: LearnedItem, text: string) => Promise<void>; onDelete: (item: LearnedItem) => Promise<void>;
}> = ({ block, index, span3, span2, onSave, onDelete }) => {
  const [open, setOpen] = useState(false);
  const info = SOURCE_INFO[block.key];
  const Icon = ICON[block.key];
  const Art = ART[block.key];
  const { list, hidden } = shownItems(block.items, open);
  const line = sourceLine(block);
  const has = block.items.length > 0;
  return (
    <li id={`mem-src-${block.key}`} className="nb-mem-tile nb-mem-src nb-mem-in" data-tone={info.tone} data-state={has ? 'learned' : block.state} data-span3={span3} data-span2={span2} style={{ ['--i' as any]: index + 2 }}>
      <div className="nb-mem-tile-head">
        <span className="nb-mem-tile-icon" aria-hidden="true"><Icon /></span>
        <div className="nb-mem-tile-titles">
          <h3>{info.title}</h3>
          <p>{line || info.line}</p>
        </div>
        {has && <span className="nb-mem-count" aria-label={`${block.items.length} learned`}>{block.items.length}</span>}
      </div>
      {has ? (
        <>
          <ul className="nb-mem-notes">
            {list.map((it) => <ItemRow key={`${it.type}-${it.id}`} item={it} onSave={onSave} onDelete={onDelete} />)}
          </ul>
          {(hidden > 0 || open) && block.items.length > MAX_SHOWN && (
            <button type="button" className="nb-mem-more" onClick={() => setOpen(!open)} aria-expanded={open}>
              {open ? 'Show fewer' : `Show all ${block.items.length}`}
            </button>
          )}
        </>
      ) : (
        <div className="nb-mem-src-empty">
          <span className="nb-mem-src-art" aria-hidden="true"><Art /></span>
          <p>{block.reason || 'Nothing learned here yet.'}</p>
          {block.state !== 'error' && block.state !== 'not_on_plan' && (
            <Link to={info.action.to} className="nb-mem-src-go">{info.action.label}<ArrowRight aria-hidden /></Link>
          )}
        </div>
      )}
    </li>
  );
};

/** `embedded`: the What Nebulaa learned tab of Insights, whose page header and tab bar sit above it. */
const AIMemory: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<LearnedView | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [cooldownLeft, setCooldownLeft] = useState(0);

  const say = (m: string, ms = 5000) => { setStatusMsg(m); if (m) window.setTimeout(() => setStatusMsg(''), ms); };

  const load = async () => {
    setLoading(true);
    try {
      const res = await aiMemoryAPI.getLearned();
      setView(res);
      setCooldownLeft(res?.cooldown?.seconds || 0);
    } catch {
      setStatusMsg('We could not load what Nebulaa learned. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  // The cooldown counts down once a minute so the button wakes up again by itself.
  useEffect(() => {
    if (cooldownLeft <= 0) return undefined;
    const t = window.setTimeout(() => setCooldownLeft((s) => Math.max(0, s - 30)), 30000);
    return () => window.clearTimeout(t);
  }, [cooldownLeft]);

  const sources = useMemo(() => sourcesInOrder(view), [view]);
  const counts = useMemo(() => heroCounts(view), [view]);
  const spans = useMemo(() => ({ three: fillRows(sources.map(() => 1), 3), two: fillRows(sources.map(() => 1), 2) }), [sources]);
  const learnedWhen = whenWords(view?.refreshedAt);
  const waitWords = cooldownWords(cooldownLeft);

  const saveItem = async (item: LearnedItem, text: string) => {
    try {
      if (item.type === 'note') await aiMemoryAPI.updateNote(item.id, { text });
      else await aiMemoryAPI.updateLearned(item.id, text);
      await load();
    } catch (err: any) {
      say(err?.message || 'It could not be saved. Please try again.');
      throw err;
    }
  };

  const deleteItem = async (item: LearnedItem) => {
    try {
      if (item.type === 'note') await aiMemoryAPI.deleteNote(item.id);
      else await aiMemoryAPI.deleteLearned(item.id);
      await load();
    } catch (err: any) {
      say(err?.message || 'It could not be deleted. Please try again.');
    }
  };

  const refreshNow = async () => {
    setRefreshing(true);
    setStatusMsg('');
    try {
      const res = await aiMemoryAPI.refreshLearned();
      setView(res);
      setCooldownLeft(res?.cooldown?.seconds || 0);
      say(res?.message || 'Nebulaa looked again.');
    } catch (err: any) {
      say(err?.message || 'We could not refresh just now. Please try again.');
      if (err?.status === 429) setCooldownLeft((s) => s || 60);
    } finally {
      setRefreshing(false);
    }
  };

  if (loading && !view) {
    return (
      <div className="nb-mem-loading" role="status" aria-label="Loading what Nebulaa learned">
        <Loader2 className="nb-mem-spin" aria-hidden />
      </div>
    );
  }

  return (
    <div className="nb-mem">
      {!embedded && (
      <PageHeader
        eyebrow="What Nebulaa learned"
        title="What Nebulaa has"
        emphasis="learned"
        description="Nebulaa keeps learning from your plan, your Blueprint, your customers, your products, your results and your competitors, and uses it when it makes your next posts."
      />
      )}
      <section className="nb-mem-hero nb-mem-in" style={{ ['--i' as any]: 0 }} aria-label="What Nebulaa learned at a glance">
        <div className="nb-mem-hero-id">
          <ul className="nb-mem-meta" aria-label="What Nebulaa learned in numbers">
            <li data-tone="gold"><Brain aria-hidden /><b>{counts.items}</b>{counts.items === 1 ? 'thing learned' : 'things learned'}</li>
            <li data-tone="teal"><Layers aria-hidden />From <b>{counts.sources}</b>of {counts.total} sources</li>
            {learnedWhen && <li><CalendarDays aria-hidden />Last looked {learnedWhen}</li>}
          </ul>
          <nav className="nb-mem-chips" aria-label="Sources">
            {sources.map((b) => {
              const Icon = ICON[b.key];
              return (
                <a key={b.key} href={`#mem-src-${b.key}`} className="nb-mem-chip" data-tone={SOURCE_INFO[b.key].tone} data-has={b.items.length > 0 ? 'yes' : 'no'}
                  onClick={(e) => { e.preventDefault(); document.getElementById(`mem-src-${b.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>
                  <Icon aria-hidden /><span>{SOURCE_INFO[b.key].chip}</span><em>{chipStatus(b)}</em>
                </a>
              );
            })}
          </nav>
        </div>
        <div className="nb-mem-hero-side">
          <span className="nb-mem-hero-art" aria-hidden="true">
            <MemoryArt />
            <PlanSparkleArt className="nb-mem-spark" />
          </span>
          <button type="button" className="nb-mem-btn" onClick={refreshNow} disabled={refreshing || cooldownLeft > 0 || view?.staff}>
            {refreshing ? <Loader2 className="nb-mem-spin" aria-hidden /> : <RefreshCw aria-hidden />}
            Refresh now
          </button>
          <span className="nb-mem-wait" aria-live="polite">{view?.staff ? '' : waitWords || 'Nebulaa also looks once a day'}</span>
        </div>
      </section>

      <div role="status" aria-live="polite" className={statusMsg ? 'nb-mem-status' : 'nb-mem-sr'}>{statusMsg}</div>

      <section aria-labelledby="mem-sources-h" className="nb-mem-section">
        <header className="nb-mem-section-head">
          <p className="nb-mem-eyebrow">Where Nebulaa learns from</p>
          <h2 id="mem-sources-h">What it knows about your business</h2>
          <p className="nb-mem-lede">{view?.staff ? view.staffReason : 'Every item says what backs it. Edit one if it is not quite right, or delete it: Nebulaa keeps your words and does not learn a deleted one again.'}</p>
        </header>
        <ul className="nb-mem-grid is-sources">
          {sources.map((b, i) => <SourceTile key={b.key} block={b} index={i} span3={spans.three[i]} span2={spans.two[i]} onSave={saveItem} onDelete={deleteItem} />)}
        </ul>
      </section>

      <div className="nb-mem-links-wrap">
      <nav aria-label="Memory history" className="nb-mem-links">
        {LINKS.map(({ to, label, line, Icon, tone }, i) => (
          <Link key={to} to={to} className="nb-mem-link nb-mem-in" data-tone={tone} style={{ ['--i' as any]: i + 8 }}>
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
