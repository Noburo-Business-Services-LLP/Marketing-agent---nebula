const test = require('node:test');
const assert = require('node:assert');
const { snapshotStore } = require('../services/competitors/snapshotStore');

// Minimal in-memory stand-in for the mongoose model: only what the store uses.
function fakeModel() {
  const rows = [];
  const match = (r, f) => Object.entries(f).every(([k, v]) => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('$gte' in v && !(r[k] >= v.$gte)) return false;
      if ('$lt' in v && !(r[k] < v.$lt)) return false;
      if ('$ne' in v) return r[k] !== v.$ne;
      if ('$nin' in v) return !v.$nin.includes(r[k]);
      return true;
    }
    return String(r[k]) === String(v);
  });
  const query = (list) => {
    let out = list.slice();
    const q = {
      sort(s) { const [[k, d]] = Object.entries(s); out.sort((a, b) => (a[k] < b[k] ? 1 : a[k] > b[k] ? -1 : 0) * (d < 0 ? 1 : -1)); return q; },
      limit(n) { out = out.slice(0, n); return q; },
      select() { return q; },
      lean() { return q; },
      then(res, rej) { return Promise.resolve(out).then(res, rej); }
    };
    return q;
  };
  return {
    rows,
    find: (f = {}) => query(rows.filter((r) => match(r, f))),
    findOne: (f = {}) => { const q = query(rows.filter((r) => match(r, f))); const t = q.then.bind(q); q.then = (res, rej) => t((a) => a[0] || null).then(res, rej); return q; },
    countDocuments: async (f = {}) => rows.filter((r) => match(r, f)).length,
    deleteMany: async (f) => { for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], f)) rows.splice(i, 1); },
    findOneAndUpdate: async (f, update) => {
      let row = rows.find((r) => match(r, f));
      if (row) { Object.assign(row, update.$set || {}); return row; }
      row = { ...f, ...(update.$setOnInsert || {}), ...(update.$set || {}) }; rows.push(row); return row;
    }
  };
}

const C = 'c1';
const good = (week, extra = {}) => ({ userId: 'u1', competitorId: C, weekStart: week, takenAt: new Date(`${week}T06:00:00Z`), ok: true, followers: 100, ...extra });
const bad = (week, extra = {}) => ({ userId: 'u1', competitorId: C, weekStart: week, takenAt: new Date(`${week}T07:00:00Z`), ok: false, error: 'private', ...extra });

test('a failed check never overwrites a good snapshot of the same week', async () => {
  const m = fakeModel(); const s = snapshotStore(m);
  await s.save(good('2026-10-12'));
  await s.save(bad('2026-10-12'));
  assert.strictEqual(m.rows.length, 1);
  assert.strictEqual(m.rows[0].ok, true);
  assert.strictEqual(m.rows[0].followers, 100);
});

test('a good snapshot replaces an earlier failed one of the same week', async () => {
  const m = fakeModel(); const s = snapshotStore(m);
  await s.save(bad('2026-10-12'));
  await s.save(good('2026-10-12'));
  assert.strictEqual(m.rows.length, 1);
  assert.strictEqual(m.rows[0].ok, true);
});

test('saving the same week twice keeps one row', async () => {
  const m = fakeModel(); const s = snapshotStore(m);
  await s.save(good('2026-10-12', { followers: 100 }));
  await s.save(good('2026-10-12', { followers: 110 }));
  assert.strictEqual(m.rows.length, 1);
  assert.strictEqual(m.rows[0].followers, 110);
});

test('latest is newest first and ok only, limited to n', async () => {
  const m = fakeModel(); const s = snapshotStore(m);
  await s.save(good('2026-09-28')); await s.save(good('2026-10-12')); await s.save(good('2026-10-05'));
  await s.save(bad('2026-10-19'));
  const l = await s.latest(C, 2);
  assert.deepStrictEqual(l.map((r) => r.weekStart), ['2026-10-12', '2026-10-05']);
  assert.ok(l.every((r) => r.ok));
});

test('latest ignores other competitors', async () => {
  const m = fakeModel(); const s = snapshotStore(m);
  await s.save(good('2026-10-12')); await s.save({ ...good('2026-10-12'), competitorId: 'other' });
  assert.strictEqual((await s.latest(C, 5)).length, 1);
});

test('lastAttempt returns the newest attempt, failed ones included', async () => {
  const m = fakeModel(); const s = snapshotStore(m);
  assert.strictEqual(await s.lastAttempt(C), null);
  await s.save(good('2026-10-05')); await s.save(bad('2026-10-12'));
  const a = await s.lastAttempt(C);
  assert.strictEqual(a.weekStart, '2026-10-12');
  assert.strictEqual(a.ok, false);
});

test('prune keeps the n newest and deletes the rest', async () => {
  const m = fakeModel(); const s = snapshotStore(m);
  for (const w of ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12']) await s.save(good(w));
  await s.save({ ...good('2026-09-14'), competitorId: 'other' });
  await s.prune(C, 3);
  const left = m.rows.filter((r) => r.competitorId === C).map((r) => r.weekStart).sort();
  assert.deepStrictEqual(left, ['2026-09-28', '2026-10-05', '2026-10-12']);
  assert.strictEqual(m.rows.filter((r) => r.competitorId === 'other').length, 1);
});

test('readsToday counts attempts in the last 24 hours only, across accounts', async () => {
  const m = fakeModel(); const s = snapshotStore(m);
  const now = new Date('2026-10-17T12:00:00Z');
  await s.save(good('2026-10-12', { takenAt: new Date('2026-10-17T01:00:00Z') }));
  await s.save({ ...bad('2026-10-12', { takenAt: new Date('2026-10-16T13:00:00Z') }), competitorId: 'c2', userId: 'u2' });
  await s.save({ ...good('2026-10-05', { takenAt: new Date('2026-10-16T11:00:00Z') }), competitorId: 'c3' });
  assert.strictEqual(await s.readsToday(now), 2);
});
