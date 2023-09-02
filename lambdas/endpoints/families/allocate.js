const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');

const validations = [
    {
        key: 'familyId',
        required: true,
        errorMsg: 'Nominator is required',
    },
    {
        key: 'donorId',
        required: true,
        errorMsg: 'Nominator is required',
    },
];

exports.handler = async (event, context, cb) => {
    try {
        if (
            !Functions.hasPermission(event, 'Admin')
        ) {
            return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
        }
        const familiesTableName = process.env.FAMILIES_TABLE;
        const familyMembersTableName = process.env.FAMILY_MEMBERS_TABLE;
        const donorsTableName = process.env.DONORS_TABLE;
        const campaignDonorsTableName = process.env.CAMPAIGN_DONORS_TABLE;
        
        console.log(event);
        const remove = event['path'] && event['path'].includes('families/allocate/remove');

        console.log(event);

        const parsed = event.familyId ? event : JSON.parse(event.body);
        console.log('Submitted Data', parsed);

        const campaignId = parsed.campaignId ?? '6fd91723-9316-4502-99cb-0fc6399aed86';
        
        const valid = await Functions.validateSubmission(parsed, validations);
        if (Object.keys(valid).length > 0) {
            return Responses._400({ messages: valid });
        }
        console.log(`Allocating ${parsed.familyId} to ${parsed.donorId}`);
        const familyData = await Dynamo.get(
            {
                "requestId": parsed.familyId,
            }, 
            familiesTableName
        ).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        if (!familyData.requestId) {
            return Responses._400({ messages: { 'unexpected': 'Family not found' } });
        }
        console.log('familyData', familyData);

        if (!remove && familyData?.allocatedTo && familyData.allocatedTo != "" && familyData.allocatedTo != "unallocated") {
            return Responses._400({ messages: { 'unexpected': 'This family has already been allocated to another donor.' } });
        }

        const donorData = await Dynamo.get(
            {
                "requestId": parsed.donorId,
            }, 
            donorsTableName
        ).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        if (!donorData.requestId) {
            return Responses._400({ messages: { 'unexpected': 'Donor not found' } });
        }
        console.log('donorData', donorData);

        familyData.allocatedTo = remove ? 'unallocated' : parsed.donorId;
        familyData.campaignRequestId = remove ? 'unallocated' : (parsed.campaignRequestId ? parsed.campaignRequestId : '');
        familyData.status = remove ? 'unallocated' : 'allocated-unconfirmed';
        
        console.log('familyData', familyData);
        await Dynamo.write(familyData, familiesTableName).catch(err => {
            console.log('error in dynamo write', err);
            return Responses._400({ messages: err });
        });

        const familyMemberQueryData = {
            'IndexName': 'familyRequest',
            'KeyConditionExpression': 'familyId = :familyId',
            'ExpressionAttributeValues': {
                ':familyId': parsed.familyId
            }
        };
        let familyMemberData = await Dynamo.query(familyMemberQueryData, familyMembersTableName).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });
        console.log('familyMemberData', familyMemberData);

        if (familyMemberData.length) {
            let batchData = [];
            for (const member of familyMemberData) {
                member.allocatedTo = remove ? 'unallocated' : parsed.donorId;
                member.campaignRequestId = remove ? 'unallocated' : (parsed.campaignRequestId ? parsed.campaignRequestId : '');
                member.status = remove ? 'unallocated' : 'allocated';
                batchData.push({
                    PutRequest: {
                        Item: member
                    }
                });
            }
            if (batchData.length) {
                console.log(`${batchData.length} family members to allocate`)
                const chunkSize = 25;
                for (let i = 0; i < batchData.length; i += chunkSize) {
                    const chunk = batchData.slice(i, i + chunkSize);

                    await Dynamo.batchWrite(chunk, familyMembersTableName).catch(err => {
                        console.log('error in dynamo write', err);
                        return Responses._400({ messages: err });
                    });
                }
            }
        } else {
            console.log('NO FAMILY MEMBERS FOUND!?', familyMemberData, familyMemberQueryData);
        }

        let donorCampaign = {};
        if (parsed.campaignRequestId) {
            donorCampaign = await Dynamo.get(
                {
                    "requestId": parsed.campaignRequestId,
                }, 
                campaignDonorsTableName
            ).catch(err => {
                console.log('error in dynamo query', err);
                return Responses._400({ messages: err });
            });
        } else {
            const queryCampaignDonorsData = {
                'IndexName': 'campaignDonorRequest',
                'KeyConditionExpression': 'campaignId = :campaignId AND donorId = :donorId',
                'ExpressionAttributeValues': {
                    ':campaignId': campaignId,
                    ':donorId': parsed.donorId
                }
            };
            const donorCampaignData = await Dynamo.query(queryCampaignDonorsData, campaignDonorsTableName).catch(err => {
                console.log('error in dynamo query', err);
                return Responses._400({ messages: { 'error': 'An unexpected error occurred. Please try again later' }});
            });
            if (donorCampaignData) {
                donorCampaign = donorCampaignData[0]
            }
        }
        const queryFamilyData = {
            'IndexName': 'allocatedToRequest',
            'KeyConditionExpression': 'allocatedTo = :donorId',
            'ExpressionAttributeValues': {
                ':donorId': parsed.donorId
            }
        };
        if (donorCampaign) {
            console.log(donorCampaign);
            const familiesData = await Dynamo.query(queryFamilyData, familiesTableName).catch(err => {
                console.log('error in dynamo query', err);
                return Responses._400({ messages: { 'error': 'An unexpected error occurred. Please try again later' }});
            });

            donorCampaign.allocatedFamilies = familiesData ? familiesData.length : 0;

            await Dynamo.write(donorCampaign, campaignDonorsTableName).catch(err => {
                console.log('error in dynamo write', err);
                return Responses._400({ messages: err });
            });
        }

        return Responses._200({ messages: { 'success': `Family allocated successful` } });
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};