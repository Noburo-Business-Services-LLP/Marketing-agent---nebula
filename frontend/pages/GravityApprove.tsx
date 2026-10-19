import PlatformIcon from '../components/PlatformIcon';
import { needsApproval } from '../utils/draftStatus';
import PostActions, { PostActionsChange, PostNotice, PostNoticeValue } from '../components/PostActions';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Loader2, Sparkles, Instagram, Facebook, Linkedin, Youtube, AlertCircle, Pencil, LayoutGrid, Rows } from 'lucide-react';
import { draftsAPI, apiService } from '../services/api';
import { Draft, User } from '../types';
import AddLanguagesControl, { LANGUAGE_VERSION_NOTE } from '../components/AddLanguagesControl';
import { languageName, variantLabel, versionsOf } from '../utils/languages';
import GeneratingFill from '../components/GeneratingFill';
import { DraftPreviewModal } from '../components/DraftPreviewModal';
import PageHeader, { PageEmphasis } from '../components/PageHeader';
import { useQuarkCosts } from '../hooks/useQuarkCosts';
import { useConfirm } from '../context/ConfirmContext';
import UpgradePrompt from '../components/UpgradePrompt';
import { UpgradeInfo } from '../utils/plans';

// Review and approve: the posts Nebulaa made for the customer (origin automation) that wait for their OK, one by one
// or as a grid. Approve calls POST /drafts/:id/approve, which never posts: a post with a planned date is scheduled for
// it, the others wait as Approved in the Library, where Schedule, Post now and Download are. Posts the customer made
// by hand never need approval and are not listed here. The buttons are the shared post actions (PostActions).

const PLATFORM_META: Record<string, { label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  instagram: { label: 'Instagram', Icon: Instagram },
  facebook:  { label: 'Facebook',  Icon: Facebook },
  linkedin:  { label: 'LinkedIn',  Icon: Linkedin },
  youtube:   { label: 'YouTube',   Icon: Youtube },
  twitter:   { label: 'X',         Icon: ({ className }) => <PlatformIcon platform="twitter" className={className} /> },
  x:         { label: 'X',         Icon: ({ className }) => <PlatformIcon platform="twitter" className={className} /> },
  gmb:       { label: 'Google Business', Icon: ({ className }) => <PlatformIcon platform="gmb" className={className} /> },
};

