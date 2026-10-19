// A reviewed list of every file that reads or writes a Quark balance. A new file with a balance access fails this
// test until someone has decided how it behaves for an agency client (use walletBalance or resolvePayer).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const REVIEWED = new Set([
  'services/quarkBuckets.js', 'services/billingPlans.js', 'services/agency.js', 'middleware/trialGuard.js', 'middleware/creditGuard.js',
  'routes/credits.js', 'routes/dashboard.js', 'routes/content.js', 'routes/chat.js', 'routes/campaigns.js', 'routes/videoGeneration.js',
  'routes/studioVideos.js', 'routes/social.js', 'routes/payment.js', 'routes/csm.js', 'routes/staff.js', 'routes/auth.js',
  'services/staff/clientBulk.js', 'services/staff/clientList.js', 'services/staff/clientStatus.js',
  'services/homeSummary.js', // read only: a client workspace's balance comes from agency.walletBalance (the shared pool), never its own field
  'services/agencyUsage.js' // reads the pool balance of the signed-in agency account only (the route refuses clients and passes)
]);

function files(dir) { return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : [])); }

// Every way of reading the balance we know of: credits.balance, credits?.balance, 'credits.balance' in either quote
// style, credits['balance'], and destructuring `{ balance } = ...credits`.
const BALANCE_ACCESS = /credits\??\.balance|['"`]credits\.balance['"`]|credits\??\[\s*['"`]balance['"`]\s*\]|\{[^{}]*\bbalance\b[^{}]*\}\s*=\s*[\w.?$]*credits\b/;

test('the balance pattern catches the ways of reading a balance', () => {
  for (const code of ['u.credits.balance', 'u.credits?.balance', "'credits.balance'", '"credits.balance"', "u.credits['balance']", 'const { balance } = user.credits;', 'const { totalUsed, balance } = u?.credits']) assert.ok(BALANCE_ACCESS.test(code), code);
  for (const code of ['walletBalance(id)', 'const balance = 5', 'user.credits.history']) assert.ok(!BALANCE_ACCESS.test(code), code);
});

test('every file that touches credits.balance has been reviewed for agency clients', () => {
  const unreviewed = ['routes', 'services', 'middleware', 'controllers', 'utils'].filter((d) => fs.existsSync(path.join(ROOT, d))).flatMap(files).filter((f) => BALANCE_ACCESS.test(fs.readFileSync(path.join(ROOT, f), 'utf8')) && !REVIEWED.has(f.replace(/\\/g, '/')));
  assert.deepStrictEqual(unreviewed, [], `New Quark balance access in: ${unreviewed.join(', ')}. Decide how it works for an agency client, then add it to REVIEWED.`);
});

test('the files that spend for a signed-in person go through the payer, not their own balance', () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  // The read sites must use the wallet (the agency pool for a client) and no longer read the person's own balance.
  for (const f of ['routes/dashboard.js', 'routes/content.js', 'routes/chat.js', 'routes/campaigns.js', 'routes/videoGeneration.js']) {
    const src = read(f);
    assert.ok(/walletBalance/.test(src), `${f} must read the balance through walletBalance`);
    assert.ok(!/credits\??\.balance/.test(src), `${f} must not read credits.balance directly`);
  }
  // Refunds in the Videos flow go through the payer, never a raw update of the person's own record.
  const sv = read('routes/studioVideos.js');
  assert.ok(!/credits\.balance/.test(sv), 'studioVideos must refund through quarkBuckets.refundTo');
  // The social connect reward is skipped for a client workspace.
  assert.match(read('routes/social.js'), /user\.agency && user\.agency\.ownerId\) return false/);
});
