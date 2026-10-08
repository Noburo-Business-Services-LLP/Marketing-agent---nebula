const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { fetchUrl } = require('../services/scraper');

async function refused(url) {
  await assert.rejects(() => fetchUrl(url, { timeout: 3000 }), /not allowed|Invalid/);
}

test('the website reader refuses internal and unusual addresses', async () => {
  await refused('http://127.0.0.1/');
  await refused('http://localhost/');
  await refused('http://169.254.169.254/latest/meta-data/');
  await refused('http://169.254.170.2/v2/credentials');
  await refused('http://10.0.0.5/');
  await refused('http://192.168.1.1/');
  await refused('http://[::1]/');
  await refused('http://0.0.0.0/');
  await refused('https://example.com:8443/');
  await refused('http://user:pass@example.com/');
  await refused('file:///etc/passwd');
  await refused('ftp://example.com/');
});

test('a local server is never reached, even when asked for by number', async () => {
  let hit = false;
  const srv = http.createServer((req, res) => { hit = true; res.end('secret'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();
  await assert.rejects(() => fetchUrl(`http://127.0.0.1:${port}/`, { timeout: 3000 }));
  await new Promise((r) => srv.close(r));
  assert.equal(hit, false);
});
