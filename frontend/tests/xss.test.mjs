import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeHref, safeSrc } from '../utils/safeHref.ts';

const HOSTILE = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  '  javascript:alert(1)',
  'java\tscript:alert(1)',
  'java\nscript:alert(1)',
  'java\rscript:alert(1)',
  '\u0000javascript:alert(1)',
  '\u0001javascript:alert(1)',
  'javascript\u0000:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
  'ftp://example.com/a',
  'blob:https://example.com/abc',
  'about:blank',
  'chrome://settings',
  '//evil.example/x',
  '\\\\evil.example\\x',
  '/\\evil.example',
  '\\/evil.example',
  'https://user:pass@example.com/',
  'http://[::1',
  'https://exa mple.com',
  '',
  '   ',
  'mailto:a@b.co',
  'tel:+911234567890',
];
const GOOD = [
  ['https://example.com/a?b=1#c', 'https://example.com/a?b=1#c'],
  ['http://example.com', 'http://example.com/'],
  ['  https://www.instagram.com/p/abc/  ', 'https://www.instagram.com/p/abc/'],
  ['HTTPS://EXAMPLE.COM/Path', 'https://example.com/Path'],
  ['/generated-media/a.mp4', 'http://localhost/generated-media/a.mp4'],
  ['https://res.cloudinary.com/x/image/upload/a.png', 'https://res.cloudinary.com/x/image/upload/a.png'],
  ['https://books.zoho.in/app/1#/invoices/2', 'https://books.zoho.in/app/1#/invoices/2'],
  ['https://example.com/a%20b', 'https://example.com/a%20b'],
];

test('safeHref rejects hostile and malformed URLs', () => {
  for (const u of HOSTILE) assert.equal(safeHref(u), undefined, JSON.stringify(u));
});
test('safeHref rejects non-strings', () => {
  for (const u of [undefined, null, 5, {}, [], true]) assert.equal(safeHref(u), undefined);
});
test('safeHref keeps http(s) URLs, normalised', () => {
  for (const [input, out] of GOOD) assert.equal(safeHref(input), out, input);
});

