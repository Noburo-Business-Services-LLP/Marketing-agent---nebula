/**
 * The extra database indexes the Home summary can use. Like config/staffIndexes.js: ONE list, declared on the models
 * with `_autoIndex: false` (the app never builds them by itself) and built on purpose by scripts/create-home-indexes.js
 * (dry run by default, the word "yes" in CONFIRM_CREATE_INDEXES to build).
 *
 * Home works without them: it then reads through the existing { userId } indexes, which is fine for a small account but
 * looks at every campaign an account has ever made. These two make "posts published this week" and "posts for today" a
 * direct range read for each account.
 */
const HOME_INDEXES = Object.freeze([
  { model: 'Campaign', collection: 'campaigns', name: 'home_userId_publishedAt', keys: { userId: 1, publishedAt: -1 }, why: 'Home: posts published this week and today' },
  { model: 'Campaign', collection: 'campaigns', name: 'home_userId_scheduledFor', keys: { userId: 1, scheduledFor: 1 }, why: 'Home: posts going out today and this week' }
]);

/** Adds this model's Home indexes to its schema, marked so Mongoose skips them when it builds indexes by itself. */
function declareHomeIndexes(schema, modelName) {
  for (const def of HOME_INDEXES.filter((d) => d.model === modelName)) {
    schema.index(def.keys, { ...(def.options || {}), name: def.name, _autoIndex: false });
  }
}

module.exports = { HOME_INDEXES, declareHomeIndexes };
