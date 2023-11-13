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

        const { adminId } = event.pathParameters;
        const nomTableName = process.env.NOMINATORS_TABLE;
        const orgTableName = process.env.ORGANISATIONS_TABLE;
        const appURL = process.env.APP_URL;
        const userPoolId =  process.env.USER_POOL_V2;
        const envSalt = process.env.HASHING_SALT;
        
        const nominatorData = await Dynamo.get(
            {
                "requestId": adminId,
            }, 
            nomTableName
        ).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        if (!nominatorData.requestId) {
            return Responses._200({ message: 'Nominator not found', result: false});
        }

        if (nominatorData.emailSent) {
            return Responses._400({ message: 'Email has already been sent', result: false});
        }
        
        const organisationData = await Dynamo.get(
            {
                "requestId": nominatorData.organisationId,
            }, 
            orgTableName
        ).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        if (!organisationData.requestId) {
            return Responses._200({ message: 'Organisation not found', result: false});
        }

        const cognitoParams = {
            MessageAction: 'SUPPRESS',
            UserPoolId: userPoolId,
            Username: nominatorData.emailAddress,
            UserAttributes: [{
                Name: "email",
                Value: nominatorData.emailAddress,
            },
            {
                Name: "name",
                Value: `${nominatorData.firstName} ${nominatorData.lastName}`,
            },
            ],
            TemporaryPassword: Functions.generateP({length: 8}),
        };

        const congitoUser = await cognito.adminCreateUser(cognitoParams).promise();
        const cognitoId = congitoUser.User.Attributes.find(a => a.Name === 'sub').Value;

        const cognitoGroupParams = {
            GroupName: 'TeamLead',
            UserPoolId: userPoolId,
            Username: nominatorData.emailAddress,
        }
        await cognito.adminAddUserToGroup(cognitoGroupParams).promise();

        // Update user with cognitoId
        nominatorData.cognitoId = cognitoId;
        nominatorData.emailSent = true;
        await Dynamo.write(nominatorData, nomTableName).catch(err => {
            console.log('error in dynamo write', err);
            return Responses._400({ messages: err });
        });
        const urlHash = Hashing.hash(organisationData.hashedData, envSalt+organisationData.hashSalt).hashedpassword;
        const nominatorRegisterLink = `${appURL}/register/${organisationData.requestId}/${urlHash}`;

        const emailTemplate = {
            appURL,
            emailAddress: nominatorData.emailAddress,
            TemporaryPassword: cognitoParams.TemporaryPassword,
            nominatorRegisterLink,
        };
        const emailAccountTemplateParams = await Functions.getEmailTemplate('organisationAdminAccount', emailTemplate);
        const jsonAccountParameters = {
            ToAddresses: [nominatorData.emailAddress],
            ...emailAccountTemplateParams,
        };
        await Notifications.sendTransactionalEmail(jsonAccountParameters);

        const emailWelcomeTemplateParams = await Functions.getEmailTemplate('organisationAdminWelcome', emailTemplate);
        const jsonWelcomeParameters = {
            ToAddresses: [nominatorData.emailAddress],
            ...emailWelcomeTemplateParams,
        };
        await Notifications.sendTransactionalEmail(jsonWelcomeParameters);

        return Responses._200({ success: true });
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};