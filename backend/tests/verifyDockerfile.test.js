'use strict';
// Hardening E6: the static Dockerfile checker passes on the repo and catches each broken rule.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const V = require('../../scripts/verify-dockerfile');

const ROOT = path.join(__dirname, '..', '..');
const good = fs.readFileSync(path.join(ROOT, 'Dockerfile.backend'), 'utf8');

test('the repo Dockerfiles and .dockerignore pass', () => {
  assert.deepStrictEqual(V.verifyDockerfile(good), []);
  assert.deepStrictEqual(V.verifyDockerfile(fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8')), []);
  assert.deepStrictEqual(V.verifyDockerignore(fs.readFileSync(path.join(ROOT, '.dockerignore'), 'utf8')), []);
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'verify-dockerfile.js')], { encoding: 'utf8' });
  assert.match(out, /verify-dockerfile: ok/);
});

test('each rule is caught', () => {
  const has = (text, re) => assert.ok(V.verifyDockerfile(text).some((p) => re.test(p)), `${re}: ${V.verifyDockerfile(text).join(' | ')}`);
  has(good.replace(/^USER node$/m, ''), /no USER/);
  has(good.replace(/^USER node$/m, 'USER root'), /final USER is root/);
  has(good.replace('NODE_ENV=production', 'NODE_ENV=development'), /NODE_ENV/);
  has(good.replace(/UV_THREADPOOL_SIZE=6/, ''), /UV_THREADPOOL_SIZE/);
  has(good.replace(/HEALTHCHECK[\s\S]*?\n(?=\n)/, ''), /no HEALTHCHECK/);
  has(good.replace("CMD [\"node\", \"-e\"", 'CMD ["sh", "-c", "curl -f http://127.0.0.1:5000/api/ready"] #'), /curl|node/);
  has(good.replace('ENTRYPOINT ["/app/backend/docker-entrypoint.sh"]', 'ENTRYPOINT ["node"]'), /ENTRYPOINT/);
  has(good.replace(/node:20\.20\.2-bookworm-slim/g, 'node:20-bookworm-slim'), /pin an exact Node version/);
  has(good.replace(/chown -R node:node storage temp downloads/, 'true'), /chowned/);
  const noScript = V.verifyDockerfile(good, { readFile: () => { throw new Error('missing'); } });
  assert.ok(noScript.some((p) => /missing/.test(p)));
  const badScript = V.verifyDockerfile(good, { readFile: () => '#!/bin/sh\nnode server.js\n', statFile: () => ({ mode: 0o644 }) });
  assert.ok(badScript.some((p) => /NODE_HEAP_MB/.test(p)) && badScript.some((p) => /exec node/.test(p)) && badScript.some((p) => /not executable/.test(p)));
  assert.ok(V.verifyDockerignore('node_modules\n').length >= 5);
});

test('the entrypoint sets the heap, execs node and passes other commands through', { skip: process.platform === 'win32' }, () => {
  const ep = path.join(ROOT, 'backend', 'docker-entrypoint.sh');
  const env = { ...process.env, NODE_HEAP_MB: '777', NODE_OPTIONS: '' };
  const out = execFileSync(ep, [process.execPath, '-e', 'console.log(process.env.NODE_OPTIONS, require("v8").getHeapStatistics().heap_size_limit > 700*1024*1024)'], { env, encoding: 'utf8' });
  assert.match(out, /--max-old-space-size=777 true/);
  assert.throws(() => execFileSync(ep, ['true'], { env: { ...env, NODE_HEAP_MB: '12x' }, stdio: 'pipe' }), (e) => e.status === 64);
});
