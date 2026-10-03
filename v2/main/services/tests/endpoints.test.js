const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup, event, root } = require('./harness');

// Explicit contract inventory: every endpoint file, including internal jobs and
// compatibility handlers, must have an entry. Adding a handler requires tests.
const protectedEndpoints = {
  campaign: ['create', 'dashboard', 'delete', 'getById', 'list', 'update'],
  comms: ['process', 'sent'],
  donors: ['delete', 'downloadFile', 'emailUpdate', 'hide', 'resendVerification', 'update', 'updatePledge'],
  emails: ['create', 'delete', 'list', 'update'],
  families: ['allocate', 'create', 'delete', 'emailAssignment', 'list', 'split', 'update'],
  feedback: ['getHamper', 'getVolunteer'],
  hampers: ['undelivered', 'undeliveredDonors'],
  nominators: ['approve', 'delete', 'resetPassword', 'sendWelcome', 'update'],
  organisations: ['checkReference', 'create', 'delete', 'update'],
  reports: ['allDropOffs', 'dropOffs'],
  subscription: ['create', 'delete', 'list'],
  users: ['create', 'delete', 'fixReferences', 'list'],
};
const publicBody = ['donors/register', 'donors/changePledge', 'feedback/generatePdf', 'feedback/hamper', 'feedback/hamperCheck', 'feedback/volunteer', 'hampers/check', 'hampers/markDirect', 'hampers/markDirectBulk', 'hampers/receive', 'nominators/create', 'subscription/subscribe'];
const publicLookup = {
  'campaign/verify': {}, 'donors/confirmPledge': { emailAddress: 'person@example.org' },
  'hampers/overview': { hamperRef: 'AB-001' }, 'hampers/screen': { campaignId: 'TEST' },
  'organisations/getByHash': { organisationId: 'org', hash: 'invalid' },
  'subscription/check': { emailAddress: 'person@example.org', hash: 'invalid' },
  'subscription/resubscribe': { emailAddress: 'person@example.org', hash: 'invalid' },
  'subscription/unsubscribe': { emailAddress: 'person@example.org', hash: 'invalid' },
  'subscription/verification': { emailAddress: 'person@example.org' },
  'users/me': {}, 'users/resetPassword': { emailAddress: 'person@example.org' },
  'users/resetPasswordCommit': { emailAddress: 'person@example.org', verificationHash: 'invalid' },
};
const jobs = ['comms/recipientFix', 'comms/reconfigureEmails', ...['addFamilyRequestIds','deletedFamilies','donorAllocations','donors','families','fixDonorCognitoIDs','fixFamilySKs','fixFamilyUnitCounts','fixSKs','nominators','organisations','removeDeletedFamilies','subscribersFix'].map(n => `dataMigration/${n}`)];
const queues = ['comms/complete', 'comms/generate', 'comms/mailer', 'donors/sendPledgeDetail', 'users/doFixReferences'];
const retired = ['comms/email','comms/notifications','comms/updateMailsSent','emails/getById','families/update.BK','feedback/feedbackGenerate.hamperspecific','dataMigration/fixDonorSKs','comms/reconfigureRecipients'];
const inventory = [...Object.entries(protectedEndpoints).flatMap(([s, names]) => names.map(n => `${s}/${n}`)), ...publicBody, ...Object.keys(publicLookup), ...jobs, ...queues, ...retired, 'feedback/transfer'];

test('endpoint inventory includes every handler file', () => {
  const actual = fs.readdirSync(root).flatMap(service => {
    const dir = path.join(root, service, 'endpoints');
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.js')).map(f => `${service}/${f.slice(0,-3)}`) : [];
  });
  assert.deepEqual([...inventory].sort(), actual.sort());
});
for (const [service, names] of Object.entries(protectedEndpoints)) for (const name of names) {
  const endpoint = `${service}/${name}`;
  test(`${endpoint}: unauthenticated requests have no service side effects`, async () => {
    const f = setup(endpoint);
    const result = await f.invoke(event({}, {}, ''));
    assert.equal(result.statusCode, 401, JSON.stringify(f.logs));
    assert.equal(f.calls.length, 0);
  });
  test(`${endpoint}: unrelated authenticated roles have no service side effects`, async () => {
    const f = setup(endpoint);
    assert.equal((await f.invoke(event({}, {}, 'Donor'))).statusCode, 401);
    assert.equal(f.calls.length, 0);
  });
}
for (const endpoint of publicBody) test(`${endpoint}: malformed JSON fails without writes, emails or AWS calls`, async () => {
  const f = setup(endpoint);
  const input = event({}, {}, ''); input.body = '{invalid';
  assert.equal((await f.invoke(input)).statusCode, 400);
  assert.equal(f.calls.length, 0);
});
for (const [endpoint, params] of Object.entries(publicLookup)) test(`${endpoint}: database failure cannot report success`, async () => {
  const f = setup(endpoint, { fail: 'Dynamo' });
  const input = event({}, params, endpoint === 'users/me' ? 'Nominator' : '');
  input.queryStringParameters = { campaignId: 'TEST', c: 'TEST', v: 'invalid' };
  assert.equal((await f.invoke(input)).statusCode, 400, JSON.stringify(f.logs));
  assert.equal(f.calls.length, 1, 'must exercise a database call, then stop');
});
for (const endpoint of jobs) {
  test(`${endpoint}: source read failure prevents migration writes`, async () => {
    const f = setup(endpoint, { fail: 'Dynamo' });
    assert.equal((await f.invoke({ campaignId: "TEST" })).statusCode, 400);
    assert.equal(f.calls.length, 1);
    assert.match(f.calls[0].name, /^Dynamo\.(scan|query)$/);
  });
  test(`${endpoint}: empty source is a harmless no-op`, async () => {
    const f = setup(endpoint);
    await f.invoke({ campaignId: "TEST" });
    assert.equal(f.calls.filter(c => !/^Dynamo\.(scan|query|get)$/.test(c.name)).length, 0);
  });
}
for (const endpoint of queues) test(`${endpoint}: invalid queue records fail for retry without side effects`, async () => {
  const f = setup(endpoint);
  await assert.rejects(f.invoke({ Records: [{ messageAttributes: {} }] }));
  assert.equal(f.calls.length, 0);
});
test('feedback/transfer: disabled migration cannot touch data', async () => {
  const f = setup('feedback/transfer');
  const result = await f.invoke({ campaignId: "TEST" });
  assert.equal(result.statusCode, 400);
  assert.equal(JSON.parse(result.body).messages.disabled, 'Function disabled');
  assert.equal(f.calls.length, 0);
});

for (const endpoint of retired) test(`${endpoint}: retired handler never reads or writes data`, async () => {
  const f = setup(endpoint);
  const result = await f.invoke(event({ campaignId: 'TEST' }));
  assert.equal(result.statusCode, 400);
  assert.ok(JSON.parse(result.body).messages.retired);
  assert.equal(f.calls.length, 0);
});
