/**
 * Creates the extra database indexes the staff Usage page needs (list: config/staffIndexes.js).
 *
 * The app never builds these by itself at start-up (they are marked as script-only in the models), because an index
 * build on a nearly full database must be a deliberate step. This script is that step.
 *
 *   DRY RUN (the default): connects, prints which database and what kind of host (never the address), the size of each
 *   collection and its indexes, and which indexes it WOULD create. Changes nothing.
 *       MONGODB_URI=<address> node scripts/create-staff-indexes.js
 *
 *   REAL RUN: only with CONFIRM_CREATE_INDEXES=yes. Creates the missing indexes one at a time, prints progress, exits.
 *   Safe to run again: an index that already exists is skipped, so the second run creates nothing.
 *       CONFIRM_CREATE_INDEXES=yes MONGODB_URI=<address> node scripts/create-staff-indexes.js
 *
 * `--create` is accepted too, but still needs the confirm variable. `--dry-run` forces a dry run even when the confirm variable is set. Needs MONGODB_URI in the environment (it does not
 * read any file). The address is never printed.
 */
const { STAFF_INDEXES } = require('../config/staffIndexes');

const MB = 1024 * 1024;
const mb = (bytes) => `${(bytes / MB).toFixed(1)} MB`;
// A date index entry is about 25 bytes per document (key, pointer, overhead). Used only to warn about disk, never to decide what to build.
const BYTES_PER_ENTRY = 25;

