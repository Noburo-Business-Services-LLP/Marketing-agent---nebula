/**
 * Extra database indexes for the background jobs that look across ALL accounts (load-test weeks 2 to 3). Like
 * config/homeIndexes.js: one list, declared on the models with `_autoIndex: false` (the app never builds them by
 * itself, mind the Atlas disk ceiling) and built on purpose by scripts/create-perf-indexes.js (dry run by default,
 * CONFIRM_CREATE_INDEXES=yes to build).
 *
 * Both are PARTIAL (only rows with status 'scheduled'), so they stay small. Without them the campaign status sync (every
 * 5 minutes) and the campaign scheduler (every minute) read the whole campaigns collection to find the few scheduled
 * rows; on the dev database one such scan took over two minutes (campaign documents average 1.7 MB there).
 */
const SCHEDULED_ONLY = { partialFilterExpression: { status: 'scheduled' } };
const PERF_INDEXES = Object.freeze([
  { model: 'Campaign', collection: 'campaigns', name: 'perf_scheduled_scheduledFor', keys: { scheduledFor: 1 }, options: SCHEDULED_ONLY, why: 'Campaign status sync: scheduled posts whose time has passed' },
  { model: 'Campaign', collection: 'campaigns', name: 'perf_scheduled_startDate', keys: { 'scheduling.startDate': 1 }, options: SCHEDULED_ONLY, why: 'Campaign scheduler: scheduled posts that are due' }
]);

function declarePerfIndexes(schema, modelName) {
  for (const def of PERF_INDEXES.filter((d) => d.model === modelName)) {
    schema.index(def.keys, { ...(def.options || {}), name: def.name, _autoIndex: false });
  }
}

module.exports = { PERF_INDEXES, declarePerfIndexes };
