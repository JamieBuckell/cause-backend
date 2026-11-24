const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(endpoint, { writeFails = false, validHash = true, cognitoOnly = false, users, savedReset } = {}) {
  const calls = { emails: [], writes: [], passwords: [], lookups: [] };
  const nominator = { GSI2PK: 'user-id', nominatorDetails: { email: 'person@example.org', cognitoId: 'cognito-id' }, emailVerification: { resetPasswordHash: 'reset-salt' } };
  const dependencies = {
    API_Responses: { _200: body => ({ statusCode: 200, body }), _400: body => ({ statusCode: 400, body }) },
    Dynamo: {
      scan: async params => { calls.scan = params; return cognitoOnly ? (params.ExpressionAttributeValues[':sk'].startsWith('PASSWORD_RESET#') && savedReset ? [savedReset] : []) : [nominator]; },
      write: async (row, table) => { calls.writes.push(table); calls.saved = row; if (writeFails) throw new Error('write failed'); },
    },
    Hashing: { generateSalt: () => 'salt', hash: () => ({ hashedpassword: 'valid-hash' }), compare: (id, values) => { calls.compare = { id, ...values }; return validHash && values.hashedpassword === 'valid-hash'; } },
    Functions: { generateP: () => 'temporary-password', getEmailTemplate: async (name, values) => ({ name, values }) },
    Notifications: { sendTransactionalEmail: async params => calls.emails.push(params) },
  };
  const sandbox = { exports: {}, console: { log() {} }, process: { env: { MAIN_DYNAMO_TABLE: 'main-table', APP_URL: 'https://app.example.org', HASHING_SALT: 'env-salt', USER_POOL: 'pool' } },
    require(name) {
      if (name === 'aws-sdk') return { config: { update() {} }, CognitoIdentityServiceProvider: function() { this.listUsers = params => ({ promise: async () => { calls.lookups.push(params); return { Users: users ?? [{ Username: 'admin-id', Enabled: true, Attributes: [{ Name: 'email', Value: 'person@example.org' }] }] }; } }); this.adminSetUserPassword = params => ({ promise: async () => calls.passwords.push(params) }); } };
      return dependencies[name.split('/').pop()];
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../endpoints', `${endpoint}.js`), 'utf8'), sandbox);
  return { calls, nominator, run: () => sandbox.exports.handler({ pathParameters: { emailAddress: 'PERSON@EXAMPLE.ORG', verificationHash: 'valid-hash' } }) };
}

test('reset initiation looks up normalized email and sends the reset link after saving', async () => {
  const { run, calls } = setup('resetPassword');
  assert.equal((await run()).statusCode, 200);
  assert.equal(calls.scan.ExpressionAttributeValues[':sk'], 'EMAIL#person@example.org');
  assert.deepEqual(calls.writes, ['main-table']);
  assert.equal(calls.emails[0].values.resetPasswordLink, 'https://app.example.org/reset-password/person@example.org/valid-hash');
});

test('reset initiation does not send a link when saving fails', async () => {
  const { run, calls } = setup('resetPassword', { writeFails: true });
  assert.equal((await run()).statusCode, 400);
  assert.equal(calls.emails.length, 0);
});

test('confirmation validates the supplied hash and clears it in the main table', async () => {
  const { run, calls, nominator } = setup('resetPasswordCommit');
  assert.equal((await run()).statusCode, 200);
  assert.equal(calls.compare.hashedpassword, 'valid-hash');
  assert.equal(calls.passwords.length, 1);
  assert.equal(calls.emails.length, 1);
  assert.equal(nominator.emailVerification.resetPasswordHash, '');
  assert.deepEqual(calls.writes, ['main-table']);
});

test('confirmation rejects invalid links without changing the password', async () => {
  const { run, calls } = setup('resetPasswordCommit', { validHash: false });
  assert.equal((await run()).statusCode, 400);
  assert.equal(calls.passwords.length, 0);
  assert.equal(calls.emails.length, 0);
  assert.equal(calls.writes.length, 0);
});

test('confirmation reports failure when clearing the reset hash fails', async () => {
  const { run } = setup('resetPasswordCommit', { writeFails: true });
  assert.equal((await run()).statusCode, 400);
});


test('Cognito-only admin can request and complete a reset without a nominator record', async () => {
  const init = setup('resetPassword', { cognitoOnly: true });
  assert.equal((await init.run()).statusCode, 200);
  assert.equal(init.calls.lookups[0].Filter, 'email = "person@example.org"');
  assert.equal(init.calls.saved.PK, 'PASSWORD_RESET#admin-id');
  assert.equal(init.calls.saved.SK, 'PASSWORD_RESET#person@example.org');
  assert.equal(init.calls.emails.length, 1);
  const commit = setup('resetPasswordCommit', { cognitoOnly: true, savedReset: init.calls.saved });
  assert.equal((await commit.run()).statusCode, 200);
  assert.equal(commit.calls.compare.id, 'admin-id');
  assert.equal(commit.calls.passwords[0].Username, 'admin-id');
  assert.equal(init.calls.saved.emailVerification.resetPasswordHash, '');
  assert.equal((await commit.run()).statusCode, 400);
  assert.equal(commit.calls.passwords.length, 1);
});

test('unknown, disabled and ambiguous Cognito accounts cannot initiate resets', async () => {
  for (const users of [[], [{ Enabled: false }], [{ Enabled: true }, { Enabled: true }]]) {
    const { run, calls } = setup('resetPassword', { cognitoOnly: true, users });
    assert.equal((await run()).statusCode, 400);
    assert.equal(calls.writes.length, 0);
    assert.equal(calls.emails.length, 0);
  }
});

test('invalid Cognito-only reset link cannot change the password', async () => {
  const init = setup('resetPassword', { cognitoOnly: true });
  await init.run();
  const { run, calls } = setup('resetPasswordCommit', { cognitoOnly: true, savedReset: init.calls.saved, validHash: false });
  assert.equal((await run()).statusCode, 400);
  assert.equal(calls.passwords.length, 0);
});
