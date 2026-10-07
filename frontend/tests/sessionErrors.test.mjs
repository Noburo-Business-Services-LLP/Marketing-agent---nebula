import test from 'node:test';
import assert from 'node:assert/strict';
import { serverRejectedSession } from '../utils/sessionErrors.ts';

// Found by stopping the API with a staff page open and reloading: every failure of the sign-in check
// deleted the saved login, so a server restart or a short outage signed everyone out.
test('only an answer from the server that the login is not valid ends the session', () => {
  assert.equal(serverRejectedSession({ status: 401 }), true);
});

test('a stopped server, a gateway error or a slow reply keeps the saved login', () => {
  assert.equal(serverRejectedSession(new Error('Unable to connect to server. Please check your connection.')), false);
  assert.equal(serverRejectedSession({ status: 500 }), false);
  assert.equal(serverRejectedSession({ status: 502 }), false);
  assert.equal(serverRejectedSession({ status: 503 }), false);
  assert.equal(serverRejectedSession({ status: 429 }), false);
  assert.equal(serverRejectedSession(undefined), false);
  assert.equal(serverRejectedSession(null), false);
});
