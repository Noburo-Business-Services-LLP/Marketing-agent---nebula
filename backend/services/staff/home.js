/**
 * Numbers for the staff Home screen: which clients need attention (most urgent first) and how the
 * business is growing. Pure except for `loadDailyActive`. Days are counted in India time.
 */
const { urgency } = require('./clientStatus');
const { buildList } = require('./clientList');

const DAY = 86400000;
const IST_OFFSET_MIN = 330;

function dayKey(ms, offsetMin = IST_OFFSET_MIN) {
  return new Date(ms + offsetMin * 60000).toISOString().slice(0, 10);
}

function startOfDay(ms, offsetMin = IST_OFFSET_MIN) {
  const shifted = ms + offsetMin * 60000;
  return shifted - (shifted % DAY) - offsetMin * 60000;
}

function pct(now, before) {
  if (!before) return now > 0 ? null : 0; // no earlier figure to compare with
  return Math.round(((now - before) / before) * 100);
}

function windowCount(times, from, to) {
  return times.filter((t) => t >= from && t < to).length;
}

/** Sign-ups today, this week and this month, each against the period before it. */
function signupStats(times, now) {
  const today = startOfDay(now);
  const w = (days) => ({ now: windowCount(times, now - days * DAY, now + 1), before: windowCount(times, now - 2 * days * DAY, now - days * DAY) });
  const d = { now: windowCount(times, today, now + 1), before: windowCount(times, today - DAY, today) };
  return {
    today: { ...d, change: pct(d.now, d.before) },
    week: { ...w(7), change: pct(w(7).now, w(7).before) },
    month: { ...w(30), change: pct(w(30).now, w(30).before) }
  };
}

function series30(signupTimes, dailyActive, now) {
  const out = [];
  const activeByDay = Object.fromEntries((dailyActive || []).map((r) => [r.day, r.n]));
  const signupsByDay = {};
  signupTimes.forEach((t) => { const k = dayKey(t); signupsByDay[k] = (signupsByDay[k] || 0) + 1; });
  for (let i = 29; i >= 0; i--) {
    const k = dayKey(now - i * DAY);
    out.push({ day: k, signups: signupsByDay[k] || 0, active: activeByDay[k] || 0 });
  }
  return out;
}

function buildHome({ viewer, users, extras = {}, csmNames = {}, dailyActive = [], now = Date.now(), attentionLimit = 25 }) {
  const list = buildList({ viewer, users, extras, csmNames, now, filter: 'attention', pageSize: 100 });
  const attention = list.rows
    .map((r) => ({ ...r, urgency: urgency(r.attention, r.quarks) }))
    .sort((a, b) => b.urgency - a.urgency || a.quarks - b.quarks)
    .slice(0, attentionLimit)
    .map(({ id, name, email, quarks, attention: reasons, csm, lastActiveAt }) => ({ id, name, email, quarks, reasons, csm, lastActiveAt }));

  const all = buildList({ viewer, users, extras, csmNames, now, filter: 'all', pageSize: 100 });
  const counts = all.counts;

  // Sign-up times of the clients this person may see (hidden test accounts excluded).
  const ids = new Set();
  let page = 1; let pages = 1;
  const clients = [];
  do {
    const p = buildList({ viewer, users, extras, csmNames, now, filter: 'all', pageSize: 100, page });
    pages = p.pages; p.rows.forEach((r) => { ids.add(r.id); clients.push(r); }); page += 1;
  } while (page <= pages);
  const signupTimes = users.filter((u) => ids.has(String(u._id || u.id)) && u.createdAt).map((u) => new Date(u.createdAt).getTime());

  const cohort = users.filter((u) => ids.has(String(u._id || u.id)) && u.createdAt && now - new Date(u.createdAt).getTime() <= 30 * DAY);
  const cohortPaying = clients.filter((r) => r.paying && cohort.some((u) => String(u._id || u.id) === r.id)).length;

  return {
    attention: { total: counts.attention, items: attention },
    growth: {
      signups: signupStats(signupTimes, now),
      activeThisWeek: counts.active,
      totalClients: counts.all,
      trialToPaid: { signedUp: cohort.length, paid: cohortPaying, percent: cohort.length ? Math.round((cohortPaying / cohort.length) * 100) : null },
      series: series30(signupTimes, dailyActive, now)
    }
  };
}

/** Distinct clients using the product per day over the last 30 days (feature events). */
async function loadDailyActive({ FeatureEvent, ids, now = Date.now() }) {
  const rows = await FeatureEvent.aggregate([
    { $match: { userId: { $in: ids }, timestamp: { $gte: new Date(now - 30 * DAY) } } },
    { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp', timezone: '+05:30' } }, user: '$userId' } } },
    { $group: { _id: '$_id.day', n: { $sum: 1 } } }
  ]);
  return rows.map((r) => ({ day: r._id, n: r.n }));
}

module.exports = { buildHome, loadDailyActive, signupStats, series30, dayKey, startOfDay, pct };
