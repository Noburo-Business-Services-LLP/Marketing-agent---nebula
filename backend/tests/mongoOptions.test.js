'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { mongoConnectOptions } = require('../config/mongoOptions');

test('pool defaults: 20 at most, 2 kept open, timeouts as before', () => {
  assert.deepStrictEqual(mongoConnectOptions({}), { maxPoolSize: 20, minPoolSize: 2, serverSelectionTimeoutMS: 30000, socketTimeoutMS: 45000, connectTimeoutMS: 30000 });
});

test('pool settings from the environment, bounded', () => {
  assert.strictEqual(mongoConnectOptions({ MONGO_MAX_POOL_SIZE: '40' }).maxPoolSize, 40);
  assert.strictEqual(mongoConnectOptions({ MONGO_MAX_POOL_SIZE: '0' }).maxPoolSize, 1);
  assert.strictEqual(mongoConnectOptions({ MONGO_MAX_POOL_SIZE: '9999' }).maxPoolSize, 200);
  assert.strictEqual(mongoConnectOptions({ MONGO_MAX_POOL_SIZE: 'lots' }).maxPoolSize, 20);
  assert.strictEqual(mongoConnectOptions({ MONGO_MAX_POOL_SIZE: '5', MONGO_MIN_POOL_SIZE: '10' }).minPoolSize, 5, 'min never above max');
  assert.strictEqual(mongoConnectOptions({ MONGO_MIN_POOL_SIZE: '0' }).minPoolSize, 0);
  assert.strictEqual(mongoConnectOptions({ MONGO_SERVER_SELECTION_TIMEOUT_MS: '10000' }).serverSelectionTimeoutMS, 10000);
  assert.strictEqual(mongoConnectOptions({ MONGO_SERVER_SELECTION_TIMEOUT_MS: '5' }).serverSelectionTimeoutMS, 1000);
});

test('server-main connects with these options', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server-main.js'), 'utf8');
  assert.match(src, /mongoose\.connect\(process\.env\.MONGODB_URI, mongoConnectOptions\(\)\)/);
});
