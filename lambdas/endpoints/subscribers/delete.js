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
        
        const { subscriberId } = event.pathParameters;
        const donorsTableName = process.env.DONORS_TABLE;

        await Dynamo.delete(
            { "requestId": subscriberId }, 
            donorsTableName
        ).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        return Responses._200({ messages: { 'success': 'Subscriber deleted' }});
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};