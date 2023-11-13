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

const validations = [
    {
        key: 'firstname',
        required: true,
        pattern: new RegExp(/[a-zA-ZÀ-ÖØ-öø-ÿ.\-\s']{1,50}/i),
        errorMsg: 'Please enter a valid first name',
    },
    {
        key: 'lastname',
        required: true,
        pattern: new RegExp(/[a-zA-ZÀ-ÖØ-öø-ÿ.\-\s']{1,50}/i),
        errorMsg: 'Please enter a valid last name',
    },
    {
        key: 'email',
        required: true,
    }
];

exports.handler = async (event, context, cb) => {
    try {
        if (!Functions.hasPermission(event, 'Admin')) {
            return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
        }

        const parsed = event.email ? event : JSON.parse(event.body);
        const userPoolId =  process.env.USER_POOL_V2;

        if (!parsed) {
            return Responses._400({ message: 'Failed to read submitted data: '+JSON.stringify(parsed) });
        }

        const valid = await Functions.validateSubmission(parsed, validations);
        if (Object.keys(valid).length > 0) {
            return Responses._400({ messages: valid });
        }
    
        const escapeRegEx = new RegExp(/(<([^>]+)>)/ig);

        // use replace for extra layer of security
        const validEmail = parsed.email.toString().replace(escapeRegEx, '');
        const validFirstname = parsed.firstname.toString().replace(escapeRegEx, '');
        const validLastname = parsed.lastname.toString().replace(escapeRegEx, '');
        const validName = `${validFirstname} ${validLastname}`;
        
        /* */
        const cognitoCheckParams = {
            UserPoolId: userPoolId,
            AttributesToGet: [ "email"],
            Limit: 25,
            Filter: 'username="'+validEmail+'"'
        }
        const cognitoCheck = await cognito.listUsers(cognitoCheckParams).promise();
        if (cognitoCheck?.Users.length) {
            return Responses._400({ messages: { 'error': 'User already exists with that email address' } });
        }
            
        const cognitoParams = {
            MessageAction: 'SUPPRESS',
            UserPoolId: userPoolId,
            Username: validEmail,
            UserAttributes: [{
                Name: "email",
                Value: validEmail,
            },
            {
                Name: "name",
                Value: `${validName}`,
            },
            ],
            TemporaryPassword: Functions.generateP({length: 8}),
        };

        await cognito.adminCreateUser(cognitoParams).promise();

        const cognitoGroupParams = {
            GroupName: 'Admin',
            UserPoolId: userPoolId,
            Username: validEmail,
        }
        await cognito.adminAddUserToGroup(cognitoGroupParams).promise();

        /* */
        const jsonParameters = {
            ToAddresses: [validEmail],
            subject: "Welcome to the CAUSE Foundation system",
            pageContent: `
            You have been added as an admin on the new CAUSE Foundation portal.
            <br /><br />
            To log in you'll need to use the following password: <strong>${cognitoParams.TemporaryPassword}</strong>
            <br /><br />
            For security reasons, once you're logged in you will be asked to change your password.
            <br /><br />
            <a href="${process.env.APP_URL}">${process.env.APP_URL}</a>
            <br /><br />
            Cause Foundation Team`
        };
        // send the email using new validated params
        await Notifications.sendTransactionalEmail(jsonParameters);

        return Responses._200({ success: true });
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};