const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const endpoint of ['fixReferences', 'doFixReferences']) {
  test(`${endpoint}: deleted references retain their number and do not consume active numbers`, async () => {
    const rows = [
      { type: 'organisation', GSI2PK: 'org', SK: 'ED17' },
      { PK: 'CHC2026', SK: 'EMAIL#nom', type: 'nominator', GSI2PK: 'nom', GSI3PK: 'org', nominatorDetails: { reference: 'KH' } },
      ...[
        ['deleted', 'SK#ED17KH-001'],
        ['unallocated', 'SK#ED17KH-002'],
        ['deleted', 'SK#ED17KH-003-DELETED'],
        ['allocated', 'SK#ED17KH-004'],
        ['deleted', 'SK#ED17KH-005-DELETED-DELETED'],
      ].map(([status, GSI2SK], i) => ({
        PK: 'CHC2026', SK: `REF#${i}`, type: 'family', GSI3SK: 'nom',
        status, GSI2SK, dateAdded: `2026-09-29 10:00:0${i}`,
      })),
    ];
    let writes = 0;
    const Dynamo = { reserveNominatorReference: async () => true, scan: async () => rows, write: async (row) => { writes++; return row; } };
    const sandbox = {
      exports: {}, process: { env: { MAIN_DYNAMO_TABLE: 'test-table' } },
      console: { log() {} },
      require(name) {
        if (name.endsWith('/Dynamo')) return Dynamo;
        if (name.endsWith('/NominatorReferences')) return loadReferences(Dynamo);
        if (name.endsWith('/Functions')) return { hasPermission: () => true, validateSubmission: async () => ({}) };
        if (name.endsWith('/API_Responses')) return {
          _200: (body) => ({ statusCode: 200, body }),
          _400: (body) => ({ statusCode: 400, body }),
        };
        if (name === 'aws-sdk') return { CognitoIdentityServiceProvider: function() {}, SQS: function() {}, config: { update() {} } };
        return {};
      },
    };
    const source = process.env.REFERENCE_ENDPOINT_DIR || path.join(__dirname, '../endpoints');
    vm.runInNewContext(fs.readFileSync(path.join(source, `${endpoint}.js`), 'utf8'), sandbox);
    const event = endpoint === 'fixReferences'
      ? { campaign: 'CHC2026', nominatorId: 'nom' }
      : { Records: [{ messageAttributes: { campaign: { stringValue: 'CHC2026' }, nominatorId: { stringValue: 'nom' } } }] };
    assert.equal((await sandbox.exports.handler(event)).statusCode, 200);
    const families = rows.filter(row => row.type === 'family');
    assert.deepEqual(families.map(row => row.GSI2SK), [
      'SK#ED17KH-001-DELETED', 'SK#ED17KH-001', 'SK#ED17KH-003-DELETED',
      'SK#ED17KH-002', 'SK#ED17KH-005-DELETED',
    ]);
    assert.deepEqual(families.map(row => row.status), ['deleted', 'unallocated', 'deleted', 'allocated', 'deleted']);
    assert.equal(writes, 4);
    writes = 0;
    assert.equal((await sandbox.exports.handler(event)).statusCode, 200);
    assert.equal(writes, 0, 'rerunning the repair must not add suffixes or rewrite unchanged records');
  });
}

function loadCommon(file, dependencies) {
  const sandbox = { module: { exports: {} }, process: { env: {} }, console,
    require: (name) => dependencies[name] };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../common', file + '.js'), 'utf8'), sandbox);
  return sandbox.module.exports;
}
function loadReferences(Dynamo) {
  const Functions = loadCommon('Functions', { './Dynamo': Dynamo,
    'aws-sdk': { config: {}, Lambda: function() {} } });
  return loadCommon('NominatorReferences', { './Dynamo': Dynamo, './Functions': Functions });
}
function nom(email, reference, campaign = 'C', org = 'O') {
  return { PK: campaign, SK: `EMAIL#${email}`, GSI2PK: email, GSI3PK: org,
    type: 'nominator', nominatorDetails: { firstName: 'Jane', lastName: 'Anderson', reference } };
}
function reservationStore() {
  const claims = new Map();
  return {
    async reserveNominatorReference({ campaignId, organisationId, reference, owner }) {
      const key = JSON.stringify([campaignId, organisationId, reference]);
      if (claims.has(key) && claims.get(key) !== owner) return false;
      claims.set(key, owner);
      return true;
    },
    async write(row) { return row; },
  };
}
const options = (rows, owner = 'EMAIL#new') => ({ campaignId: 'C', organisationId: 'O',
  owner, name: 'Jane Anderson', rows, tableName: 'test-table' });

