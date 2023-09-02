const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Functions = require('../../common/Functions');

const AWS = require('aws-sdk');
const SES = new AWS.SES();

exports.handler = async (event, context, cb) => {
    try {
        const { requestId } = event.pathParameters;
        const nomTableName = process.env.NOMINATORS_TABLE;

        const nominatorData = await Dynamo.get(
            {
                "requestId": requestId,
            }, 
            nomTableName
        ).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        if (!nominatorData) {
            return Responses._400({ message: 'Failed to retrieve db by ID' });
        }

        return Responses._200({ ...nominatorData });
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};