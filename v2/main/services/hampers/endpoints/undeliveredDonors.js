const Responses = require('../common/API_Responses');
const Dynamo = require('../common/Dynamo');
const Functions = require('../common/Functions');
exports.handler = async event => {
  try {
    if (!Functions.hasPermission(event, 'Admin')) return Responses._401({ messages: { unauthorized: 'Admin access is required' } });
    const campaignId = Functions.requireCampaign(event.queryStringParameters?.campaignId);
    const rows = await Dynamo.query({ KeyConditionExpression: '#pk = :pk', ExpressionAttributeNames: { '#pk': 'PK' }, ExpressionAttributeValues: { ':pk': campaignId } }, process.env.MAIN_DYNAMO_TABLE);
    const organisationId = event.queryStringParameters?.organisationId;
    return Responses._200(rows.filter(f => f.type === 'family' && f.status !== 'deleted' && !f.receiveStatus && (!organisationId || f.GSI3PK === organisationId)).map(f => {
      const donor = rows.find(d => d.type === 'donor' && d.status !== 'deleted' && d.GSI2PK === f.allocatedTo);
      return {
        reference: f.GSI2SK.replace(/^SK#/, ''),
        donor: donor ? `${donor.donorDetails.firstName} ${donor.donorDetails.lastName} (${donor.GSI3PK})` : 'Unallocated',
        dynamics: f.familyDetail || Functions.createDetailPreview('familyDetail', { members: f.members ?? [] }), totalUnit: f.totalUnit,
        pledged: (donor?.familyDetails?.request ?? []).reduce((sum, r) => sum + (Number(r.numberOfFamilies) || 0), 0),
      };
    }));
  } catch (error) {
    console.log('Undelivered donor report failed', error);
    return Responses._400({ messages: { unexpected: 'An unexpected error occurred' } });
  }
};
