// materializeSourceToFile reads a local file only from the app's own storage (D108). Real temp files, no network.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { materializeSourceToFile } = require('../services/videoGenerationPipeline');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'zz-materialize-'));
const root = path.join(base, 'storage');
const job = path.join(root, 'job1', 'images');
const outside = path.join(base, 'outside');
fs.mkdirSync(job, { recursive: true });
fs.mkdirSync(outside, { recursive: true });
fs.writeFileSync(path.join(job, 'a.png'), 'PNGDATA');
fs.writeFileSync(path.join(outside, 'secret.txt'), 'SECRET');
fs.symlinkSync(outside, path.join(root, 'link-out'));
fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(job, 'file-link.png'));
const dest = (n) => path.join(base, `dest-${n}`);
const roots = [root];
test.after(() => fs.rmSync(base, { recursive: true, force: true }));

const refused = async (source, n) => {
  await assert.rejects(materializeSourceToFile({ source, destinationPath: dest(n), allowedRoots: roots }), /not available/);
  assert.ok(!fs.existsSync(dest(n)), 'nothing was copied');
};

test('a file inside a job directory is copied', async () => {
  const r = await materializeSourceToFile({ source: path.join(job, 'a.png'), destinationPath: dest(1), allowedRoots: roots });
  assert.deepStrictEqual(r, { mimeType: '' });
  assert.strictEqual(fs.readFileSync(dest(1), 'utf8'), 'PNGDATA');
});

test('traversal with .. is refused, even when it lands back inside', async () => {
  await refused(path.join(job, '..', '..', '..', 'outside', 'secret.txt'), 2);
  await refused(`${job}/../images/a.png`, 3);
});

test('absolute /etc/passwd is refused with the default roots', async () => {
  await assert.rejects(materializeSourceToFile({ source: '/etc/passwd', destinationPath: dest(4) }), /not available/);
  assert.ok(!fs.existsSync(dest(4)));
});

test('a symlink out of the storage directory is refused (directory link and file link)', async () => {
  await refused(path.join(root, 'link-out', 'secret.txt'), 5);
  await refused(path.join(job, 'file-link.png'), 6);
});

test('a directory, a missing file, a relative path and an odd scheme are refused', async () => {
  await refused(job, 7);
  await refused(path.join(job, 'nope.png'), 8);
  await refused('secret.txt', 9);
  await refused('file:///etc/passwd', 10);
  await refused(`${path.join(job, 'a.png')}\0.txt`, 11);
});

test('https goes through safeFetch (a fake here); a data URL still works', async () => {
  const safeFetch = require('../services/safeFetch');
  const real = safeFetch.safeFetchResponse;
  const seen = [];
  safeFetch.safeFetchResponse = async (url) => { seen.push(url); return new Response('REMOTE', { status: 200, headers: { 'content-type': 'image/png' } }); };
  try {
    const r = await materializeSourceToFile({ source: 'https://cdn.example.test/x.png', destinationPath: dest(12), allowedRoots: roots });
    assert.strictEqual(r.mimeType, 'image/png');
    assert.deepStrictEqual(seen, ['https://cdn.example.test/x.png']);
    assert.strictEqual(fs.readFileSync(dest(12), 'utf8'), 'REMOTE');
  } finally { safeFetch.safeFetchResponse = real; }
  await materializeSourceToFile({ source: 'data:text/plain;base64,SEk=', destinationPath: dest(13), allowedRoots: roots });
  assert.strictEqual(fs.readFileSync(dest(13), 'utf8'), 'HI');
});

test('plain http is refused by safeFetch, not fetched', async () => {
  await assert.rejects(materializeSourceToFile({ source: 'http://127.0.0.1/x.png', destinationPath: dest(14), allowedRoots: roots }));
  assert.ok(!fs.existsSync(dest(14)));
});

test('the same rule guards the other stored-path reads (scene imagePath): /etc/passwd and ../ are refused', async () => {
  const { resolveAllowedLocalFile } = require('../utils/safeLocalFile');
  await assert.rejects(resolveAllowedLocalFile('/etc/passwd'), /not available/);
  await assert.rejects(resolveAllowedLocalFile(path.join(__dirname, '..', 'storage', '..', '.env')), /not available/);
  assert.strictEqual(await resolveAllowedLocalFile(path.join(job, 'a.png'), roots), fs.realpathSync(path.join(job, 'a.png')));
});
