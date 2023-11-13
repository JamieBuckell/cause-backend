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
        const userPoolId =  process.env.USER_POOL_V2;
        const validEmail = 'lois_mallon@middlesbrough.gov.uk';
        const password = '82452772';

        const passwordSetParams = {
            "Password": password,
            "Permanent": false,
            "Username": validEmail,
            "UserPoolId": userPoolId
        };
        await cognito.adminSetUserPassword(passwordSetParams).promise();

        return Responses._200({ messages: { 'success': 'Groups updated successfully' }});
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};