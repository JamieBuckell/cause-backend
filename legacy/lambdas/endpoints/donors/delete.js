const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');

exports.handler = async (event, context, cb) => {
    try {
        if (!Functions.hasPermission(event, 'Admin')) {
            return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
        }

        const donorsTableName = process.env.DONORS_TABLE;
        const campaignDonorsTableName = process.env.CAMPAIGN_DONORS_TABLE;
        const familiesTableName = process.env.FAMILIES_TABLE;
        const familyMembersTableName = process.env.FAMILY_MEMBERS_TABLE;

        const userEmail = event.requestContext.authorizer.claims.email;

        const parsed = event.donorId ? event : JSON.parse(event.body);

        console.log(`${userEmail} is attempting to delete donor ${parsed.donorId}`);
        await Dynamo.delete(
            { "requestId": parsed.donorId }, 
            donorsTableName
        ).catch(err => {
            console.log('error in donors dynamo delete', err);
            return Responses._400({ messages: err });
        });

        const queryCampaignDonorsData = {
            'IndexName': 'donorRequest',
            'KeyConditionExpression': 'donorId = :donorId',
            'ExpressionAttributeValues': {
                ':donorId': parsed.donorId
            }
        };
        const donorCampaignData = await Dynamo.query(queryCampaignDonorsData, campaignDonorsTableName).catch(err => {
            console.log('error in campaign dynamo query', err);
            return Responses._400({ messages: { 'error': 'An unexpected error occurred. Please try again later' }});
        });

        console.log(`Deleteing ${donorCampaignData.length} donor links`);

        if (donorCampaignData.length) {
            for (const [i, item] of donorCampaignData.entries()) {
                console.log(item);
                await Dynamo.delete(
                    { "requestId": item.requestId }, 
                    campaignDonorsTableName
                ).catch(err => {
                    console.log('error in campaign donor dynamo delete', err);
                    return Responses._400({ messages: err });
                });
            }
        }


        const queryFamilyData = {
            'IndexName': 'allocatedToRequest',
            'KeyConditionExpression': 'allocatedTo = :donorId',
            'ExpressionAttributeValues': {
                ':donorId': parsed.donorId
            }
        };
        const familiesData = await Dynamo.query(queryFamilyData, familiesTableName).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: { 'error': 'An unexpected error occurred. Please try again later' }});
        });
        console.log(`Removing ${familiesData.length} family assignments`);

        if (familiesData && familiesData.length) {
            const batchData = [];

            for (const [i, family] of familiesData.entries()) {
                family.allocatedTo = 'unallocated';
                family.campaignRequestId = 'unallocated';
                family.status = 'unallocated';
                batchData.push({
                    PutRequest: {
                        Item: family
                    }
                });
            }

            if (batchData && batchData.length) {
                const chunkSize = 25;
                for (let i = 0; i < batchData.length; i += chunkSize) {
                    const chunk = batchData.slice(i, i + chunkSize);

                    await Dynamo.batchWrite(chunk, familiesTableName).catch(err => {
                        console.log('error in dynamo write', err);
                        return Responses._400({ messages: err });
                    });
                }
            }
        }

        const familyMemberQueryData = {
            'IndexName': 'donorFamilyRequest',
            'KeyConditionExpression': 'allocatedTo = :allocatedTo',
            'ExpressionAttributeValues': {
                ':allocatedTo': parsed.donorId
            }
        };
        let familyMemberData = await Dynamo.query(familyMemberQueryData, familyMembersTableName).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });
        console.log(`Removing ${familyMemberData.length} family member assignments`);

        if (familyMemberData && familyMemberData.length) {
            const batchData = [];

            for (const [i, member] of familyMemberData.entries()) {
                member.allocatedTo = 'unallocated';
                member.campaignRequestId = 'unallocated';
                member.status = 'unallocated';
                batchData.push({
                    PutRequest: {
                        Item: member
                    }
                });
            }

            if (batchData && batchData.length) {
                const chunkSize = 25;
                for (let i = 0; i < batchData.length; i += chunkSize) {
                    const chunk = batchData.slice(i, i + chunkSize);

                    await Dynamo.batchWrite(chunk, familiesTableName).catch(err => {
                        console.log('error in dynamo write', err);
                        return Responses._400({ messages: err });
                    });
                }
            }
        }

        return Responses._200({ messages: { 'success': 'Donor deleted successfully' }});
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};