test('safeSrc allows http(s), blob and the four image data types only', () => {
  assert.equal(safeSrc('https://x.test/a.png'), 'https://x.test/a.png');
  assert.equal(safeSrc('blob:https://x.test/1234-5678'), 'blob:https://x.test/1234-5678');
  assert.equal(safeSrc('data:image/png;base64,iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(safeSrc('data:image/jpeg;base64,/9j/4AAQ=='), 'data:image/jpeg;base64,/9j/4AAQ==');
  assert.equal(safeSrc('data:image/webp;base64,UklGR'), 'data:image/webp;base64,UklGR');
  assert.equal(safeSrc('data:image/gif;base64,R0lGOD'), 'data:image/gif;base64,R0lGOD');
  for (const bad of ['data:image/svg+xml;base64,PHN2Zz4=', 'data:image/svg+xml,<svg onload=alert(1)>', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/png;base64,AA" onerror="x', 'data:image/png,abc', 'javascript:alert(1)', 'java\tscript:alert(1)', 'vbscript:x', 'file:///a.png', '//evil.test/a.png', '', undefined, null, 'blob:javascript:alert(1)']) {
    assert.equal(safeSrc(bad), undefined, String(bad));
  }
});

// ---------------------------------------------------------------------------------------------
// The HTML cleaner (DOMPurify) with a jsdom window.
// ---------------------------------------------------------------------------------------------
const { JSDOM } = await import('jsdom');
const { default: createPurify } = await import('dompurify');
const { createStrategySanitizer, STRATEGY_ALLOWED_TAGS, STRATEGY_ALLOWED_ATTR } = await import('../utils/sanitizeHtml.ts');
const dom = new JSDOM('');
const clean = createStrategySanitizer(createPurify(dom.window));

/** Parse the cleaned string and report whether anything dangerous is left. */
function leftovers(html) {
  const doc = new JSDOM(`<body>${html}</body>`).window.document;
  const bad = [];
  doc.body.querySelectorAll('*').forEach((el) => {
    if (!STRATEGY_ALLOWED_TAGS.includes(el.tagName.toLowerCase())) bad.push(`tag ${el.tagName}`);
    for (const a of el.attributes) if (!STRATEGY_ALLOWED_ATTR.includes(a.name)) bad.push(`attr ${a.name}`);
  });
  if (/<script|<\/script/i.test(html)) bad.push('raw script text');
  return bad;
}

const ATTACKS = [
  '<script>alert(1)</script><p>x</p>',
  '<SCRIPT SRC=//evil.test/x.js></SCRIPT><p>x</p>',
  '<scr<script>ipt>alert(1)</scr</script>ipt><p>x</p>',
  '<img src=x onerror=alert(1)>',
  '<IMG SRC=x ONERROR=alert(1)>',
  '<img src="x" onerror="alert(1)"//>',
  '<svg onload=alert(1)><circle/></svg>',
  '<svg><script>alert(1)</script></svg>',
  '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
  '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
  '<a href="javascript:alert(1)">click</a>',
  '<a href="  JaVa\tScRiPt:alert(1)">click</a>',
  '<a href="data:text/html,<script>alert(1)</script>">click</a>',
  '<p style="background:url(javascript:alert(1))">x</p>',
  '<p style="position:fixed;inset:0">cover</p>',
  '<td style="x" colspan="2" onclick="alert(1)">x</td>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<object data="javascript:alert(1)"></object><embed src="javascript:alert(1)">',
  '<form action="javascript:alert(1)"><button formaction="javascript:alert(1)">x</button></form>',
  '<input autofocus onfocus=alert(1)>',
  '<body onload=alert(1)><p>x</p>',
  '<p onmouseover="alert(1)">hover</p>',
  '<details open ontoggle=alert(1)>x</details>',
  '<style>@import "javascript:alert(1)";</style><p>x</p>',
  '<link rel="stylesheet" href="javascript:alert(1)">',
  '<base href="javascript:alert(1)//"><p>x</p>',
  '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
  '<table><tr><td><img src=x onerror=alert(1)></td></tr></table>',
  '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p><img src=x onerror=alert(1)>',
  '<p>a<![CDATA[<img src=x onerror=alert(1)>]]></p>',
  '<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>',
  '<template><script>alert(1)</script></template><p>x</p>',
  '<p data-x="1" aria-label="x" id="a" class="b">x</p>',
];

test('the cleaner leaves nothing dangerous from hostile input', () => {
  for (const attack of ATTACKS) {
    const out = clean(attack);
    assert.deepEqual(leftovers(out), [], `${attack}  ->  ${out}`);
  }
});

test('the cleaner removes script, img onerror, svg onload, javascript: links and style attributes', () => {
  assert.equal(clean('<p>Hi</p><script>alert(1)</script>'), '<p>Hi</p>');
  assert.equal(clean('<p>Hi</p><img src=x onerror=alert(1)>'), '<p>Hi</p>');
  assert.equal(clean('<p>Hi</p><svg onload=alert(1)></svg>'), '<p>Hi</p>');
  assert.equal(clean('<p>Go <a href="javascript:alert(1)">here</a></p>'), '<p>Go here</p>');
  assert.equal(clean('<p style="color:red">Hi</p>'), '<p>Hi</p>');
  assert.equal(clean('<p onclick="alert(1)" class="x" id="y">Hi</p>'), '<p>Hi</p>');
});

test('the cleaner keeps the allowed strategy markup, including table spans', () => {
  const doc = '<h1>Plan</h1><h2>Why</h2><h3>Who</h3><p>One <strong>two</strong> <em>three</em><br>four</p><ul><li>a</li></ul><ol><li>b</li></ol>'
    + '<table><thead><tr><th colspan="2">Pillar</th></tr></thead><tbody><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></tbody></table>';
  assert.equal(clean(doc), doc);
});

test('a span that is not a small whole number is dropped', () => {
  assert.equal(clean('<table><tr><td colspan="2 onclick=alert(1)">x</td></tr></table>').includes('onclick'), false);
  assert.ok(!/colspan/.test(clean('<table><tr><td colspan="javascript:1">x</td></tr></table>')));
});

test('code fences and non-string input are handled', () => {
  assert.equal(clean('```html\n<p>Hi</p>\n```'), '<p>Hi</p>');
  assert.equal(clean(null), '');
  assert.equal(clean(undefined), '');
  assert.equal(clean(42), '42');
});

test('an unsupported environment shows nothing instead of unchecked text', () => {
  const none = createStrategySanitizer({ isSupported: false, sanitize: () => 'x', addHook() {} });
  assert.equal(none('<script>alert(1)</script>'), '');
});

// ---------------------------------------------------------------------------------------------
// Static scan of the app sources.
// ---------------------------------------------------------------------------------------------
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['pages', 'components', 'utils', 'services', 'hooks', 'context', 'constants'];
const SCAN_FILES = ['App.tsx', 'index.tsx'];

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}
const SOURCES = [...SCAN_DIRS.filter((d) => fs.existsSync(path.join(ROOT, d))).flatMap((d) => walk(path.join(ROOT, d))), ...SCAN_FILES.map((f) => path.join(ROOT, f))]
  .map((abs) => ({ rel: path.relative(ROOT, abs).split(path.sep).join('/'), src: fs.readFileSync(abs, 'utf8') }));

/** Reviewed places where HTML is written into the page. Anything new must be added here WITH a reason. */
const HTML_SINK_ALLOWLIST = {
  'utils/strategyPdf.ts': {
    patterns: ['innerHTML ='],
    reason: 'Assigns the output of the DOMPurify cleaner (headings, lists, tables only, no attributes but colspan/rowspan) to an off-screen wrapper that html2canvas draws; covered by the cleaner tests above.',
  },
};
const HTML_SINKS = [
  ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
  ['innerHTML =', /\.innerHTML\s*(\+)?=(?!=)/],
  ['outerHTML =', /\.outerHTML\s*=(?!=)/],
  ['insertAdjacentHTML', /insertAdjacentHTML\s*\(/],
  ['document.write', /document\.write(ln)?\s*\(/],
  ['createContextualFragment', /createContextualFragment\s*\(/],
  ['DOMParser', /new\s+DOMParser\s*\(/],
  ['eval / new Function', /(?<![\w.])eval\s*\(|new\s+Function\s*\(/],
];

test('no HTML sink is used in app sources outside the reviewed allowlist', () => {
  const found = [];
  for (const { rel, src } of SOURCES) {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
    for (const [name, re] of HTML_SINKS) {
      if (!re.test(code)) continue;
      const allowed = HTML_SINK_ALLOWLIST[rel];
      if (allowed && allowed.patterns.includes(name) && allowed.reason) continue;
      found.push(`${rel}: ${name}`);
    }
  }
  assert.deepEqual(found, [], 'Use JSX, textContent or the DOMPurify cleaner. If it is reviewed, add it to HTML_SINK_ALLOWLIST with a reason.');
});

test('the allowlisted sink really exists (the allowlist cannot go stale)', () => {
  for (const [rel, entry] of Object.entries(HTML_SINK_ALLOWLIST)) {
    const file = SOURCES.find((s) => s.rel === rel);
    assert.ok(file, `${rel} is gone: remove it from the allowlist`);
    assert.ok(file.src.includes('sanitizeStrategyHtml'), 'the allowlisted file must clean with the DOMPurify cleaner');
    assert.ok(entry.reason.length > 20);
  }
});

/** Pull out the expression of every `href={...}` (balanced braces). */
function hrefExpressions(src) {
  const out = [];
  const re = /\bhref=\{/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 1; let i = re.lastIndex;
    while (i < src.length && depth > 0) { const c = src[i]; if (c === '{') depth++; else if (c === '}') depth--; i++; }
    out.push(src.slice(re.lastIndex, i - 1).trim());
  }
  return out;
}

/** Reviewed `href={...}` expressions that are not data: fixed constants. Key: file, value: the exact expressions with the reason. */
const HREF_STATIC_ALLOWLIST = {
  'pages/LandingPage.tsx': { exprs: ['href'], reason: 'the marketing page menu: `href` comes from a constant list of in-page anchors in the same file' },
  'components/LegalLinks.tsx': { exprs: ['p.href'], reason: 'LEGAL_PAGES is a constant list of in-app routes (constants/legal)' },
  'components/TermsPrompt.tsx': { exprs: ['p.href'], reason: 'LEGAL_PAGES is a constant list of in-app routes (constants/legal)' },
};
const STATIC_HREF = /^(`(#|\/|mailto:\$\{SUPPORT_EMAIL\}|https:\/\/)[^`]*`|'(#|\/|https:\/\/)[^']*'|"(#|\/|https:\/\/)[^"]*")$/;

test('every href built from a variable goes through safeHref or safeSrc', () => {
  const offenders = [];
  for (const { rel, src } of SOURCES) {
    for (const expr of hrefExpressions(src)) {
      if (/\b(safeHref|safeSrc)\(/.test(expr)) continue;
      if (STATIC_HREF.test(expr)) continue;
      const ok = HREF_STATIC_ALLOWLIST[rel];
      if (ok && ok.exprs.includes(expr) && ok.reason) continue;
      offenders.push(`${rel}: href={${expr.slice(0, 80)}}`);
    }
  }
  assert.deepEqual(offenders, [], 'Wrap the value in safeHref(...) (utils/safeHref.ts), or add a reviewed fixed constant to HREF_STATIC_ALLOWLIST with a reason.');
});

test('safeHref/safeSrc are used where data links are made (guards against the scanner going blind)', () => {
  const uses = SOURCES.reduce((n, { rel, src }) => n + (rel === 'utils/safeHref.ts' ? 0 : (src.match(/\b(safeHref|safeSrc|openSafe)\(/g) || []).length), 0);
  assert.ok(uses >= 30, `only ${uses} uses found`);
});

test('window.open and location changes take a checked address', () => {
  const offenders = [];
  for (const { rel, src } of SOURCES) {
    if (rel === 'utils/safeHref.ts') continue;
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of code.matchAll(/window\.open\(\s*([^,)]*)/g)) {
      const arg = m[1].trim();
      if (arg === "''" || arg === '""' || /^safeHref\(/.test(arg)) continue;
      offenders.push(`${rel}: window.open(${arg})`);
    }
    for (const m of code.matchAll(/(?:window\.)?location(?:\.href\s*=(?!=)|\.assign\(|\.replace\()\s*([^;\n]*)/g)) {
      const rhs = m[1].trim();
      if (/^safeHref\(/.test(rhs) || /^['"`]\/?#?\/?[\w-]*['"`]\)?$/.test(rhs)) continue;
      // a local name is fine only when the same file sets it from safeHref
      const name = /^(\w+);?$/.exec(rhs);
      if (name && new RegExp(`const ${name[1]} = safeHref\\(`).test(code)) continue;
      offenders.push(`${rel}: location = ${rhs.slice(0, 60)}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('every link that opens a new tab says noopener noreferrer', () => {
  const offenders = [];
  for (const { rel, src } of SOURCES) {
    let i = -1;
    while ((i = src.indexOf('target="_blank"', i + 1)) !== -1) {
      const near = src.slice(Math.max(0, i - 400), i + 400);
      if (!/rel="noopener noreferrer"/.test(near)) offenders.push(`${rel}:${src.slice(0, i).split('\n').length}`);
    }
  }
  assert.deepEqual(offenders, []);
});
