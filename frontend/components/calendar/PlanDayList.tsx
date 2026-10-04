import React, { useState } from 'react';
import { Check, ChevronDown, ChevronUp, Edit3, Loader2, Save, Sparkles, X } from 'lucide-react';
import { ContentCalendarItem, ContentCalendarWeek } from '../../types';
import { formatPlanDay, groupItemsByDay, weekRangeLabel } from '../../utils/calendarPlan';
import { formatChipStyle, statusMark } from './PlanMonthGrid';

export interface PlanDayListProps {
  month: string;
  weeks: ContentCalendarWeek[];
  editingId: string;
  saving: string;
  draftItem: Partial<ContentCalendarItem>;
  setDraftItem: React.Dispatch<React.SetStateAction<Partial<ContentCalendarItem>>>;
  editableFields: Array<keyof ContentCalendarItem>;
  isReelItem: (item: ContentCalendarItem) => boolean;
  beginEdit: (item: ContentCalendarItem) => void;
  saveItem: (itemId: string) => void;
  approveItem: (item: ContentCalendarItem) => void;
  updateItemStatus: (item: ContentCalendarItem, status: ContentCalendarItem['status']) => void;
  createDraft: (item: ContentCalendarItem) => void;
  moveItem: (itemId: string, direction: -1 | 1) => void;
}

const panel: React.CSSProperties = { background: 'var(--gv-panel)', borderColor: 'var(--gv-border-subtle)', color: 'var(--gv-text-primary)' };
const btnBase = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border disabled:opacity-50';
const accentBtn: React.CSSProperties = { background: 'var(--gv-accent)', borderColor: 'var(--gv-accent)', color: 'var(--gv-accent-ink)' };

const PlanCard: React.FC<PlanDayListProps & { item: ContentCalendarItem }> = (p) => {
  const { item } = p;
  const [expanded, setExpanded] = useState(false);
  const isEditing = p.editingId === item._id;
  const busy = p.saving.endsWith(item._id);
  const reel = p.isReelItem(item);
  const s = statusMark(item.status);
  const concept = String(item.creativeConcept || '');
  const longConcept = concept.length > 150;
  const meta = [
    item.contentPillar && `Pillar: ${item.contentPillar}.`,
    item.objective && `Objective: ${item.objective}.`,
    item.shootType && `Shoot: ${item.shootType}.`,
    item.cta && `Call to action: ${item.cta}.`,
  ].filter(Boolean).join(' ');

  return (
    <article className="rounded-xl border p-4" style={{ ...panel, boxShadow: 'var(--gv-shadow-card)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-xs font-semibold px-2 py-1 rounded" style={formatChipStyle(item.format)}>{item.format}</span>
            <span className="text-xs font-semibold px-2 py-1 rounded border" style={{ borderColor: 'var(--gv-border-subtle)', color: 'var(--gv-text-secondary)' }}>
              <span aria-hidden="true">{s.mark} </span>{s.label}
            </span>
          </div>
          {!isEditing ? (
            <>
              <h4 className="font-bold text-[15px] leading-snug" style={{ color: 'var(--gv-text-primary)' }}>{item.headline}</h4>
              <p
                className="mt-1 text-sm leading-relaxed"
                style={{
                  color: 'var(--gv-text-secondary)',
                  ...(expanded ? {} : { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }),
                }}
              >
                {concept}
              </p>
              {longConcept && (
                <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1 text-xs font-semibold underline" style={{ color: 'var(--gv-accent-text)' }}>
                  {expanded ? 'Show less' : 'Show more'}
                </button>
              )}
              {meta && <p className="mt-2 text-xs" style={{ color: 'var(--gv-text-tertiary)' }}>{meta}</p>}
            </>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {p.editableFields.map((field) => (
                <label key={field} className={field === 'headline' || field === 'creativeConcept' ? 'md:col-span-2' : ''}>
                  <span className="text-xs font-semibold capitalize" style={{ color: 'var(--gv-text-tertiary)' }}>{String(field)}</span>
                  <textarea
                    value={String(p.draftItem[field] || '')}
                    onChange={(event) => p.setDraftItem((prev) => ({ ...prev, [field]: event.target.value }))}
                    rows={field === 'headline' || field === 'creativeConcept' ? 2 : 1}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
                    style={panel}
                  />
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <button type="button" title="Move up" onClick={() => p.moveItem(item._id, -1)} className="p-2 rounded-lg" style={{ color: 'var(--gv-text-secondary)' }}>
            <ChevronUp className="w-4 h-4" />
          </button>
          <button type="button" title="Move down" onClick={() => p.moveItem(item._id, 1)} className="p-2 rounded-lg" style={{ color: 'var(--gv-text-secondary)' }}>
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!isEditing ? (
          <button type="button" onClick={() => p.beginEdit(item)} className={btnBase} style={panel}>
            <Edit3 className="w-3.5 h-3.5" />
            Edit
          </button>
        ) : (
          <button type="button" onClick={() => p.saveItem(item._id)} disabled={busy} className={btnBase} style={accentBtn}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </button>
        )}
        <button
          type="button"
          onClick={() => p.approveItem(item)}
          disabled={busy || Boolean(item.reelQueueJobId)}
          title={reel ? 'Approve and build this reel in the background' : 'Mark this day approved'}
          className={btnBase}
          style={reel ? accentBtn : panel}
        >
          {p.saving === `approved-${item._id}`
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : reel ? <Sparkles className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
          {item.reelQueueJobId ? 'Generating…' : reel ? 'Approve & Generate Reel' : 'Approve'}
        </button>
        <button type="button" onClick={() => p.updateItemStatus(item, 'rejected')} disabled={busy} className={btnBase} style={panel}>
          <X className="w-3.5 h-3.5" />
          Reject
        </button>
        {item.generatedDraftId ? (
          <a href={`/drafts?draftId=${item.generatedDraftId}`} className={btnBase} style={panel}>
            <Sparkles className="w-3.5 h-3.5" />
            View Draft
          </a>
        ) : (
          <button type="button" onClick={() => p.createDraft(item)} disabled={busy || Boolean(item.generatedCampaignId)} className={btnBase} style={item.generatedCampaignId ? panel : accentBtn}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {item.generatedCampaignId ? 'Draft Saved' : 'Save Draft'}
          </button>
        )}
      </div>
    </article>
  );
};

const PlanDayList: React.FC<PlanDayListProps> = (props) => (
  <div className="space-y-8">
    {props.weeks.map((week) => {
      const items = week.items || [];
      return (
        <section key={week._id || week.weekNumber} className="space-y-4">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--gv-text-tertiary)' }}>
            Week {week.weekNumber}: {weekRangeLabel(items, props.month)}
          </h3>
          {groupItemsByDay(items).map((group) => (
            <div key={group.day} id={`plan-day-${group.day}`} className="space-y-3 scroll-mt-4">
              <div className="flex items-baseline justify-between gap-3 border-b pb-1" style={{ borderColor: 'var(--gv-border-subtle)' }}>
                <h4 className="text-base font-bold" style={{ color: 'var(--gv-text-primary)' }}>{formatPlanDay(props.month, group.day)}</h4>
                <span className="text-xs" style={{ color: 'var(--gv-text-tertiary)' }}>
                  {group.items.length} {group.items.length === 1 ? 'item' : 'items'}
                </span>
              </div>
              {group.items.map((item) => <PlanCard key={item._id} {...props} item={item} />)}
            </div>
          ))}
        </section>
      );
    })}
  </div>
);

export default PlanDayList;
