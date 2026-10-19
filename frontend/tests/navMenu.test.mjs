import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  groupHasPath, showsCompetitorsEntry, navSectionOf, navSubItems, activeSubKey, planTabs, insightsTabs,
  NAV_REDIRECTS, redirectTarget, topBarMeta, badgeText, CREATE_ITEMS,
} from '../utils/navMenu.ts';

test('the folded group opens on its own pages and not on others', () => {
  const paths = ['/brand-assets', '/connect-socials', '/settings'];
  assert.equal(groupHasPath('/brand-assets', paths), true);
  assert.equal(groupHasPath('/settings', paths), true);
  assert.equal(groupHasPath('/dashboard', paths), false);
  assert.equal(groupHasPath('/settings-extra', paths), false);
});

const acct = (tier, extra = {}) => ({ plan: { tier }, ...extra });

test('Competitors tab: shown to every paid plan so the add-on can be found', () => {
  for (const tier of ['starter', 'professional', 'agency']) assert.equal(showsCompetitorsEntry(acct(tier), false), true, tier);
  assert.equal(showsCompetitorsEntry(acct(null), false), true);
});

test('Competitors tab: hidden for free accounts, signed-out and staff-only navigation', () => {
  assert.equal(showsCompetitorsEntry(acct('free'), false), false);
  assert.equal(showsCompetitorsEntry(null, false), false);
  assert.equal(showsCompetitorsEntry(acct('agency', { staffRole: 'owner' }), false), false);
  assert.equal(showsCompetitorsEntry(acct(null, { isCsm: true }), false), false);
});

test('Competitors tab: inside an agency client, or a client opened by staff with a return pass', () => {
  assert.equal(showsCompetitorsEntry(acct('agency', { actingAgency: { id: 'a' } }), true), true);
  assert.equal(showsCompetitorsEntry(acct(null, { isCsm: true }), true), true);
  assert.equal(showsCompetitorsEntry(acct('free', { actingAgency: { id: 'a' } }), true), false);
});

test('every page lights up one menu entry', () => {
  const table = {
    '/dashboard': 'home', '/': 'home',
    '/plan': 'plan', '/blueprint/new': 'plan', '/blueprint/abc': 'plan', '/content-calendar': 'plan',
    '/campaigns': 'create', '/reels': 'create', '/reels/studio': 'create', '/photoshoot': 'create', '/upload': 'create',
    '/library': 'library', '/drafts': 'library',
    '/inbox': 'inbox',
    '/analytics': 'insights', '/competitors': 'insights', '/ai-memory': 'insights', '/ai-history': 'insights', '/ai-performance': 'insights',
    '/brand-assets': 'setup', '/connect-socials': 'setup', '/settings': 'setup',
    '/staff/home': 'staff', '/clients': 'clients', '/agency/clients': 'clients',
    '/trial-expired': 'other', '/dashboard-classic': 'other', '/plans-x': 'other',
  };
  for (const [p, s] of Object.entries(table)) assert.equal(navSectionOf(p), s, p);
});

const ALL = { showsMyPlan: true, showsCompetitors: true };

test('Plan tabs: My plan, Calendar, Content ideas, Blueprint; without My plan the Calendar comes first', () => {
  assert.deepEqual(planTabs(ALL).map((t) => t.label), ['My plan', 'Calendar', 'Content ideas', 'Blueprint']);
  assert.deepEqual(planTabs({ showsMyPlan: false }).map((t) => t.key), ['calendar', 'ideas', 'blueprint']);
  assert.equal(planTabs({ showsMyPlan: false })[0].to, '/plan');
});

test('Insights tabs: Performance, Competitors (paid only), What Nebulaa learned', () => {
  assert.deepEqual(insightsTabs(ALL).map((t) => t.label), ['Performance', 'Competitors', 'What Nebulaa learned']);
  assert.deepEqual(insightsTabs({ showsCompetitors: false }).map((t) => t.key), ['performance', 'learned']);
});

test('sub-items under each open entry, and the current one', () => {
  assert.deepEqual(CREATE_ITEMS.map((i) => [i.label, i.to]), [['Create content', '/campaigns'], ['Create video', '/reels'], ['Photoshoot', '/photoshoot']]);
  assert.equal(navSubItems('create', ALL).length, 3);
  assert.equal(navSubItems('inbox', ALL).length, 3);
  assert.equal(navSubItems('home', ALL).length, 0);
  assert.equal(navSubItems('library', ALL).length, 0);
  assert.equal(activeSubKey('/plan', '', ALL), 'plan');
  assert.equal(activeSubKey('/plan', '?tab=calendar', ALL), 'calendar');
  assert.equal(activeSubKey('/plan', '?tab=nope', ALL), 'plan');
  assert.equal(activeSubKey('/plan', '', { showsMyPlan: false, showsCompetitors: true }), 'calendar');
  assert.equal(activeSubKey('/blueprint/new', '', ALL), 'blueprint');
  assert.equal(activeSubKey('/reels', '?jobId=1', ALL), 'video');
  assert.equal(activeSubKey('/photoshoot', '', ALL), 'photoshoot');
  assert.equal(activeSubKey('/campaigns', '?tab=upload', ALL), 'content');
  assert.equal(activeSubKey('/inbox', '?tab=reviews', ALL), 'reviews');
  assert.equal(activeSubKey('/analytics', '?tab=learned', ALL), 'learned');
  assert.equal(activeSubKey('/ai-history', '', ALL), 'learned');
  assert.equal(activeSubKey('/analytics', '', ALL), 'performance');
});

