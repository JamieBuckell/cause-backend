const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');
const Notifications = require('../../common/Notifications');

exports.handler = async (event, context, cb) => {
    try {
        if (!Functions.hasPermission(event, 'Admin')) {
            return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
        }

        const { requestId } = event.pathParameters;
        const donorsTableName = process.env.DONORS_TABLE;
        const campaignTableName = process.env.CAMPAIGNS_TABLE;
        const campaignDonorsTableName = process.env.CAMPAIGN_DONORS_TABLE;
        const familiesTableName = process.env.FAMILIES_TABLE;

        const donorData = await Dynamo.get(
            {
                "requestId": requestId,
            }, 
            donorsTableName
        ).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        if (!donorData) {
            return Responses._400({ message: 'Failed to retrieve by ID' });
        }

        const queryData = {
            'IndexName': 'donorRequest',
            'KeyConditionExpression': 'donorId = :donorId',
            'ExpressionAttributeValues': {
                ':donorId': requestId
            }
        };
        const donorCampaignData = await Dynamo.query(queryData, campaignDonorsTableName).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: { 'error': 'An unexpected error occurred. Please try again later' }});
        });

        if (donorCampaignData.length) {

            for (const [i, item] of donorCampaignData.entries()) {
                const campaignData = await Dynamo.get(
                    {
                        "requestId": item.campaignId,
                    }, 
                    campaignTableName
                ).catch(err => {
                    console.log('error in dynamo query', err);
                    return Responses._400({ messages: err });
                });

                item.campaignName = campaignData?.name;
                console.log(item);
            }
        }

        const queryFamilyData = {
            'IndexName': 'allocatedToRequest',
            'KeyConditionExpression': 'allocatedTo = :donorId',
            'ExpressionAttributeValues': {
                ':donorId': requestId
            }
        };
        const donorFamiliesData = await Dynamo.query(queryFamilyData, familiesTableName).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: { 'error': 'An unexpected error occurred. Please try again later' }});
        });

        return Responses._200({donor: donorData, campaigns: donorCampaignData, families: donorFamiliesData });
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};