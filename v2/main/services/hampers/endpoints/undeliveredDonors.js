const Responses = require('../common/API_Responses');
const Dynamo = require('../common/Dynamo');
const Hashing = require('../common/Hashing');
const Functions = require('../common/Functions');

exports.handler = async (event, context, cb) => {
    try {
        if (
            !Functions.hasPermission(event, 'Admin')
        ) {
            return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
        }
        
        const parsed = event.emailAddress ? event : JSON.parse(event.body);

        const familiesTableName = process.env.FAMILIES_TABLE;
        const donorsTableName = process.env.DONORS_TABLE;
        const campaignDonorsTableName = process.env.CAMPAIGN_DONORS_TABLE;

        const campaignId = '6fd91723-9316-4502-99cb-0fc6399aed86';

        const params = {"TableName": familiesTableName};
        let allFamilies = await Dynamo.scan(params).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        if (parsed?.organisationId) {
            allFamilies = allFamilies.filter(
                (f) => f.organisationId == parsed.organisationId
            );
        }

        if (!allFamilies) {
            return Responses._400({ message: 'Failed to find family data' });
        }
        const queryData = {
            'IndexName': 'campaignRequest',
            'KeyConditionExpression': 'campaignId = :campaignId',
            'ExpressionAttributeValues': {
                ':campaignId': campaignId
            }
        };
        const campaignDonors = await Dynamo.query(queryData, campaignDonorsTableName).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        const campaignDonorsMapped = campaignDonors.map(d => ([d.donorId, d.numberOfFamilies]));
        const allDonorPledges = Object.fromEntries(campaignDonorsMapped);

        const donorParams = {"TableName": donorsTableName};
        const donorsData = await Dynamo.scan(donorParams).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        const donorsMapped = donorsData.map(d => ([d.requestId, `${d.firstName} ${d.lastName} (${d.email})`]));
        const allDonors = Object.fromEntries(donorsMapped);

        allFamilies = allFamilies.filter((d) =>
            !d.receiveStatus
        )

        allFamilies = allFamilies.map(f => ({
            reference: f.reference,
            donor: allDonors[f.allocatedTo],
            dynamics: f.familyDetail,
            totalUnit: f.totalUnit,
            pledged: allDonorPledges[f.allocatedTo],
        }));

        return Responses._200([ ...allFamilies ]);
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};