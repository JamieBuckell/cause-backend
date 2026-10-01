const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const Hashing = require('../../common/Hashing');

function setup(handler, email) {
  const lookups = [], writes = [], messages = [];
  const donor = { GSI2PK: 'donor-id', emailVerification: { hash: 'test-id' } };
  const response = statusCode => body => ({ statusCode, body });
  const dependencies = {
    '../common/API_Responses': { _200: response(200), _400: response(400) },
    '../common/Hashing': Hashing,
    '../common/Dynamo': {
      query: async query => {
        lookups.push(query);
        const values = query.ExpressionAttributeValues;
        return values[':pk'] === 'CHC2026' && values[':sk'] === `EMAIL#D#${email}` ? [donor] : [];
      },
      scan: async () => [{ allocatedTo: 'donor-id', status: 'allocated' }],
      batchWrite: async items => writes.push(...items),
    },
    '../common/Functions': { hasPermission: () => false, validateSubmission: async () => ({}) },
    '../common/Notifications': { sendInternalEmail: async message => messages.push(message) },
    'aws-sdk': {
      config: { update() {} },
      SQS: function () { this.sendMessage = message => ({ promise: async () => messages.push(message) }); },
    },
  };
  const context = {
    exports: {}, console: { log() {} },
    process: { env: { HASHING_SALT: 'test-salt' } },
    require: name => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; },
  };
  vm.runInNewContext(readFileSync(path.join(__dirname, `../endpoints/${handler}.js`), 'utf8'), context);
  return {
    lookups, writes, messages,
    invoke: (emailAddress, v = Hashing.hash('test-id', 'test-salt').hashedpassword, c = 'CHC2026') =>
      context.exports.handler({ pathParameters: { emailAddress }, queryStringParameters: { v, c }, body: JSON.stringify({ details: 'Please change allocation' }) }),
  };
}

for (const handler of ['confirmPledge', 'changePledge']) {
  for (const email of ['donor@example.com', 'donor+appeal@example.com', 'donor%40name@example.com', 'donor%name@example.com']) {
    for (const input of [email, encodeURIComponent(email)]) {
      test(`${handler} handles ${input}`, async () => {
        const fixture = setup(handler, email);
        const result = await fixture.invoke(input);
        assert.equal(result.statusCode, 200);
        assert.equal(fixture.messages.length, 1);
        assert.equal(fixture.writes.length, handler === 'confirmPledge' ? 1 : 0);
        if (handler === 'confirmPledge') assert.equal(fixture.writes[0].PutRequest.Item.status, 'allocated-confirmed');
      });
    }
  }
  test(`${handler} rejects malformed encoding before lookup`, async () => {
    const fixture = setup(handler, 'donor@example.com');
    assert.equal((await fixture.invoke('donor%ZZ%40example.com')).statusCode, 400);
    assert.equal(fixture.lookups.length, 0);
    assert.equal(fixture.writes.length, 0);
    assert.equal(fixture.messages.length, 0);
  });
  test(`${handler} still rejects invalid tokens`, async () => {
    const fixture = setup(handler, 'donor@example.com');
    assert.equal((await fixture.invoke('donor%40example.com', 'invalid')).statusCode, 400);
    assert.equal(fixture.lookups.length, 1);
    assert.equal(fixture.writes.length, 0);
    assert.equal(fixture.messages.length, 0);
  });
  test(`${handler} keeps campaign lookup scoped`, async () => {
    const fixture = setup(handler, 'donor@example.com');
    assert.equal((await fixture.invoke('donor%40example.com', undefined, 'OTHER')).statusCode, 400);
    assert.equal(fixture.writes.length, 0);
    assert.equal(fixture.messages.length, 0);
  });
}
