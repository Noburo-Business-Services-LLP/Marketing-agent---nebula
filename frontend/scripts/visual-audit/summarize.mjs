#!/usr/bin/env node
// Turn the per-route audit results (out/results/<width>__<label>.json, written by the in-page
// runner) into a Markdown report and a compact JSON summary.
//
//   node scripts/visual-audit/summarize.mjs --results <dir> --md <report.md> --json <summary.json>
//        [--compare <earlier summary.json>] [--title "..."] [--shots <relative dir for links>]
//
// With --compare, the report starts with a before/after table per route (Tasks 7-8).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const resultsDir = resolve(args.results || join(here, 'out/results'));
const routes = JSON.parse(readFileSync(join(here, 'routes.json'), 'utf8')).routes;
const order = new Map(routes.map((r, i) => [r.label, i]));
const slug = (s) => String(s).replace(/^[#/]+/, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'root';
const byName = new Map(routes.map((r) => [slug(r.label), r]));

const allRuns = readdirSync(resultsDir).filter((f) => /^\d+__.+\.json$/.test(f)).map((f) => {
  const d = JSON.parse(readFileSync(join(resultsDir, f), 'utf8'));
  const [, width, name] = f.match(/^(\d+)__(.+)\.json$/);
  const spec = byName.get(name);
  return { file: f, width: Number(width), name, spec, d };
}).filter((r) => r.spec);
allRuns.sort((a, b) => (order.get(a.spec.label) - order.get(b.spec.label)) || (b.width - a.width));
// Pages redesigned in another session (landing, sign-in, onboarding) are reported on their own
// and kept out of totals, patterns and per-route tables.
const runs = allRuns.filter((r) => !r.spec.otherSession && !r.spec.duplicateOf);
const dupRuns = allRuns.filter((r) => r.spec.duplicateOf);
const otherRuns = allRuns.filter((r) => r.spec.otherSession);
const widths = [...new Set(allRuns.map((r) => r.width))].sort((a, b) => b - a);

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const code = (s) => (s ? '`' + String(s).replace(/`/g, "'") + '`' : '');
const baseClasses = (s) => String(s || '').split(/\s+/).filter((c) => c && !/^(hover|focus|active|group-hover|dark|disabled|focus-visible|placeholder):/.test(c)).join(' ');
const status = (r) => {
  if (r.d.blank) return 'BLANK';
  const want = '#' + r.spec.path;
  if (r.d.finalHash && r.d.finalHash !== want && !(r.spec.path === '/' && r.d.finalHash === '')) return 'redirect ' + r.d.finalHash;
  if (r.spec.click && r.d.clicked === false) return 'tab not found';
  return 'ok';
};

// ---- per route/width summary ----------------------------------------------------------------
const summary = { generatedAt: new Date().toISOString(), widths, totals: {}, routes: {} };
for (const r of runs) {
  const key = r.spec.label;
  summary.routes[key] ??= { path: r.spec.path, group: r.spec.group, widths: {} };
  summary.routes[key].widths[r.width] = {
    status: status(r), checked: r.d.checked, failures: r.d.failureCount, unknown: r.d.unknown.length,
    disabled: r.d.disabled.length, placeholdersFailing: r.d.placeholders.filter((p) => p.ratio < p.required).length,
    worst: r.d.failures[0] ? r.d.failures[0].ratio : null,
    top: r.d.failures.slice(0, 10).map((f) => [f.text.slice(0, 40), f.ratio, f.effectiveColor, f.background, f.textClass]),
  };
}
for (const w of widths) {
  const rs = runs.filter((r) => r.width === w);
  summary.totals[w] = { routes: rs.length, checked: rs.reduce((s, r) => s + r.d.checked, 0), failures: rs.reduce((s, r) => s + r.d.failureCount, 0), unknown: rs.reduce((s, r) => s + r.d.unknown.length, 0), routesWithFailures: rs.filter((r) => r.d.failureCount > 0).length };
}

// ---- class patterns ---------------------------------------------------------------------------
const group = (keyFn) => {
  const m = new Map();
  for (const r of runs) for (const f of r.d.failures) {
    const k = keyFn(f);
    const g = m.get(k) || { count: 0, routes: new Set(), minRatio: 99, sample: f };
    g.count++; g.routes.add(r.spec.label); g.minRatio = Math.min(g.minRatio, f.ratio);
    m.set(k, g);
  }
  return [...m.entries()].sort((a, b) => b[1].count - a[1].count);
};
const textPatterns = group((f) => baseClasses(f.textClass) || '(no text-colour class: inherited/default)');
const bgPatterns = group((f) => baseClasses(f.bgClass) || '(no bg class up to the opaque layer)');
const colourPairs = group((f) => `${f.effectiveColor} on ${f.background}`);

// ---- markdown ---------------------------------------------------------------------------------
const L = [];
const title = args.title || 'Nebulaa contrast baseline';
L.push(`# ${title}`, '');
L.push(`Generated ${summary.generatedAt.slice(0, 10)} by \`frontend/scripts/visual-audit/summarize.mjs\` from ${allRuns.length} audit runs (${otherRuns.length} of them on pages built in another session, reported separately) (${widths.join(' and ')} px wide). Standard: WCAG AA, 4.5:1 for normal text, 3:1 for large text (>= 24px, or >= 18.66px at weight 700+).`, '');

if (args.compare && args.compare !== true) {
  const prev = JSON.parse(readFileSync(resolve(args.compare), 'utf8'));
  L.push('## Before / after', '', `| Route | ${widths.map((w) => `${w} before | ${w} after`).join(' | ')} |`, `|---|${widths.map(() => '---:|---:').join('|')}|`);
  for (const [k, v] of Object.entries(summary.routes)) {
    L.push(`| ${k} | ${widths.map((w) => `${prev.routes?.[k]?.widths?.[w]?.failures ?? '-'} | ${v.widths[w]?.failures ?? '-'}`).join(' | ')} |`);
  }
  L.push('', `Totals: ${widths.map((w) => `${w}px ${prev.totals?.[w]?.failures ?? '-'} -> ${summary.totals[w].failures}`).join('; ')}.`, '');
}

L.push('## Totals', '', '| Width | Routes | Text elements checked | Failures | Routes with failures | Unknown background |', '|---:|---:|---:|---:|---:|---:|');
for (const w of widths) { const t = summary.totals[w]; L.push(`| ${w} | ${t.routes} | ${t.checked} | ${t.failures} | ${t.routesWithFailures} | ${t.unknown} |`); }
L.push('');

L.push('## Per route', '', `| Route | Path | ${widths.map((w) => `${w}: fail / checked`).join(' | ')} | Worst ratio | Unknown bg | Status |`, `|---|---|${widths.map(() => '---:').join('|')}|---:|---:|---|`);
for (const [k, v] of Object.entries(summary.routes)) {
  const ws = widths.map((w) => v.widths[w] ? `${v.widths[w].failures} / ${v.widths[w].checked}` : '-').join(' | ');
  const worst = Math.min(...widths.map((w) => v.widths[w]?.worst ?? 99));
  const unk = widths.map((w) => v.widths[w]?.unknown ?? '-').join(' / ');
  const st = [...new Set(widths.map((w) => v.widths[w]?.status).filter(Boolean))].join(', ');
  L.push(`| ${k} | ${code(v.path)} | ${ws} | ${worst === 99 ? '-' : worst.toFixed(2)} | ${unk} | ${st} |`);
}
L.push('');

if (dupRuns.length) L.push(`Redirect routes audited but left out of the totals: ${[...new Set(dupRuns.map((r) => `${r.spec.label} (${code(r.spec.path)} -> ${code(r.d.finalHash)}, same result as ${r.spec.duplicateOf})`))].join('; ')}.`, '');
L.push('## Failing class patterns', '', 'Grouped by the nearest text-colour class on the element or an ancestor (state variants such as `hover:` dropped). Counts are failures across all routes and widths. The computed colour is what the browser drew, after the `index.html` override layer.', '');
L.push('| Text-colour classes | Failures | Routes | Worst | Example (computed colour on background) |', '|---|---:|---:|---:|---|');
for (const [k, g] of textPatterns.slice(0, 30)) L.push(`| ${code(k)} | ${g.count} | ${g.routes.size} | ${g.minRatio.toFixed(2)} | ${esc(g.sample.text.slice(0, 30))}: ${g.sample.effectiveColor} on ${g.sample.background} |`);
L.push('', '| Background classes (up to the nearest opaque layer) | Failures | Routes | Worst |', '|---|---:|---:|---:|');
for (const [k, g] of bgPatterns.slice(0, 25)) L.push(`| ${code(k)} | ${g.count} | ${g.routes.size} | ${g.minRatio.toFixed(2)} |`);
L.push('', '| Computed text colour on background | Failures | Routes | Ratio |', '|---|---:|---:|---:|');
for (const [k, g] of colourPairs.slice(0, 20)) L.push(`| ${k} | ${g.count} | ${g.routes.size} | ${g.minRatio.toFixed(2)} |`);
L.push('');

L.push('## Worst 10 per route', '', `From the ${widths[0]}px run (the ${widths.slice(1).join('/')}px count is in the table above). Ratio is text against its effective background; "req" is the AA minimum for that size.`, '');
for (const k of Object.keys(summary.routes)) {
  const r = runs.find((x) => x.spec.label === k && x.width === widths[0]) || runs.find((x) => x.spec.label === k);
  if (!r) continue;
  L.push(`### ${k} (${code(r.spec.path)}${r.spec.click ? `, tab "${r.spec.click}"` : ''}) - ${r.d.failureCount} failing of ${r.d.checked}`, '');
  if (!r.d.failures.length) { L.push('No failures.', ''); continue; }
  L.push('| Ratio | req | Text | Colour on background | Selector | Text class |', '|---:|---:|---|---|---|---|');
  for (const f of r.d.failures.slice(0, 10)) L.push(`| ${f.ratio.toFixed(2)} | ${f.required} | ${esc(f.text.slice(0, 40))} | ${f.effectiveColor} on ${f.background}${f.kind !== 'text' ? ` (${f.kind})` : ''} | ${code(esc(f.selector.slice(-80)))} | ${code(esc(baseClasses(f.textClass)))} |`);
  L.push('');
}

L.push('## Built in the other session (read-only, will be replaced by that branch\'s version)', '', 'Landing, sign-in/sign-up and onboarding were redesigned in a separate session (branches rebrand-on-prod / rebrand-nebulaa-landing) and will be brought in as-is. They were audited here for information only: not fixed in Tasks 7-8 and not counted in any total above.', '');
if (!otherRuns.length) L.push('Not audited.', '');
else {
  L.push('| Route | Path | Width | Failures / checked | Unknown bg | Worst 3 |', '|---|---|---:|---:|---:|---|');
  for (const r of otherRuns) L.push(`| ${r.spec.label} | ${code(r.spec.path)} | ${r.width} | ${r.d.failureCount} / ${r.d.checked} | ${r.d.unknown.length} | ${esc(r.d.failures.slice(0, 3).map((f) => `"${f.text.slice(0, 24)}" ${f.ratio} (${f.effectiveColor} on ${f.background})`).join('; '))} |`);
  L.push('');
}
summary.otherSession = Object.fromEntries(otherRuns.map((r) => [`${r.spec.label}@${r.width}`, { failures: r.d.failureCount, checked: r.d.checked, unknown: r.d.unknown.length }]));

L.push('## Unknown backgrounds (not counted as failures)', '', 'Text over a url() background image, or over an img/video/canvas that covers most of the text box. These need a visual check.', '');
L.push('| Route | Width | Count | Reasons | Examples |', '|---|---:|---:|---|---|');
for (const r of runs) {
  if (!r.d.unknown.length) continue;
  const reasons = [...new Set(r.d.unknown.map((u) => u.reason))].join(', ');
  L.push(`| ${r.spec.label} | ${r.width} | ${r.d.unknown.length} | ${reasons} | ${esc(r.d.unknown.slice(0, 3).map((u) => `"${u.text.slice(0, 20)}" (${u.color})`).join('; '))} |`);
}
L.push('');

const dis = runs.filter((r) => r.d.disabled.length);
L.push('## Disabled controls below AA (reported, exempt)', '');
if (!dis.length) L.push('None.', '');
else { L.push('| Route | Width | Count | Examples |', '|---|---:|---:|---|'); for (const r of dis) L.push(`| ${r.spec.label} | ${r.width} | ${r.d.disabled.length} | ${esc(r.d.disabled.slice(0, 3).map((f) => `"${f.text.slice(0, 20)}" ${f.ratio}`).join('; '))} |`); L.push(''); }

const ph = runs.filter((r) => r.d.placeholders.some((p) => p.ratio < p.required));
L.push('## Placeholders below AA (also counted in failures)', '');
if (!ph.length) L.push('None.', '');
else { L.push('| Route | Width | Failing | Examples |', '|---|---:|---:|---|'); for (const r of ph) { const f = r.d.placeholders.filter((p) => p.ratio < p.required); L.push(`| ${r.spec.label} | ${r.width} | ${f.length} | ${esc(f.slice(0, 3).map((p) => `"${p.text.slice(0, 24)}" ${p.ratio}`).join('; '))} |`); } L.push(''); }

const gt = runs.filter((r) => r.d.gradientText.length);
if (gt.length) {
  L.push('## Gradient (background-clip:text) text, not measured', '', '| Route | Width | Count | Example |', '|---|---:|---:|---|');
  for (const r of gt) L.push(`| ${r.spec.label} | ${r.width} | ${r.d.gradientText.length} | ${esc(r.d.gradientText[0].text.slice(0, 30))} |`);
  L.push('');
}

const errs = runs.filter((r) => r.d.consoleErrors && r.d.consoleErrors.length);
if (errs.length) {
  L.push('## Console errors during the run', '', '| Route | Width | Errors (first 2) |', '|---|---:|---|');
  for (const r of errs) L.push(`| ${r.spec.label} | ${r.width} | ${esc(r.d.consoleErrors.slice(0, 2).map((e) => e.slice(0, 120)).join(' / '))} |`);
  L.push('');
}

if (args.md) writeFileSync(resolve(args.md), L.join('\n') + '\n');
if (args.json) writeFileSync(resolve(args.json), JSON.stringify(summary, null, 1) + '\n');
const worstPages = Object.entries(summary.routes).map(([k, v]) => [k, v.widths[widths[0]]?.failures ?? 0]).sort((a, b) => b[1] - a[1]);
console.log(JSON.stringify({ totals: summary.totals, worstPages: worstPages.slice(0, 10), textPatterns: textPatterns.slice(0, 8).map(([k, g]) => [k, g.count]) }, null, 1));
