import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collectPages, queryString, PAGE_MAX, MAX_PAGES } from '../utils/pages.ts';

// A fake server: `total` rows, pages of at most `limit`, an opaque cursor.
const server = (total) => {
  const calls = [];
  return {
    calls,
    fetch: async (cursor, limit) => {
      calls.push({ cursor, limit });
      const from = cursor ? Number(cursor.slice(1)) : 0;
      const n = Math.min(limit, PAGE_MAX);
      const items = Array.from({ length: Math.max(0, Math.min(n, total - from)) }, (_, i) => from + i);
      return { items, nextCursor: from + items.length < total ? `c${from + items.length}` : null };
    },
  };
};

test('reads every page for the screens that need everything', async () => {
  const s = server(123);
  const r = await collectPages(s.fetch);
  assert.equal(r.items.length, 123);
  assert.deepEqual(r.items.slice(0, 3), [0, 1, 2]);
  assert.equal(r.nextCursor, null);
  assert.equal(s.calls.length, 3);
  assert.ok(s.calls.every((c) => c.limit === 50));
});

test('reads only as many as asked (the Library), and says there are more', async () => {
  const s = server(100);
  const r = await collectPages(s.fetch, { maxItems: 30 });
  assert.equal(r.items.length, 30);
  assert.equal(r.nextCursor, 'c30');
  assert.deepEqual(s.calls, [{ cursor: null, limit: 30 }]);
  const r2 = await collectPages(server(100).fetch, { maxItems: 60 });
  assert.equal(r2.items.length, 60);
});

test('stops after the safety number of pages; an empty page ends the loop', async () => {
  const s = server(100000);
  const r = await collectPages(s.fetch);
  assert.equal(s.calls.length, MAX_PAGES);
  assert.ok(r.nextCursor);
  const r2 = await collectPages(async () => ({ items: [], nextCursor: 'again' }));
  assert.deepEqual(r2.items, []);
});

test('query string only from the parts that are set', () => {
  assert.equal(queryString({ status: undefined, type: '', cursor: null }), '');
  assert.equal(queryString({ status: 'draft', cursor: 'a b', limit: 50 }), '?status=draft&cursor=a%20b&limit=50');
});

test('the API reads pages: every draft and campaign for the calendar, the newest posts plus Load more in the Library', () => {
  const api = fs.readFileSync(new URL('../services/api.ts', import.meta.url), 'utf8');
  assert.match(api, /getDraftsPage: async/);
  assert.match(api, /getDraftsUpTo: async \(count: number/);
  assert.match(api, /getBin: async \(\): Promise<\{ drafts: Draft\[\] \}> => \{\s+return draftsAPI\.getDrafts\('binned'\);/);
  assert.match(api, /getCampaigns: async[\s\S]{0,400}collectPages<Campaign>/);
  const lib = fs.readFileSync(new URL('../pages/Library.tsx', import.meta.url), 'utf8');
  assert.match(lib, /draftsAPI\.getDraftsUpTo\(postTarget\.current\)/);
  assert.match(lib, /data-testid="library-load-more"/);
  assert.match(lib, /Load more posts/);
});
