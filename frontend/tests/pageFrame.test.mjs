import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Owner, 2026-10-19 (navigation phase 6): every menu page uses the same full content width (one page frame in
// Layout.tsx, no narrowing wrapper of its own) and the same plain cream background (no page or hero glow).
// Rule: docs/superpowers/ops/tile-system.md, "Page width and background".
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// Every page reachable from the menu (and the pages that open inside a menu category).
const MENU_PAGES = [
  'pages/GravityHome.tsx', 'pages/MyPlan.tsx', 'pages/PlanHub.tsx', 'pages/CalendarHome.tsx', 'pages/ContentCalendar.tsx', 'pages/GravityCalendar.tsx',
  'pages/IdeaInbox.tsx', 'pages/GravityCreate.tsx', 'components/CreateGenerations.tsx', 'pages/UploadAndSchedule.tsx', 'pages/CreateVideo.tsx',
  'pages/Photoshoot.tsx', 'pages/Library.tsx', 'pages/GravityApprove.tsx', 'pages/SocialInbox.tsx', 'pages/InsightsHub.tsx', 'pages/GravityInsights.tsx',
  'pages/Competitors.tsx', 'pages/AIMemory.tsx', 'pages/BrandAssets.tsx', 'pages/ConnectSocials.tsx', 'pages/Settings.tsx', 'pages/TrialExpired.tsx',
  'pages/CsmClients.tsx', 'pages/AgencyClients.tsx',
];
// Reading screens that keep a narrow column on purpose (named in the rule): the finished Blueprint is a document read
// page by page (and printed); the Blueprint form keeps its column only on the bare page before onboarding.
const READING_EXCEPTIONS = ['pages/BlueprintView.tsx'];

const NARROW_WRAPPER = /max-w-(?:3xl|4xl|5xl|6xl|7xl|\[(?:[6-9]\d\d|1[0-5]\d\d)px\])[^"'`]*mx-auto|mx-auto[^"'`]*max-w-(?:3xl|4xl|5xl|6xl|7xl|\[(?:[6-9]\d\d|1[0-5]\d\d)px\])/;

test('one page frame in Layout gives every page the same width and padding', () => {
  const layout = read('components/Layout.tsx');
  assert.match(layout, /<main className="flex-1 overflow-y-auto overscroll-contain p-4 md:p-8">\s*\{\/\*[\s\S]*?\*\/\}\s*<div className="nb-page-frame">\{children\}<\/div>/);
  assert.match(read('components/nav.css'), /\.nb-page-frame \{ width: 100%; max-width: 1600px; margin: 0 auto;/);
});

test('menu pages add no narrow centred wrapper of their own', () => {
  const hits = [];
  for (const f of MENU_PAGES) {
    const src = read(f);
    src.split('\n').forEach((line, i) => { if (NARROW_WRAPPER.test(line)) hits.push(`${f}:${i + 1}`); });
  }
  assert.deepEqual(hits, []);
  assert.doesNotMatch(read('App.tsx'), /frame: 'max-w/);
  for (const f of READING_EXCEPTIONS) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
  assert.match(read('pages/BlueprintStart.tsx'), /user\.onboardingCompleted \? 'w-full' : 'max-w-\[720px\]/);
});

test('page stylesheets set no page width and draw no glow behind the page', () => {
  const sheets = {
    'components/home/home.css': '.nb-home', 'components/plan/plan.css': '.nb-plan', 'components/inbox/inbox.css': '.nb-ix',
    'components/memory/memory.css': '.nb-mem', 'components/performance/performance.css': '.nb-perf', 'components/photoshoot/photoshoot.css': '.nb-ps',
  };
  for (const [f, root] of Object.entries(sheets)) {
    const css = read(f);
    const rule = css.slice(css.indexOf(`${root} {`), css.indexOf('}', css.indexOf(`${root} {`)));
    assert.doesNotMatch(rule, /max-width|margin: 0 auto/, `${f}: ${root} has no width of its own`);
    assert.ok(!css.includes(`${root}::before {`), `${f}: no glow layer behind the page`);
  }
  // Hero blocks are plain cards now.
  for (const [f, hero] of [['components/plan/plan.css', '.nb-plan-hero {'], ['components/performance/performance.css', '.nb-perf-hero {'], ['components/memory/memory.css', '.nb-mem-hero {']]) {
    const css = read(f);
    const rule = css.slice(css.indexOf(hero), css.indexOf('}', css.indexOf(hero)));
    assert.doesNotMatch(rule, /gradient/, `${f}: ${hero} plain`);
  }
});

test('the body has the plain cream background and no ambient glow', () => {
  const html = read('index.html');
  assert.ok(!/body\.gravity-shell::before\s*\{/.test(html), 'no body glow layer');
  assert.match(html, /body\.gravity-shell \{\s*background-color: var\(--gv-bg\) !important;/);
});
