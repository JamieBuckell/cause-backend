const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const endpoint of ['fixReferences', 'doFixReferences']) {
  test(`${endpoint}: deleted references retain their number and do not consume active numbers`, async () => {
    const rows = [
      { type: 'organisation', GSI2PK: 'org', SK: 'ED17' },
      { type: 'nominator', GSI2PK: 'nom', GSI3PK: 'org', nominatorDetails: { reference: 'KH' } },
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
    const Dynamo = { scan: async () => rows, write: async (row) => { writes++; return row; } };
    const sandbox = {
      exports: {}, process: { env: { MAIN_DYNAMO_TABLE: 'test-table' } },
      console: { log() {} },
      require(name) {
        if (name.endsWith('/Dynamo')) return Dynamo;
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
