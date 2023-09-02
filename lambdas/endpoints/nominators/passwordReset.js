const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');
const Notifications = require('../../common/Notifications');

const AWS = require('aws-sdk');
AWS.config.update({region: 'eu-west-2'});
const cognito = new AWS.CognitoIdentityServiceProvider({
    apiVersion: "2016-04-18",
});

exports.handler = async (event, context, cb) => {
    try {
        if (!Functions.hasPermission(event, 'Admin')) {
            return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
        }

        const { nominatorId } = event.pathParameters;
        const nomTableName = process.env.NOMINATORS_TABLE;
        const appURL = process.env.APP_URL;
        const userPoolId =  process.env.USER_POOL_V2;
        
        const nominatorData = await Dynamo.get(
            {
                "requestId": nominatorId,
            }, 
            nomTableName
        ).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        if (!nominatorData.requestId) {
            return Responses._400({ message: 'Nominator not found', result: false});
        }
        if (!nominatorData.cognitoId) {
            return Responses._400({ messages: { 'error': 'User does not have a full user account.' } });
        }
        
        const cognitoCheckParams = {
            UserPoolId: userPoolId,
            AttributesToGet: [ "email"],
            Limit: 25,
            Filter: 'email="'+nominatorData.emailAddress+'"'
        }
        const cognitoCheck = await cognito.listUsers(cognitoCheckParams).promise();
        if (!cognitoCheck?.Users.length) {
            console.log(`Cannot find ${nominatorData.emailAddress}`, nominatorData);
            return Responses._400({ messages: { 'error': 'User not found' } });
        }
        const congitoUser = cognitoCheck.USers[0];
        const cognitoId = congitoUser.User.Attributes.find(a => a.Name === 'sub').Value;

        const userPassword = Functions.generateP({length: 8});
        const passwordSetParams = {
            "Password": userPassword,
            "Permanent": false,
            "Username": cognitoId,
            "UserPoolId": userPoolId
        };
        await cognito.adminSetUserPassword(passwordSetParams).promise();
        if (cognitoId != nominatorData.cognitoId) {
            console.log(`Updating Cognito ID from ${nominatorData.cognitoId} to ${cognitoId}`);
            nominatorData.cognitoId = cognitoId;
            await Dynamo.write(nominatorData, nomTableName).catch(err => {
                console.log('error in dynamo write', err);
                return Responses._400({ messages: err });
            });
        }

        const emailTemplateNominator = {
            appURL,
            nominator: {firstName: nominatorData.firstName, email: nominatorData.emailAddress, password: userPassword},
        };
        const emailAccountTemplateParams = await Functions.getEmailTemplate('nominatorResetConfirmation', emailTemplateNominator);
        const jsonNominatorParameters = {
            ToAddresses: [nominatorData.emailAddress],
            ...emailAccountTemplateParams,
        };
        await Notifications.sendTransactionalEmail(jsonNominatorParameters);

        return Responses._200({ success: true });
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};