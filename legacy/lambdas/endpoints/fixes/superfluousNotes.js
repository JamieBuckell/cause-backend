const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');

const AWS = require('aws-sdk');

exports.handler = async (event, context, cb) => {
    try {
        const familiesTableName = process.env.FAMILIES_TABLE;
        const campaignDonorsTableName = process.env.CAMPAIGN_DONORS_TABLE;
        const familyMembersTableName = process.env.FAMILY_MEMBERS_TABLE;

        const campaignId = '6fd91723-9316-4502-99cb-0fc6399aed86';

        const params = {"TableName": familyMembersTableName};
        let allFamilyMembers = await Dynamo.scan(params).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        if (!allFamilyMembers) {
            return Responses._400({ message: 'Failed to find family data' });
        }

        let batchData = [];
        for (const [i, fm] of allFamilyMembers.entries()) {
            if (fm?.additionalInfo) {
                const basicInfo = fm.additionalInfo.toLowerCase();
                if (basicInfo.indexOf("none")) {
                    console.log(fm.additionalInfo);
                }

                batchData.push({
                    PutRequest: {
                        Item: fm
                    }
                });
            }
        }

        const chunkSize = 25;
        for (let i = 0; i < batchData.length; i += chunkSize) {
            const chunk = batchData.slice(i, i + chunkSize);

            /* *
            await Dynamo.batchWrite(chunk, campaignDonorsTableName).catch(err => {
                console.log('error in dynamo write', err);
                return Responses._400({ messages: err });
            });
            /* */
        }

        return Responses._200({ messages: { 'success': 'Allocations Totals Updated Successfully' }});
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};