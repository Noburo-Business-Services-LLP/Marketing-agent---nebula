#!/usr/bin/env node
// Turn the per-route audit results (results/<width>__<label>.json, written by the in-page runner)
// into a Markdown report, a compact JSON summary and a PASS/FAIL gate.
//
//   node scripts/visual-audit/summarize.mjs --results <dir> [--md <report.md>] [--json <summary.json>]
//        [--compare <earlier summary.json>] [--widths 1280,375] [--signoff <file>] [--title "..."]
//        [--since <ISO time | epoch ms>]
//
// Every routes.json entry x every width is expected. A missing result is MISSING; a page that
// crashed is BLANK; an audit that threw is ERROR; landing elsewhere than expected is REDIRECT;
// a page where the audit checked 0 elements is EMPTY; with --since, a result saved before that
// time is STALE. None of those ever counts as "0 failures" (rules in gate-logic.mjs).
//
// GATE (Tasks 7-8): PASS only when, for every in-scope route (routes.json minus otherSession)
// at every width: status ok, 0 failures, and every unknown-background item, unparsed colour and
// gradient-text item is listed in unknown-signoff.json. Otherwise FAIL, exit code 1. A run
// narrowed with --widths that leaves out 1280 or 375 never prints PASS: it prints
// "PARTIAL (widths: ...)" and exits 1.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rowStatus, gateVerdict, parseSince } from './gate-logic.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const resultsDir = resolve(args.results || join(here, 'out/results'));
const widths = String(args.widths || '1280,375').split(',').map(Number);
const since = parseSince(args.since);
const routes = JSON.parse(readFileSync(join(here, 'routes.json'), 'utf8')).routes;
const signoffPath = resolve(args.signoff || join(here, 'unknown-signoff.json'));
const signoff = existsSync(signoffPath) ? JSON.parse(readFileSync(signoffPath, 'utf8')) : { signedOff: [] };
const slug = (s) => String(s).replace(/^[#/]+/, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'root';

const files = new Map(readdirSync(resultsDir).filter((f) => /^\d+__.+\.json$/.test(f)).map((f) => [f, JSON.parse(readFileSync(join(resultsDir, f), 'utf8'))]));

// Sign-off entries: { kind: unknown|unparsed|gradientText, route, width?, text? ('*' = all), selector?, reason, verifiedBy }
const isSignedOff = (kind, label, width, item) => (signoff.signedOff || []).some((s) =>
  s.kind === kind && s.route === label && (s.width == null || Number(s.width) === width) &&
  (s.text === '*' || (s.text && String(item.text || '').startsWith(s.text)) || (s.selector && s.selector === item.selector)));

// ---- one row per route x width ---------------------------------------------------------------
const rows = [];
for (const spec of routes) {
  for (const w of widths) {
    const d = files.get(`${w}__${slug(spec.label)}.json`);
    const row = { spec, label: spec.label, width: w, d, scope: spec.otherSession ? 'other' : spec.duplicateOf ? 'duplicate' : 'in' };
    row.status = rowStatus(spec, d, { since });
    if (row.status === 'ok') {
      row.checked = d.checked;
      row.failures = d.failureCount;
      row.unknown = d.unknown.length;
      row.unknownUnsigned = d.unknown.filter((u) => !isSignedOff('unknown', spec.label, w, u)).length;
      row.unparsed = (d.unparsedColors || []).length;
      row.unparsedUnsigned = (d.unparsedColors || []).filter((u) => !isSignedOff('unparsed', spec.label, w, u)).length;
      row.gradientText = (d.gradientText || []).length;
      row.gradientTextUnsigned = (d.gradientText || []).filter((u) => !isSignedOff('gradientText', spec.label, w, u)).length;
      row.kinds = {};
      for (const f of d.failures) row.kinds[f.failureKind || 'contrast'] = (row.kinds[f.failureKind || 'contrast'] || 0) + 1;
      row.svgFailures = d.failures.filter((f) => f.kind === 'svg-text').length;
      row.iconFailures = d.failures.filter((f) => f.kind === 'svg-icon').length;
      row.iconsChecked = d.iconsChecked || 0;
      row.iconUnknown = (d.iconUnknown || []).length;
      row.positionedFailures = d.failures.filter((f) => f.positioned).length;
      row.worst = d.failures[0] ? d.failures[0].ratio : null;
    }
    row.pass = row.status === 'ok' && row.failures === 0 && row.unknownUnsigned === 0 && row.unparsedUnsigned === 0 && row.gradientTextUnsigned === 0;
    rows.push(row);
  }
}
const inScope = rows.filter((r) => r.scope === 'in');
const gated = rows.filter((r) => r.scope !== 'other'); // duplicates must render too
const okRows = (rs) => rs.filter((r) => r.status === 'ok');
const sum = (rs, k) => okRows(rs).reduce((s, r) => s + (r[k] || 0), 0);
const totalsFor = (w) => {
  const rs = inScope.filter((r) => r.width === w);
  const count = (st) => gated.filter((r) => r.width === w && r.status === st).length;
  return {
    expected: rs.length, ok: okRows(rs).length, missing: count('MISSING'), blank: count('BLANK'), error: count('ERROR'),
    redirect: count('REDIRECT'), tabNotFound: count('TAB-NOT-FOUND'), empty: count('EMPTY'), stale: count('STALE'),
    checked: sum(rs, 'checked'), failures: sum(rs, 'failures'), routesWithFailures: okRows(rs).filter((r) => r.failures > 0).length,
    unknown: sum(rs, 'unknown'), unknownUnsigned: sum(rs, 'unknownUnsigned'), unparsed: sum(rs, 'unparsed'), unparsedUnsigned: sum(rs, 'unparsedUnsigned'),
    gradientText: sum(rs, 'gradientText'), gradientTextUnsigned: sum(rs, 'gradientTextUnsigned'),
    svgFailures: sum(rs, 'svgFailures'), iconFailures: sum(rs, 'iconFailures'), iconsChecked: sum(rs, 'iconsChecked'), iconUnknown: sum(rs, 'iconUnknown'), positionedFailures: sum(rs, 'positionedFailures'),
    imageFailures: okRows(rs).reduce((s, r) => s + (r.kinds['image-underlying'] || 0) + (r.kinds['image-any'] || 0), 0),
  };
};
const totals = Object.fromEntries(widths.map((w) => [w, totalsFor(w)]));
const verdict = gateVerdict(rows, widths);

const summary = { generatedAt: new Date().toISOString(), widths, since: since ? new Date(since).toISOString() : null, gate: verdict.gate, totals, routes: {}, otherSession: {} };
for (const r of rows) {
  const tgt = r.scope === 'other' ? summary.otherSession : summary.routes;
  tgt[r.label] ??= { path: r.spec.path || r.spec.url, group: r.spec.group, scope: r.scope, widths: {} };
  tgt[r.label].widths[r.width] = r.status !== 'ok' ? { status: r.status, error: r.d && r.d.error, finalHash: r.d && r.d.finalHash, at: r.d && r.d.at } : {
    status: 'ok', checked: r.checked, failures: r.failures, unknown: r.unknown, unknownUnsigned: r.unknownUnsigned,
    unparsed: r.unparsed, gradientText: r.gradientText, kinds: r.kinds, svgFailures: r.svgFailures, iconFailures: r.iconFailures, iconsChecked: r.iconsChecked, iconUnknown: r.iconUnknown, worst: r.worst,
    top: r.d.failures.slice(0, 10).map((f) => [f.text.slice(0, 40), f.ratio, f.effectiveColor, f.background, f.textClass, f.failureKind || 'contrast', f.kind]),
  };
}

// ---- markdown ---------------------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const code = (s) => (s ? '`' + String(s).replace(/`/g, "'") + '`' : '');
const baseClasses = (s) => String(s || '').split(/\s+/).filter((c) => c && !/^(hover|focus|active|group-hover|dark|disabled|focus-visible|placeholder):/.test(c)).join(' ');
const cell = (r) => (!r ? '-' : r.status !== 'ok' ? `**${r.status}**` : `${r.failures} / ${r.checked}`);
const L = [];
L.push(`# ${args.title || 'Nebulaa contrast audit'}`, '');
L.push(`Generated ${summary.generatedAt.slice(0, 10)} by \`frontend/scripts/visual-audit/summarize.mjs\`. Expected: ${routes.length} routes.json entries x ${widths.join(' and ')} px. Standard: WCAG AA, 4.5:1 normal text, 3:1 large text (>= 24px, or >= 18.66px at 700+).`, '');
L.push(`**GATE: ${summary.gate}**`, '');
L.push('Gate rule (Tasks 7-8): every route in scope (all of routes.json except the pages built in the other session) renders at both 1280 and 375 (no MISSING / STALE / BLANK / EMPTY / ERROR / REDIRECT; a run narrowed to fewer widths is PARTIAL, never PASS), has 0 failures, and every unknown-background item, unparsed colour and gradient-text item is signed off in `frontend/scripts/visual-audit/unknown-signoff.json` after a by-eye check.', '');

if (args.compare && args.compare !== true) {
  const prev = JSON.parse(readFileSync(resolve(args.compare), 'utf8'));
  L.push('## Before / after', '', `| Route | ${widths.map((w) => `${w} before | ${w} after`).join(' | ')} |`, `|---|${widths.map(() => '---:|---:').join('|')}|`);
  const v = (x) => (!x ? 'MISSING' : x.status !== 'ok' ? x.status : `${x.failures} (+${x.unknown ?? 0} unk)`);
  const comparable = [];
  for (const [k, cur] of Object.entries(summary.routes)) {
    L.push(`| ${k} | ${widths.map((w) => `${v(prev.routes?.[k]?.widths?.[w])} | ${v(cur.widths[w])}`).join(' | ')} |`);
    for (const w of widths) { const a = prev.routes?.[k]?.widths?.[w]; const b = cur.widths[w]; if (a?.status === 'ok' && b?.status === 'ok') comparable.push([w, a, b]); }
  }
  L.push('', 'Totals over routes that rendered in BOTH runs (a route missing or broken in either run is not counted, so it cannot make the total drop):', '');
  for (const w of widths) {
    const c = comparable.filter((x) => x[0] === w);
    L.push(`- ${w}px: ${c.length} routes compared, failures ${c.reduce((s, x) => s + x[1].failures, 0)} -> ${c.reduce((s, x) => s + x[2].failures, 0)}, unknown ${c.reduce((s, x) => s + (x[1].unknown || 0), 0)} -> ${c.reduce((s, x) => s + (x[2].unknown || 0), 0)}; not comparable: ${Object.keys(summary.routes).length - c.length}.`);
  }
  L.push('');
}

L.push('## Totals (in scope)', '', '| Width | Expected | Rendered ok | Missing / stale | Blank / empty | Error | Redirect | Checked | Failures | Routes with failures | Unknown (unsigned) | Unparsed colours | Gradient text | of which SVG text | of which SVG icons (icons checked; icon unknown) | over positioned layers | image layers |', '|---:|' + '---:|'.repeat(16));
for (const w of widths) { const t = totals[w]; L.push(`| ${w} | ${t.expected} | ${t.ok} | ${t.missing + t.stale} | ${t.blank + t.empty} | ${t.error} | ${t.redirect + t.tabNotFound} | ${t.checked} | ${t.failures} | ${t.routesWithFailures} | ${t.unknown} (${t.unknownUnsigned}) | ${t.unparsed} | ${t.gradientText} | ${t.svgFailures} | ${t.iconFailures} (${t.iconsChecked}; ${t.iconUnknown}) | ${t.positionedFailures} | ${t.imageFailures} |`); }
L.push('', 'Missing/Blank/Error/Redirect counts include the redirect route kept out of the failure totals. "of which ..." columns break the failures down: SVG `<text>` labels, text measured against a positioned (non-ancestor) layer, and failures involving an image layer (`image-underlying`: fails on the colour beneath the image; `image-any`: no opaque image could make it pass).', '');

const bad = gated.filter((r) => r.status !== 'ok');
if (bad.length) {
  L.push('## Routes that did not render as expected', '', '| Route | Width | Status | Detail |', '|---|---:|---|---|');
  const detail = (r) => !r.d ? 'no result file' : r.d.error || (r.status === 'STALE' ? `saved ${r.d.at || '(no time)'}, before --since` : r.status === 'EMPTY' ? `checked 0 elements (landed on ${r.d.finalHash})` : `landed on ${r.d.finalHash}`);
  for (const r of bad) L.push(`| ${r.label} | ${r.width} | ${r.status} | ${esc(detail(r))} |`);
  L.push('');
}

L.push('## Per route', '', `| Route | Path | ${widths.map((w) => `${w}: fail / checked`).join(' | ')} | Worst ratio | Unknown | Unparsed / gradient text |`, `|---|---|${widths.map(() => '---:').join('|')}|---:|---:|---:|`);
for (const spec of routes.filter((s) => !s.otherSession)) {
  const rs = widths.map((w) => rows.find((r) => r.label === spec.label && r.width === w));
  const worst = Math.min(...rs.map((r) => (r && r.status === 'ok' && r.worst != null ? r.worst : 99)));
  L.push(`| ${spec.label}${spec.duplicateOf ? ' (redirect, not in totals)' : ''} | ${code(spec.path || spec.url)} | ${rs.map(cell).join(' | ')} | ${worst === 99 ? '-' : worst.toFixed(2)} | ${rs.map((r) => (r && r.status === 'ok' ? r.unknown : '-')).join(' / ')} | ${rs.map((r) => (r && r.status === 'ok' ? `${r.unparsed}/${r.gradientText}` : '-')).join(' ; ')} |`);
}
L.push('');

const failRows = okRows(inScope).flatMap((r) => r.d.failures.map((f) => ({ ...f, route: r.label })));
const group = (keyFn) => {
  const m = new Map();
  for (const f of failRows) {
    const k = keyFn(f);
    const g = m.get(k) || { count: 0, routes: new Set(), minRatio: 99, sample: f };
    g.count++; g.routes.add(f.route); g.minRatio = Math.min(g.minRatio, f.ratio);
    m.set(k, g);
  }
  return [...m.entries()].sort((a, b) => b[1].count - a[1].count);
};
L.push('## Failing class patterns', '', 'Nearest text-colour class on the element or an ancestor (state variants dropped). Counts are failures across in-scope routes and both widths. Colours are as drawn, i.e. after the `index.html` override layer.', '');
L.push('| Text-colour classes | Failures | Routes | Worst | Example (computed colour on background) |', '|---|---:|---:|---:|---|');
for (const [k, g] of group((f) => baseClasses(f.textClass) || '(no text-colour class)').slice(0, 30)) L.push(`| ${code(k)} | ${g.count} | ${g.routes.size} | ${g.minRatio.toFixed(2)} | ${esc(g.sample.text.slice(0, 30))}: ${g.sample.effectiveColor} on ${g.sample.background} |`);
L.push('', '| Background classes (nearest) | Failures | Routes | Worst |', '|---|---:|---:|---:|');
for (const [k, g] of group((f) => baseClasses(f.bgClass) || '(no bg class)').slice(0, 25)) L.push(`| ${code(k)} | ${g.count} | ${g.routes.size} | ${g.minRatio.toFixed(2)} |`);
L.push('', '| Computed text colour on background | Failures | Routes | Ratio |', '|---|---:|---:|---:|');
for (const [k, g] of group((f) => `${f.effectiveColor} on ${f.background}`).slice(0, 20)) L.push(`| ${k} | ${g.count} | ${g.routes.size} | ${g.minRatio.toFixed(2)} |`);
L.push('');

L.push('## Worst 10 per route', '', `From the ${widths[0]}px run. "req" is the AA minimum for that size; kind/failureKind as defined in the README.`, '');
for (const spec of routes.filter((s) => !s.otherSession && !s.duplicateOf)) {
  const r = rows.find((x) => x.label === spec.label && x.width === widths[0]);
  if (!r) continue;
  if (r.status !== 'ok') { L.push(`### ${spec.label} - ${r.status}`, ''); continue; }
  L.push(`### ${spec.label} (${code(spec.path || spec.url)}${spec.click ? `, tab "${spec.click}"` : ''}) - ${r.failures} failing of ${r.checked}`, '');
  if (!r.d.failures.length) { L.push('No failures.', ''); continue; }
  L.push('| Ratio | req | Text | Colour on background | Kind | Selector | Text class |', '|---:|---:|---|---|---|---|---|');
  for (const f of r.d.failures.slice(0, 10)) L.push(`| ${f.ratio.toFixed(2)} | ${f.required} | ${esc(f.text.slice(0, 40))} | ${f.effectiveColor} on ${f.background} | ${[f.kind !== 'text' ? f.kind : '', f.failureKind && f.failureKind !== 'contrast' ? f.failureKind : '', f.positioned ? 'positioned' : ''].filter(Boolean).join(', ')} | ${code(esc(f.selector.slice(-80)))} | ${code(esc(baseClasses(f.textClass)))} |`);
  L.push('');
}

L.push('## Unknown, unparsed and gradient-text items (gated unless signed off)', '');
const unk = okRows(gated).flatMap((r) => [
  ...r.d.unknown.map((u) => ({ r, type: 'unknown', u, signed: isSignedOff('unknown', r.label, r.width, u) })),
  ...(r.d.unparsedColors || []).map((u) => ({ r, type: 'unparsed', u, signed: isSignedOff('unparsed', r.label, r.width, u) })),
  ...(r.d.gradientText || []).map((u) => ({ r, type: 'gradientText', u, signed: isSignedOff('gradientText', r.label, r.width, u) })),
]);
if (!unk.length) L.push('None.', '');
else {
  L.push('| Route | Width | Type | Text | Reason / detail | Signed off |', '|---|---:|---|---|---|---|');
  for (const { r, type, u, signed } of unk) L.push(`| ${r.label} | ${r.width} | ${type} | ${esc(String(u.text).slice(0, 30))} | ${esc(u.reason || u.color || u.fill || u.backgroundImage || '')}${u.black != null ? ` (black ${u.black}, white ${u.white}, beneath ${u.ratioUnder})` : ''} | ${signed ? 'yes' : '**no**'} |`);
  L.push('');
}
if ((signoff.needsByEyeCheck || []).length) {
  L.push('Pending by-eye checks listed in the sign-off file:', '');
  for (const n of signoff.needsByEyeCheck) L.push(`- ${n.route}: ${n.reason}`);
  L.push('');
}

const iu = okRows(gated).flatMap((r) => (r.d.iconUnknown || []).map((u) => ({ r, u })));
L.push('## SVG icons over images of unknown colour (reported, not gated)', '');
if (!iu.length) L.push('None.', '');
else { L.push('| Route | Width | Icon | Detail |', '|---|---:|---|---|'); for (const { r, u } of iu) L.push(`| ${r.label} | ${r.width} | ${esc(u.text)} | ${esc(u.reason || '')}${u.black != null ? ` (black ${u.black}, white ${u.white})` : ''} |`); L.push(''); }

const dis = okRows(gated).filter((r) => r.d.disabled.length);
L.push('## Disabled controls below AA (reported, exempt)', '');
if (!dis.length) L.push('None.', '');
else { L.push('| Route | Width | Count | Examples |', '|---|---:|---:|---|'); for (const r of dis) L.push(`| ${r.label} | ${r.width} | ${r.d.disabled.length} | ${esc(r.d.disabled.slice(0, 3).map((f) => `"${f.text.slice(0, 20)}" ${f.ratio}`).join('; '))} |`); L.push(''); }

const ph = okRows(gated).filter((r) => r.d.placeholders.some((p) => p.ratio < p.required));
L.push('## Placeholders below AA (also counted in failures)', '');
if (!ph.length) L.push('None.', '');
else { L.push('| Route | Width | Failing | Examples |', '|---|---:|---:|---|'); for (const r of ph) { const f = r.d.placeholders.filter((p) => p.ratio < p.required); L.push(`| ${r.label} | ${r.width} | ${f.length} | ${esc(f.slice(0, 3).map((p) => `"${p.text.slice(0, 24)}" ${p.ratio}`).join('; '))} |`); } L.push(''); }

const other = rows.filter((r) => r.scope === 'other');
L.push("## Built in the other session (read-only, will be replaced by that branch's version)", '', 'Landing, sign-in/sign-up and onboarding were redesigned in a separate session (branches rebrand-on-prod / rebrand-nebulaa-landing) and will be brought in as-is. Audited for information only: not fixed in Tasks 7-8, not counted in any total, not part of the gate.', '');
L.push('| Route | Path | Width | Failures / checked | Unknown | Worst 3 |', '|---|---|---:|---:|---:|---|');
for (const r of other) L.push(`| ${r.label} | ${code(r.spec.path)} | ${r.width} | ${cell(r)} | ${r.status === 'ok' ? r.unknown : '-'} | ${r.status === 'ok' ? esc(r.d.failures.slice(0, 3).map((f) => `"${f.text.slice(0, 24)}" ${f.ratio} (${f.effectiveColor} on ${f.background})`).join('; ')) : ''} |`);
L.push('');

const errs = okRows(gated).filter((r) => r.d.consoleErrors && r.d.consoleErrors.length);
if (errs.length) {
  L.push('## Console errors during the run', '', '| Route | Width | Errors (first 2) |', '|---|---:|---|');
  for (const r of errs) L.push(`| ${r.label} | ${r.width} | ${esc(r.d.consoleErrors.slice(0, 2).map((e) => e.slice(0, 120)).join(' / '))} |`);
  L.push('');
}

if (args.md) writeFileSync(resolve(args.md), L.join('\n') + '\n');
if (args.json) writeFileSync(resolve(args.json), JSON.stringify(summary, null, 1) + '\n');
for (const w of widths) {
  const t = totals[w];
  console.log(`${w}px: icons checked ${t.iconsChecked}, icon failures ${t.iconFailures}; expected ${t.expected}, ok ${t.ok}, MISSING ${t.missing}, STALE ${t.stale}, BLANK ${t.blank}, EMPTY ${t.empty}, ERROR ${t.error}, REDIRECT ${t.redirect + t.tabNotFound}; failures ${t.failures} on ${t.routesWithFailures} routes; unknown ${t.unknown} (${t.unknownUnsigned} not signed off); unparsed ${t.unparsed}; gradient text ${t.gradientText}`);
}
console.log(`GATE: ${summary.gate}`);
if (verdict.exitCode) process.exitCode = verdict.exitCode;
