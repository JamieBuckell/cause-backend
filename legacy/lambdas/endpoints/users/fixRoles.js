const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');

const AWS = require('aws-sdk');
const validations = [
    {
        key: 'nominatorId',
        required: true,
        errorMsg: 'Nominator is required',
    },
];

exports.handler = async (event, context, cb) => {
    try {
        if (!Functions.hasPermission(event, 'Admin')) {
            return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
        }

        const parsed = event.nominatorId ? event : JSON.parse(event.body);
        const valid = await Functions.validateSubmission(parsed, validations);
        if (Object.keys(valid).length > 0) {
            return Responses._400({ messages: valid });
        }

        const nomTableName = process.env.NOMINATORS_TABLE;
        const userPoolId =  process.env.USER_POOL;

        const nominatorParams = {"TableName": nomTableName};
        const allNominators = await Dynamo.scan(nominatorParams).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        if (!allNominators.length) {
            return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
        }

        for (const nominator of allNominators) {
            const validEmail = nominator.emailAddress;
        }

        return Responses._200({ messages: { 'success': 'Groups updated successfully' }});
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};