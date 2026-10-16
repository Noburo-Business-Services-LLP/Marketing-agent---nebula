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
  'services/staff/clientBulk.js', 'services/staff/clientList.js', 'services/staff/clientStatus.js'
]);

function files(dir) { return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : [])); }

test('every file that touches credits.balance has been reviewed for agency clients', () => {
  const unreviewed = ['routes', 'services', 'middleware'].flatMap(files).filter((f) => /credits\??\.balance|'credits\.balance'/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')) && !REVIEWED.has(f.replace(/\\/g, '/')));
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
