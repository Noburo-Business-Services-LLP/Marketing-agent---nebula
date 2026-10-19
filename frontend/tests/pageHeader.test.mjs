import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGE_HEADER, PAGE_HEADER_CLASSES } from '../utils/pageHeader.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const css = read('components/pageHeader.css');
const tsx = read('components/PageHeader.tsx');

/** The declarations of the first rule for `selector` in the given block of CSS. */
const rule = (src, selector) => {
  const at = src.indexOf(`${selector} {`);
  assert.ok(at >= 0, `no rule for ${selector}`);
  return src.slice(at, src.indexOf('}', at));
};
const phone = css.slice(css.indexOf(`@media (max-width: ${PAGE_HEADER.phoneBreakpointPx}px)`));

test('the style sheet defines every class the header uses', () => {
  for (const c of PAGE_HEADER_CLASSES) {
    assert.ok(css.includes(`.${c} {`) || css.includes(`.${c},`), `.${c} in pageHeader.css`);
    assert.ok(tsx.includes(c), `${c} in PageHeader.tsx`);
  }
});

test('the title is the serif display at one size scale: 32 px, 26 px on a phone', () => {
  const t = rule(css, '.nb-page-head .nb-page-title');
  assert.match(t, /font-family: 'Playfair Display'/);
  assert.match(t, new RegExp(`font-size: ${PAGE_HEADER.titleDesktopPx}px`));
  assert.match(t, new RegExp(`line-height: ${PAGE_HEADER.titleLineHeight}`));
  assert.match(t, new RegExp(`font-weight: ${PAGE_HEADER.titleWeight}`));
  assert.ok(phone.length > 0, 'a phone rule exists');
  assert.match(rule(phone, '.nb-page-head .nb-page-title'), new RegExp(`font-size: ${PAGE_HEADER.titlePhonePx}px`));
});

test('eyebrow, description, emphasis and spacing follow the spec', () => {
  const e = rule(css, '.nb-page-head .nb-page-eyebrow');
  assert.match(e, new RegExp(`font-size: ${PAGE_HEADER.eyebrowPx}px`));
  assert.match(e, /text-transform: uppercase/);
  const d = rule(css, '.nb-page-head .nb-page-desc');
  assert.match(d, new RegExp(`font-size: ${PAGE_HEADER.descriptionPx}px`));
  assert.match(d, new RegExp(`max-width: ${PAGE_HEADER.descriptionMaxWidthPx}px`));
  assert.match(d, /color: var\(--gv-text-secondary\)/);
  assert.match(css, new RegExp(`\\.nb-page-head \\.nb-page-title em, \\.nb-page-em \\{ font-style: italic; font-weight: inherit; color: ${PAGE_HEADER.emphasisColour}`));
  const h = rule(css, '.nb-page-head');
  assert.match(h, new RegExp(`margin: 0 0 ${PAGE_HEADER.gapBelowPx}px`), 'no top margin, the spec gap below');
  assert.match(rule(phone, '.nb-page-head'), new RegExp(`margin-bottom: ${PAGE_HEADER.gapBelowPhonePx}px`));
});

test('the component has the small API: eyebrow, title, emphasis, description, actions', () => {
  for (const p of ['eyebrow?:', 'title:', 'emphasis?:', 'description?:', 'actions?:', 'id?:', 'titleId?:', 'dataTour?:']) {
    assert.ok(tsx.includes(p), `prop ${p}`);
  }
  assert.match(tsx, /export const PageEmphasis/);
  assert.match(tsx, /import '\.\/pageHeader\.css'/);
  // No colour or size utility classes inside the component: the style sheet is the one source.
  assert.doesNotMatch(tsx, /text-\[\d+px\]/);
});

