import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Edit3,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  ImageIcon,
  X
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-06" -> "June 2026". The stored value is not meant to be read raw. */
const monthLabel = (month = '') => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || '').trim());
  if (!m) return String(month || '');
  const name = MONTH_NAMES[parseInt(m[2], 10) - 1];
  return name ? `${name} ${m[1]}` : String(month);
};
import { contentCalendarAPI, draftsAPI } from '../services/api';
import { CONTENT_LANGUAGES } from '../constants/languages';
import { ContentCalendar as ContentCalendarType, ContentCalendarItem, Draft } from '../types';
import { getThemeClasses, useTheme } from '../context/ThemeContext';
import { GravityHero, GravityEmphasis } from '../components/gravity';
import StrategyDocumentView from '../components/StrategyDocumentView';
import { startBackgroundReel } from '../utils/backgroundReel';

// Reel days are the ones Approve auto-builds; everything else just gets a status.
const isReelItem = (item: ContentCalendarItem) => /reel|video/i.test(String(item?.format || ''));

const editableFields: Array<keyof ContentCalendarItem> = [
  'format',
  'contentPillar',
  'headline',
  'creativeConcept',
  'productNeeded',
  'shootType',
  'cta',
  'objective'
];

const ContentCalendar: React.FC = () => {
  const { isDarkMode } = useTheme();
  const theme = getThemeClasses(isDarkMode);
  const navigate = useNavigate();
  const [calendar, setCalendar] = useState<ContentCalendarType | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [editingId, setEditingId] = useState('');
  const [draftItem, setDraftItem] = useState<Partial<ContentCalendarItem>>({});
  const [error, setError] = useState('');
  const [activeDetailTab, setActiveDetailTab] = useState<'calendar' | 'planning' | 'drafts'>('calendar');
  const [weeklyDrafts, setWeeklyDrafts] = useState<Draft[]>([]);
  const [loadingWeeklyDrafts, setLoadingWeeklyDrafts] = useState(false);
  const [history, setHistory] = useState<ContentCalendarType[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');

  const loadWeeklyDrafts = async () => {
    if (!calendar) return;
    setLoadingWeeklyDrafts(true);
    try {
      const typeFilter = 'campaign,post';
      const res = await draftsAPI.getDrafts('draft', typeFilter);
      const filtered = (res.drafts || []).filter(d => 
        String(d.contentCalendarId) === calendar._id && 
        d.calendarWeek === getActiveWeekNumber()
      );
      setWeeklyDrafts(filtered);
    } catch (err) {
      console.error('Failed to load weekly drafts:', err);
    } finally {
      setLoadingWeeklyDrafts(false);
    }
  };

  const getActiveWeekNumber = (): number => {
    const day = new Date().getDate();
    if (day <= 7) return 1;
    if (day <= 14) return 2;
    if (day <= 21) return 3;
    return 4;
  };

  const handleGenerateWeekContent = async () => {
    if (!calendar) return;
    const weekNum = getActiveWeekNumber();
    setSaving(`week-${weekNum}`);
    try {
      const res = await contentCalendarAPI.autoGenerateWeek(calendar._id, weekNum);
      alert(res.message || `Week ${weekNum} content generation queued in the background.`);
      loadCalendar();
    } catch (err: any) {
      alert(err.message || 'Failed to trigger weekly content generation');
    } finally {
      setSaving('');
    }
  };


  // Covers render after the plan is saved, so a freshly generated month shows
  // the pending state and swaps in the art when it lands.
  const [coverBusy, setCoverBusy] = useState(false);
  const [planLanguage, setPlanLanguage] = useState('');
  // What's specific to THIS plan — a launch, an event, an offer, a pillar to
  // lean into. Optional: left blank, the AI plans from brand memory and
  // recent Idea Inbox items alone.
  const [planFocus, setPlanFocus] = useState('');

  useEffect(() => {
    // Watches the open plan (detail view) and every card's thumbnail (list
    // view) — either can be mid-render when this page loads.
    const anyPending = calendar?.coverStatus === 'pending' || history.some((c) => c.coverStatus === 'pending');
    if (!anyPending) return;
    const id = setInterval(() => { loadCalendar(); }, 6000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendar?.coverStatus, calendar?._id, history]);

  const requestCover = async () => {
    if (!calendar) return;
    setCoverBusy(true);
    try {
      await contentCalendarAPI.generateCover(calendar.month);
      setCalendar({ ...calendar, coverStatus: 'pending' });
    } catch (err: any) {
      setError(err?.message || 'Could not start the cover image.');
    } finally {
      setCoverBusy(false);
    }
  };

  const allItems = useMemo(
    () => (calendar?.weeks || []).flatMap((week) => week.items || []),
    [calendar]
  );

  const loadCalendar = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await contentCalendarAPI.getHistory();
      setHistory(response.calendars || []);
      if (calendar) {
        const updated = response.calendars.find((c: any) => c._id === calendar._id);
        if (updated) setCalendar(updated);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load content calendar history');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateNextMonth = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await contentCalendarAPI.generateNextMonth(planLanguage || undefined, planFocus.trim() || undefined);
      await loadCalendar();
      setCalendar(response.calendar);
      setViewMode('detail');
    } catch (err: any) {
      setError(err?.message || 'Failed to generate next month plan');
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCalendar();
  }, []);

  const updateCalendar = async (action: () => Promise<{ calendar?: ContentCalendarType } | any>, busyKey: string) => {
    setSaving(busyKey);
    setError('');
    try {
      const response = await action();
      if (response?.calendar) setCalendar(response.calendar);
    } catch (err: any) {
      setError(err?.message || 'Calendar update failed');
    } finally {
      setSaving('');
    }
  };

  // The list view renders from `history`, which updateCalendar does not touch
  // — it only sets the detail `calendar`. Toggling from a card would hit the
  // API and leave the switch visually stuck, so this updates the list entry.
  const toggleAutoGenerateForPlan = async (plan: ContentCalendarType) => {
    const key = `auto-${plan._id}`;
    setSaving(key);
    setError('');
    try {
      const response = await contentCalendarAPI.updateSettings({
        calendarId: plan._id,
        autoGenerate: !plan.autoGenerate,
      });
      const updated = response?.calendar;
      setHistory((prev) => prev.map((c) => (c._id === plan._id ? { ...c, ...(updated || { autoGenerate: !plan.autoGenerate }) } : c)));
      if (calendar?._id === plan._id && updated) setCalendar(updated);
    } catch (err: any) {
      setError(err?.message || 'Calendar update failed');
    } finally {
      setSaving('');
    }
  };

  // A week's worth is the default. Anything above it is the user deliberately
  // spending credits faster, so the warning fires there rather than nagging on
  // every change.
  const AUTO_GENERATE_DEFAULT = 7;

  const setAutoGenerateLimit = async (plan: ContentCalendarType, limit: number) => {
    const key = `limit-${plan._id}`;
    setSaving(key);
    setError('');
    try {
      const response = await contentCalendarAPI.updateSettings({
        calendarId: plan._id,
        autoGenerateLimit: limit,
      });
      const updated = response?.calendar;
      setHistory((prev) => prev.map((c) => (c._id === plan._id ? { ...c, ...(updated || { autoGenerateLimit: limit }) } : c)));
      if (calendar?._id === plan._id && updated) setCalendar(updated);
    } catch (err: any) {
      setError(err?.message || 'Could not update the limit');
    } finally {
      setSaving('');
    }
  };

  const beginEdit = (item: ContentCalendarItem) => {
    setEditingId(item._id);
    setDraftItem({ ...item });
  };

  const saveItem = (itemId: string) => {
    updateCalendar(async () => contentCalendarAPI.updateItem(itemId, draftItem), `save-${itemId}`);
    setEditingId('');
  };

  const updateItemStatus = (item: ContentCalendarItem, status: ContentCalendarItem['status']) => {
    updateCalendar(async () => contentCalendarAPI.updateItem(item._id, { status }), `${status}-${item._id}`);
  };

  // Approving a reel day does more than flip a label: it queues the full AI
  // Reels pipeline server-side, then drops the user into the wizard so they
  // watch it fill in. Non-reel days keep the old status-only behaviour.
  const approveItem = async (item: ContentCalendarItem) => {
    if (!isReelItem(item)) {
      updateItemStatus(item, 'approved');
      return;
    }

    setSaving(`approved-${item._id}`);
    setError('');
    try {
      const response = await contentCalendarAPI.autoGenerateReel(item._id);
      if (!response?.success || !response.jobId) {
        throw new Error(response?.message || 'Could not start reel generation');
      }
      if (response.calendar) setCalendar(response.calendar);

      startBackgroundReel({
        jobId: response.jobId,
        itemId: item._id,
        day: Number(item.day) || 0,
        headline: item.headline || ''
      });

      // The wizard resumes from this jobId and syncs its step as the
      // pipeline advances, which is what produces the live autofill.
      navigate(`/reels?jobId=${encodeURIComponent(response.jobId)}`);
    } catch (err: any) {
      setError(err?.message || 'Could not start reel generation');
    } finally {
      setSaving('');
    }
  };

  const moveItem = (itemId: string, direction: -1 | 1) => {
    const currentIndex = allItems.findIndex((item) => item._id === itemId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= allItems.length) return;

    const nextItems = [...allItems];
    const [item] = nextItems.splice(currentIndex, 1);
    nextItems.splice(nextIndex, 0, item);
    updateCalendar(async () => contentCalendarAPI.reorder(nextItems.map((entry) => entry._id)), `reorder-${itemId}`);
  };

  const regenerate = () => {
    if (!window.confirm("Regenerate this month's plan? This replaces every day's current idea.")) return;
    updateCalendar(async () => contentCalendarAPI.regenerate(undefined, undefined, planFocus.trim() || undefined), 'regenerate');
  };

  const approveCalendar = () => {
    if (!calendar) return;
    updateCalendar(async () => contentCalendarAPI.updateSettings({ calendarId: calendar._id, approved: true }), 'approve-calendar');
  };

  const toggleAutoGenerate = () => {
    if (!calendar) return;
    updateCalendar(
      async () => contentCalendarAPI.updateSettings({ calendarId: calendar._id, autoGenerate: !calendar.autoGenerate }),
      'auto-generate'
    );
  };

  const createDraft = (item: ContentCalendarItem) => {
    updateCalendar(async () => contentCalendarAPI.createDraft(item._id, false), `draft-${item._id}`);
  };

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#F5A623]" />
      </div>
    );
  }

  if (viewMode === 'list') {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <GravityHero
            align="left"
            eyebrow="Smart Calendar"
            headline={<>The month, <GravityEmphasis>planned</GravityEmphasis></>}
            subcopy="Manage your monthly content strategies."
            className="!mb-0"
          />
          <div className="flex flex-col items-stretch sm:items-end gap-2">
            <div className="flex items-center gap-2">
              {/* Per-plan language. Empty means "use my account setting", so this
                  does not force a choice on people happy with their default. */}
              <select
                value={planLanguage}
                onChange={(e) => setPlanLanguage(e.target.value)}
                className="gravity-bare px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.10] text-[13px] text-[#F5F4F1] outline-none"
                title="Language for the next plan"
              >
                <option value="">My default language</option>
                {CONTENT_LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleGenerateNextMonth}
                disabled={loading}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-[#F5A623] text-black hover:bg-[#ffb833] transition-colors"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Generate Next Month Plan
              </button>
            </div>
            {/* Optional — a launch, event, offer, or pillar to lean into this
                month. Left blank, the AI still has brand memory and recent
                Idea Inbox items to work from, just no specific steer. */}
            <input
              type="text"
              value={planFocus}
              onChange={(e) => setPlanFocus(e.target.value)}
              placeholder="Anything specific to focus on this month? (optional)"
              className="gravity-bare w-full sm:w-[360px] px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.10] text-[13px] text-[#F5F4F1] outline-none placeholder:text-white/30"
            />
          </div>
        </div>
        
        {history.length === 0 && !loading && (
          <div className="p-8 text-center border rounded-xl border-slate-800 bg-slate-900/50 text-slate-400">
            No plans found. Generate your first plan!
          </div>
        )}
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {history.map((cal) => (
            <div
              key={cal._id}
              onClick={() => { setCalendar(cal); setViewMode('detail'); }}
              className="cursor-pointer group relative rounded-xl border border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04] transition-all overflow-hidden"
            >
              {/* Cover thumbnail. Same source as the detail banner, so a
                  month reads the same whether you're browsing the grid or
                  already inside it. */}
              <div className="relative h-28 bg-[#151515]">
                {cal.coverImageUrl ? (
                  <img src={cal.coverImageUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-[#F5A623]/[0.08] via-transparent to-transparent flex items-center justify-center">
                    {cal.coverStatus === 'pending' ? (
                      <Loader2 className="w-4 h-4 animate-spin text-[#F5A623]/60" />
                    ) : (
                      <ImageIcon className="w-5 h-5 text-white/15" />
                    )}
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
                {cal.approved && (
                  <span title="Approved" className="absolute top-2.5 right-2.5">
                    <Check className="w-5 h-5 text-emerald-400 bg-emerald-500/20 backdrop-blur p-1 rounded-full" />
                  </span>
                )}
              </div>

              <div className="p-5 pt-4">
              <h3 className="font-serif-display text-[20px] text-[#F5F4F1] group-hover:text-[#F5A623] transition-colors">
                {monthLabel(cal.month)}
              </h3>
              {cal.themeTitle ? (
                <p className="text-[13px] text-[#F5A623]/90 mb-3 mt-0.5 line-clamp-1">{cal.themeTitle}</p>
              ) : (
                <p className="text-[13px] text-white/50 mb-3 mt-0.5">{cal.businessName || 'Business Plan'}</p>
              )}
              <div className="flex items-center gap-2 text-[11px] text-white/45 mb-4">
                <span className="px-2 py-1 rounded-md bg-white/[0.04]">{cal.language}</span>
                <span className="px-2 py-1 rounded-md bg-white/[0.04]">{cal.weeks?.length || 0} Weeks</span>
              </div>

              {/* Auto Generation used to live only inside a plan, so anyone
                  told to "turn on Smart Calendar" landed here and found no
                  control at all. stopPropagation keeps the card's own click
                  (open the plan) from firing when you hit the switch. */}
              <div
                className="flex items-center justify-between gap-3 pt-3 border-t border-white/[0.06]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="min-w-0">
                  <div className="gravity-label">Auto Generation</div>
                  <div className={`text-[12px] mt-0.5 ${cal.autoGenerate ? 'text-emerald-400' : 'text-white/40'}`}>
                    {cal.autoGenerate ? 'A draft a day, for review' : 'Off'}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!cal.autoGenerate}
                  aria-label={`Toggle auto generation for ${monthLabel(cal.month)}`}
                  disabled={saving === `auto-${cal._id}`}
                  onClick={() => toggleAutoGenerateForPlan(cal)}
                  className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors disabled:opacity-50 ${cal.autoGenerate ? 'bg-[#F5A623]' : 'bg-white/[0.15]'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${cal.autoGenerate ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
              </div>

              {/* How much it is allowed to make. Only worth showing once the
                  switch is on — off, the number means nothing. */}
              {cal.autoGenerate && (
                <div className="mt-3 pt-3 border-t border-white/[0.06]" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="gravity-label">Limit</div>
                      <div className="text-[12px] mt-0.5 text-white/45">
                        {cal.autoGeneratedCount || 0} of {cal.autoGenerateLimit ?? AUTO_GENERATE_DEFAULT} made
                      </div>
                    </div>
                    <select
                      value={cal.autoGenerateLimit ?? AUTO_GENERATE_DEFAULT}
                      disabled={saving === `limit-${cal._id}`}
                      onChange={(e) => setAutoGenerateLimit(cal, Number(e.target.value))}
                      className="gravity-bare flex-shrink-0 px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.10] text-[12.5px] text-[#F5F4F1] outline-none disabled:opacity-50"
                    >
                      {[3, 5, 7, 10, 14, 20, 30].map((n) => (
                        <option key={n} value={n}>{n} posts</option>
                      ))}
                    </select>
                  </div>
                  {(cal.autoGenerateLimit ?? AUTO_GENERATE_DEFAULT) > AUTO_GENERATE_DEFAULT && (
                    <p className="mt-2 text-[11.5px] text-[#F5A623]/90 leading-relaxed">
                      Above a week's worth. Each post generates an image, so this
                      will use credits faster.
                    </p>
                  )}
                </div>
              )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (viewMode === 'detail' && !calendar) {
    return (
      <div className={`p-6 rounded-lg border ${theme.bgCard} ${isDarkMode ? 'border-slate-800' : 'border-slate-200'}`}>
        <p className={theme.textSecondary}>{error || 'No content calendar found.'}</p>
        <button onClick={() => setViewMode('list')} className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 text-white font-semibold hover:bg-slate-700">
          ← Back to Plans
        </button>
      </div>
    );
  }

  

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <button onClick={() => setViewMode('list')} className="mb-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#F5A623] text-black hover:bg-[#ffb833] transition-colors shadow-sm">
        ← Back to Plans
      </button>

      {/* Tabs Navigation */}
      <div className={`flex items-center gap-6 border-b px-2 mb-6 ${isDarkMode ? 'border-slate-800' : 'border-slate-200'}`}>
        <button
          onClick={() => setActiveDetailTab('calendar')}
          className={`pb-3 text-sm font-bold border-b-2 transition-colors ${activeDetailTab === 'calendar' ? 'border-[#F5A623] text-[#F5A623]' : 'border-transparent ' + theme.textSecondary + ' hover:' + theme.text}`}
        >
          Calendar View
        </button>
        <button
          onClick={() => setActiveDetailTab('planning')}
          className={`pb-3 text-sm font-bold border-b-2 transition-colors ${activeDetailTab === 'planning' ? 'border-[#F5A623] text-[#F5A623]' : 'border-transparent ' + theme.textSecondary + ' hover:' + theme.text}`}
        >
          Content Planning
        </button>
        <button
          onClick={() => {
            setActiveDetailTab('drafts');
            loadWeeklyDrafts();
          }}
          className={`pb-3 text-sm font-bold border-b-2 transition-colors ${activeDetailTab === 'drafts' ? 'border-[#F5A623] text-[#F5A623]' : 'border-transparent ' + theme.textSecondary + ' hover:' + theme.text}`}
        >
          Weekly Drafts
        </button>
      </div>

      {activeDetailTab === 'planning' && (
        <div className="mt-4">
          <StrategyDocumentView calendar={calendar} onBack={() => setActiveDetailTab('calendar')} />
        </div>
      )}

      {activeDetailTab === 'drafts' && (
        <div className="space-y-6 mt-4">
          <div className="flex items-center justify-between border-b pb-4 border-slate-800">
            <div>
              <h2 className="font-serif-display text-[22px] text-[#F5F4F1]">Week {getActiveWeekNumber()} Drafts</h2>
              <p className={`text-xs ${theme.textMuted} mt-1`}>Review the drafts generated from your weekly content calendar.</p>
            </div>
          </div>
        {loadingWeeklyDrafts ? (
          <div className="py-20 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-[#F5A623]" />
            <p className={`text-sm ${theme.textMuted}`}>Loading weekly drafts...</p>
          </div>
        ) : weeklyDrafts.length === 0 ? (
          <div className={`text-center py-20 rounded-xl border border-dashed ${isDarkMode ? 'border-slate-805/50' : 'border-slate-300'} ${theme.bgCard}`}>
            <h3 className={`text-lg font-bold ${theme.text}`}>No drafts found</h3>
            <p className={`${theme.textSecondary} mb-6`}>There are no drafts generated for Week {getActiveWeekNumber()} of this calendar.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in duration-350">
            {weeklyDrafts.map((item) => (
              <div 
                key={item._id}
                className={`group relative bg-slate-900/40 border rounded-2xl overflow-hidden transition-all flex flex-col hover:border-slate-700/80 hover:shadow-xl ${
                  isDarkMode ? 'border-slate-800' : 'border-slate-200'
                }`}
              >
                <div className="relative aspect-video w-full bg-slate-950 overflow-hidden flex items-center justify-center">
                  {item.status === 'processing' ? (
                    <div className="flex flex-col items-center gap-1.5 text-slate-400 text-xs">
                      <Loader2 className="w-6 h-6 text-[#F5A623] animate-spin" />
                      <span>Generating Image...</span>
                    </div>
                  ) : item.status === 'failed' ? (
                    <div className="flex flex-col items-center gap-1.5 text-red-400 text-xs">
                      <span className="text-xl">⚠️</span>
                      <span>Generation Failed</span>
                    </div>
                  ) : item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-3xl text-slate-700">🖼️</div>
                  )}
                </div>
                <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                  <div>
                    <div className="flex justify-between items-start gap-2">
                      <h3 className="font-bold text-slate-200 line-clamp-1">
                        {item.title || 'Untitled Draft'}
                      </h3>
                      {item.status === 'processing' && (
                        <span className="px-1.5 py-0.5 text-[9px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded">
                          Processing
                        </span>
                      )}
                      {item.status === 'failed' && (
                        <span className="px-1.5 py-0.5 text-[9px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20 rounded">
                          Failed
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 line-clamp-3 mt-2 leading-relaxed">
                      {item.caption || <span className="italic text-slate-650">No caption defined</span>}
                    </p>
                  </div>
                  <div className="pt-3 border-t border-slate-800/60 flex items-center justify-between text-xs text-[#F5A623]">
                    {item.status === 'failed' ? (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            await draftsAPI.retryImageGeneration(item._id);
                            loadWeeklyDrafts();
                          } catch (err: any) {
                            alert(err.message || 'Failed to retry generation.');
                          }
                        }}
                        className="flex items-center gap-1 px-2 py-0.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/30 transition-colors"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Retry
                      </button>
                    ) : item.status === 'processing' ? (
                      <span className="text-slate-400">Processing...</span>
                    ) : (
                      <span className="capitalize">{item.status}</span>
                    )}
                    <span>➜</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
      )}

      {activeDetailTab === 'calendar' && (
        <>
      {/* Month banner. The cover is art for the month's own theme, so it sits
          behind the month name rather than beside it — and the scrim keeps the
          type readable whatever the image turns out to be. */}
      <div className="relative rounded-2xl overflow-hidden border border-white/[0.08] bg-[#141414] mb-5">
        <div className="absolute inset-0">
          {calendar.coverImageUrl ? (
            <img src={calendar.coverImageUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-[#F5A623]/[0.10] via-transparent to-transparent" />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/70 to-black/40" />
        </div>

        <div className="relative px-6 py-7 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="gravity-label text-[#F5A623] mb-1.5">Smart Calendar</div>
            <h2 className="font-serif-display text-[34px] leading-[1.05] text-[#F5F4F1]">
              {monthLabel(calendar.month)}
            </h2>
            {calendar.themeTitle && (
              <div className="mt-2 text-[14px] font-semibold text-[#F5A623]">{calendar.themeTitle}</div>
            )}
            {calendar.themeSummary && (
              <p className="mt-1 text-[12.5px] text-white/60 max-w-[440px] leading-relaxed">
                {calendar.themeSummary}
              </p>
            )}
            <p className="mt-2.5 text-[11.5px] text-white/40">
              {calendar.businessName || 'Your business'} · {calendar.businessVertical || 'Content'} · {calendar.language}
            </p>
          </div>

          <div className="shrink-0">
            {calendar.coverStatus === 'pending' ? (
              <span className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] text-white/55 border border-white/[0.12]">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#F5A623]" />
                Making the cover…
              </span>
            ) : (
              <button
                type="button"
                onClick={requestCover}
                disabled={coverBusy}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-semibold border border-white/[0.12] text-[#F5F4F1] hover:bg-white/[0.06] hover:border-[#F5A623]/40 transition-all disabled:opacity-40"
              >
                <ImageIcon className="w-3.5 h-3.5 text-[#F5A623]" />
                {calendar.coverImageUrl ? 'New cover' : 'Make a cover'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#F5A623]" />
            <h2 className="font-serif-display text-[18px] text-[#F5F4F1]">This month's plan</h2>
          </div>
        </div>

        <div className="flex flex-col items-stretch lg:items-end gap-2">
          {/* Same optional focus used by "Generate Next Month Plan" — shown
              here too since Regenerate is the other place a focus matters. */}
          <input
            type="text"
            value={planFocus}
            onChange={(e) => setPlanFocus(e.target.value)}
            placeholder="Anything specific to focus on this month? (optional, used by Regenerate)"
            className="gravity-bare w-full lg:w-[380px] px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.10] text-[12.5px] text-[#F5F4F1] outline-none placeholder:text-white/30"
          />
          <div className="flex flex-wrap items-center gap-2">

          <button
            type="button"
            onClick={approveCalendar}
            disabled={!!saving || calendar.approved}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold ${calendar.approved ? 'bg-emerald-500/15 text-emerald-400' : 'bg-[#F5A623] text-black'}`}
          >
            <Check className="w-4 h-4" />
            {calendar.approved ? 'Approved' : 'Approve'}
          </button>
          <button
            type="button"
            onClick={toggleAutoGenerate}
            disabled={!!saving}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border transition-all duration-300 ${calendar.autoGenerate ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.3)]' : isDarkMode ? 'border-slate-700 text-slate-200 hover:bg-slate-800' : 'border-slate-300 text-slate-800 hover:bg-slate-50'}`}
          >
            {calendar.autoGenerate ? <ToggleRight className="w-5 h-5 text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse" /> : <ToggleLeft className="w-5 h-5 opacity-70" />}
            Auto Generation
          </button>
          <button
            type="button"
            onClick={regenerate}
            disabled={!!saving}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border ${isDarkMode ? 'border-slate-700 text-slate-200' : 'border-slate-300 text-slate-800'}`}
          >
            {saving === 'regenerate' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
            Regenerate
          </button>
          {calendar.approved && (
            <button
              type="button"
              onClick={handleGenerateWeekContent}
              disabled={!!saving}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-blue-600 to-indigo-650 hover:from-blue-500 hover:to-indigo-550 text-white shadow-md hover:shadow-lg transition-all disabled:opacity-50"
            >
              {saving.startsWith('week-') ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Generate Week {getActiveWeekNumber()} Content
            </button>
          )}

          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {calendar.weeks.map((week) => (
          <section key={week._id || week.weekNumber} className="space-y-3">
            <h3 className={`text-sm font-bold uppercase tracking-wide ${theme.textMuted}`}>Week {week.weekNumber}</h3>
            <div className="space-y-3">
              {week.items.map((item) => {
                const isEditing = editingId === item._id;
                const busy = saving.endsWith(item._id);
                return (
                  <article
                    key={item._id}
                    className={`rounded-lg border p-4 ${theme.bgCard} ${isDarkMode ? 'border-slate-800' : 'border-slate-200'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className="text-xs font-bold px-2 py-1 rounded bg-[#F5A623] text-black">Day {item.day}</span>
                          <span className={`text-xs px-2 py-1 rounded ${isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'}`}>{item.format}</span>
                          <span className={`text-xs px-2 py-1 rounded capitalize ${item.status === 'approved' ? 'bg-emerald-500/15 text-emerald-400' : item.status === 'rejected' ? 'bg-red-500/15 text-red-400' : isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'}`}>{item.status}</span>
                        </div>
                        {!isEditing ? (
                          <>
                            <h4 className={`font-semibold ${theme.text}`}>{item.headline}</h4>
                            <p className={`mt-1 text-sm ${theme.textSecondary}`}>{item.creativeConcept}</p>
                            <p className={`mt-2 text-xs ${theme.textMuted}`}>
                              {item.contentPillar} · {item.objective} · {item.shootType} · {item.cta}
                            </p>
                          </>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {editableFields.map((field) => (
                              <label key={field} className={field === 'headline' || field === 'creativeConcept' ? 'md:col-span-2' : ''}>
                                <span className={`text-xs font-semibold capitalize ${theme.textMuted}`}>{String(field)}</span>
                                <textarea
                                  value={String(draftItem[field] || '')}
                                  onChange={(event) => setDraftItem((prev) => ({ ...prev, [field]: event.target.value }))}
                                  rows={field === 'headline' || field === 'creativeConcept' ? 2 : 1}
                                  className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none ${isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'}`}
                                />
                              </label>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col gap-1">
                        <button type="button" title="Move up" onClick={() => moveItem(item._id, -1)} className={`p-2 rounded-lg ${isDarkMode ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`}>
                          <ChevronUp className="w-4 h-4" />
                        </button>
                        <button type="button" title="Move down" onClick={() => moveItem(item._id, 1)} className={`p-2 rounded-lg ${isDarkMode ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`}>
                          <ChevronDown className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {!isEditing ? (
                        <button type="button" onClick={() => beginEdit(item)} className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border ${isDarkMode ? 'border-slate-700 text-slate-200' : 'border-slate-300 text-slate-800'}`}>
                          <Edit3 className="w-3.5 h-3.5" />
                          Edit
                        </button>
                      ) : (
                        <button type="button" onClick={() => saveItem(item._id)} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-[#F5A623] text-black">
                          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          Save
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => approveItem(item)}
                        disabled={busy || Boolean(item.reelQueueJobId)}
                        title={isReelItem(item) ? 'Approve and build this reel in the background' : 'Mark this day approved'}
                        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold ${
                          isReelItem(item) ? 'bg-[#F5A623] text-black' : 'bg-emerald-500/15 text-emerald-400'
                        } disabled:opacity-50`}
                      >
                        {saving === `approved-${item._id}`
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : isReelItem(item) ? <Sparkles className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                        {item.reelQueueJobId
                          ? 'Generating…'
                          : isReelItem(item) ? 'Approve & Generate Reel' : 'Approve'}
                      </button>
                      <button type="button" onClick={() => updateItemStatus(item, 'rejected')} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-red-500/15 text-red-400">
                        <X className="w-3.5 h-3.5" />
                        Reject
                      </button>
                      {item.generatedDraftId ? (
                        <a href={`/drafts?draftId=${item.generatedDraftId}`} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-blue-500/15 text-blue-400 hover:bg-blue-500/25">
                          <Sparkles className="w-3.5 h-3.5" />
                          View Draft
                        </a>
                      ) : (
                        <button type="button" onClick={() => createDraft(item)} disabled={busy || Boolean(item.generatedCampaignId)} className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold ${item.generatedCampaignId ? 'bg-slate-500/15 text-slate-400' : 'bg-[#F5A623] text-black'}`}>
                          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                          {item.generatedCampaignId ? 'Draft Saved' : 'Save Draft'}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      </>
      )}
    </div>
  );
};

export default ContentCalendar;
