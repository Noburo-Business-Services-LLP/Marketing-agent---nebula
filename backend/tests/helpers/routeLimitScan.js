'use strict';
/**
 * Static scan used by tests/paidRouteLimits.test.js: every write handler (POST, PUT, PATCH, DELETE) in routes/*.js
 * whose body calls a paid service, and whether a limiter covers it (route-local, router-level or at the mount in
 * server-main.js). Text only: nothing is required or run.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const ROUTES = path.join(ROOT, 'routes');

// Calls that cost money or provider quota: credits, models, generation, scrapers, social publishing, ad spend, storage.
const PAID = /\b(deductCredits|callTextLLM|callOpenAI\w*|generateOpenAIImage|omni\.\w+\s*\(|requireCredits|chargeQuarks|callGemini\w*|generateContent\w*|generate[A-Z]\w*\s*\(|\w*[sS]crape\w*\s*\(|lookupInstagramHandle|serper\w*\s*\(|ayrshare\w*\.\w*(post|publish)\w*\s*\(|publishTo\w*\s*\(|postTo\w*\s*\(|createMetaAd\w*|boostPost\w*|uploadBase64Image|uploadToCloudinary|uploadBuffer\w*|cloudinary\.uploader|transcribe\w*\s*\(|\.single\(|\.array\(|\.fields\()/;
// A limiter in a route's middleware list, in a router.use(...) or in a mount's middleware list.
const LIMITER = /\b(L\.\w+|limits\.\w+|\w*[lL]imiter\w*|\w*Limit(er)?s?\.\w+)\b/;

const DEF = /router\.(post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2/g;

/** Handlers in one file: { method, path, args, body } (args = the text before the handler's first arrow). */
function handlersOf(src) {
  const defs = [];
  let m;
  const anyDef = /router\.(get|post|put|patch|delete|all|use)\(/g;
  const starts = [];
  while ((m = anyDef.exec(src))) starts.push(m.index);
  DEF.lastIndex = 0;
  while ((m = DEF.exec(src))) {
    const start = m.index;
    const next = starts.find((s) => s > start) || src.length;
    const text = src.slice(start, next);
    const arrow = text.indexOf('=>');
    const args = arrow === -1 ? text : text.slice(0, arrow);
    defs.push({ method: m[1].toUpperCase(), path: m[3], args, body: text, start });
  }
  return defs;
}

/** A router-level limiter: router.use(<limiter>) placed before the route. */
function routerLevelLimiterBefore(src, index) {
  const re = /router\.use\(([^;]*?)\);/g;
  let m;
  while ((m = re.exec(src))) {
    if (m.index > index) break;
    if (LIMITER.test(m[1])) return true;
  }
  return false;
}

/** Mounts from server-main.js: { file -> [{ mount, limited }] } plus the array-path limiters ({ prefix -> true }). */
function mounts() {
  const src = fs.readFileSync(path.join(ROOT, 'server-main.js'), 'utf8');
  const vars = {};
  let m;
  const req = /const (\w+) = require\('\.\/routes\/([\w-]+)'\)/g;
  while ((m = req.exec(src))) vars[m[1]] = m[2];
  const out = {};
  const prefixLimited = [];
  const use = /app\.use\(([^\n]*)\);/g;
  while ((m = use.exec(src))) {
    const line = m[1];
    const inline = line.match(/require\('\.\/routes\/([\w-]+)'\)/);
    const lastArg = line.split(',').pop().trim().replace(/\)+$/, '');
    const file = inline ? inline[1] : vars[lastArg] || vars[lastArg.split('.')[0]];
    const paths = (line.match(/'(\/[^']*)'/g) || []).map((p) => p.slice(1, -1));
    // A route file mount counts only the middleware before the router; a mount without a router file is all middleware.
    const middle = inline ? line.slice(0, line.indexOf('require(')) : (file ? line.slice(0, line.lastIndexOf(lastArg)) : line);
    // The general per-address flood guard on all of /api is not a specific limit.
    const limited = LIMITER.test(middle.replace(/'[^']*'/g, '').replace(/limits\.general/g, ''));
    if (file) {
      (out[file] = out[file] || []).push({ mount: paths[0] || '', limited });
    } else if (limited) {
      for (const p of paths) prefixLimited.push(p);
    }
  }
  return { byFile: out, prefixLimited };
}

function scan() {
  const { byFile, prefixLimited } = mounts();
  const rows = [];
  for (const f of fs.readdirSync(ROUTES).filter((x) => x.endsWith('.js'))) {
    const name = f.replace(/\.js$/, '');
    const src = fs.readFileSync(path.join(ROUTES, f), 'utf8');
    const ms = byFile[name] || [];
    for (const h of handlersOf(src)) {
      if (!PAID.test(h.body)) continue;
      const full = (ms[0] && ms[0].mount ? ms[0].mount : `?/${name}`) + (h.path === '/' ? '' : h.path);
      const covered = LIMITER.test(h.args.replace(/'[^']*'/g, ''))
        || routerLevelLimiterBefore(src, h.start)
        || ms.some((x) => x.limited)
        || prefixLimited.some((p) => full === p || full.startsWith(`${p}/`));
      rows.push({ file: name, method: h.method, path: h.path, full, covered });
    }
  }
  return rows;
}

module.exports = { scan, handlersOf, mounts, PAID, LIMITER };

if (require.main === module) {
  const rows = scan();
  for (const r of rows.filter((x) => !x.covered)) console.log(`${r.file}\t${r.method} ${r.full}`);
  console.log(`paid write handlers: ${rows.length}, covered: ${rows.filter((x) => x.covered).length}`);
}
