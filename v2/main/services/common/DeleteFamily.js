const AWS = require('aws-sdk');
const crypto = require('crypto');
const { read } = require('./DonorAllocations');
const { plan } = require('./UnallocateFamily');
const db = new AWS.DynamoDB.DocumentClient({ region: process.env.AWS_ACCOUNT_REGION || 'eu-west-2' });

// Family deletion and pledge cleanup must succeed together. Never persist a
// stale whole-family snapshot over a concurrent allocation or reference change.
async function deleteFamily(family, actor) {
  if (family.status === 'deleted') return;
  let donor, details, guardFamilies = [];
  if (family.allocatedTo && family.allocatedTo !== 'unallocated') {
    const current = await read(family.PK, family.allocatedTo);
    donor = current.donor;
    ({ details, guardFamilies } = plan(donor, current.families, { familyId: family.GSI2PK }));
  }
  const table = process.env.MAIN_DYNAMO_TABLE;
  const names = { '#status': 'status' }, values = { ':deleted': 'deleted' };
  const conditions = [];
  for (const [index, field] of ['type', 'GSI2PK', 'GSI2SK', 'GSI3PK', 'GSI3SK', 'allocatedTo', 'status', 'members'].entries()) {
    const name = `#f${index}`, value = `:f${index}`;
    names[name] = field;
    if (family[field] === undefined) conditions.push(`attribute_not_exists(${name})`);
    else { conditions.push(`${name} = ${value}`); values[value] = family[field]; }
  }
  const now = new Date().toISOString(), token = crypto.randomBytes(16).toString('hex');
  const operations = [{ Update: { TableName: table, Key: { PK: family.PK, SK: family.SK },
    UpdateExpression: 'SET #status = :deleted', ConditionExpression: conditions.join(' AND '),
    ExpressionAttributeNames: names, ExpressionAttributeValues: values } }];
  if (donor) operations.push({ Update: { TableName: table, Key: { PK: donor.PK, SK: donor.SK },
    UpdateExpression: 'SET familyDetails = :next',
    ConditionExpression: 'familyDetails = :before AND GSI2PK = :donor AND #type = :type AND (attribute_not_exists(#status) OR #status <> :deleted)',
    ExpressionAttributeNames: { '#type': 'type', '#status': 'status' },
    ExpressionAttributeValues: { ':next': details, ':before': donor.familyDetails, ':donor': donor.GSI2PK, ':type': 'donor', ':deleted': 'deleted' } } });
  for (const other of guardFamilies) operations.push({ ConditionCheck: { TableName: table, Key: { PK: other.PK, SK: other.SK },
    ConditionExpression: 'allocatedTo = :donor AND GSI2SK = :ref AND members = :members',
    ExpressionAttributeValues: { ':donor': donor.GSI2PK, ':ref': other.GSI2SK, ':members': other.members } } });
  operations.push({ Put: { TableName: table, Item: { PK: donor ? `DONOR_CHANGE#${donor.GSI2PK}` : `FAMILY_CHANGE#${family.GSI2PK}`,
    SK: `${now}#${token}`, type: 'family-deletion', campaignId: family.PK, actor, familyId: family.GSI2PK,
    reference: family.GSI2SK, before: family, ...(donor ? { beforePledge: donor.familyDetails, afterPledge: details } : {}) },
    ConditionExpression: 'attribute_not_exists(PK)' } });
  if (operations.length > 100) throw new Error('Too many assignments to check safely. Manual review is required.');
  try { await db.transactWrite({ TransactItems: operations, ClientRequestToken: token }).promise(); }
  catch (error) {
    if (['TransactionCanceledException', 'ConditionalCheckFailedException'].includes(error.code)) throw new Error('The donor or family changed while saving. Refresh and try again.');
    throw error;
  }
}
module.exports = { deleteFamily };
