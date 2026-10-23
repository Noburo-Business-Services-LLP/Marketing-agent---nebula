/**
 * A throwaway, brand-new, NOT-yet-onboarded account in the DEVELOPMENT database, so the onboarding questionnaire
 * can be recorded for the demo video (scripts/record-onboarding.py fills it in as Zaya Naturals).
 *
 *   node scripts/seed-onboarding-recording.js create [--agency] --password-file /absolute/path/outside/the/repo.txt
 *   node scripts/seed-onboarding-recording.js remove [--agency]
 *
 * Without --agency it makes demo-zaya-rec@example.test (the brand recording); with --agency, demo-agency-rec@example.test (the agency recording).
 *
 * SAFETY: refuses any database except `nebulaa_dev`; the address is the reserved example.test one; the password is written
 * only to the --password-file (outside the repository, mode 0600) and never printed; no payment, email, AI or social call is made.
 */
require('dotenv').config();
const fs = require('fs');
const safety = require('./demo-brand/safety');

const EMAILS = { brand: 'demo-zaya-rec@example.test', agency: 'demo-agency-rec@example.test' };
const WHO = { brand: { firstName: 'Aanya', lastName: 'Raghavan' }, agency: { firstName: 'Priya', lastName: 'Nair' } };

async function main(argv) {
  const mode = argv[0];
  const kind = argv.includes('--agency') ? 'agency' : 'brand';
  const EMAIL = EMAILS[kind];
  const i = argv.indexOf('--password-file');
  const passwordFile = i >= 0 ? argv[i + 1] : '';
  if (!['create', 'remove'].includes(mode)) throw new Error('Usage: create --password-file <abs path outside repo> | remove');
  safety.assertDevUri(process.env.MONGODB_URI);
  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    safety.assertDevTarget(mongoose.connection.name);
    const User = require('../models/User');
    const { consentRecord } = require('../services/consent');
    if (mode === 'remove') {
      const r = await User.deleteMany({ email: EMAIL });
      console.log(`Removed ${r.deletedCount} recording account(s). Left: ${await User.countDocuments({ email: EMAIL })}`);
      return;
    }
    if (!passwordFile || !safety.passwordFileOk(passwordFile)) throw new Error('Name an absolute --password-file outside this repository.');
    if (await User.findOne({ email: EMAIL })) { console.log('The recording account already exists; nothing added. Run remove first to start over.'); return; }
    const password = safety.makePassword();
    await User.create({
      email: EMAIL, password, firstName: WHO[kind].firstName, lastName: WHO[kind].lastName, isVerified: true, onboardingCompleted: false,
      consent: consentRecord(new Date(), 'demo'), plan: { tier: 'free', addons: [] },
    });
    fs.writeFileSync(passwordFile, `${EMAIL}\n${password}\n`, { mode: 0o600 });
    console.log(`Created ${EMAIL}. Password saved to ${passwordFile} (not printed).`);
  } finally { await mongoose.disconnect(); }
}

main(process.argv.slice(2)).then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