// Every page reached from the menu, with the file that draws its top heading. Each one uses PageHeader and no
// ad-hoc big title of its own (an h1 with a size class, or a full-size GravityHero). Pages drawn as tabs get their
// header from App.tsx (PAGE_HEADERS), so their files must not draw a second page title.
const MIGRATED = [
  'pages/GravityHome.tsx', 'pages/MyPlan.tsx', 'pages/CreateVideo.tsx', 'pages/HeroVideo.tsx', 'pages/ReelGenerator.tsx',
  'pages/Photoshoot.tsx', 'pages/GravityApprove.tsx', 'pages/Library.tsx', 'pages/AIMemory.tsx', 'pages/BrandAssets.tsx',
  'pages/Inventory.tsx', 'pages/ConnectSocials.tsx', 'pages/Settings.tsx', 'pages/TrialExpired.tsx', 'pages/BlueprintRoutes.tsx',
  'pages/BlueprintStart.tsx', 'pages/BlueprintView.tsx', 'pages/AgencyClients.tsx', 'pages/CsmClients.tsx',
];
const IN_TABS = ['pages/GravityCreate.tsx', 'pages/UploadAndSchedule.tsx', 'pages/CalendarHome.tsx', 'pages/IdeaInbox.tsx', 'pages/GravityCalendar.tsx'];
// Adopted by the agent working on these pages; kept here so the list of pages is complete.
const PENDING_OTHER_AGENT = ['pages/SocialInbox.tsx', 'pages/GravityInsights.tsx', 'pages/Competitors.tsx'];

/** A visible h1 with its own size class or style: the old ad-hoc page titles. Screen-reader-only h1s are fine. */
const adHocTitle = (src) => (src.match(/<h1\b[^>]*>/g) || []).filter((t) => !/sr-only/.test(t) && /text-\[|text-(xl|2xl|3xl|4xl)|style=|className=\{|nb-[a-z-]+-(title|hello)/.test(t));
const bigHero = (src) => (src.match(/<GravityHero\b[^>]*?(\/>|>)/gs) || []).filter((t) => !/size="md"/.test(t));

test('every menu page uses the shared PageHeader and no ad-hoc big title', () => {
  for (const f of MIGRATED) {
    const src = read(f);
    assert.match(src, /import PageHeader(, \{[^}]*\})? from '\.\.\/components\/PageHeader'/, `${f} imports PageHeader`);
    assert.match(src, /<PageHeader\b/, `${f} draws PageHeader`);
    const titles = adHocTitle(src).filter((t) => !(f === 'pages/AgencyClients.tsx' && /font-serif-display text-\[26px\]/.test(t)));
    assert.deepEqual(titles, [], `${f} has no ad-hoc h1`);
    assert.deepEqual(bigHero(src), [], `${f} has no full-size GravityHero`);
  }
});

test('tabbed pages take their header from App.tsx and draw no page title of their own', () => {
  const app = read('App.tsx');
  for (const k of ['create', 'upload']) assert.match(app, new RegExp(`header: PAGE_HEADERS\\.${k}`), `tab ${k} has a header`);
  // Plan and Insights (navigation phases 3 and 4): one header per tab above the tab bar, the tab bodies draw none.
  const plan = read('pages/PlanHub.tsx');
  for (const k of ['plan', 'calendar', 'ideas', 'blueprint']) assert.match(plan, new RegExp(`${k}: <PageHeader eyebrow="Plan"`), `Plan tab ${k}`);
  assert.match(plan, /header: PLAN_HEADERS\[t\.key\]/);
  assert.match(plan, /<MyPlan user=\{user\} embedded \/>/);
  const ins = read('pages/InsightsHub.tsx');
  for (const k of ['performance', 'competitors', 'learned']) assert.match(ins, new RegExp(`${k}: <PageHeader eyebrow="Insights"`), `Insights tab ${k}`);
  for (const c of ['GravityInsights', 'Competitors', 'AIMemory']) assert.match(ins, new RegExp(`<${c} embedded />`), c);
  assert.match(read('components/PageTabs.tsx'), /\{current\.header\}/);
  for (const f of IN_TABS) {
    const src = read(f);
    assert.doesNotMatch(src, /<h1\b/, `${f} has no h1`);
    assert.deepEqual(bigHero(src), [], `${f} has no full-size GravityHero`);
  }
});

test('the pages left for the other agent still exist (remove from this list once they use PageHeader)', () => {
  for (const f of PENDING_OTHER_AGENT) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
});