test('allocation skips existing base and suffixed references, including team leads', async () => {
  const helper = loadReferences(reservationStore());
  const rows = [nom('a', 'JA'), { ...nom('b', 'JAB'), type: 'team-lead' }, nom('c', 'JAC')];
  assert.equal(await helper.allocate(options(rows)), 'JAD');
});
test('references are scoped to organisation and campaign', async () => {
  const helper = loadReferences(reservationStore());
  assert.equal(await helper.allocate(options([nom('a', 'JA', 'OTHER'), nom('b', 'JA', 'C', 'OTHER')])), 'JA');
});
test('simultaneous allocations with the same snapshot receive different references', async () => {
  const helper = loadReferences(reservationStore());
  const rows = [nom('a', 'JA')];
  const refs = await Promise.all(['b', 'c', 'd'].map(owner => helper.allocate(options(rows, owner))));
  assert.deepEqual(refs.sort(), ['JAB', 'JAC', 'JAD']);
  assert.equal(await helper.allocate(options(rows, 'b')), refs[0]);
});
test('reservation infrastructure errors fail allocation', async () => {
  const helper = loadReferences({ reserveNominatorReference: async () => { throw new Error('unavailable'); } });
  await assert.rejects(helper.allocate(options([])), /unavailable/);
});

for (const endpoint of ['fixReferences', 'doFixReferences']) {
  test(`${endpoint}: duplicate nominator reference and active family references are repaired idempotently`, async () => {
    const target = nom('target', 'JAB');
    const rows = [nom('first', 'JA'), nom('second', 'JAB'), target,
      { PK: 'C', SK: 'ORG', type: 'organisation', GSI2PK: 'O' },
      { PK: 'C', SK: 'family', type: 'family', GSI3SK: 'target', GSI2SK: 'SK#ORGJAB-001', status: 'allocated' }];
    let writes = 0;
    const Dynamo = { ...reservationStore(), scan: async () => rows,
      write: async row => { writes++; return row; } };
    const helper = loadReferences(Dynamo);
    const sandbox = { exports: {}, process: { env: { MAIN_DYNAMO_TABLE: 'test-table' } }, console: { log() {} },
      require(name) {
        if (name.endsWith('/Dynamo')) return Dynamo;
        if (name.endsWith('/NominatorReferences')) return helper;
        if (name.endsWith('/Functions')) return { hasPermission: () => true, validateSubmission: async () => ({}) };
        if (name.endsWith('/API_Responses')) return { _200: body => ({ statusCode: 200, body }), _400: body => ({ statusCode: 400, body }) };
        if (name === 'aws-sdk') return { config: { update() {} }, CognitoIdentityServiceProvider: function() {}, SQS: function() {} };
        return {};
      } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../endpoints', endpoint + '.js'), 'utf8'), sandbox);
    const event = endpoint === 'fixReferences' ? { campaign: 'C', nominatorId: 'target' } :
      { Records: [{ messageAttributes: { campaign: { stringValue: 'C' }, nominatorId: { stringValue: 'target' } } }] };
    assert.equal((await sandbox.exports.handler(event)).statusCode, 200);
    assert.equal(target.nominatorDetails.reference, 'JAC');
    assert.equal(rows[4].GSI2SK, 'SK#ORGJAC-001');
    assert.equal(rows[1].nominatorDetails.reference, 'JAB');
    assert.equal(writes, 2);
    assert.equal((await sandbox.exports.handler(event)).statusCode, 200);
    assert.equal(writes, 2);
  });
}

test('Dynamo reservation uses a conditional put and only treats collisions as occupied', async () => {
  let failure;
  let params;
  const Dynamo = loadCommon('Dynamo', { 'aws-sdk': { config: { update() {} }, DynamoDB: {
    DocumentClient: function() { this.put = input => { params = input; return { promise: async () => {
      if (failure) throw failure;
      return {};
    } }; }; }
  } } });
  const claim = { campaignId: 'C', organisationId: 'O', reference: 'JA', owner: 'EMAIL#a' };
  assert.equal(await Dynamo.reserveNominatorReference(claim, 'table'), true);
  assert.equal(params.ConditionExpression, 'attribute_not_exists(PK) OR #owner = :owner');
  assert.equal(params.Item.PK, 'NOMINATOR_REFERENCE#["C","O"]');
  failure = Object.assign(new Error('occupied'), { code: 'ConditionalCheckFailedException' });
  assert.equal(await Dynamo.reserveNominatorReference(claim, 'table'), false);
  failure = new Error('Access denied');
  await assert.rejects(Dynamo.reserveNominatorReference(claim, 'table'), /Access denied/);
});
