const test = require('node:test');
const assert = require('node:assert/strict');
const User = require('../models/User');

test('the public user carries how many client brands the account owns', () => {
  const u = new User({ email: 'a@example.com', firstName: 'A', agency: { clientCount: 3, workspaceName: 'Sweet Co' } });
  assert.equal(u.toPublicJSON().agency.clientCount, 3);
  assert.equal(u.toPublicJSON().agency.workspaceName, 'Sweet Co');
  assert.equal(new User({ email: 'b@example.com', firstName: 'B' }).toPublicJSON().agency.clientCount, 0);
});
