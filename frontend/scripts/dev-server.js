import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');

const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || '0.0.0.0';

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.mjs', 'application/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

function send(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, headers);
  res.end(body);
}

function isPathInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function tryResolveStaticFile(relativePath) {
  const fromRoot = path.join(rootDir, relativePath);
  const fromPublic = path.join(publicDir, relativePath);

  for (const candidate of [fromRoot, fromPublic]) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      // ignore
    }
  }
  return null;
}

function patchIndexHtmlForBundle(htmlBuffer) {
  const html = htmlBuffer.toString('utf8');
  // Use the bundled entry instead of the TSX entry (no Vite required).
  return html.replace(
    /<script\s+type="module"\s+src="\/index\.tsx"><\/script>/i,
    '<script src="/app.js"></script>'
  );
}

async function buildBundle() {
  const entryPoint = path.join(rootDir, 'index.tsx');
  const { rollup } = await import('rollup');
  const commonjs = (await import('@rollup/plugin-commonjs')).default;
  const replace = (await import('@rollup/plugin-replace')).default;
  const { nodeResolve } = await import('@rollup/plugin-node-resolve');

  const typescriptTranspile = () => ({
    name: 'typescript-transpile',
    transform(code, id) {
      if (id.includes('node_modules')) return null;
      if (!/\.tsx?$/.test(id) || id.endsWith('.d.ts')) return null;

      const result = ts.transpileModule(code, {
        fileName: id,
        compilerOptions: {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          jsx: ts.JsxEmit.ReactJSX,
          sourceMap: true,
          inlineSources: true,
        },
      });

      return {
        code: result.outputText,
        map: result.sourceMapText ? JSON.parse(result.sourceMapText) : null,
      };
    },
  });

  const bundle = await rollup({
    input: entryPoint,
    plugins: [
      replace({
        preventAssignment: true,
        'process.env.NODE_ENV': JSON.stringify('development'),
      }),
      nodeResolve({
        browser: true,
        extensions: ['.mjs', '.js', '.json', '.ts', '.tsx'],
      }),
      commonjs(),
      typescriptTranspile(),
    ],
  });

  const generated = await bundle.generate({
    format: 'iife',
    name: 'NebulaaApp',
    sourcemap: 'inline',
    intro: 'var process = { env: { NODE_ENV: "development" } };',
  });

  const jsChunk = generated.output.find((o) => o.type === 'chunk');
  if (!jsChunk) throw new Error('Bundle output missing JS chunk');

  return {
    code: jsChunk.code,
  };
}

let bundleCode = null;
let bundleError = null;

function startBundling() {
  const bundleStart = Date.now();
  console.log('Bundling frontend (this may take a bit on first run)...');
  buildBundle()
    .then((bundle) => {
      bundleCode = bundle.code;
      const ms = Date.now() - bundleStart;
      console.log(`Bundle ready in ${ms}ms`);
    })
    .catch((err) => {
      bundleError = err instanceof Error ? err : new Error(String(err));
      console.error('Bundle failed:', bundleError);
    });
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const requestPath = decodeURIComponent(url.pathname);

    if (requestPath === '/' || requestPath === '/index.html') {
      if (bundleError) {
        const message = bundleError.stack || bundleError.message;
        return send(res, 500, message, { 'Content-Type': 'text/plain; charset=utf-8' });
      }

      if (!bundleCode) {
        const waitingHtml = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Building...</title></head>
  <body style="font-family:system-ui; padding:24px;">
    <h1>Building the frontend bundle...</h1>
    <p>Refreshes automatically when ready.</p>
    <script>
      setInterval(async () => {
        try {
          const r = await fetch('/app.js', { cache: 'no-store' });
          if (r.ok) location.reload();
        } catch {}
      }, 2000);
    </script>
  </body>
</html>`;
        return send(res, 200, waitingHtml, { 'Content-Type': 'text/html; charset=utf-8' });
      }

      const indexPath = path.join(rootDir, 'index.html');
      const html = patchIndexHtmlForBundle(fs.readFileSync(indexPath));
      return send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    }

    if (requestPath === '/app.js') {
      if (bundleError) {
        const message = bundleError.stack || bundleError.message;
        return send(res, 500, message, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      if (!bundleCode) {
        return send(res, 503, '// bundling...', { 'Content-Type': 'application/javascript; charset=utf-8' });
      }
      return send(res, 200, bundleCode, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    }

    const relativePath = requestPath.replace(/^\/+/, '');
    const resolvedPath = tryResolveStaticFile(relativePath);
    if (!resolvedPath) {
      return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    if (!isPathInside(resolvedPath, rootDir) && !isPathInside(resolvedPath, publicDir)) {
      return send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const mime = mimeTypes.get(ext) || 'application/octet-stream';
    const content = fs.readFileSync(resolvedPath);
    return send(res, 200, content, { 'Content-Type': mime });
  } catch (err) {
    const message = err instanceof Error ? err.stack || err.message : String(err);
    return send(res, 500, message, { 'Content-Type': 'text/plain; charset=utf-8' });
  }
});

server.listen(port, host, () => {
  console.log(`Frontend running at http://localhost:${port}/`);
  startBundling();
});
