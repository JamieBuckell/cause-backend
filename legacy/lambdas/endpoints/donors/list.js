const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');
const Notifications = require('../../common/Notifications')

exports.handler = async (event, context, cb) => {
    try {
        if (!Functions.hasPermission(event, 'Admin')) {
            return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
        }
        
        const requestId = context.awsRequestId; // Change this so that we are generating our own ID

        const parsed = event.emailAddress ? event : JSON.parse(event.body);

        const tableName = process.env.DONORS_TABLE;

        const params = {"TableName": tableName};
        const donorsData = await Dynamo.scan(params).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        if (!donorsData) {
            return Responses._400({ message: 'Failed to retrieve all via scan' });
        }

        return Responses._200({ ...donorsData });
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};