'use strict';
/**
 * Live updates across server tasks (decision D35). With REDIS_URL set AND the optional packages
 * `@socket.io/redis-adapter` and `redis` installed, Socket.IO rooms and the Inbox live stream (SSE) reach a browser
 * whichever task it is connected to. Without them nothing breaks: live updates reach browsers connected to the task
 * that produced the event (single-process behaviour) and a line in the log says so. Required lazily: Redis is not a
 * dependency of the app.
 */
async function attachRedisAdapter(io, { env = process.env, load = require, log = console } = {}) {
  if (!io) return { mode: 'none', reason: 'no Socket.IO server' };
  if (!env.REDIS_URL) {
    log.log('[live] REDIS_URL not set: live updates are single-process (they reach browsers connected to this task only)');
    return { mode: 'single', reason: 'no REDIS_URL' };
  }
  let createAdapter; let createClient;
  try {
    ({ createAdapter } = load('@socket.io/redis-adapter'));
    ({ createClient } = load('redis'));
  } catch (e) {
    log.warn(`[live] REDIS_URL is set but @socket.io/redis-adapter or redis is not installed (${e && e.message}): live updates are single-process`);
    return { mode: 'single', reason: 'packages missing' };
  }
  try {
    const pub = createClient({ url: env.REDIS_URL });
    const sub = pub.duplicate();
    const onError = (e) => log.warn('[live] redis error:', e && e.message);
    pub.on('error', onError); sub.on('error', onError);
    await Promise.all([pub.connect(), sub.connect()]);
    io.adapter(createAdapter(pub, sub));
    log.log('[live] Socket.IO Redis adapter on: live updates reach every task');
    return { mode: 'redis', pub, sub };
  } catch (e) {
    log.warn(`[live] could not connect to Redis (${e && e.message}): live updates are single-process`);
    return { mode: 'single', reason: 'connect failed' };
  }
}

module.exports = { attachRedisAdapter };
