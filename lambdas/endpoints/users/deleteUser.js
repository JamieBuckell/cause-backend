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
        if (
            !Functions.hasPermission(event, 'Admin') && 
            !Functions.hasPermission(event, 'TeamLead')
        ) {
            return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
        }
        
        const { organisationId, emailAddress } = event.pathParameters;
        const userEmail = event.requestContext.authorizer.claims.email;
        const nomTableName = process.env.NOMINATORS_TABLE;
        const familiesTableName = process.env.FAMILIES_TABLE;
        const familyMembersTableName = process.env.FAMILY_MEMBERS_TABLE;
        const userPoolId =  process.env.USER_POOL_V2;

        console.log(`${userEmail} is attempting to delete ${emailAddress} from org id: ${organisationId}`);

        if (userEmail == emailAddress) {
            return Responses._401({ messages: { 'error': 'You cannot delete yourself' } });
        }

        if (Functions.hasPermission(event, 'TeamLead')) {
            const leadQueryData = {
                'IndexName': 'nominatorOrganisationRequest',
                'KeyConditionExpression': 'emailAddress = :emailAddress AND organisationId = :organisationId',
                'ExpressionAttributeValues': {
                    ':emailAddress': userEmail,
                    ':organisationId': organisationId
                }
            };
            const leadData = await Dynamo.query(leadQueryData, nomTableName).catch(err => {
                console.log('error in dynamo query 1', err);
                return Responses._400({ messages: err });
            });

            if (!leadData.length) {
                console.log('Lead not found');
                return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
            }
        }

        const nomQueryData = {
            'IndexName': 'nominatorOrganisationRequest',
            'KeyConditionExpression': 'emailAddress = :emailAddress AND organisationId = :organisationId',
            'ExpressionAttributeValues': {
                ':emailAddress': emailAddress,
                ':organisationId': organisationId
            }
        };
        const nominatorData = await Dynamo.query(nomQueryData, nomTableName).catch(err => {
            console.log('error in dynamo query 1', err);
            return Responses._400({ messages: err });
        });

        // Delete the nominator if they exist...
        // Todo: also delete any data they have created!
        if (nominatorData[0]?.requestId) {
            await Dynamo.delete(
                { "requestId": nominatorData[0].requestId }, 
                nomTableName
            ).catch(err => {
                console.log('error in dynamo query 2', err, nominatorData[0].requestId);
                return Responses._400({ messages: err });
            });

            const nomFamilyQueryData = {
                'IndexName': 'nominatorRequest',
                'KeyConditionExpression': 'nominatorId = :nominatorId',
                'ExpressionAttributeValues': {
                    ':nominatorId': nominatorData[0]?.requestId
                }
            };
            const nomFamilyData = await Dynamo.query(nomFamilyQueryData, familiesTableName).catch(err => {
                console.log('error in dynamo query 3', err);
                console.log(nomFamilyQueryData, familiesTableName);
                return Responses._400({ messages: err });
            });

            if (nomFamilyData.length) {
                for (const family of nomFamilyData) {
                    await Dynamo.delete(
                        { "requestId": family.requestId }, 
                        familiesTableName
                    ).catch(err => {
                        console.log('error in dynamo query 4', err, family.requestId);
                        return Responses._400({ messages: err });
                    });
                }
            }
            const nomFamilyMembersQueryData = {
                'IndexName': 'nominatorRequest',
                'KeyConditionExpression': 'nominatorId = :nominatorId',
                'ExpressionAttributeValues': {
                    ':nominatorId': nominatorData[0]?.requestId
                }
            };
            const nomFamilyMembersData = await Dynamo.query(nomFamilyMembersQueryData, familyMembersTableName).catch(err => {
                console.log('error in dynamo query 5', err);
                console.log(nomFamilyMembersQueryData, familyMembersTableName);
                return Responses._400({ messages: err });
            });

            if (nomFamilyMembersData.length) {
                for (const familyMember of nomFamilyMembersData) {
                    await Dynamo.delete(
                        { "requestId": familyMember.requestId }, 
                        familyMembersTableName
                    ).catch(err => {
                        console.log('error in dynamo query 6', err, familyMember.requestId);
                        return Responses._400({ messages: err });
                    });
                }
            }
        } else {
            console.log(`Nominator not found: ${JSON.stringify(nominatorData)}`);
        }
        
        try {
            const existingCognitoUser = await cognito.adminGetUser({
                UserPoolId: userPoolId,
                Username: emailAddress
            }).promise();

            if (existingCognitoUser) {
                await cognito.adminDeleteUser({
                    UserPoolId: userPoolId,
                    Username: emailAddress
                }).promise();
            } else {
                console.log(`Cognito User not found: ${emailAddress}`);
            }
        } catch (e) {
            console.log(`Cognito Auth Error! - ${e}`);
            return Responses._200({ success: true });
        }

        return Responses._200({ success: true });
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};