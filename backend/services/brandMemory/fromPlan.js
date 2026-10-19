'use strict';
/**
 * What the memory learns from the account's plan and from its own Growth Blueprint. PURE.
 * Both are Blueprint documents (kind 'plan' or 'blueprint') whose `result.plan` is the planner's cleaned answer. Only
 * the strategy is read: themes (pillars), the position and its line, the channel order and the format mix of the 30-day
 * calendar. The Blueprint's competitor block (it carries competitor names) is never read.
 */
const { str, plural, listWords, dayMonth, makeItem, sourceResult, claimText } = require('./common');

const MIN_PILLARS = 3;
const MIN_CALENDAR_DAYS = 10;
const FORMAT_PLURAL = { 'image post': 'image posts', carousel: 'carousels', reel: 'reels', story: 'stories' };

const planOf = (doc) => (doc && doc.result && doc.result.plan && typeof doc.result.plan === 'object' ? doc.result.plan : null);
const pillarNames = (p) => (Array.isArray(p && p.pillars) ? p.pillars : []).map((x) => str(x && x.name)).filter(Boolean).slice(0, 5);

function strategyItems(source, doc) {
  const p = planOf(doc);
  const label = source === 'plan' ? 'your plan' : 'your Blueprint';
  const Label = source === 'plan' ? 'Your plan' : 'Your Blueprint';
  const date = dayMonth(doc && (doc.completedAt || doc.updatedAt));
  const from = date ? `from ${label} of ${date}` : `from ${label}`;
  const items = [];

  const pillars = pillarNames(p);
  if (pillars.length >= MIN_PILLARS) {
    items.push(makeItem({
      key: `${source}-themes`, source, kind: 'themes', confidence: 'strong',
      text: `${Label} has ${plural(pillars.length, 'theme', 'themes')}: ${listWords(pillars)}.`,
      promptLine: source === 'plan' ? `Keep posts inside these themes: ${listWords(pillars)}.` : `The owner's Growth Blueprint suggests these themes: ${listWords(pillars)}.`,
      evidenceCount: pillars.length, evidenceUnit: 'themes', evidenceText: from
    }));
  }

  const pos = (p && p.positioning) || {};
  const territory = str(pos.territory && pos.territory.name);
  const line = claimText(pos.line);
  if (territory || line) {
    const text = territory && line ? `${Label} gives you this position: ${territory}. Your line: "${line}"` : territory ? `${Label} gives you this position: ${territory}.` : `Your line from ${label}: "${line}"`;
    items.push(makeItem({
      key: `${source}-position`, source, kind: 'position', confidence: 'strong', text,
      promptLine: source === 'plan' ? (territory ? `The brand's position: ${territory}.` : `The brand's line: ${line}`) : (territory ? `The owner's Growth Blueprint suggests this position: ${territory}.` : `The owner's Growth Blueprint suggests this line: ${line}`),
      evidenceCount: (territory ? 1 : 0) + (line ? 1 : 0), evidenceUnit: 'parts', evidenceText: from
    }));
  }

  const channels = (Array.isArray(p && p.channels) ? p.channels : []).filter((c) => c && str(c.channel))
    .sort((a, b) => (Number(a.priority) || 99) - (Number(b.priority) || 99)).map((c) => str(c.channel)).slice(0, 5);
  if (channels.length) {
    const text = channels.length === 1 ? `${Label} puts ${channels[0]} first.` : `${Label} puts ${channels[0]} first, then ${listWords(channels.slice(1))}.`;
    items.push(makeItem({
      key: `${source}-channels`, source, kind: 'channels', confidence: 'strong', text,
      promptLine: source !== 'plan' ? '' : channels.length === 1 ? `${channels[0]} matters most for this brand.` : `${channels[0]} matters most for this brand, then ${listWords(channels.slice(1))}.`,
      evidenceCount: channels.length, evidenceUnit: 'channels', evidenceText: from
    }));
  }

  // The format mix of the calendar only for the plan (the Blueprint's calendar is a one-off sample).
  if (source === 'plan') {
    const days = (Array.isArray(p && p.calendar) ? p.calendar : []).filter((c) => c && FORMAT_PLURAL[str(c.format).toLowerCase()]);
    if (days.length >= MIN_CALENDAR_DAYS) {
      const counts = {};
      for (const d of days) { const f = str(d.format).toLowerCase(); counts[f] = (counts[f] || 0) + 1; }
      const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const [top, n] = ranked[0];
      const next = ranked[1];
      items.push(makeItem({
        key: 'plan-format-mix', source, kind: 'format_mix', confidence: 'strong',
        text: `${Label}'s calendar leans on ${FORMAT_PLURAL[top]} (${n} of ${days.length} days)${next ? `, then ${FORMAT_PLURAL[next[0]]} (${next[1]})` : ''}.`,
        promptLine: `The plan leans on ${FORMAT_PLURAL[top]}${next ? `, then ${FORMAT_PLURAL[next[0]]}` : ''}.`,
        evidenceCount: days.length, evidenceUnit: 'days', evidenceText: `from the ${days.length} planned days of ${label}`
      }));
    }
  }
  return { items: items.filter(Boolean), pillars };
}

/** The account's newest completed plan run (or null). */
function learnFromPlan(planDoc) {
  if (!planOf(planDoc)) return sourceResult('none', 'You have no plan yet. Nebulaa makes it from your business profile, then learns from it.');
  const { items } = strategyItems('plan', planDoc);
  return sourceResult('not_enough', 'Your plan does not have enough parts to learn from yet. It fills in at the next refresh of the plan.', { evidenceCount: items.length, evidenceUnit: 'parts', items });
}

/** The account's newest completed Growth Blueprint (or null); the plan is used only to find shared themes. */
function learnFromBlueprint(blueprintDoc, planDoc = null) {
  if (!planOf(blueprintDoc)) return sourceResult('none', 'You have not made a Growth Blueprint yet. When you do, Nebulaa learns from it too.');
  const { items, pillars } = strategyItems('blueprint', blueprintDoc);
  const planPillars = pillarNames(planOf(planDoc));
  if (pillars.length && planPillars.length) {
    const lower = new Set(planPillars.map((x) => x.toLowerCase()));
    const shared = pillars.filter((x) => lower.has(x.toLowerCase()));
    if (shared.length) {
      items.push(makeItem({
        key: 'blueprint-shared-themes', source: 'blueprint', kind: 'shared_themes', confidence: 'strong',
        text: `${plural(shared.length, 'theme is', 'themes are')} in both your Blueprint and your plan: ${listWords(shared)}.`,
        promptLine: `Themes the owner's Blueprint and plan agree on: ${listWords(shared)}.`,
        evidenceCount: shared.length, evidenceUnit: 'themes', evidenceText: 'from your Blueprint and your plan'
      }));
    }
  }
  return sourceResult('not_enough', 'Your Blueprint does not have enough parts to learn from.', { evidenceCount: items.filter(Boolean).length, evidenceUnit: 'parts', items });
}

module.exports = { learnFromPlan, learnFromBlueprint, planOf, pillarNames, MIN_PILLARS, MIN_CALENDAR_DAYS };
