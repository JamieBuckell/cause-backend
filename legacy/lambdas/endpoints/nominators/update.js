const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
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
            !Functions.hasPermission(event, 'TeamLead') &&
            !Functions.hasPermission(event, 'Nominator')
        ) {
            return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
        }

        const parsed = event?.requestId ? event : JSON.parse(event.body);
        if (!parsed?.requestId) {
            console.log(`An unexpected error occurred`, parsed);
            return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
        }
        const requestId = parsed.requestId;

        const userEmail = event.requestContext.authorizer.claims.email;

        const userPoolId =  process.env.USER_POOL_V2;
        const nomTableName = process.env.NOMINATORS_TABLE;
        const appURL = process.env.APP_URL;

        var nominatorData = {};

        if (
            Functions.hasPermission(event, 'TeamLead') ||
            Functions.hasPermission(event, 'Nominator')
        ) {
            const queryUserData = {
                'IndexName': 'nominatorRequest',
                'KeyConditionExpression': 'emailAddress = :emailAddress',
                'ExpressionAttributeValues': {
                    ':emailAddress': userEmail
                }
            };
            const userNominatorQuery = await Dynamo.query(queryUserData, nomTableName).catch(err => {
                console.log('error in dynamo query', err);
                return Responses._400({ messages: err });
            });

            if (!userNominatorQuery.length) {
                console.log('Updating user not found...');
                return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
            }
            userNominatorData = userNominatorQuery[0];

            if (requestId == userNominatorData.requestId) {
                nominatorData = userNominatorData;
            } else {
                const queryData = {
                    'IndexName': 'nominatorRequest',
                    'KeyConditionExpression': 'emailAddress = :emailAddress',
                    'ExpressionAttributeValues': {
                        ':emailAddress': parsed?.originalEmail ? parsed.originalEmail : 'unknown'
                    }
                };
                const nominatorQuery = await Dynamo.query(queryData, nomTableName).catch(err => {
                    console.log('error in dynamo query', err);
                    return Responses._400({ messages: err });
                });

                if (
                    !nominatorQuery.length || 
                    nominatorQuery[0].requestId != requestId ||
                    nominatorQuery[0].organisationId != userNominatorData.organisationId
                ) {
                    console.log('Unauth...', nominatorQuery, requestId, userNominatorData.organisationId);
                    return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section 2' } });
                }
                nominatorData = nominatorQuery[0];
            }
        } else {
            nominatorData = await Dynamo.get(
                {
                    "requestId": requestId,
                }, 
                nomTableName
            ).catch(err => {
                console.log('error in dynamo query', err);
                return Responses._400({ messages: err });
            });

            if (!nominatorData.requestId) {
                return Responses._200({ message: 'Record not found', result: false});
            }
        }

        if (
            parsed?.status && 
            parsed.status != nominatorData.status && 
            parsed.status === 'authorised'
        ) {
            const cognitoParams = {
                UserPoolId: userPoolId,
                Username: nominatorData.emailAddress,
                UserAttributes: [{
                    Name: "email",
                    Value: nominatorData.emailAddress,
                },
                {
                    Name: "name",
                    Value: `${nominatorData.fullName}`,
                },
                ],
                TemporaryPassword: Functions.generateP({length: 8}),
            };

            let response = await cognito.adminCreateUser(cognitoParams).promise();
        }

        const updateData = {
            ...nominatorData,
            ...parsed
        };

        if (updateData.originalEmail) {
            if (updateData.originalEmail != updateData.emailAddress) {
                console.log(`Email address changed from ${updateData.originalEmail} to  ${updateData.emailAddress}`);
                let existingCognitoUser = {};
                let doDelete = false;
                try {
                    existingCognitoUser = await cognito.adminGetUser({
                        UserPoolId: userPoolId,
                        Username: updateData.originalEmail
                    }).promise();

                    if (!existingCognitoUser) {
                        console.log(`Cognito User not found: ${updateData.originalEmail}`);
                    } else {
                        doDelete = true;
                    }                    
                } catch (e) {
                    switch (e.code) {
                    case 'UserNotFoundException':
                        break;
                    default:
                        console.log(`Cognito User Check Error! - ${e}`);
                        break;
                    }
                }

                let doCreate = true;
                try {                    
                    existingCognitoUser = await cognito.adminGetUser({
                        UserPoolId: userPoolId,
                        Username: updateData.emailAddress
                    }).promise();

                    if (existingCognitoUser) {
                        console.log(`New email address in use: ${updateData.emailAddress}`);
                        return Responses._400({ messages: { "duplicate": "New email address already in use" }});
                    } else {
                        doCreate = true;
                    }
                } catch (e) {
                    switch (e.code) {
                    case 'UserNotFoundException':
                        break;
                    default:
                        console.log(`Cognito User Check Error! - ${e}`);
                        break;
                    }
                }

                // Do Delete
                if (doDelete) {
                    console.log('Original cognito user deleted');
                    await cognito.adminDeleteUser({
                        UserPoolId: userPoolId,
                        Username: updateData.originalEmail
                    }).promise();
                }

                // Do Create
                if (doCreate) {
                    console.log('New cognito user added');
                    const validName = `${updateData.firstName} ${updateData.lastName}`;

                    const cognitoParams = {
                        MessageAction: 'SUPPRESS',
                        UserPoolId: userPoolId,
                        Username: updateData.emailAddress,
                        UserAttributes: [{
                            Name: "email",
                            Value: updateData.emailAddress,
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
                        TemporaryPassword: Functions.generateP({length: 8}),
                    };

                    const congitoUser = await cognito.adminCreateUser(cognitoParams).promise();
                    updateData.cognitoId = congitoUser.User.Attributes.find(a => a.Name === 'sub').Value;

                    const cognitoGroupParams = {
                        GroupName: updateData.isAdmin ? 'TeamLead' : 'Nominator',
                        UserPoolId: userPoolId,
                        Username: updateData.emailAddress,
                    }
                    await cognito.adminAddUserToGroup(cognitoGroupParams).promise();
                    
                    const emailTemplateNominator = {
                        appURL,
                        nominator: {firstName: updateData.firstName, email: updateData.emailAddress, password: cognitoParams.TemporaryPassword},
                    };
                    const emailAccountTemplateParams = await Functions.getEmailTemplate('newNominatorConfirmation', emailTemplateNominator);
                    const jsonNominatorParameters = {
                        ToAddresses: [updateData.emailAddress],
                        ...emailAccountTemplateParams,
                    };
                    await Notifications.sendTransactionalEmail(jsonNominatorParameters);            
                }
            }

            delete updateData.originalEmail;
        }
        
        if (updateData.fullName) {
            delete updateData.fullName;
        }

        console.log('Update nominator data');
        await Dynamo.write(updateData, nomTableName).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        return Responses._200({ success: true, nominator: updateData });
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};