test('every old address opens its new place, with the query string kept', () => {
  const expect = [
    ['/drafts', '', '/library?view=approve'],
    ['/content-calendar', '', '/plan?tab=calendar'],
    ['/content-calendar', '?tab=ideas', '/plan?tab=ideas'],
    ['/content-calendar', '?view=schedule', '/plan?view=schedule&tab=calendar'],
    ['/idea-inbox', '', '/plan?tab=ideas'],
    ['/blueprint', '', '/plan?tab=blueprint'],
    ['/competitors', '', '/analytics?tab=competitors'],
    ['/competitors', '?compstate=few', '/analytics?compstate=few&tab=competitors'],
    ['/ai-memory', '?memorystate=filled', '/analytics?memorystate=filled&tab=learned'],
  ];
  for (const [from, q, to] of expect) assert.equal(redirectTarget(from, q), to, `${from}${q}`);
  assert.deepEqual(NAV_REDIRECTS.map((r) => r.from).sort(), ['/ai-memory', '/blueprint', '/competitors', '/content-calendar', '/drafts', '/idea-inbox']);
});

test('App.tsx has a replace redirect for every old address; the Blueprint pages keep their own', () => {
  const app = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  for (const r of NAV_REDIRECTS) {
    if (r.from === '/blueprint') continue;
    assert.match(app, new RegExp(`path="${r.from}" element={<OldAddress from="${r.from}" />}`), r.from);
  }
  const bp = fs.readFileSync(new URL('../pages/BlueprintRoutes.tsx', import.meta.url), 'utf8');
  assert.match(bp, /<Route path="new"/);
  assert.match(bp, /<Route path=":id"/);
  assert.match(bp, /OldAddress from="\/blueprint"/);
  // Before onboarding the list stays where it is (no app frame and no Plan page yet).
  assert.match(bp, /user\.onboardingCompleted \? <OldAddress/);
  const redirect = fs.readFileSync(new URL('../components/OldAddress.tsx', import.meta.url), 'utf8');
  assert.match(redirect, /replace/);
});

test('top bar title and crumb for moved pages', () => {
  assert.deepEqual(topBarMeta('/plan', '?tab=calendar'), { title: 'Plan', crumb: 'Calendar' });
  assert.deepEqual(topBarMeta('/plan', ''), { title: 'Plan', crumb: 'My plan' });
  assert.deepEqual(topBarMeta('/blueprint/new', ''), { title: 'Plan', crumb: 'Blueprint' });
  assert.deepEqual(topBarMeta('/reels', ''), { title: 'Create', crumb: 'Create video' });
  assert.deepEqual(topBarMeta('/photoshoot', ''), { title: 'Create', crumb: 'Photoshoot' });
  assert.deepEqual(topBarMeta('/library', '?view=approve'), { title: 'Library', crumb: 'Needs approval' });
  assert.deepEqual(topBarMeta('/analytics', '?tab=competitors'), { title: 'Insights', crumb: 'Competitors' });
  assert.deepEqual(topBarMeta('/analytics', '?tab=learned'), { title: 'Insights', crumb: 'What Nebulaa learned' });
  assert.deepEqual(topBarMeta('/dashboard', ''), { title: 'Home', crumb: '' });
});

test('the Library badge shows nothing for 0 or an unknown count', () => {
  assert.equal(badgeText(0), '');
  assert.equal(badgeText(undefined), '');
  assert.equal(badgeText(null), '');
  assert.equal(badgeText(3), '3');
  assert.equal(badgeText(140), '99+');
});

test('the menu has six entries plus Setup, no old entries and no dead Search button', () => {
  const layout = fs.readFileSync(new URL('../components/Layout.tsx', import.meta.url), 'utf8');
  for (const label of ['Home', 'Plan', 'Create', 'Library', 'Inbox', 'Insights', 'Setup', 'Brand assets', 'Connected accounts', 'Settings', 'Help']) {
    assert.ok(layout.includes(`label: '${label}'`) || layout.includes(`>${label}<`), label);
  }
  for (const old of ["label: 'Dashboard'", "label: 'Review and approve'", "label: 'Calendar'", "label: 'Growth Blueprint'", "label: 'Brand memory'", "label: 'Performance'", 'aria-label="Search"']) {
    assert.ok(!layout.includes(old), old);
  }
});
