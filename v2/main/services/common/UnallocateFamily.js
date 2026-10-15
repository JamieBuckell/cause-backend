const AWS = require('aws-sdk');
const crypto = require('crypto');
const { read } = require('./DonorAllocations');
const db = new AWS.DynamoDB.DocumentClient({ region: process.env.AWS_ACCOUNT_REGION || 'eu-west-2' });
const canonical = value => JSON.stringify(value, function(key, item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.keys(item).sort().reduce((result, name) => { result[name] = item[name]; return result; }, {}) : item;
});
function plan(donor, families, input) {
  const matches = families.filter(f => input.familyId ? f.GSI2PK === input.familyId : f.GSI2SK === `SK#${input.hamperId}`);
  if (matches.length !== 1) throw new Error('Family is no longer allocated to this donor. Refresh the donor page.');
  const family = matches[0];
  const details = JSON.parse(JSON.stringify(donor.familyDetails || {}));
  const links = [];
  for (const request of details.request || []) {
    if (request.allocation !== undefined && !Array.isArray(request.allocation)) throw new Error('Pledge allocation data needs review.');
    for (const link of request.allocation || []) links.push({ request, link });
  }
  const ref = family.GSI2SK.slice(3);
  const exact = links.filter(({ link }) => link.familyId === family.GSI2PK || link.hamperId === ref);
  const snapshots = links.filter(({ link }) => Array.isArray(link.members) && canonical(link.members) === canonical(family.members));
  if (exact.length && snapshots.length && !exact.some(entry => snapshots.includes(entry))) {
    throw new Error('The family reference conflicts with an outdated allocation link and needs review.');
  }
  let selected = exact;
  if (!exact.length) {
    // Old references may now belong to other families. Only a unique member
    // snapshot among this donor's assignments can identify a stale link.
    if (snapshots.length) {
      if (snapshots.length !== 1 || families.filter(f => canonical(f.members) === canonical(family.members)).length !== 1 ||
        families.some(f => f.SK !== family.SK && f.GSI2SK === `SK#${snapshots[0].link.hamperId}`)) {
        throw new Error('The outdated allocation link is ambiguous and needs review.');
      }
      selected = snapshots;
    } else if (links.some(({ link }) => !families.some(f => f.GSI2SK === `SK#${link.hamperId}`))) {
      throw new Error('The outdated allocation link cannot be identified safely and needs review.');
    }
  }
  if (selected.length > 1) throw new Error('Duplicate allocation links need review before unallocating.');
  for (const { request, link } of selected) request.allocation = request.allocation.filter(a => a !== link);
  return { family, details, guardFamilies: !exact.length && snapshots.length ? families.filter(f => f.SK !== family.SK) : [] };
}
async function unallocate(input, actor) {
  const { donor, families } = await read(input.campaignId, input.donorId);
  const { family, details, guardFamilies } = plan(donor, families, input);
  const table = process.env.MAIN_DYNAMO_TABLE;
  const now = new Date().toISOString(), token = crypto.randomBytes(16).toString('hex');
  const operations = [
    { Update: { TableName: table, Key: { PK: family.PK, SK: family.SK },
      UpdateExpression: 'SET allocatedTo = :free, #status = :free',
      ConditionExpression: 'allocatedTo = :donor AND #status = :before AND GSI2SK = :ref AND members = :members',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':free': 'unallocated', ':donor': donor.GSI2PK, ':before': family.status, ':ref': family.GSI2SK, ':members': family.members } } },
    { Update: { TableName: table, Key: { PK: donor.PK, SK: donor.SK },
      UpdateExpression: 'SET familyDetails = :next',
      ConditionExpression: 'familyDetails = :before AND GSI2PK = :donor AND #type = :type AND (attribute_not_exists(#status) OR #status <> :deleted)',
      ExpressionAttributeNames: { '#type': 'type', '#status': 'status' },
      ExpressionAttributeValues: { ':next': details, ':before': donor.familyDetails, ':donor': donor.GSI2PK, ':type': 'donor', ':deleted': 'deleted' } } },
    { Put: { TableName: table, Item: { PK: `DONOR_CHANGE#${donor.GSI2PK}`, SK: `${now}#${token}`, type: 'donor-unallocation',
      campaignId: donor.PK, actor, familyId: family.GSI2PK, reference: family.GSI2SK.slice(3), before: donor.familyDetails, after: details },
      ConditionExpression: 'attribute_not_exists(PK)' } },
  ];
  if (operations.length + guardFamilies.length > 100) throw new Error('This donor has too many assignments to check the outdated link automatically. Review is required.');
  for (const other of guardFamilies) operations.push({ ConditionCheck: {
    TableName: table, Key: { PK: other.PK, SK: other.SK },
    ConditionExpression: 'allocatedTo = :donor AND GSI2SK = :ref AND members = :members',
    ExpressionAttributeValues: { ':donor': donor.GSI2PK, ':ref': other.GSI2SK, ':members': other.members },
  } });
  try { await db.transactWrite({ TransactItems: operations, ClientRequestToken: token }).promise(); }
  catch (error) {
    if (['TransactionCanceledException', 'ConditionalCheckFailedException'].includes(error.code)) throw new Error('The donor or family changed while saving. Refresh and try again.');
    throw error;
  }
  return { donor: { ...donor, familyDetails: details }, family: { ...family, allocatedTo: 'unallocated', status: 'unallocated' } };
}
module.exports = { plan, unallocate };
