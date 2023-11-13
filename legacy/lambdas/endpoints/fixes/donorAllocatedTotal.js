const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');

const AWS = require('aws-sdk');

exports.handler = async (event, context, cb) => {
    try {
        const familiesTableName = process.env.FAMILIES_TABLE;
        const campaignDonorsTableName = process.env.CAMPAIGN_DONORS_TABLE;

        const campaignId = '6fd91723-9316-4502-99cb-0fc6399aed86';

        const params = {"TableName": familiesTableName};
        let allFamilies = await Dynamo.scan(params).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

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

        if (!campaignDonors) {
            return Responses._400({ message: 'Failed to find campqign data' });
        }

        let batchData = [];
        for (const [i, c] of campaignDonors.entries()) {

            const currentAllocatedFamilies = c.allocatedFamilies ?? 0;
            const actuallyAllocated = allFamilies.filter(f => f.allocatedTo === c.donorId);

            if (actuallyAllocated) {
                if (actuallyAllocated.length !== currentAllocatedFamilies) {
                    console.log('Euston... We have a problem!', actuallyAllocated.length, currentAllocatedFamilies);
                    c.allocatedFamilies = actuallyAllocated.length;

                    batchData.push({
                        PutRequest: {
                            Item: c
                        }
                    });
                }
                // console.log(actuallyAllocated.length);
                // console.log(actuallyAllocated.length, currentAllocatedFamilies, c);
            }

            if (c?.allocatedFamilies && c.allocatedFamilies != c.numberOfFamilies) {
                console.log('Problem Number 2!', c.allocatedFamilies, c.numberOfFamilies, c.donorId);
            }
        }

        const chunkSize = 25;
        for (let i = 0; i < batchData.length; i += chunkSize) {
            const chunk = batchData.slice(i, i + chunkSize);

            await Dynamo.batchWrite(chunk, campaignDonorsTableName).catch(err => {
                console.log('error in dynamo write', err);
                return Responses._400({ messages: err });
            });
        }

        return Responses._200({ messages: { 'success': 'Allocations Totals Updated Successfully' }});
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};