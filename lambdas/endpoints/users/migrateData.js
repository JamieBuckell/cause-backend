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
        const nomTableName = process.env.NOMINATORS_TABLE;

        const userPoolId =  process.env.USER_POOL;
        const userPoolIdV2 =  process.env.USER_POOL_V2;
        const appURL = process.env.APP_URL;
        const tempPassword = 'hgK5Z*R6ChW4';

        const escapeRegEx = new RegExp(/(<([^>]+)>)/ig);

        const parsed = event.Username ? event : JSON.parse(event.body);

        if (!parsed) {
            return Responses._400({ message: 'Failed to read submitted data: '+JSON.stringify(parsed) });
        }

        const userEmail = event.requestContext.authorizer.claims.email.toLowerCase();

        const migrateUserOriginalEmail = parsed.Username.toString().replace(escapeRegEx, '');
        const migrateUserEmail = migrateUserOriginalEmail.toLowerCase();

        const queryNominatorData = {
            'IndexName': 'nominatorRequest',
            'KeyConditionExpression': 'emailAddress = :emailAddress',
            'ExpressionAttributeValues': {
                ':emailAddress': migrateUserEmail
            }
        };
        const migrateNominatorData = await Dynamo.query(queryNominatorData, nomTableName).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        if (
            !Functions.hasPermission(event, 'Admin') || 
            (userEmail !== migrateUserEmail)
        ) {
            if (!migrateNominatorData.length) {
                return Responses._400({ messages: { 'error': 'Unable to find nominator!' } });
            }
        }

        let nominator;
        if (migrateNominatorData.length) {
            nominator = migrateNominatorData[0];
        }

        let validName = event.requestContext.authorizer.claims.name;
        if (nominator?.requestId) {
            validName = `${nominator.firstName} ${nominator.lastName}`;
        }

        console.log(validName);

        /* */

        if (!Functions.hasPermission(event, 'Admin')) {
            if (userEmail !== migrateUserEmail) {
                console.log(`${userEmail} is trying to migrate ${migrateUserOriginalEmail}`);
                return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
            }
        } else {
            console.log(`${userEmail} is migrating ${migrateUserOriginalEmail}`);
        }

        // Check the user exists in the old pool
        const cognitoCheckParams = {
            UserPoolId: userPoolId,
            AttributesToGet: [ "email"],
            Limit: 25,
            Filter: 'username="'+migrateUserOriginalEmail+'"'
        }
        const cognitoCheck = await cognito.listUsers(cognitoCheckParams).promise();
        if (!cognitoCheck?.Users.length) {
            console.log(`Cannot find ${migrateUserOriginalEmail}`);
            return Responses._400({ messages: { 'error': 'User not found' } });
        }
        const cognitoUser = cognitoCheck.Users[0];
        console.log(cognitoUser);
        console.log(cognitoUser?.Attributes);

        // Check if the email exists in the new pool
        const cognitoCheckParamsV2 = {
            UserPoolId: userPoolIdV2,
            AttributesToGet: [ "email"],
            Limit: 25,
            Filter: 'email="'+migrateUserEmail+'"'
        }
        const cognitoCheckV2 = await cognito.listUsers(cognitoCheckParamsV2).promise();
        if (cognitoCheckV2?.Users.length) {
            console.log(cognitoCheckV2);
            return Responses._400({ messages: { 'error': 'User already migrated' } });
        }

        const userPassword = !parsed?.Manual ? parsed.Password : Functions.generateP({length: 8});

        const cognitoParams = {
            MessageAction: 'SUPPRESS',
            UserPoolId: userPoolIdV2,
            Username: migrateUserEmail,
            UserAttributes: [{
                Name: "email",
                Value: migrateUserEmail,
            },
            {
                Name: 'email_verified',
                Value: 'true'
            },
            {
                Name: "name",
                Value: `${validName}`,
            },
            ],
            TemporaryPassword: tempPassword,
        };

        const congitoUser = await cognito.adminCreateUser(cognitoParams).promise();
        const cognitoId = congitoUser.User.Attributes.find(a => a.Name === 'sub').Value;

        // Update the nominator if that's who this is
        if (nominator?.requestId) {
            nominator.emailAddress = migrateUserEmail;
            nominator.cognitoIdv1 = nominator.cognitoId;
            nominator.cognitoId = cognitoId;
            await Dynamo.write(migrateNominatorData, nomTableName).catch(err => {
                console.log('error in dynamo write', err);
                return Responses._400({ messages: err });
            });
        }

        const passwordSetParams = {
            "Password": userPassword,
            "Permanent": parsed?.Manual ? false : true,
            "Username": migrateUserEmail,
            "UserPoolId": userPoolIdV2
        };
        await cognito.adminSetUserPassword(passwordSetParams).promise();

        let groupName;
        console.log(migrateNominatorData);
        if (nominator?.requestId) {
            groupName = nominator.isAdmin ? 'TeamLead' : 'Nominator';
        } else {
            groupName = Functions.hasPermission(event, 'Admin') ? 'Admin' : '';
        }

        if (groupName) {
            const cognitoGroupParams = {
                GroupName: groupName,
                UserPoolId: userPoolIdV2,
                Username: migrateUserEmail,
            }
            await cognito.adminAddUserToGroup(cognitoGroupParams).promise();
        } else {
            console.log(`${migrateUserEmail} has no group!`);
        }

        if (parsed?.Manual) {
            const validFirstname = validName.split(/\s+/)[0];
            const emailTemplateNominator = {
                appURL,
                nominator: {firstName: validFirstname, email: migrateUserEmail, password: userPassword},
            };
            const emailAccountTemplateParams = await Functions.getEmailTemplate('nominatorResetConfirmation', emailTemplateNominator);
            const jsonNominatorParameters = {
                ToAddresses: [migrateUserEmail],
                ...emailAccountTemplateParams,
            };
            await Notifications.sendTransactionalEmail(jsonNominatorParameters);
        }
        /* */

        return Responses._200({ messages: { 'success': 'Migration successful' }});
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};