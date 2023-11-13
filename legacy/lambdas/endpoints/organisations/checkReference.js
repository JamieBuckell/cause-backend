const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');

exports.handler = async (event, context, cb) => {
    try {
        const { reference } = event.pathParameters;
        const tableName = process.env.ORGANISATIONS_TABLE;

        const envSalt = process.env.HASHING_SALT;

        let referenceValid = false;
        let newReference = reference;
        let iterator = 1;
        while (referenceValid === false) {
            const params = {
                "TableName": tableName,
                "FilterExpression": "#org_ref = :reference",
                "ExpressionAttributeValues": {":reference": newReference},
                "ExpressionAttributeNames": {
                    "#org_ref": "reference"
                }
            };
            const referenceData = await Dynamo.scan(params).catch(err => {
                console.log('error in dynamo query', err);
                return Responses._400({ messages: err });
            });
            if (!referenceData.length) {
                referenceValid = true;
            } else {
                newReference = `${reference}${iterator}`;
                iterator++;
            }
        }

        return Responses._200({ reference: newReference });
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};