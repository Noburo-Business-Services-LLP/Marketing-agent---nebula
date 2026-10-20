import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { retryImport, ChunkLoadError } from '../utils/lazyWithRetry.ts';
import { pathOfHash, PREFETCH_BY_PATH, PAGE_LOADERS, IDLE_PREFETCH } from '../utils/routeChunks.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('retryImport returns the module at once when the first try works', async () => {
  let calls = 0;
  const mod = await retryImport(async () => { calls++; return { default: 'ok' }; }, 1);
  assert.equal(mod.default, 'ok');
  assert.equal(calls, 1);
});

test('retryImport tries once more after a failure and then succeeds', async () => {
  let calls = 0;
  const mod = await retryImport(async () => { calls++; if (calls === 1) throw new Error('Failed to fetch dynamically imported module'); return { default: 'ok' }; }, 1);
  assert.equal(mod.default, 'ok');
  assert.equal(calls, 2);
});

test('retryImport gives up after the second failure with a ChunkLoadError (no third try)', async () => {
  let calls = 0;
  await assert.rejects(
    retryImport(async () => { calls++; throw new Error('404'); }, 1),
    (e) => e instanceof ChunkLoadError && /404/.test(String(e.cause)),
  );
  assert.equal(calls, 2);
});

test('every lazy page in App.tsx has a loader, and only the shell and Home are imported at the top', () => {
  const app = read('App.tsx');
  const eager = [...app.matchAll(/^import (\w+) from '\.\/pages\/([\w/]+)';/gm)].map((m) => m[1]);
  assert.deepEqual(eager, ['GravityHome'], 'a page imported at the top of App.tsx goes into the first download');
  const lazy = [...app.matchAll(/^const (\w+) = lazyWithRetry\(PAGE_LOADERS\.(\w+)\);/gm)];
  assert.ok(lazy.length >= 35);
  for (const [, local, key] of lazy) {
    assert.equal(local, key, `${local} uses its own loader`);
    assert.ok(PAGE_LOADERS[key], `${key} has a loader`);
  }
  assert.ok(app.includes("import Layout from './components/Layout'"), 'the shell stays in the first download');
});

test('the route table keeps every address and every redirect', () => {
  const app = read('App.tsx');
  const paths = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
  for (const p of [
    '/', '/login', '/terms', '/privacy-policy', '/refund-policy', '/blueprint/*', '/admin/login', '/admin', '/onboarding', '/*',
    '/dashboard', '/plan', '/trial-expired', '/dashboard-classic', '/content-calendar', '/content-calendar-grid', '/content-calendar-classic',
    '/idea-inbox', '/campaigns', '/campaigns-classic', '/drafts', '/library', '/photoshoot', '/reels', '/reels/studio', '/reels/hero',
    '/upload', '/ad-campaigns', '/competitors', '/connect-socials', '/inbox', '/clients', '/agency/clients', '/staff', '/staff/:section',
    '/staff/:section/:id', '/connect-socials/inbox', '/brand-assets', '/inventory', '/analytics', '/analytics-classic', '/seo', '/seo/keywords',
    '/seo/metadata', '/seo/hashtags', '/seo/competitor', '/influencer-portal', '/influencer-portal/list', '/influencer-portal/collaborations',
    '/influencer-portal/submissions', '/influencer-portal/analytics', '/influencer-portal/profile', '/ai-memory', '/ai-history', '/ai-performance',
    '/settings', '/help', '*',
  ]) assert.ok(paths.includes(p), `route ${p} is missing`);
  assert.ok(app.includes('<Route path="/upload" element={<Navigate to="/campaigns?tab=upload" replace />} />'));
  assert.ok(app.includes('<Route path="/inventory" element={<Navigate to="/brand-assets?tab=products" replace />} />'));
  assert.ok(app.includes('<Route path="/connect-socials/inbox" element={<Navigate to="/inbox" replace />} />'));
  assert.ok(app.includes('<Route path="*" element={<Navigate to="/dashboard" replace />} />'));
  assert.ok(app.includes('<HashRouter') || app.includes('HashRouter as Router'), 'HashRouter stays');
});

test('both route tables sit inside the error boundary and the loading placeholder', () => {
  const app = read('App.tsx');
  assert.equal((app.match(/<PageBoundary>/g) || []).length, 2, 'the outer routes and the routes inside the shell');
  assert.match(app, /<RouteErrorBoundary resetKey=\{pathname\}>/);
  assert.match(app, /<React\.Suspense fallback=\{<RouteFallback \/>\}>/);
  const boundary = read('components/RouteErrorBoundary.tsx');
  assert.match(boundary, /getDerivedStateFromError/);
  assert.match(boundary, /window\.location\.reload\(\)/);
  assert.match(boundary, /Failed to fetch dynamically imported module/);
});

test('the loading placeholder waits 150 ms before it draws anything', () => {
  const src = read('components/RouteFallback.tsx');
  assert.match(src, /delayMs = 150/);
  assert.match(src, /if \(!show\) return null/);
});

test('large libraries stay out of the first download', () => {
  const vite = read('vite.config.ts');
  for (const g of ['vendor-react', 'vendor-router', 'vendor-pdf']) assert.ok(vite.includes(`'${g}'`), g);
  for (const f of ['components/StrategyDocumentView.tsx', 'services/generateAnalyticsPDF.ts']) {
    assert.doesNotMatch(read(f), /^import (\{ jsPDF \}|jsPDF|html2canvas) from/m, `${f} loads the PDF libraries on demand`);
  }
  assert.match(read('components/Layout.tsx'), /const GuidedTour = React\.lazy/);
  assert.doesNotMatch(read('index.html'), /checkout\.razorpay\.com\/v1\/checkout\.js"><\/script>\s*<script type="module"/);
});

test('menu links and idle prefetch point at real page loaders', () => {
  assert.equal(pathOfHash('#/library?view=approve'), '/library');
  assert.equal(pathOfHash('https://x.test/#/plan'), '/plan');
  assert.equal(pathOfHash('/assets/a.png'), null);
  assert.equal(pathOfHash(null), null);
  for (const name of [...Object.values(PREFETCH_BY_PATH), ...IDLE_PREFETCH]) assert.ok(PAGE_LOADERS[name], name);
  assert.ok(IDLE_PREFETCH.length <= 4, 'the idle prefetch stays small');
});
