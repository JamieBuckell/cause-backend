const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setup, root } = require('./harness');

function database(method, responses) {
  const calls = [];
  const client = { [method]: params => ({ promise: async () => {
    calls.push(JSON.parse(JSON.stringify(params)));
    const result = responses.shift(); if (result instanceof Error) throw result; return result;
  } }) };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'common/Dynamo.js'), 'utf8'), {
    module, require: name => name === "crypto" ? require("node:crypto") : ({ config: { update() {} }, DynamoDB: { DocumentClient: function() { return client; } } }),
    setTimeout: fn => fn(), console: { log() {} },
  });
  return { db: module.exports, calls };
}
for (const method of ['scan', 'query']) {
  test(`${method}: combines all pages without mutating caller parameters`, async () => {
    const { db, calls } = database(method, [{ Items: [], LastEvaluatedKey: { PK: 'next' } }, { Items: [{ PK: 'last' }], LastEvaluatedKey: {} }]);
    const params = { TableName: 'main' };
    const result = await db[method](params, 'main');
    assert.equal(result.length, 1); assert.equal(result[0].PK, 'last');
    assert.equal(calls[1].ExclusiveStartKey.PK, 'next');
    assert.deepEqual(params, { TableName: 'main' });
  });
  test(`${method}: COUNT pages do not require Items`, async () => {
    const { db } = database(method, [{ Count: 2, LastEvaluatedKey: { PK: 'next' } }, { Count: 3 }]);
    assert.equal(await db[method]({ TableName: 'main', Select: 'COUNT' }, 'main'), 5);
  });
}
test('batchWrite retries only unprocessed items', async () => {
  const one = { PutRequest: { Item: { PK: 'one' } } }, two = { PutRequest: { Item: { PK: 'two' } } };
  const { db, calls } = database('batchWrite', [{ UnprocessedItems: { main: [two] } }, {}]);
  await db.batchWrite([one, two], 'main');
  assert.deepEqual(calls[1].RequestItems.main, [two]);
});
test('batchWrite fails after bounded retries instead of claiming success', async () => {
  const item = { PutRequest: { Item: { PK: 'one' } } };
  const { db, calls } = database('batchWrite', Array.from({ length: 8 }, () => ({ UnprocessedItems: { main: [item] } })));
  await assert.rejects(db.batchWrite([item], 'main'), /Unprocessed/);
  assert.equal(calls.length, 8);
});
test('validation preserves false/zero and never falls back to a sibling property', async () => {
  const f = setup('campaign/list').loadCommon('Functions');
  assert.equal(await f.checkValue(['count'], { count: 0 }), 0);
  assert.equal(await f.checkValue(['enabled'], { enabled: false }), false);
  assert.equal(await f.checkValue(['missing', 'name'], { name: 'wrong' }), null);
  assert.equal(Object.keys(await f.validateSubmission({ count: 0 }, [{ key: 'count', required: true }])).length, 0);
  assert.equal(Object.keys(await f.validateSubmission({ name: '   ' }, [{ key: 'name', required: true, errorMsg: 'required' }])).length, 1);
});
test('email validation accepts school subdomains and rejects malformed addresses', async () => {
  const f = setup('campaign/list').loadCommon('Functions');
  const rules = [{ key: 'email', required: true, type: 'email' }];
  assert.equal(Object.keys(await f.validateSubmission({ email: 'person+appeal@school.example.org.uk' }, rules)).length, 0);
  assert.equal(Object.keys(await f.validateSubmission({ email: 'person@@example.org' }, rules)).length, 1);
});
test('permissions tolerate missing claims and distinguish complete group names', () => {
  const f = setup('campaign/list').loadCommon('Functions');
  assert.equal(f.hasPermission({ requestContext: { authorizer: {} } }, 'Admin'), false);
  assert.ok(!f.hasPermission({ requestContext: { authorizer: { claims: { 'cognito:groups': 'SuperAdmin' } } } }, 'Admin'));
});
test('temporary passwords have the requested length and allowed characters', () => {
  const f = setup('campaign/list').loadCommon('Functions');
  for (let i = 0; i < 20; i++) assert.match(f.generateP({ length: 8 }), /^\d{8}$/);
});
test('batch import stops when a chunk fails', async () => {
  const fixture = setup('campaign/list', { fail: 'Dynamo.batchWrite' });
  await assert.rejects(fixture.loadCommon('Functions').doBatchImport(Array.from({ length: 26 }, () => ({})), 'main'));
  assert.equal(fixture.calls.length, 1);
});
test('template query failures propagate and missing templates can use built-in fallback', async () => {
  const failing = setup('campaign/list', { fail: 'Dynamo.query' });
  await assert.rejects(failing.loadCommon('Functions').getEmailTemplate('donorRegister', {}));
  const f = setup('campaign/list').loadCommon('Functions');
  assert.ok((await f.getEmailTemplate('donorRegister', {})).subject);
});
test('explicitly deleted templates cannot silently fall back to a built-in template', async () => {
  const f = setup('campaign/list', { rows: [{ status: 'deleted' }] }).loadCommon('Functions');
  await assert.rejects(f.getEmailTemplate('donorRegister', {}), /deleted/);
});
test('raw email CSV is base64 encoded and delayed mail resolves/rejects', async () => {
  const calls = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'common/Notifications.js'), 'utf8'), {
    module, Buffer, process: { env: { FROM_ADDRESS: 'sender@example.org', INTERNAL_ADDRESS: 'internal@example.org' } },
    console: { log() {} }, setTimeout: fn => fn(), require: name => name === "crypto" ? require("node:crypto") : ({ config: { update() {} }, SES: function() {
      this.sendRawEmail = params => ({ promise: async () => { calls.push(params); return {}; } });
      this.sendTemplatedEmail = () => ({ promise: async () => ({ MessageId: 'sent' }) });
    } }),
  });
  const n = module.exports;
  const csv = 'Name,Count\nJane,2';
  await n.sendRawEmail({ ToAddress: 'recipient@example.org', csvAttachment: csv, csvAttachmentFilename: 'test.csv' });
  assert.ok(calls[0].RawMessage.Data.includes(Buffer.from(csv).toString('base64')));
  assert.ok(calls[0].RawMessage.Data.includes('multipart/mixed'));
  assert.equal((await n.sendTransactionalEmailDelayed({}, 1)).MessageId, 'sent');
  n.sendTransactionalEmail = async () => { throw new Error('SES failed'); };
  await assert.rejects(n.sendTransactionalEmailDelayed({}, 1), /SES failed/);
});