const formatScheduleDate = (d?: string | null) => {
  if (!d) return 'No date yet';
  const date = new Date(d);
  if (isNaN(date.getTime())) return 'No date yet';
  const today = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const dcopy = new Date(date); dcopy.setHours(0,0,0,0);
  let day = dcopy.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  if (dcopy.getTime() === today.getTime()) day = 'Today';
  else if (dcopy.getTime() === tomorrow.getTime()) day = 'Tomorrow';
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`;
};

/**
 * Review one by one. Since navigation phase 5 it is drawn inside the Library (`/library?view=approve&mode=one`,
 * `embedded`): the Library's header and views sit above it, so it draws no header of its own and offers a way back to
 * the grid. The old drafts address redirects to the Library's Needs approval view.
 */
const GravityApprove: React.FC<{ user?: User | null; embedded?: boolean; onBack?: () => void }> = ({ user, embedded = false, onBack }) => {
  const navigate = useNavigate();
  // Regenerate re-runs the full generation pipeline, so it costs the same
  // Quarks as the original — campaign-type drafts are billed through the
  // legacy Campaigns flow already (matches backend/routes/drafts.js).
  const quarkCosts = useQuarkCosts();
  const confirm = useConfirm();
  const regenerateCostFor = (draft: any) => (draft?.contentType === 'campaign' ? 0 : (quarkCosts.image_generated || 0));
  const [drafts, setDrafts] = useState<Draft[]>([]);
  // Every language version the client has, whatever its status, so the original can say which exist.
  const [versionRows, setVersionRows] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgrade] = useState<UpgradeInfo | null>(null);
  const [notice, setNotice] = useState<PostNoticeValue | null>(null);
  // Grid is for bulk triage across everything awaiting review at once;
  // single is the full detail view. A customer with fifty drafts going
  // through them one swipe at a time is the exact problem this solves.
  const [reviewView, setReviewView] = useState<'single' | 'grid'>('single');
  const pollTimerRef = useRef<any>(null);

  // ---- Library tabs -------------------------------------------------------
  // Everything past "Needs review" is a read-only browse of your posts by
  // status. Generation runs server-side, so a post that is still rendering
  // when you navigate away shows up here as 'processing' and quietly swaps
  // to the finished image once the worker lands it.
  const TABS = [
    { key: 'review',    label: 'Needs review', status: '' },
  ] as const;

  const [tab, setTab] = useState<string>('review');
  const [libraryItems, setLibraryItems] = useState<Draft[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const libraryPollRef = useRef<any>(null);

  const activeTab = TABS.find((t) => t.key === tab) || TABS[0];

  const loadLibrary = async (status: string, quiet = false) => {
    if (!quiet) setLibraryLoading(true);
    try {
      const res = await draftsAPI.getDrafts(status === 'all' ? undefined : status);
      const rows = (Array.isArray(res?.drafts) ? res.drafts : []).filter((d: any) => {
        const source = String(d?.sourceType || d?.contentType || 'post').toLowerCase();
        return source !== 'reel' && source !== 'video'; // reels live in AI Reels
      });
      setLibraryItems(rows);
    } catch {
      setLibraryItems([]);
    } finally {
      if (!quiet) setLibraryLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'review') { setLibraryItems([]); return; }
    loadLibrary(activeTab.status);
  }, [tab]);

  // Keep pulling while anything in view is still being generated.
  useEffect(() => {
    const anyProcessing = libraryItems.some((d: any) => String(d?.status || '').toLowerCase() === 'processing');
    if (tab === 'review' || !anyProcessing) {
      if (libraryPollRef.current) { clearInterval(libraryPollRef.current); libraryPollRef.current = null; }
      return;
    }
    if (libraryPollRef.current) return;
    libraryPollRef.current = setInterval(() => loadLibrary(activeTab.status, true), 6000);
    return () => { if (libraryPollRef.current) { clearInterval(libraryPollRef.current); libraryPollRef.current = null; } };
  }, [libraryItems, tab]);

  useEffect(() => () => { if (libraryPollRef.current) clearInterval(libraryPollRef.current); }, []);

  // ---- Detail sheet -------------------------------------------------------
  // Clicking a card opens it for editing, rescheduling, regenerating and
  // publishing. Every action below maps to an endpoint that already exists.
  const [selected, setSelected] = useState<any | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCaption, setEditCaption] = useState('');
  const [editWhen, setEditWhen] = useState('');
  const [sheetBusy, setSheetBusy] = useState('');
  const [sheetMsg, setSheetMsg] = useState('');

  const openDetail = (d: any) => {
    setSelected(d);
    setEditTitle(d.title || '');
    setEditCaption(d.caption || '');
    setEditWhen(d.scheduledDate ? new Date(d.scheduledDate).toISOString().slice(0, 16) : '');
    setSheetMsg('');
  };

  const closeDetail = () => { setSelected(null); setSheetMsg(''); };

  // Applies a change, refreshes the grid, and keeps the sheet in sync.
  const runAction = async (key: string, fn: () => Promise<any>, note: string, close = false) => {
    setSheetBusy(key);
    setSheetMsg('');
    try {
      const res = await fn();
      await loadLibrary(activeTab.status, true);
      if (close) { closeDetail(); return; }
      if (res?.draft) setSelected((prev: any) => ({ ...prev, ...res.draft }));
      setSheetMsg(note);
    } catch (e: any) {
      setSheetMsg(e?.message || 'Something went wrong. Please try again.');
    } finally {
      setSheetBusy('');
    }
  };

  const detailImage = (d: any) => d?.imageUrl || d?.creative?.imageUrls?.[0] || '';

  // What belongs in the queue (automation posts that wait or did not finish, never videos) is defined once in
  // utils/draftStatus.ts (needsApproval), the same rule the server uses for the Library count and Home.

  const loadDrafts = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await draftsAPI.getDrafts();
      setVersionRows((Array.isArray(res?.drafts) ? res.drafts : []).filter((d: any) => d?.languageVariantOf));
      const filtered = (Array.isArray(res?.drafts) ? res.drafts : []).filter((d: any) => needsApproval(d));
      setDrafts(filtered);
      // Preserve index if possible so we don't jump around while polling
      setIndex((prev) => Math.min(prev, Math.max(0, filtered.length - 1)));
    } catch (e: any) {
      setError(e?.message || 'The drafts could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadDrafts(); }, []);

  // Poll every 6s if any draft is still processing — refresh so the
  // image URL appears as soon as the backend worker saves it.
  useEffect(() => {
    const anyProcessing = drafts.some((d: any) => {
      const s = String(d?.status || '').toLowerCase();
      return s === 'processing';
    });
    if (anyProcessing && !pollTimerRef.current) {
      pollTimerRef.current = setInterval(() => {
        draftsAPI.getDrafts().then((res) => {
          const list = (Array.isArray(res?.drafts) ? res.drafts : []).filter((d: any) => needsApproval(d));
          setDrafts(list);
        }).catch(() => {});
      }, 6000);
    }
    if (!anyProcessing && pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    return () => {
      if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
    };
  }, [drafts]);

  // A post whose picture did not finish is NOT made again by itself any more: making it again charges the account
  // (POST /drafts/:id/retry-image takes the image price for every post that is not a campaign post), so it is the
  // visible Make again button of the shared post actions, with its price on the button and in the question.

  const current: any = drafts[index] || null;
  const total = drafts.length;

  const platforms = useMemo(() => (current?.platforms || []) as string[], [current]);
  const caption = useMemo(() => {
    const raw: string = current?.caption || current?.creative?.textContent || '';
    return raw;
  }, [current]);
  const hashtags: string[] = useMemo(() => {
    if (Array.isArray(current?.hashtags)) return current.hashtags;
    const matches = String(caption).match(/#\w+/g) || [];
    return matches;
  }, [current, caption]);
  const captionBody = useMemo(() => String(caption).replace(/#\w+/g, '').trim(), [caption]);

  const imageUrl = useMemo(() => {
    return current?.imageUrl || current?.creative?.imageUrls?.[0] || '';
  }, [current]);

  const goPrev = () => setIndex((i) => Math.max(0, i - 1));
  const goNext = () => setIndex((i) => Math.min(total - 1, i + 1));

  useEffect(() => {
    // Arrows move between posts only in the one-by-one view, and never while typing or inside a dialog.
    if (reviewView !== 'single') return undefined;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="tablist"]'))) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total, reviewView]);

  // After an action: a post that left the queue (approved, archived, moved to the Bin) is taken out; Make again
  // reloads so the new picture shows when it is ready.
  const actionDone = (draft: any) => (c: PostActionsChange) => {
    if (c.key === 'makeAgain') { loadDrafts(true); return; }
    if (!c.moved) return;
    setDrafts((prev) => {
      const next = prev.filter((d: any) => d._id !== draft._id);
      setIndex((i) => Math.min(i, Math.max(0, next.length - 1)));
      return next;
    });
    if (c.key === 'approve') setNotice({ text: c.message, tone: 'ok', to: { label: 'See approved posts', path: '/library?view=approved' } });
  };
  const makeAgainQuarksFor = (draft: any) => regenerateCostFor(draft);
  const onNotice = (text: string, tone: 'ok' | 'error', to?: { label: string; path: string }) => setNotice(text ? { text, tone, to } : null);

  const redoDraft = async (draft: any, promptOverride?: string) => {
    if (!draft?._id) return;
    const cost = regenerateCostFor(draft);
    const hasImage = !!(draft?.imageUrl || draft?.creative?.imageUrls?.[0]);
    const confirmMsg = cost > 0
      ? `This costs ${cost.toLocaleString('en-IN')} ${cost === 1 ? 'Quark' : 'Quarks'} and ${hasImage ? 'replaces the current image.' : 'adds an image to this post.'}`
      : hasImage ? 'This replaces the current image.' : 'This adds an image to this post.';
    const dialogTitle = hasImage ? 'Make this again?' : 'Add an image?';
    const dialogConfirmLabel = hasImage ? 'Make again' : 'Add';
    if (!(await confirm(confirmMsg, { title: dialogTitle, confirmLabel: dialogConfirmLabel }))) return;
    try {
      await draftsAPI.retryImageGeneration(String(draft._id), promptOverride);
      await loadDrafts();
    } catch (e: any) {
      setError(e?.message || 'The image could not be regenerated.');
      throw e;
    }
  };

  const createVersions = async (languages: string[]) => {
    if (!current?._id) return [];
    const res = await draftsAPI.localizeDraft(String(current._id), languages);
    await loadDrafts(true);
    return res?.results || [];
  };

  // What was actually sent to the image model for the CURRENT post — kept
  // in sync as index changes (unlike a modal, this page stays mounted while
  // you page through the whole queue). Editable: Regenerate sends whatever
  // is here, so leaving it means "try this again," editing it means "try
  // this specific change," and clearing it hands the idea back to the
  // Creative Director for a fresh concept.
  const [promptDraft, setPromptDraft] = useState('');
  useEffect(() => {
    setPromptDraft(current?.imagePromptResolved || '');
  }, [current?._id]);

  const handleRedo = async () => {
    if (!current) return;
    setBusy(true);
    try { await redoDraft(current, promptDraft.trim() || undefined); } catch { /* error already set */ } finally { setBusy(false); }
  };

  // Targeted fix — keep the current image, change only what the instruction
  // describes. Separate from Regenerate, which redraws from the prompt above.
  const [editOpen, setEditOpen] = useState(false);
  const [editInstruction, setEditInstruction] = useState('');
  const [isEditingImage, setIsEditingImage] = useState(false);
  useEffect(() => {
    setEditOpen(false);
    setEditInstruction('');
  }, [current?._id]);

  const handleEditImage = async () => {
    if (!current || !editInstruction.trim()) return;
    setIsEditingImage(true);
    try {
      await draftsAPI.editImage(String(current._id), editInstruction.trim());
      setEditOpen(false);
      setEditInstruction('');
      await loadDrafts();
    } catch (e: any) {
      setError(e?.message || 'That edit could not be applied.');
    } finally {
      setIsEditingImage(false);
    }
  };

  const openInSingleView = (draftId: string) => {
    const i = drafts.findIndex((d: any) => d._id === draftId);
    if (i >= 0) setIndex(i);
    setReviewView('single');
  };

  // -------- render --------

  // The page-level header, same shape as every other top-level page —
  // TabBar sits below it, not instead of it.
  const Header = () => (embedded ? null : (
    <PageHeader
      eyebrow="Review and approve"
      title={<>Review your <PageEmphasis>posts</PageEmphasis> before they go out</>}
      description="Posts Nebulaa prepared for you wait here for your approval. Approving never posts by itself: a post with a planned date is scheduled for it, the others wait as Approved in the Library."
    />
  ));

  // Everything that is not waiting for your OK (approved, scheduled, posted, your own posts) is in the Library.
  const TabBar = () => (embedded ? (
    <div className="mb-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13.5px] text-[var(--gv-text-secondary)]">One post at a time: approve it, change it or make it again, then move to the next.</p>
        {onBack && <button type="button" onClick={onBack} className="nb-pa-btn">Back to all posts that need approval</button>}
      </div>
      <PostNotice notice={notice} onClose={() => setNotice(null)} />
    </div>
  ) : (
    <div className="mb-6 space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-[13px] text-[var(--gv-text-secondary)]">
        <span className="inline-flex items-center h-9 px-5 rounded-full bg-[var(--gv-surface-3)] border border-[var(--gv-border-subtle)] font-semibold text-[var(--gv-text-primary)]">Needs approval{total ? ` · ${total}` : ''}</span>
        <button type="button" onClick={() => navigate('/library?view=approved')} className="font-semibold text-[var(--gv-accent-text)] underline underline-offset-2">
          Approved posts
        </button>
        <button type="button" onClick={() => navigate('/library?view=all')} className="font-semibold text-[var(--gv-accent-text)] underline underline-offset-2">
          Everything in the Library
        </button>
      </div>
      <PostNotice notice={notice} onClose={() => setNotice(null)} />
    </div>
  ));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-[var(--gv-text-tertiary)]">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading posts for review…
      </div>
    );
  }

  if (error && total === 0) {
    return <div className="text-center py-20 text-red-400">{error}</div>;
  }

  if (total === 0) {
    return (
      <div className={embedded ? 'pb-12' : 'w-full pb-24'}>
        <Header />
        <TabBar />
        <div className="max-w-[560px] mx-auto text-center py-16">
        <div className="gravity-label mb-4">Nothing to approve</div>
        <h2 className="font-serif-display text-[24px] leading-[1.2] tracking-[-0.01em] text-[var(--gv-text-primary)] mb-3">
          No posts are waiting for <PageEmphasis>your approval</PageEmphasis>.
        </h2>
        <p className="text-[14px] text-[var(--gv-text-tertiary)] max-w-[520px] mx-auto mb-6">
          Posts Nebulaa prepares for you appear here. Posts you make yourself can be scheduled or posted straight away from the Library.
        </p>
        <button
          onClick={() => navigate('/campaigns')}
          className="inline-flex items-center gap-2 h-11 px-5 rounded-lg bg-[var(--gv-accent)] hover:bg-[var(--gv-accent-hover)] text-[#1A1208] text-[14px] font-semibold"
        >
          <Sparkles className="w-4 h-4" />
          Create content
        </button>
        </div>
      </div>
    );
  }

  return (
    <div className={embedded ? 'pb-12' : 'w-full pb-16'}>
      <Header />
      <TabBar />
      {/* Header row */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-baseline gap-3">
          <span className="gravity-label">
            {reviewView === 'grid' ? `${total} waiting for approval` : `Post ${index + 1} / ${total}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* List/Grid toggle — grid is for triaging many at once, single is
              for the one that needs a closer look. Switching to single from
              a grid card opens that exact card, not wherever index happened
              to be pointing. */}
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg border border-[var(--gv-border-default)] mr-1">
            <button
              onClick={() => setReviewView('single')}
              title="Single view"
              className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
                reviewView === 'single' ? 'bg-[var(--gv-accent)] text-black' : 'text-[var(--gv-text-tertiary)] hover:text-[var(--gv-text-secondary)]'
              }`}
            >
              <Rows className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setReviewView('grid')}
              title="Grid view"
              className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
                reviewView === 'grid' ? 'bg-[var(--gv-accent)] text-black' : 'text-[var(--gv-text-tertiary)] hover:text-[var(--gv-text-secondary)]'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
          </div>
          {reviewView === 'single' && (
            <>
              <button
                onClick={goPrev}
                disabled={index === 0}
                className="w-9 h-9 rounded-lg border border-[var(--gv-border-default)] flex items-center justify-center text-[var(--gv-text-tertiary)] hover:text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={goNext}
                disabled={index >= total - 1}
                className="w-9 h-9 rounded-lg border border-[var(--gv-border-default)] flex items-center justify-center text-[var(--gv-text-tertiary)] hover:text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {reviewView === 'grid' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {drafts.map((d: any) => {
            const img = d.imageUrl || d.creative?.imageUrls?.[0] || '';
            const status = String(d?.status || '').toLowerCase();
            // 'processing' is only true while a generation job is actually
            // in flight (the backend sets status: 'processing' explicitly).
            // A draft can also have no image simply by design (e.g. a
            // LinkedIn post saved with imageUrl: '') without ever having
            // been queued for one — that's neither processing nor failed.
            const processing = status === 'processing';
            const failed = status === 'failed' && !img;
            const cap = String(d.caption || d.creative?.textContent || '').replace(/#\w+/g, '').trim();
            return (
              <div
                key={d._id}
                onClick={() => openInSingleView(d._id)}
                className="group relative rounded-xl border border-[var(--gv-border-default)] bg-[var(--gv-surface-1)] overflow-hidden cursor-pointer transition-all duration-200 hover:border-[rgb(var(--gv-accent-rgb)/0.50)] hover:bg-[var(--gv-surface-2)]"
              >
                <div className="relative bg-[#F6EEDF] aspect-[4/5] overflow-hidden">
                  {img ? (
                    <img src={img} alt={d.title || 'Post'} className="w-full h-full object-contain" />
                  ) : failed ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3 text-center">
                      <AlertCircle className="w-5 h-5 text-red-400/70" />
                      <span className="text-[10.5px] text-[var(--gv-text-muted)]">Generation failed</span>
                    </div>
                  ) : processing ? (
                    <GeneratingFill resolution="" />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3 text-center">
                      <span className="text-[10.5px] text-[var(--gv-text-muted)]">No image yet</span>
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <p className="text-[12px] font-semibold text-[var(--gv-text-primary)] truncate">{d.title || 'Untitled'}</p>
                  {variantLabel(d) && (
                    <span className="inline-flex items-center h-5 px-2 mt-1 rounded-full bg-[var(--gv-accent-fill)] border border-[rgb(var(--gv-accent-rgb)/0.30)] text-[10.5px] font-medium text-[var(--gv-accent-text)]">{variantLabel(d)}</span>
                  )}
                  {cap && <p className="text-[10.5px] text-[var(--gv-text-muted)] line-clamp-2 mt-1 leading-snug">{cap}</p>}
                  <div className="flex items-center gap-1 mt-2">
                    {(d.platforms || []).length === 0 ? (
                      <span className="text-[9.5px] text-[var(--gv-text-muted)]">No platform</span>
                    ) : (d.platforms || []).slice(0, 4).map((p: string) => {
                      const meta = PLATFORM_META[String(p).toLowerCase()];
                      return meta
                        ? <meta.Icon key={p} className="w-3 h-3 text-[var(--gv-text-tertiary)]" />
                        : <span key={p} className="text-[9.5px] text-[var(--gv-text-muted)]">{p}</span>;
                    })}
                  </div>
                  <div className="mt-3 pt-2.5 border-t border-[var(--gv-border-subtle)]" onClick={(e) => e.stopPropagation()}>
                    <PostActions
                      draft={d}
                      variant="compact"
                      label={d.title || 'this post'}
                      makeAgainQuarks={makeAgainQuarksFor(d)}
                      onEdit={() => openInSingleView(d._id)}
                      archiveVia={d.contentCalendarId && d.calendarDay ? 'reject' : 'archive'}
                      onChanged={actionDone(d)}
                      onMessage={onNotice}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-10">
        {/* PREVIEW */}
        <div className="relative flex items-center justify-center min-h-[560px]">
          <div className="absolute inset-[-20px] rounded-3xl blur-3xl opacity-70" style={{ background: 'radial-gradient(60% 55% at 50% 50%, rgba(245,166,35,0.16), transparent 70%)' }} />
          <div className="relative w-[380px] aspect-[4/5] rounded-2xl bg-[var(--gv-panel)] border border-[var(--gv-border-subtle)] overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.6)]">
            {imageUrl ? (
              <img src={imageUrl} alt={current?.title || 'draft preview'} className="w-full h-full object-contain" />
            ) : String(current?.status || '').toLowerCase() === 'failed' ? (
              <div className="w-full h-full bg-gradient-to-br from-red-950/20 to-[var(--gv-surface-1)] flex flex-col items-center justify-center gap-3 px-6 text-center">
                <AlertCircle className="w-8 h-8 text-red-400/70" />
                <div className="text-[13px] font-semibold text-[var(--gv-text-primary)]">The picture did not finish</div>
                <div className="text-[11.5px] text-[var(--gv-text-tertiary)] max-w-[260px] leading-relaxed">
                  {current?.errorMessage || 'Something went wrong. Select Make again to try once more.'}
                </div>
                <button
                  onClick={handleRedo}
                  data-testid="approve-make-again"
                  className="mt-2 h-8 px-3 rounded-md bg-[var(--gv-surface-2)] hover:bg-[var(--gv-surface-4)] text-[12px] font-semibold text-[var(--gv-text-primary)]"
                >
                  Make again{regenerateCostFor(current) > 0 ? ` (${regenerateCostFor(current).toLocaleString('en-IN')} ${regenerateCostFor(current) === 1 ? 'Quark' : 'Quarks'})` : ''}
                </button>
              </div>
            ) : String(current?.status || '').toLowerCase() !== 'processing' ? (
              // No image, and generation isn't actually in flight (and
              // didn't fail) — this draft was saved without an image by
              // design (e.g. a LinkedIn post). Distinct from both the
              // failure state above and the genuine "generating…" spinner
              // below: never show the spinner here, since no job is
              // running and it would never resolve.
              <div className="w-full h-full bg-gradient-to-br from-[var(--gv-surface-2)] to-[var(--gv-surface-1)] flex flex-col items-center justify-center gap-3 px-6 text-center">
                <div className="text-[13px] font-semibold text-[var(--gv-text-primary)]">No image yet</div>
                <div className="text-[11.5px] text-[var(--gv-text-tertiary)] max-w-[260px] leading-relaxed">
                  This post does not have an image. Select Add image to generate one.
                </div>
                <button
                  onClick={handleRedo}
                  className="mt-2 h-8 px-3 rounded-md bg-[var(--gv-surface-2)] hover:bg-[var(--gv-surface-4)] text-[12px] font-semibold text-[var(--gv-text-primary)]"
                >
                  Add image
                </button>
              </div>
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-[var(--gv-surface-2)] to-[var(--gv-surface-1)] flex flex-col items-center justify-center gap-3 px-6 text-center">
                <div className="relative w-10 h-10">
                  <div className="absolute inset-0 rounded-full border-2 border-[rgb(var(--gv-accent-rgb)/0.25)]" />
                  <Loader2 className="w-10 h-10 text-[var(--gv-accent)] animate-spin absolute inset-0" strokeWidth={1.5} />
                </div>
                <div className="text-[11px] uppercase tracking-widest text-[var(--gv-text-tertiary)]">Generating…</div>
                <div className="text-[13.5px] font-semibold text-[var(--gv-text-primary)] max-w-[260px]">
                  {current?.title || 'Untitled draft'}
                </div>
                <div className="text-[11px] text-[var(--gv-text-muted)] max-w-[260px]">
                  The image is being generated. This usually takes 20 to 40 seconds.
                </div>
              </div>
            )}
          </div>
          {/* Dot pagination */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
            {drafts.slice(0, Math.min(total, 8)).map((_, i) => (
              <span key={i} className={`h-1.5 rounded-full transition-all ${i === index ? 'w-6 bg-[var(--gv-accent)]' : 'w-1.5 bg-[rgb(var(--gv-ink-rgb)/0.25)]'}`} />
            ))}
          </div>
        </div>

        {/* META + CAPTION */}
        <div className="flex flex-col">
          {variantLabel(current) && (
            <div className="mb-3">
              <span className="inline-flex items-center h-6 px-2.5 rounded-full bg-[var(--gv-accent-fill)] border border-[rgb(var(--gv-accent-rgb)/0.30)] text-[12px] font-medium text-[var(--gv-accent-text)]">
                {variantLabel(current)}
              </span>
              <p className="text-[12.5px] text-[var(--gv-text-secondary)] mt-2">{LANGUAGE_VERSION_NOTE}</p>
            </div>
          )}
          <h2 className="font-serif-display text-[24px] leading-[1.2] tracking-[-0.01em] text-[var(--gv-text-primary)] mb-6">
            {current?.title || current?.name || 'Untitled draft'}
          </h2>

          <dl className="grid grid-cols-[110px_1fr] gap-y-3 gap-x-4 mb-6">
            <dt className="gravity-label pt-1">Planned for</dt>
            <dd className="text-[13px] text-[var(--gv-text-primary)] flex items-center gap-2">
              {formatScheduleDate(current?.plannedDate || current?.scheduledDate)}
            </dd>

            <dt className="gravity-label pt-1">Platforms</dt>
            <dd className="flex items-center gap-2 flex-wrap">
              {platforms.length ? platforms.map((p) => {
                const meta = PLATFORM_META[p.toLowerCase()];
                if (!meta) return null;
                const { Icon, label } = meta;
                return (
                  <span key={p} className="inline-flex items-center gap-1.5 h-6 px-2 rounded-md bg-[var(--gv-surface-2)] border border-[var(--gv-border-default)] text-[11.5px] text-[var(--gv-text-primary)]">
                    <Icon className="w-3 h-3" />
                    {label}
                  </span>
                );
              }) : <span className="text-[12px] text-[var(--gv-text-muted)]">No platforms</span>}
            </dd>

            <dt className="gravity-label pt-1">Style</dt>
            <dd className="text-[13px] text-[var(--gv-text-secondary)]">{current?.tone || current?.creative?.style || '—'}</dd>

            {versionsOf(versionRows, current?._id).length > 0 && (
              <>
                <dt className="gravity-label pt-1">Versions</dt>
                <dd className="text-[13px] text-[var(--gv-text-secondary)]">
                  {versionsOf(versionRows, current?._id).map((v: any) => languageName(v.language)).join(', ')}
                </dd>
              </>
            )}

            <dt className="gravity-label pt-1">Source</dt>
            <dd className="text-[13px] text-[var(--gv-text-secondary)]">
              {current?.contentCalendarId || typeof current?.calendarDay === 'number' ? 'Made by Nebulaa from your plan' : 'Made by Nebulaa'}
            </dd>
          </dl>

          <div className="border-t border-[var(--gv-border-subtle)] pt-5 mb-6">
            <div className="gravity-label mb-3">Caption</div>
            <p className="text-[14px] text-[var(--gv-text-primary)] leading-relaxed whitespace-pre-line mb-3">
              {captionBody || <span className="text-[var(--gv-text-muted)]">No caption yet.</span>}
            </p>
            {hashtags.length > 0 && (
              <div className="flex flex-wrap gap-x-2 gap-y-1">
                {hashtags.map((h, i) => (
                  <span key={i} className="text-[13px] text-[var(--gv-accent-text)]">{h}</span>
                ))}
              </div>
            )}
          </div>

          {/* What was actually sent to the image model — editable, so
              Regenerate means "try this specific change" instead of "reroll
              and hope." Clearing it hands the idea back to the Creative
              Director for a fresh concept. */}
          <div className="border-t border-[var(--gv-border-subtle)] pt-5 mb-8">
            <div className="gravity-label mb-3">Prompt</div>
            <textarea
              value={promptDraft}
              onChange={(e) => setPromptDraft(e.target.value)}
              placeholder={current?.imagePromptResolved ? '' : 'No prompt was recorded for this image. Leave this blank and Nebulaa will choose a new concept, or write your own prompt to use it exactly.'}
              rows={5}
              className="w-full p-3 rounded-lg bg-[var(--gv-surface-1)] border border-[var(--gv-border-default)] text-[12px] leading-relaxed text-[var(--gv-text-secondary)] font-mono outline-none focus:border-[rgb(var(--gv-accent-rgb)/0.40)] resize-y placeholder:text-[var(--gv-text-muted)] placeholder:font-sans"
            />
            <p className="text-[10.5px] text-[var(--gv-text-muted)] mt-1.5">
              {promptDraft.trim() && promptDraft.trim() !== (current?.imagePromptResolved || '').trim()
                ? 'You edited the prompt. Make again uses this exact text.'
                : promptDraft.trim()
                  ? 'Make again uses this exact text again.'
                  : 'The prompt is empty. Make again asks Nebulaa for a new idea.'}
            </p>
          </div>

          {/* Small targeted fix — keeps the current image, changes only what
              the instruction describes. Distinct from Regenerate above,
              which redraws the whole image from the prompt. */}
          {editOpen && (
            <div className="mb-6 p-3 rounded-xl bg-[var(--gv-accent-fill)] border border-[rgb(var(--gv-accent-rgb)/0.20)]">
              <label className="gravity-label block mb-1.5 text-[var(--gv-accent-text)]">Describe the change</label>
              <textarea
                value={editInstruction}
                onChange={(e) => setEditInstruction(e.target.value)}
                placeholder="For example: fix the spelling in the headline, make the sky darker, or remove the coffee cup."
                rows={2}
                className="w-full p-2.5 rounded-lg bg-[var(--gv-surface-2)] border border-[var(--gv-border-default)] text-[12.5px] leading-relaxed text-[var(--gv-text-secondary)] outline-none focus:border-[rgb(var(--gv-accent-rgb)/0.40)] resize-y placeholder:text-[var(--gv-text-muted)]"
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-[10.5px] text-[var(--gv-text-muted)]">The rest of the image stays the same.</span>
                <button
                  onClick={handleEditImage}
                  disabled={isEditingImage || !editInstruction.trim()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[var(--gv-accent)] text-black text-[12px] font-semibold hover:bg-[var(--gv-accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isEditingImage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pencil className="w-3.5 h-3.5" />}
                  Apply edit
                </button>
              </div>
            </div>
          )}

          {!current?.languageVariantOf && (
            <AddLanguagesControl
              key={current?._id}
              draftLanguage={current?.language}
              additional={user?.businessProfile?.additionalLanguages || []}
              created={versionsOf(versionRows, current?._id).map((v: any) => v.language)}
              onCreate={createVersions}
            />
          )}

          {/* The shared post actions: Approve first, then the rest in the fixed order. */}
          <div className="mt-auto">
            <PostActions
              key={current?._id}
              draft={current}
              label={current?.title || 'this post'}
              makeAgainQuarks={makeAgainQuarksFor(current)}
              makeAgainPrompt={promptDraft}
              onEdit={() => setEditOpen((v) => !v)}
              archiveVia={current?.contentCalendarId && current?.calendarDay ? 'reject' : 'archive'}
              onChanged={actionDone(current)}
              onMessage={onNotice}
              className="nb-approve-actions"
            />
          </div>
        </div>
      </div>
      )}

      {upgrade && <UpgradePrompt className="mt-6" reason={upgrade.reason} feature={upgrade.feature} />}
      {error && (
        <div className="mt-6 text-center text-[12px] text-red-400">{error}</div>
      )}
    </div>
  );
};

export default GravityApprove;
