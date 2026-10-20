const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { cspHeaderValue, helmetCsp, DIRECTIVES } = require('../config/csp');
const { createCspReporter, readReports, blockedOrigin } = require('../services/cspReport');
const { userFileHeaders } = require('../middleware/userFileHeaders');

const ROOT = path.join(__dirname, '..', '..');
const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server-main.js'), 'utf8');

async function withServer(app, fn) {
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}

test('the policy covers what the app loads and keeps the dangerous defaults shut', () => {
  const v = cspHeaderValue();
  for (const host of ['https://checkout.razorpay.com', 'https://api.razorpay.com', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://res.cloudinary.com', 'https://challenges.cloudflare.com']) {
    assert.ok(v.includes(host), host);
  }
  // Tailwind is built at build time and the esm.sh import map is gone (D67): neither host may come back.
  for (const host of ['cdn.tailwindcss.com', 'esm.sh']) assert.ok(!v.includes(host), host);
  assert.deepStrictEqual(DIRECTIVES['object-src'], ["'none'"]);
  assert.ok(DIRECTIVES['style-src'].includes("'unsafe-inline'"));
  assert.match(v, /report-uri \/api\/csp-report/);
  assert.strictEqual(helmetCsp().reportOnly, true);
});

test('helmet sends it as Content-Security-Policy-Report-Only (nothing enforced)', async () => {
  const app = express();
  app.use(helmet({ contentSecurityPolicy: helmetCsp() }));
  app.get('/x', (req, res) => res.json({ ok: true }));
  await withServer(app, async (base) => {
    const r = await fetch(`${base}/x`);
    assert.strictEqual(r.headers.get('content-security-policy'), null);
    const ro = r.headers.get('content-security-policy-report-only');
    assert.ok(ro && ro.includes("default-src 'self'") && ro.includes('report-uri /api/csp-report'));
  });
});

test('server-main uses the report-only policy, the report endpoint with its limiter, and the file headers', () => {
  assert.match(serverSrc, /contentSecurityPolicy: require\('\.\/config\/csp'\)\.helmetCsp\(\)/);
  assert.match(serverSrc, /app\.post\('\/api\/csp-report', L\.cspReport,/);
  assert.match(serverSrc, /app\.use\('\/generated-media', express\.static\([^\n]*setHeaders: userFileHeaders/);
});

test('nginx sends the very same policy, report-only, on the app page', () => {
  const nginx = fs.readFileSync(path.join(ROOT, 'nginx.conf'), 'utf8');
  const lines = nginx.split('\n').filter((l) => l.includes('Content-Security-Policy-Report-Only'));
  assert.strictEqual(lines.length, 2, 'index.html and the SPA fallback');
  for (const l of lines) assert.ok(l.includes(`"${cspHeaderValue()}"`), 'equal to config/csp.js');
  assert.ok(!/add_header Content-Security-Policy "/.test(nginx), 'not enforced yet');
});

test('reports: counts only (directive and blocked origin), never the page address or a sample', async () => {
  const logged = [];
  const rep = createCspReporter({ log: { log: (m) => logged.push(m) }, now: () => 0 });
  const app = express();
  app.post('/api/csp-report', express.json({ type: ['application/csp-report', 'application/reports+json', 'application/json'], limit: '16kb' }), rep.handler);
  await withServer(app, async (base) => {
    const body = { 'csp-report': { 'document-uri': 'https://gravity.nebulaa.ai/drafts/secret-id?token=abc', 'violated-directive': 'script-src-elem', 'blocked-uri': 'https://evil.example/x.js?u=me@x.test', 'script-sample': 'alert(document.cookie)' } };
    for (let i = 0; i < 3; i += 1) {
      const r = await fetch(`${base}/api/csp-report`, { method: 'POST', headers: { 'Content-Type': 'application/csp-report' }, body: JSON.stringify(body) });
      assert.strictEqual(r.status, 204);
    }
    const list = [{ type: 'csp-violation', body: { effectiveDirective: 'style-src', blockedURL: 'inline', documentURL: 'https://gravity.nebulaa.ai/x' } }];
    assert.strictEqual((await fetch(`${base}/api/csp-report`, { method: 'POST', headers: { 'Content-Type': 'application/reports+json' }, body: JSON.stringify(list) })).status, 204);
    assert.strictEqual((await fetch(`${base}/api/csp-report`, { method: 'POST', headers: { 'Content-Type': 'application/csp-report' }, body: 'not json' })).status >= 400, true);
  });
  assert.deepStrictEqual(rep.counts(), { 'script-src-elem https://evil.example': 3, 'style-src inline': 1 });
  const all = logged.join('\n');
  assert.ok(!/secret-id|token=abc|me@x\.test|document\.cookie|\/x\.js/.test(all), all);
});

test('blocked origins are reduced to scheme and host', () => {
  assert.strictEqual(blockedOrigin('https://a.example/path?q=1'), 'https://a.example');
  assert.strictEqual(blockedOrigin('inline'), 'inline');
  assert.strictEqual(blockedOrigin('data:image/png;base64,AAA'), 'data');
  assert.deepStrictEqual(readReports(null), []);
});

test('generated media: sandbox, nosniff and a Content-Disposition on every file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zz-media-'));
  fs.writeFileSync(path.join(dir, 'clip.mp4'), Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]));
  fs.writeFileSync(path.join(dir, 'page.html'), '<script>alert(1)</script>');
  const app = express();
  app.use('/generated-media', express.static(dir, { setHeaders: userFileHeaders }));
  try {
    await withServer(app, async (base) => {
      const v = await fetch(`${base}/generated-media/clip.mp4`);
      assert.strictEqual(v.headers.get('content-security-policy'), 'sandbox');
      assert.strictEqual(v.headers.get('x-content-type-options'), 'nosniff');
      assert.strictEqual(v.headers.get('content-disposition'), 'inline; filename="clip.mp4"');
      const h = await fetch(`${base}/generated-media/page.html`);
      assert.strictEqual(h.headers.get('content-security-policy'), 'sandbox');
      assert.match(h.headers.get('content-disposition'), /^attachment;/);
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('every upload route refuses SVG and HTML', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert.match(read('routes/brandAssets.js'), /router\.post\('\/upload', protect, L\.upload, rejectUnsafeImage\('imageData'\)/);
  assert.match(read('routes/brandAssets.js'), /router\.post\('\/intelligence-profile\/past-posts', [^\n]*rejectUnsafeImage/);
  assert.match(read('routes/brandAssets.js'), /router\.post\('\/frames', [^\n]*rejectUnsafeImage/);
  assert.match(read('routes/products.js'), /router\.post\('\/upload-image', [^\n]*rejectUnsafeImage/);
  assert.match(read('routes/ideas.js'), /router\.post\('\/', [^\n]*rejectUnsafeImage/);
  assert.match(read('routes/drafts.js'), /checkUpload\(\{ mime: req\.file\.mimetype, name: req\.file\.originalname/);
  assert.match(read('routes/createAssist.js'), /uploadSafety'\)\.checkUpload/);
  assert.match(read('services/imageUploader.js'), /if \(unsafeImageData\(base64Data\)\)/);
});

test('the shared picture uploader refuses SVG before anything is sent to storage', async () => {
  const up = require('../services/imageUploader');
  const svg = `data:image/png;base64,${Buffer.from('<svg onload="alert(1)"></svg>').toString('base64')}`;
  const r = await up.uploadBase64Image(svg, 'zz-test');
  assert.strictEqual(r.success, false);
  assert.match(r.error, /Unsupported file type/);
});
