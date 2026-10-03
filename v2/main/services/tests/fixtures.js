const assert = require('node:assert/strict');
const { setup, event, clone } = require('./harness');
const Hashing = require('../common/Hashing');
const token = data => Hashing.hash(data, 'test-salt').hashedpassword;
const campaign = { PK: 'TEST', SK: 'A', type: 'campaign', campaignName: 'Test', status: 'active', campaignDetails: { registrationOpen: '2000-01-01', registrationClosed: '2999-01-01', nominationsClosed: '2999-01-01' } };
const org = { PK: 'TEST', SK: 'AB', GSI2PK: 'org', type: 'organisation', hash: { data: 'org-data', salt: 'org-salt' }, organisation: { name: 'School' } };
const nom = { PK: 'TEST', SK: 'EMAIL#actor@example.org', GSI2PK: 'nom', GSI3PK: 'org', type: 'nominator', nominatorDetails: { firstName: 'Jane', lastName: 'Doe', email: 'actor@example.org', reference: 'JD', telephone: '01234567890', cognitoId: 'id' }, emailVerification: {} };
const family = { PK: 'TEST', SK: 'REF#family', GSI2PK: 'family', GSI2SK: 'SK#ABJD-001', GSI3PK: 'org', GSI3SK: 'nom', type: 'family', status: 'unallocated', allocatedTo: 'unallocated', members: [{ who: 'Adult', age: 30, ageType: 'years' }], totalUnit: 1 };
const donor = { PK: 'TEST', SK: 'EMAIL#D#donor@example.org', GSI2PK: 'donor', GSI2SK: 'EMAIL#D#donor@example.org', GSI3PK: 'donor@example.org', type: 'donor', donorDetails: { firstName: 'Donor', lastName: 'Example' }, emailVerification: { hash: 'H#token', verified: false }, familyDetails: { request: [{ requestId: 'request', numberOfFamilies: 1, familyDetail: '["single"]', allocation: [] }] } };
const subscriber = { PK: 'donor@example.org', SK: 'H#token', subscribed: true, verified: true };
const template = { PK: 'welcome', SK: 'SK#welcome', subject: 'Welcome', pageContent: 'Hello', status: 'active' };
const decoded = r => JSON.parse(r.body);
const writes = f => f.calls.filter(c => c.name === 'Dynamo.write');
const batches = f => f.calls.filter(c => c.name === 'Dynamo.batchWrite').flatMap(c => c.args[0].map(x => x.PutRequest?.Item));
const defaultFunctions = { getEmailTemplate: async () => ({ subject: 'Test', pageContent: 'Test', pageTitle: 'Test' }) };
function fixture(endpoint, options = {}) { return setup(endpoint, { ...options, rows: clone(options.rows ?? []), functions: { ...defaultFunctions, ...options.functions } }); }

module.exports = { campaign, org, nom, family, donor, subscriber, fixture, token, decoded, writes, batches };
