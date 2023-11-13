const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');
const Notifications = require('../../common/Notifications');

exports.handler = async (event, context, cb) => {
    try {
        const emailsSubscribersTableName = process.env.EMAILS_SUBSCRIBERS_TABLE;

        if (event?.Records) {
            let batchData = [];
            for (const r of event?.Records) {
                console.log(`Running mail sent message: ${r.body}`);

                if (r?.messageAttributes?.subscriberEmailData) {
                    const subscriberEmailData = JSON.parse(r.messageAttributes.subscriberEmailData.stringValue);

                    batchData.push({
                        PutRequest: {
                            Item: subscriberEmailData
                        }
                    });
                }
            }
                
            const chunkSize = 25;
            for (let i = 0; i < batchData.length; i += chunkSize) {
                const chunk = batchData.slice(i, i + chunkSize);

                await Dynamo.batchWrite(chunk, emailsSubscribersTableName).catch(err => {
                    console.log('error in dynamo write', err);
                    return Responses._400({ messages: err });
                });
            }
            return Responses._200({ messages: { 'success': 'Email Logging Complete' }});
        } else {
            console.log(`No records found`, event);
            return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
        }
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};