// Vite config for the visual / contrast audit ONLY. Never used by `npm run dev` or the build.
//
//   cd frontend
//   npx vite --config scripts/visual-audit/vite.audit.config.mjs
//
// It reuses vite.config.ts and changes three things:
//  - binds to 127.0.0.1:3100 (strict) so it can never collide with the owner's :3000 / :5000;
//  - removes the /api, /audio and /generated-media proxy to the backend and answers those
//    paths itself with 503 (a backstop: the in-page stub already answers them);
//  - inlines mock-session.js as the very first element of <head>, so the fake session and the
//    fetch/XHR/WebSocket stub are installed before Tailwind and before the app boots.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import baseConfig from '../../vite.config.ts';

const here = dirname(fileURLToPath(import.meta.url));
const frontendDir = resolve(here, '../..');
const PORT = Number(process.env.AUDIT_PORT || 3100);
if (PORT === 3000 || PORT === 5000) throw new Error('Audit server must not use port 3000 or 5000');
// Where POST /__audit/save and /__audit/shot write (results/*.json, shots/*.jpg).
const OUT = resolve(process.env.AUDIT_OUT || resolve(here, 'out'));

export default async (env) => {
  const base = typeof baseConfig === 'function' ? await baseConfig(env) : baseConfig;
  return {
    ...base,
    root: frontendDir,
    server: {
      host: '127.0.0.1',
      port: PORT,
      strictPort: true,
      proxy: {},
    },
    plugins: [
      ...(base.plugins || []),
      {
        name: 'nebulaa-audit-backstop',
        configureServer(server) {
          // Local-only helpers the in-page runner uses to write results and screenshots to disk.
          server.middlewares.use((req, res, next) => {
            const url = req.url || '';
            if (url === '/__audit/html2canvas.js') {
              res.setHeader('Content-Type', 'text/javascript');
              res.end(readFileSync(resolve(frontendDir, 'node_modules/html2canvas/dist/html2canvas.min.js')));
              return;
            }
            const m = url.match(/^\/__audit\/(save|shot)\?name=([A-Za-z0-9._-]{1,120})$/);
            if (!m || req.method !== 'POST') return next();
            const chunks = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', () => {
              const body = Buffer.concat(chunks).toString('utf8');
              const dir = resolve(OUT, m[1] === 'save' ? 'results' : 'shots');
              mkdirSync(dir, { recursive: true });
              if (m[1] === 'save') writeFileSync(resolve(dir, `${m[2]}.json`), body);
              else writeFileSync(resolve(dir, `${m[2]}.jpg`), Buffer.from(body.replace(/^data:image\/jpeg;base64,/, ''), 'base64'));
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true }));
            });
          });
          server.middlewares.use((req, res, next) => {
            if (/^\/(api|audio|generated-media)(\/|$|\?)/.test(req.url || '')) {
              console.warn('[audit backstop] refused', req.method, req.url);
              res.statusCode = 503;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, auditBackstop: true }));
              return;
            }
            next();
          });
        },
      },
      {
        name: 'nebulaa-audit-mock-session',
        transformIndexHtml: {
          order: 'pre',
          handler() {
            // Read on every request so edits to the mock apply on reload.
            const code = readFileSync(resolve(here, 'mock-session.js'), 'utf8');
            return [{ tag: 'script', children: code, injectTo: 'head-prepend' }];
          },
        },
      },
    ],
  };
};
