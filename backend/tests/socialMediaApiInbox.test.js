const test = require('node:test');
const assert = require('node:assert');
const https = require('https');
const { EventEmitter } = require('events');

// The real HTTP layer is replaced by a recorder. Nothing leaves the machine.
process.env.AYRSHARE_API_KEY = 'test-key';
process.env.AYRSHARE_KILL_SWITCH = 'false';
const sent = [];
let reply = { status: 200, body: {} };
https.request = (options, cb) => {
  const req = new EventEmitter();
  let body = '';
  req.write = (chunk) => { body += chunk; };
  req.destroy = () => {};
  req.end = () => {
    sent.push({ method: options.method, host: options.hostname, path: options.path, headers: options.headers, body: body ? JSON.parse(body) : null });
    const res = new EventEmitter();
    res.statusCode = reply.status;
    res.headers = {};
    cb(res);
    res.emit('data', JSON.stringify(reply.body));
    res.emit('end');
  };
  return req;
};
const api = require('../services/socialMediaAPI');

const quiet = { log: console.log, warn: console.warn, error: console.error };
test.before(() => { console.log = () => {}; console.warn = () => {}; console.error = () => {}; });
test.after(() => { Object.assign(console, quiet); });
test.beforeEach(() => { sent.length = 0; });

test('comment reply: posts to the comments/reply endpoint with the comment id, platform and profile key', async () => {
  reply = { status: 200, body: { status: 'success', commentId: 'ay1', instagram: { status: 'success', commentId: 'ig-reply-1' } } };
  const out = await api.replyToAyrshareComment({ profileKey: 'PK1', platform: 'instagram', commentId: 'c/9', text: 'Thanks' });
  assert.strictEqual(out.success, true);
  assert.strictEqual(out.replyId, 'ig-reply-1');
  assert.strictEqual(sent[0].method, 'POST');
  assert.strictEqual(sent[0].host, 'api.ayrshare.com');
  assert.strictEqual(sent[0].path, '/api/comments/reply/c%2F9');
  assert.strictEqual(sent[0].headers['Profile-Key'], 'PK1');
  assert.match(sent[0].headers.Authorization, /^Bearer /);
  assert.deepStrictEqual(sent[0].body, { comment: 'Thanks', platforms: ['instagram'], searchPlatformId: true });
});

test('comment reply: an error from the platform is a failure with its code', async () => {
  reply = { status: 400, body: { status: 'error', code: 215, message: 'not found' } };
  const out = await api.replyToAyrshareComment({ profileKey: 'PK1', platform: 'facebook', commentId: 'c1', text: 'x' });
  assert.strictEqual(out.success, false);
  assert.strictEqual(out.code, 215);
});

test('direct message: posts to messages/{platform} with recipientId and message', async () => {
  reply = { status: 200, body: { status: 'success', recipientId: 'r1', messageId: 'mid-1', message: 'Hi' } };
  const out = await api.sendAyrshareDirectMessage({ profileKey: 'PK2', platform: 'facebook', recipientId: 'r1', text: 'Hi' });
  assert.strictEqual(out.success, true);
  assert.strictEqual(out.messageId, 'mid-1');
  assert.strictEqual(sent[0].path, '/api/messages/facebook');
  assert.strictEqual(sent[0].headers['Profile-Key'], 'PK2');
  assert.deepStrictEqual(sent[0].body, { recipientId: 'r1', message: 'Hi' });
});

test('direct message: not-enabled and relink errors come back as failures with the code', async () => {
  reply = { status: 403, body: { status: 'error', code: 361, message: 'messaging not enabled' } };
  const out = await api.sendAyrshareDirectMessage({ profileKey: 'PK2', platform: 'instagram', recipientId: 'r1', text: 'Hi' });
  assert.strictEqual(out.success, false);
  assert.strictEqual(out.code, 361);
});

test('registering a webhook sends the chosen action and logs no address', async () => {
  reply = { status: 200, body: { status: 'success', action: 'messages', url: 'https://x.test/?token=SECRET', refId: 'r' } };
  const logged = [];
  console.log = (...a) => logged.push(a.join(' '));
  const out = await api.setAyrshareWebhook('PK3', 'https://x.test/?token=SECRET', 'messages');
  console.log = () => {};
  assert.strictEqual(out.success, true);
  assert.strictEqual(sent[0].body.action, 'messages');
  assert.ok(!logged.join('\n').includes('SECRET'));
  assert.ok(!JSON.stringify(out).includes('SECRET'));
});
