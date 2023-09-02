const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');

const AWS = require('aws-sdk');
const cognito = new AWS.CognitoIdentityServiceProvider({
    apiVersion: "2016-04-18",
});

var uuid = require('uuid');

exports.handler = async (event, context, cb) => {
    try {
        const restoreFrom = 'cause-campaign-donors-live-restored';
        const restoreTo = process.env.CAMPAIGN_DONORS_TABLE;
        
        const pledgeParams = {"TableName": restoreFrom};
        const oldPledges = await Dynamo.scan(pledgeParams).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        const batchData = [];
        if (oldPledges && oldPledges.length) {
            console.log('Pledges to restore', oldPledges.length)
            for (const [i, pledge] of oldPledges.entries()) {
                pledge.requestId = uuid.v4();
                batchData.push({
                    PutRequest: {
                        Item: pledge
                    }
                });
            }
        }

        if (batchData && batchData.length) {
            const chunkSize = 25;
            for (let i = 0; i < batchData.length; i += chunkSize) {
                const chunk = batchData.slice(i, i + chunkSize);

                await Dynamo.batchWrite(chunk, restoreTo).catch(err => {
                    console.log('error in dynamo write', err);
                    return Responses._400({ messages: err });
                });
            }
        }

        return Responses._200({ messages: { 'success': 'Pledges restored successfully' }});
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};