import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Loader2,
  RotateCcw,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  ImageIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { CalendarCover } from '../components/calendar/CalendarCover';
import { MonthHero, PlanInputsCard } from '../components/calendar/MonthHero';
import { indiaMonthKey, nextPlanMonth, pickHeroCalendar, heroAction, monthCounts, weekOfMonth, allItems as allPlanItems } from '../utils/calendarHero';
import { fillRows } from '../utils/rowSpans';

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
import StrategyDocumentView from '../components/StrategyDocumentView';
import { startBackgroundReel } from '../utils/backgroundReel';
import { useConfirm } from '../context/ConfirmContext';
import PlanMonthGrid from '../components/calendar/PlanMonthGrid';
import PlanDayList from '../components/calendar/PlanDayList';
import { DraftPreviewModal } from '../components/DraftPreviewModal';

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
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [calendar, setCalendar] = useState<ContentCalendarType | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [editingId, setEditingId] = useState('');
  const [draftItem, setDraftItem] = useState<Partial<ContentCalendarItem>>({});
  const [error, setError] = useState('');
  // The post made for a plan day opens in its post sheet (approve, schedule, download...), not on another page.
  const [openPost, setOpenPost] = useState<Draft | null>(null);
  const openDraft = async (draftId: string) => {
    try {
      const r: any = await draftsAPI.getDraft(draftId);
      if (r?.draft) setOpenPost(r.draft); else setError('We could not open that post. Please try again.');
    } catch { setError('We could not open that post. Please try again.'); }
  };
  const [activeDetailTab, setActiveDetailTab] = useState<'calendar' | 'planning' | 'drafts'>('calendar');
  const [weeklyDrafts, setWeeklyDrafts] = useState<Draft[]>([]);
  const [loadingWeeklyDrafts, setLoadingWeeklyDrafts] = useState(false);
  const [history, setHistory] = useState<ContentCalendarType[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');
  // True while "Plan next month" is running (the request takes about a minute); the hero shows it.
  const [generating, setGenerating] = useState(false);
  // Month cards and weekly drafts: columns follow the grid's real width, the last row is filled.
  const [cardCols, setCardCols] = useState(1);
  const cardsRef = React.useRef<HTMLUListElement | null>(null);
  const draftsRef = React.useRef<HTMLUListElement | null>(null);

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

  const getActiveWeekNumber = (): number => weekOfMonth(new Date().getDate());
  useEffect(() => {
    const el = cardsRef.current || draftsRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width;
      setCardCols(w >= 900 ? 3 : w >= 560 ? 2 : 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewMode, loading, history.length, activeDetailTab, weeklyDrafts.length, loadingWeeklyDrafts]);
  const draftSpans = useMemo(() => fillRows(weeklyDrafts.map(() => 1), cardCols), [weeklyDrafts, cardCols]);

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
    const id = setInterval(() => { loadCalendar(true); }, 6000);
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

  // `quiet` keeps the page on screen (the cover check every few seconds, the reload after planning).
  const loadCalendar = async (quiet = false) => {
    if (!quiet) setLoading(true);
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
    if (generating) return;
    setGenerating(true);
    setError('');
    try {
      const response = await contentCalendarAPI.generateNextMonth(planLanguage || undefined, planFocus.trim() || undefined);
      await loadCalendar(true);
      setCalendar(response.calendar);
      setViewMode('detail');
    } catch (err: any) {
      setError(err?.message || 'Failed to generate next month plan');
    } finally {
      setGenerating(false);
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
        month: calendar?.month,
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

  const regenerate = async () => {
    if (!(await confirm("This replaces every day's current idea.", { title: "Regenerate this month's plan?", confirmLabel: 'Regenerate' }))) return;
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

  const todayMonth = indiaMonthKey(Date.now());
  const nextMonth = nextPlanMonth(history, todayMonth);
  const heroCal = pickHeroCalendar(history, todayMonth);
  const weekNow = weekOfMonth(new Date().getDate());
  const sortedHistory = useMemo(
    () => history.slice().sort((x, y) => String(y.month || '').localeCompare(String(x.month || ''))),
    [history]
  );
  const cardSpans = useMemo(() => fillRows(sortedHistory.map(() => 1), cardCols), [sortedHistory, cardCols]);
  const openPlan = (cal: ContentCalendarType) => { setCalendar(cal); setViewMode('detail'); setActiveDetailTab('calendar'); };

  if (loading && !history.length && !generating) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#C77A0A]" aria-label="Loading your plans" />
      </div>
    );
  }

  if (viewMode === 'list') {
    return (
      <div className="nb-cal space-y-5">
        <MonthHero
          calendar={generating ? null : heroCal}
          month={generating || !heroCal ? nextMonth : undefined}
          businessName={heroCal?.businessName || history[0]?.businessName}
          generating={generating}
          primary={heroCal && !generating
            ? { label: heroAction(heroCal, { inList: true, week: weekNow }).label, onClick: () => openPlan(heroCal) }
            : { label: heroAction(null, { inList: true, week: weekNow, nextMonth }).label, onClick: handleGenerateNextMonth }}
        />

        {heroCal && !generating && <PlanInputsCard calendar={heroCal} />}

        {error && <div className="nb-cal-error" role="alert">{error}</div>}

        {/* Plan the month after the newest plan. Language empty means "use my account setting"; the focus is
            optional (left blank, the plan uses brand memory and recent Idea Inbox items). */}
        <div className="nb-cal-next">
          <p className="nb-cal-next-title">{history.length ? `Plan ${monthLabel(nextMonth)}` : 'Before you plan'}</p>
          <select
            value={planLanguage}
            onChange={(e) => setPlanLanguage(e.target.value)}
            className="nb-cal-field"
            aria-label="Language for the next plan"
          >
            <option value="">My default language</option>
            {CONTENT_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
          <input
            type="text"
            value={planFocus}
            onChange={(e) => setPlanFocus(e.target.value)}
            placeholder="Anything specific to focus on this month? (optional)"
            aria-label="Focus for the next plan (optional)"
            className="nb-cal-field"
          />
          {history.length > 0 && (
            <button type="button" onClick={handleGenerateNextMonth} disabled={generating} className="nb-cal-primary">
              {generating ? <Loader2 className="nb-cal-spin w-4 h-4" aria-hidden="true" /> : <Sparkles className="w-4 h-4" aria-hidden="true" />}
              Plan {MONTH_NAMES[Number(nextMonth.slice(5, 7)) - 1] || 'next month'}
            </button>
          )}
        </div>

        {sortedHistory.length > 0 && (
          <section aria-labelledby="nb-cal-months">
            <div className="nb-cal-section-head">
              <h3 id="nb-cal-months">All months</h3>
              <span>{sortedHistory.length} {sortedHistory.length === 1 ? 'plan' : 'plans'}</span>
            </div>
            <ul ref={cardsRef} className="nb-cal-cards" style={{ ['--nb-cal-cols' as any]: cardCols }} data-testid="calendar-month-cards">
              {sortedHistory.map((cal, n) => {
                const counts = monthCounts(allPlanItems(cal));
                return (
                  <li key={cal._id} className="nb-cal-card" data-current={cal._id === heroCal?._id || undefined} data-wide={(cardCols > 1 && cardSpans[n] === cardCols) || undefined} style={cardSpans[n] > 1 ? { gridColumn: `span ${cardSpans[n]}` } : undefined}>
                    <button type="button" className="nb-cal-card-open" onClick={() => openPlan(cal)} aria-label={`Open ${monthLabel(cal.month)}`}>
                      {/* Same cover as the hero, so a month reads the same in the list and inside it. */}
                      <span className="nb-cal-card-cover">
                        <CalendarCover imageUrl={cal.coverImageUrl} month={cal.month} businessName={cal.businessName} pending={cal.coverStatus === 'pending'} tone="light" />
                        {cal.approved && <span className="nb-cal-card-chip"><Check className="w-3 h-3" aria-hidden="true" />Approved</span>}
                      </span>
                      <span className="nb-cal-card-body">
                        <span className="nb-cal-card-month">{monthLabel(cal.month)}</span>
                        <span className="nb-cal-card-theme">{cal.themeTitle || cal.businessName || 'Monthly plan'}</span>
                        <span className="nb-cal-card-meta">
                          <span>{counts.planned} planned</span>
                          <span>{counts.approved} approved</span>
                          <span>{counts.published} published</span>
                          {cal.language && <span>{cal.language.charAt(0).toUpperCase() + cal.language.slice(1)}</span>}
                        </span>
                      </span>
                    </button>

                    {/* Auto Generation used to live only inside a plan, so anyone told to "turn on Smart Calendar"
                        landed here and found no control at all. */}
                    <div className="nb-cal-card-foot">
                      <div className="nb-cal-row">
                        <div className="min-w-0">
                          <div className="nb-cal-row-label">Auto Generation</div>
                          <div className="nb-cal-row-value" data-on={!!cal.autoGenerate}>{cal.autoGenerate ? 'A draft a day, for review' : 'Off'}</div>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={!!cal.autoGenerate}
                          aria-label={`Toggle auto generation for ${monthLabel(cal.month)}`}
                          disabled={saving === `auto-${cal._id}`}
                          onClick={() => toggleAutoGenerateForPlan(cal)}
                          className="nb-cal-switch"
                        />
                      </div>
                      {/* How much it is allowed to make. Always in its place (so the cards of a row line up); it can be
                          changed once the switch is on. */}
                      <div className="nb-cal-row">
                        <div className="min-w-0">
                          <div className="nb-cal-row-label">Limit</div>
                          <div
                            className="nb-cal-row-value"
                            title={cal.autoGenerate && (cal.autoGenerateLimit ?? AUTO_GENERATE_DEFAULT) > AUTO_GENERATE_DEFAULT ? "Above a week's worth. Each post generates an image, so this will use Quarks faster." : undefined}
                          >
                            {cal.autoGenerate
                              ? <>{cal.autoGeneratedCount || 0} of {cal.autoGenerateLimit ?? AUTO_GENERATE_DEFAULT} made{(cal.autoGenerateLimit ?? AUTO_GENERATE_DEFAULT) > AUTO_GENERATE_DEFAULT && <span className="nb-cal-warn"> · uses Quarks faster</span>}</>
                              : 'Set once it is on'}
                          </div>
                        </div>
                        <select
                          value={cal.autoGenerateLimit ?? AUTO_GENERATE_DEFAULT}
                          disabled={!cal.autoGenerate || saving === `limit-${cal._id}`}
                          onChange={(e) => setAutoGenerateLimit(cal, Number(e.target.value))}
                          aria-label={`Posts auto generation may make in ${monthLabel(cal.month)}`}
                          className="nb-cal-field"
                          style={{ height: 32, flex: 'none' }}
                        >
                          {[3, 5, 7, 10, 14, 20, 30].map((n2) => (
                            <option key={n2} value={n2}>{n2} posts</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    );
  }

  if (viewMode === 'detail' && !calendar) {
    return (
      <div className="nb-cal nb-cal-empty">
        <p>{error || 'No content calendar found.'}</p>
        <button type="button" onClick={() => setViewMode('list')} className="nb-cal-quiet mt-3">All months</button>
      </div>
    );
  }

  const detailAction = heroAction(calendar, { inList: false, week: getActiveWeekNumber() });

  return (
    <div className="nb-cal space-y-5">
      <button type="button" onClick={() => setViewMode('list')} className="nb-cal-quiet">
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />All months
      </button>

      {/* Month hero: the cover, the business and month, the theme, the counts and the one next step
          (approve the month, then make this week's posts). */}
      <MonthHero
        calendar={calendar}
        primary={detailAction.kind === 'approve'
          ? { label: detailAction.label, onClick: approveCalendar, busy: saving === 'approve-calendar', disabled: !!saving }
          : { label: detailAction.label, onClick: handleGenerateWeekContent, busy: saving.startsWith('week-'), disabled: !!saving }}
        extra={calendar.coverStatus === 'pending' ? undefined : (
          <button type="button" onClick={requestCover} disabled={coverBusy} className="nb-cal-quiet">
            <ImageIcon className="w-3.5 h-3.5" aria-hidden="true" />
            {calendar.coverImageUrl ? 'New cover' : 'Make a cover'}
          </button>
        )}
      />

      <div className="nb-cal-tabs" role="tablist" aria-label="Plan views">
        <button type="button" role="tab" aria-selected={activeDetailTab === 'calendar'} className="nb-cal-tab" onClick={() => setActiveDetailTab('calendar')}>Calendar View</button>
        <button type="button" role="tab" aria-selected={activeDetailTab === 'planning'} className="nb-cal-tab" onClick={() => setActiveDetailTab('planning')}>Content Planning</button>
        <button type="button" role="tab" aria-selected={activeDetailTab === 'drafts'} className="nb-cal-tab" onClick={() => { setActiveDetailTab('drafts'); loadWeeklyDrafts(); }}>Weekly Drafts</button>
      </div>

      {activeDetailTab === 'planning' && (
        <div className="mt-4">
          <StrategyDocumentView calendar={calendar} onBack={() => setActiveDetailTab('calendar')} />
        </div>
      )}

      {activeDetailTab === 'drafts' && (
        <div className="space-y-4">
          <div>
            <h2 className="font-serif-display text-[22px] text-[#2B1D0E]">Week {getActiveWeekNumber()} drafts</h2>
            <p className="text-[12.5px] text-[#5E4A31] mt-1">Review the drafts generated from your weekly content calendar.</p>
          </div>
          {loadingWeeklyDrafts ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-7 h-7 animate-spin text-[#C77A0A]" aria-hidden="true" />
              <p className="text-[13px] text-[#5E4A31]">Loading weekly drafts...</p>
            </div>
          ) : weeklyDrafts.length === 0 ? (
            <div className="nb-cal-empty">
              <p className="font-semibold text-[#2B1D0E]">No drafts found</p>
              <p className="mt-1">There are no drafts generated for Week {getActiveWeekNumber()} of this calendar.</p>
            </div>
          ) : (
            <ul ref={draftsRef} className="nb-cal-drafts" style={{ ['--nb-cal-cols' as any]: cardCols }}>
              {weeklyDrafts.map((item, n) => (
                <li key={item._id} className="nb-cal-draft" style={draftSpans[n] > 1 ? { gridColumn: `span ${draftSpans[n]}` } : undefined}>
                  <div className="nb-cal-draft-pic">
                    {item.status === 'processing' ? (
                      <span className="inline-flex items-center gap-1.5"><Loader2 className="w-4 h-4 animate-spin text-[#C77A0A]" aria-hidden="true" />Making the image...</span>
                    ) : item.status === 'failed' ? (
                      <span className="text-[#9A3412]">The image did not finish</span>
                    ) : item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.title} loading="lazy" />
                    ) : (
                      <span>No image yet</span>
                    )}
                  </div>
                  <div className="nb-cal-draft-body">
                    <div className="nb-cal-draft-title">{item.title || 'Untitled Draft'}</div>
                    <p className="nb-cal-draft-caption">{item.caption || 'No caption yet'}</p>
                    <div className="nb-cal-draft-foot">
                      {item.status === 'failed' ? (
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              await draftsAPI.retryImageGeneration(item._id);
                              loadWeeklyDrafts();
                            } catch (err: any) {
                              alert(err.message || 'Failed to retry generation.');
                            }
                          }}
                          className="nb-cal-quiet"
                          style={{ height: 30 }}
                        >
                          <RotateCcw className="w-3 h-3" aria-hidden="true" />
                          Retry
                        </button>
                      ) : item.status === 'processing' ? (
                        <span>Processing...</span>
                      ) : (
                        <span>{item.status}</span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {activeDetailTab === 'calendar' && (
        <>
      <div className="nb-cal-toolbar">
        {/* Same optional focus as "Plan next month": Regenerate is the other place a focus matters. */}
        <input
          type="text"
          value={planFocus}
          onChange={(e) => setPlanFocus(e.target.value)}
          placeholder="Anything specific to focus on this month? (optional, used by Regenerate)"
          aria-label="Focus for Regenerate (optional)"
          className="nb-cal-field"
        />
        <button type="button" onClick={toggleAutoGenerate} disabled={!!saving} aria-pressed={!!calendar.autoGenerate} className="nb-cal-quiet">
          {calendar.autoGenerate ? <ToggleRight className="w-5 h-5" aria-hidden="true" /> : <ToggleLeft className="w-5 h-5" aria-hidden="true" />}
          Auto Generation{calendar.autoGenerate ? ' on' : ''}
        </button>
        <button type="button" onClick={regenerate} disabled={!!saving} className="nb-cal-quiet">
          {saving === 'regenerate' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="w-4 h-4" aria-hidden="true" />}
          Regenerate
        </button>
      </div>

      {error && <div className="nb-cal-error" role="alert">{error}</div>}

      <PlanMonthGrid month={calendar.month} items={allItems} />
      <PlanDayList
        month={calendar.month}
        weeks={calendar.weeks}
        editingId={editingId}
        saving={saving}
        draftItem={draftItem}
        setDraftItem={setDraftItem}
        editableFields={editableFields}
        isReelItem={isReelItem}
        beginEdit={beginEdit}
        saveItem={saveItem}
        approveItem={approveItem}
        updateItemStatus={updateItemStatus}
        createDraft={createDraft}
        moveItem={moveItem}
        openDraft={openDraft}
      />
      {openPost && (
        <DraftPreviewModal
          key={String((openPost as any)._id)}
          draft={openPost}
          onClose={() => setOpenPost(null)}
          onSuccess={() => { setOpenPost(null); loadCalendar(true); }}
          onChanged={() => loadCalendar(true)}
        />
      )}
      </>
      )}
    </div>
  );
};

export default ContentCalendar;
