/**
 * Creates the extra database indexes the Home summary can use (list: config/homeIndexes.js). Same safety rules as
 * scripts/create-staff-indexes.js, which does the work: DRY RUN by default, and a real run only with
 * CONFIRM_CREATE_INDEXES=yes. Needs MONGODB_URI in the environment; the address is never printed.
 *
 *   MONGODB_URI=<address> node scripts/create-home-indexes.js                                    dry run
 *   CONFIRM_CREATE_INDEXES=yes MONGODB_URI=<address> node scripts/create-home-indexes.js         build the missing ones
 */
const { run } = require('./create-staff-indexes');
const { HOME_INDEXES } = require('../config/homeIndexes');

if (require.main === module) {
  run({ argv: process.argv.slice(2), env: process.env, indexes: HOME_INDEXES }).then((code) => process.exit(code), (error) => { console.error('Failed:', String(error.message).split(process.env.MONGODB_URI || '\u0000').join('[address hidden]')); process.exit(1); });
}

module.exports = { run: (opts) => run({ ...opts, indexes: HOME_INDEXES }) };
