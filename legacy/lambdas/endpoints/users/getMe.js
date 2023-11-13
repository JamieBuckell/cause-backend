const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');

const AWS = require('aws-sdk');
const cognito = new AWS.CognitoIdentityServiceProvider({
    apiVersion: "2016-04-18",
});

exports.handler = async (event, context, cb) => {
    try {
        const nomTableName = process.env.NOMINATORS_TABLE;

        const userEmail = event.requestContext.authorizer.claims.email.toLowerCase();
        console.log(`Email ${userEmail} has been authorized`);

        const meResponse = {
            email: userEmail
        };

        const queryData = {
            'IndexName': 'nominatorRequest',
            'KeyConditionExpression': 'emailAddress = :emailAddress',
            'ExpressionAttributeValues': {
                ':emailAddress': userEmail
            }
        };
        const nominatorData = await Dynamo.query(queryData, nomTableName).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });
        if (nominatorData.length) {
            meResponse.nominator = nominatorData[0];
        }

        return Responses._200(meResponse);
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};