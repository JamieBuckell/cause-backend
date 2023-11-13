const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');

const validations = [
    {
        key: 'hamperId',
        required: true,
        errorMsg: 'Hamper ID is required',
    },
];

exports.handler = async (event, context, cb) => {
    try {
        const familiesTableName = process.env.FAMILIES_TABLE;

        const parsed = event.nominatorId ? event : JSON.parse(event.body);
        
        const valid = await Functions.validateSubmission(parsed, validations);
        if (Object.keys(valid).length > 0) {
            return Responses._400({ messages: valid });
        }

        const queryData = {
            'IndexName': 'familyRequest',
            'KeyConditionExpression': 'reference = :reference',
            'ExpressionAttributeValues': {
                ':reference': parsed.hamperId
            }
        };
        let familyData = await Dynamo.query(queryData, familiesTableName).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        if (familyData && familyData[0]) {
            familyData = familyData[0];
            if (familyData?.reference && familyData.reference === parsed.hamperId) {
                return Responses._200({ success: true });
            }
        }
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });

    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};