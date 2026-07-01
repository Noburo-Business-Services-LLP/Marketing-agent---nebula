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
  X
} from 'lucide-react';
import { contentCalendarAPI } from '../services/api';
import { ContentCalendar as ContentCalendarType, ContentCalendarItem } from '../types';
import { getThemeClasses, useTheme } from '../context/ThemeContext';
import StrategyDocumentView from '../components/StrategyDocumentView';

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
  const [calendar, setCalendar] = useState<ContentCalendarType | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [editingId, setEditingId] = useState('');
  const [draftItem, setDraftItem] = useState<Partial<ContentCalendarItem>>({});
  const [error, setError] = useState('');
  const [showStrategyDoc, setShowStrategyDoc] = useState(false);

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

  const allItems = useMemo(
    () => (calendar?.weeks || []).flatMap((week) => week.items || []),
    [calendar]
  );

  const loadCalendar = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await contentCalendarAPI.get();
      setCalendar(response.calendar);
    } catch (err: any) {
      setError(err?.message || 'Failed to load content calendar');
    } finally {
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
    updateCalendar(async () => contentCalendarAPI.regenerate(), 'regenerate');
  };

  const approveCalendar = () => {
    updateCalendar(async () => contentCalendarAPI.updateSettings({ approved: true }), 'approve-calendar');
  };

  const toggleAutoGenerate = () => {
    if (!calendar) return;
    updateCalendar(
      async () => contentCalendarAPI.updateSettings({ autoGenerate: !calendar.autoGenerate }),
      'auto-generate'
    );
  };

  const createDraft = (item: ContentCalendarItem) => {
    updateCalendar(async () => contentCalendarAPI.createDraft(item._id, false), `draft-${item._id}`);
  };

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#ffcc29]" />
      </div>
    );
  }

  if (!calendar) {
    return (
      <div className={`p-6 rounded-lg border ${theme.bgCard} ${isDarkMode ? 'border-slate-800' : 'border-slate-200'}`}>
        <p className={theme.textSecondary}>{error || 'No content calendar found.'}</p>
        <button onClick={loadCalendar} className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#ffcc29] text-black font-semibold">
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      </div>
    );
  }

  if (showStrategyDoc) {
    return <StrategyDocumentView calendar={calendar} onBack={() => setShowStrategyDoc(false)} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#ffcc29]" />
            <h2 className={`text-xl font-bold ${theme.text}`}>Gravity Smart Calendar</h2>
          </div>
          <p className={`mt-1 text-sm ${theme.textSecondary}`}>
            {calendar.businessName || 'Your business'} · {calendar.businessVertical || 'Content'} · {calendar.month} · {calendar.language}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowStrategyDoc(true)}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${isDarkMode ? 'border-slate-700 hover:bg-slate-800 text-white' : 'border-slate-300 hover:bg-slate-50 text-black'}`}
          >
            <Sparkles className="w-4 h-4" />
            View Content Planning
          </button>
          <button
            type="button"
            onClick={approveCalendar}
            disabled={!!saving || calendar.approved}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold ${calendar.approved ? 'bg-emerald-500/15 text-emerald-400' : 'bg-[#ffcc29] text-black'}`}
          >
            <Check className="w-4 h-4" />
            {calendar.approved ? 'Approved' : 'Approve'}
          </button>
          <button
            type="button"
            onClick={toggleAutoGenerate}
            disabled={!!saving}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border ${isDarkMode ? 'border-slate-700 text-slate-200' : 'border-slate-300 text-slate-800'}`}
          >
            {calendar.autoGenerate ? <ToggleRight className="w-5 h-5 text-emerald-400" /> : <ToggleLeft className="w-5 h-5" />}
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
          <a
            href="/drafts"
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${isDarkMode ? 'border-slate-750 hover:bg-slate-800 text-slate-200' : 'border-slate-250 hover:bg-slate-50 text-slate-800'}`}
          >
            <Sparkles className="w-4 h-4 text-[#ffcc29]" />
            View Weekly Drafts
          </a>
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
                          <span className="text-xs font-bold px-2 py-1 rounded bg-[#ffcc29] text-black">Day {item.day}</span>
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
                        <button type="button" onClick={() => saveItem(item._id)} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-[#ffcc29] text-black">
                          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          Save
                        </button>
                      )}
                      <button type="button" onClick={() => updateItemStatus(item, 'approved')} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-500/15 text-emerald-400">
                        <Check className="w-3.5 h-3.5" />
                        Approve
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
                        <button type="button" onClick={() => createDraft(item)} disabled={busy || Boolean(item.generatedCampaignId)} className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold ${item.generatedCampaignId ? 'bg-slate-500/15 text-slate-400' : 'bg-[#ffcc29] text-black'}`}>
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
    </div>
  );
};

export default ContentCalendar;
