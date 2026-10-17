'use strict';
// Turns the account's plan into a short instruction block for the monthly calendar prompt. planContext is pure.

const MAX_TEXT = 900;
const DAY_MS = 24 * 60 * 60 * 1000;

function phaseFor(days) {
  if (days <= 30) return 'foundation';
  if (days <= 60) return 'storytelling';
  return 'growth';
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function planContext({ plan, now = new Date() } = {}) {
  const p = plan && plan.result && plan.result.plan;
  if (!p || typeof p !== 'object') return null;
  const pillars = (Array.isArray(p.pillars) ? p.pillars : []).map((x) => str(x && x.name)).filter(Boolean);
  if (!pillars.length) return null;

  const effort = (Array.isArray(p.effort) ? p.effort : []).filter((e) => e && str(e.channel));
  const channels = (Array.isArray(p.channels) ? p.channels : []).filter((c) => c && str(c.channel));
  const channelMix = effort.length
    ? effort.map((e) => ({ channel: str(e.channel), organicPct: e.organicPct }))
    : channels.map((c) => ({ channel: str(c.channel), role: str(c.role && c.role.text) }));

  const started = plan.completedAt ? new Date(plan.completedAt) : null;
  const valid = started && !Number.isNaN(started.getTime());
  const days = valid ? Math.max(1, Math.floor((new Date(now) - started) / DAY_MS)) : 1;
  const phase = phaseFor(days);

  const row = (Array.isArray(p.roadmap) ? p.roadmap : []).find((r) => r && r.phase === phase);
  const focusText = str(row && row.focus && row.focus.text);
  const actions = (row && Array.isArray(row.actions) ? row.actions : []).slice(0, 2).map((a) => str(a && a.text)).filter(Boolean);
  const focus = { text: focusText, actions };

  const mixText = channelMix.map((c) => (c.organicPct != null ? `${c.channel} (${c.organicPct}% organic)` : (c.role ? `${c.channel} (${c.role})` : c.channel))).join(', ');
  const focusLine = [focusText, ...actions].filter(Boolean).join(' ');
  let text = `Plan guidance: themes: ${pillars.join(', ')}; channels: ${mixText || 'not set'}; this month's phase: ${phase}`
    + `${focusLine ? ` focus: ${focusLine}` : ''}; keep every idea inside these themes.`;
  if (text.length > MAX_TEXT) text = `${clip(text.slice(0, MAX_TEXT - 45), MAX_TEXT - 45)} Keep every idea inside these themes.`;
  return { pillars, channelMix, phase, focus, text };
}

// Never throws: a plan lookup failure must not block a calendar being made.
async function planGuidanceFor(userId, { now = new Date(), service = null } = {}) {
  try {
    const svc = service || require('../plan/planService').createPlanService();
    const ctx = planContext({ plan: await svc.currentPlan(userId), now });
    return ctx ? ctx.text : '';
  } catch (e) {
    console.warn('[calendar] plan guidance unavailable:', e && e.message);
    return '';
  }
}

module.exports = { planContext, planGuidanceFor };
