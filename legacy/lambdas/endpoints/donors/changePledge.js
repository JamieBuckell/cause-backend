const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');
const Notifications = require('../../common/Notifications');

const validations = [
    {
        key: 'details',
        required: true,
        errorMsg: 'Change details is required',
    },
];
exports.handler = async (event, context, cb) => {
    try {
        const { emailAddress } = event.pathParameters;
        const { v } = event.queryStringParameters;
        const envSalt = process.env.HASHING_SALT;

        const familiesTableName = process.env.FAMILIES_TABLE;
        const donorsTableName = process.env.DONORS_TABLE;
        const appURL = process.env.APP_URL;

        const parsed = event.donorId ? event : JSON.parse(event.body);
        
        const valid = await Functions.validateSubmission(parsed, validations);
        if (Object.keys(valid).length > 0) {
            return Responses._400({ messages: valid });
        }  

        const queryData = {
            'IndexName': 'donorRequest',
            'KeyConditionExpression': 'email = :email',
            'ExpressionAttributeValues': {
                ':email': emailAddress
            }
        };
        const res = await Dynamo.query(queryData, donorsTableName).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: { 'error': 'An unexpected error occurred. Please try again later' }});
        });
        if (res.length) {
            const existingDonor = res[0];
            /* */
            const donorManageLink = `${appURL}/donors/view/${existingDonor.requestId}`;
            const jsonParameters = {
                subject: 'CAUSE Foundation: Pledge Change Request',
                messageBody: `A donor has request a change to their hamper allocation:<br /><br /><strong>Donor:</strong> ${emailAddress}<br /><strong>Request:</strong><br />${parsed.details}<br /><br /><strong>Manage Donor: </strong><a href="${donorManageLink}">${donorManageLink}</a>`,
            };
            await Notifications.sendInternalEmail(jsonParameters);
            /* */

            return Responses._200({ messages: { 'success': 'Thank you, your request has been received.' }});
        } else {
            console.log(`Cannot find donor!`, emailAddress);
        }
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred. Please try again later' } })

    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred. Please try again later' } });
    }
};