/** 'this computer', 'Atlas' or 'another server'. Says what kind of place the address points at, nothing else. */
function hostClass(uri) {
  const m = /^mongodb(\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/.exec(String(uri || '').trim());
  if (!m) return 'unknown';
  const hosts = m[2].split(',').map((h) => h.replace(/:\d+$/, '').replace(/^\[|\]$/g, ''));
  if (hosts.every((h) => ['localhost', '127.0.0.1', '::1'].includes(h))) return 'this computer (local)';
  if (hosts.some((h) => /mongodb\.net$/i.test(h))) return 'MongoDB Atlas (cloud)';
  return 'another server';
}

function databaseName(uri) {
  const m = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?[^/?]+\/([^?]*)/.exec(String(uri || '').trim());
  return m && m[1] ? decodeURIComponent(m[1]) : '';
}

/** What to do from the environment and arguments. Pure. */
function decideMode({ argv = [], env = {} }) {
  if (!env.MONGODB_URI) return { ok: false, message: 'MONGODB_URI is not set. Set it in the environment (the address is never printed) and run again.' };
  if (!databaseName(env.MONGODB_URI)) return { ok: false, message: 'MONGODB_URI has no database name in it. Add it after the host, for example .../mydatabase?...' };
  const confirmed = env.CONFIRM_CREATE_INDEXES === 'yes';
  if (argv.includes('--create') && !confirmed && !argv.includes('--dry-run')) return { ok: false, message: 'Refusing: --create needs CONFIRM_CREATE_INDEXES=yes in the environment.' };
  const dry = argv.includes('--dry-run') || !confirmed;
  return { ok: true, mode: dry ? 'dry-run' : 'create' };
}

const sameKeys = (a, b) => JSON.stringify(Object.entries(a)) === JSON.stringify(Object.entries(b));

/** For each wanted index: 'exists' (same name, or same keys and same filter) or 'missing'. existing: { collection: [indexInfo] }. */
function planIndexes(defs, existing) {
  return defs.map((def) => {
    const list = existing[def.collection] || [];
    const wantedFilter = JSON.stringify((def.options && def.options.partialFilterExpression) || null);
    const hit = list.find((i) => i.name === def.name || (sameKeys(i.key, def.keys) && JSON.stringify(i.partialFilterExpression || null) === wantedFilter));
    return { def, status: hit ? 'exists' : 'missing', existingName: hit ? hit.name : null };
  });
}

/** Warns when the new indexes would use more than half of the free disk (when the server reports it). */
function diskVerdict({ estimateBytes, freeBytes }) {
  if (!Number.isFinite(freeBytes)) return { known: false, ok: true };
  return { known: true, ok: estimateBytes <= freeBytes * 0.5, estimateBytes, freeBytes };
}

/** Does the work. Returns the exit code. `say`, `fail` and `mongoose` are injected so the tests can run it against a fake database. `indexes` is the list to build (the staff list by default; scripts/create-home-indexes.js passes the Home list). */
async function run({ argv, env, say = (m = '') => console.log(m), fail = (m) => console.error(m), mongoose = require('mongoose'), indexes: INDEXES = STAFF_INDEXES }) {
  const decision = decideMode({ argv, env });
  if (!decision.ok) { fail(decision.message); return 2; }
  const uri = env.MONGODB_URI;
  let code = 0;
  say(`Database: ${databaseName(uri)}`);
  say(`Host: ${hostClass(uri)}`);
  say(`Mode: ${decision.mode === 'dry-run' ? 'DRY RUN (nothing will be changed)' : 'CREATE (confirmed)'}`);
  say();

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000, socketTimeoutMS: 3600000, connectTimeoutMS: 30000 });
  const db = mongoose.connection.db;
  try {
    const existing = {}; const counts = {};
    let estimate = 0;
    for (const collection of [...new Set(INDEXES.map((d) => d.collection))]) {
      let indexes = [];
      try { indexes = await db.collection(collection).indexes(); } catch (error) { if (error.codeName !== 'NamespaceNotFound' && error.code !== 26) throw error; }
      existing[collection] = indexes;
      counts[collection] = await db.collection(collection).estimatedDocumentCount();
      let sizes = {};
      try { sizes = (await db.command({ collStats: collection })).indexSizes || {}; } catch (_) { /* not reported here */ }
      const total = Object.values(sizes).reduce((n, v) => n + Number(v || 0), 0);
      say(`${collection}: ${counts[collection].toLocaleString('en-IN')} documents, ${indexes.length} indexes${total ? `, ${mb(total)} of indexes today` : ''}`);
    }
    say();

    const plan = planIndexes(INDEXES, existing);
    for (const step of plan) {
      const n = counts[step.def.collection] || 0;
      step.estimateBytes = n * BYTES_PER_ENTRY;
      if (step.status === 'missing') estimate += step.estimateBytes;
      say(`${step.status === 'exists' ? 'already there' : (decision.mode === 'dry-run' ? 'would create ' : 'to create    ')}  ${step.def.collection}.${step.def.name}  ${JSON.stringify(step.def.keys)}${step.def.options ? ' (partial)' : ''}${step.status === 'missing' ? `  about ${mb(step.estimateBytes)}` : ''}  - ${step.def.why}`);
    }
    const missing = plan.filter((s) => s.status === 'missing');
    say();
    say(missing.length ? `${missing.length} index(es) missing, about ${mb(estimate)} of extra disk in total (a rough estimate).` : 'Nothing to create: every index is already there.');

    let free = NaN;
    try { const s = await db.command({ dbStats: 1 }); if (s.fsTotalSize && s.fsUsedSize) free = s.fsTotalSize - s.fsUsedSize; } catch (_) { /* not reported here */ }
    const disk = diskVerdict({ estimateBytes: estimate, freeBytes: free });
    if (disk.known) say(`Free disk reported by the server: ${mb(free)} (${disk.ok ? 'enough' : 'NOT ENOUGH: the new indexes would use more than half of it'}).`);
    else say('The server did not report free disk. Check the Atlas disk chart yourself before a real run.');

    if (decision.mode === 'dry-run') {
      say();
      say(missing.length ? 'Dry run only. To create them: CONFIRM_CREATE_INDEXES=yes node scripts/create-staff-indexes.js' : 'Dry run only.');
      return 0;
    }
    if (!disk.ok) { fail('Refusing to build: not enough free disk. Free some space or raise the disk size first.'); code = 3; return code; }

    let done = 0;
    for (const step of missing) {
      const started = Date.now();
      say(`[${done + 1}/${missing.length}] building ${step.def.collection}.${step.def.name} ...`);
      await db.collection(step.def.collection).createIndex(step.def.keys, { ...(step.def.options || {}), name: step.def.name });
      done += 1;
      say(`[${done}/${missing.length}] done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    }
    say(`Finished. Created ${done} index(es). Run again with no confirm flag to check: it should say nothing to create.`);
  } finally {
    await mongoose.disconnect();
  }
  return code;
}

if (require.main === module) {
  run({ argv: process.argv.slice(2), env: process.env }).then((code) => process.exit(code), (error) => { console.error('Failed:', String(error.message).split(process.env.MONGODB_URI || '\u0000').join('[address hidden]')); process.exit(1); });
}

module.exports = { run, hostClass, databaseName, decideMode, planIndexes, diskVerdict, BYTES_PER_ENTRY };
