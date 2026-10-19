import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { HELP_ANSWERS, QUARKS_HELP_LINK } from '../utils/help.ts';
import { navSectionOf, topBarMeta } from '../utils/navMenu.ts';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const app = read('../App.tsx');

test('the Help entry in the menu opens the Help page inside the app frame', () => {
  const layout = read('../components/Layout.tsx');
  assert.ok(layout.includes("{ path: '/help',            label: 'Help'"), 'Help is a menu entry with a route');
  assert.ok(!/href=\{`mailto:/.test(layout), 'the menu entry is no longer a mail link that does nothing without a mail program');
  assert.ok(app.includes('<Route path="/help" element={<Help user={user} />} />'));
  assert.equal(navSectionOf('/help'), 'setup');
  assert.deepEqual(topBarMeta('/help'), { title: 'Setup', crumb: 'Help' });
});

test('the Help page has the shared header, the tour, Quarks and support tiles', () => {
  const page = read('../pages/Help.tsx');
  assert.ok(page.includes('<PageHeader'));
  assert.ok(page.includes('TOUR_REPLAY_EVENT') && page.includes("saveTour('replay')"), 'Take the tour again restarts the guided tour');
  assert.ok(page.includes('SUPPORT_EMAIL') && page.includes('mailto:'), 'support uses the existing support address');
  assert.equal(QUARKS_HELP_LINK, '/settings?tab=billing');
  const settings = read('../pages/Settings.tsx');
  assert.ok(settings.includes("billing: 'Billing'"), 'Settings opens Billing from ?tab=billing');
});

test('6 to 8 quick answers, each with a link to a page that exists', () => {
  assert.ok(HELP_ANSWERS.length >= 6 && HELP_ANSWERS.length <= 8);
  const topics = HELP_ANSWERS.map((a) => a.id);
  for (const t of ['post', 'approval', 'schedule', 'quarks', 'accounts', 'videos', 'photoshoot', 'inbox']) assert.ok(topics.includes(t), t);
  for (const a of HELP_ANSWERS) {
    assert.ok(a.link, a.id);
    const path = a.link.to.split('?')[0];
    assert.ok(app.includes(`<Route path="${path}"`), `${a.link.to} is a route`);
  }
});

test('answers follow the wording rules and make no claim about replies sent from the Inbox', () => {
  const text = HELP_ANSWERS.map((a) => `${a.question} ${a.answer} ${a.link?.label || ''}`).join('\n');
  assert.ok(!/\bcredits?\b|\btrials?\b|7 days|!|—/i.test(text));
  const inbox = HELP_ANSWERS.find((a) => a.id === 'inbox').answer;
  assert.ok(!/repl/i.test(inbox), 'no promise about replies');
});
