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

const moment = require("moment-timezone");
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
    },
    {
        key: 'telephone',
        required: true,
        pattern: new RegExp(/[0-9+()\-\s]{8,30}/),
        errorMsg: 'Please enter a valid telephone number',
    },
    {
        key: 'organisationId',
        required: true,
        errorMsg: 'Organisation ID is invalid',
    },
];

exports.handler = async (event, context, cb) => {
    try {
        const requestId = context.awsRequestId; // Change this so that we are generating our own ID
        const orgTableName = process.env.ORGANISATIONS_TABLE;
        const nomTableName = process.env.NOMINATORS_TABLE;
        const appURL = process.env.APP_URL;

        const userPoolId =  process.env.USER_POOL_V2;

        const envSalt = process.env.HASHING_SALT;
        const parsed = event.emailAddress ? event : JSON.parse(event.body);
        
        const organisationData = await Dynamo.get(
            {
                "requestId": parsed.organisationId,
            }, 
            orgTableName
        ).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });
        if (parsed.email) {
            console.log(`${parsed.email} is attempting to register to ${parsed.organisationId}`);
        }
        
        const hashCompare = Hashing.compare(organisationData.hashedData, {salt: envSalt+organisationData.hashSalt, hashedpassword: parsed.hashPassword})

        if (hashCompare) {
            const valid = await Functions.validateSubmission(parsed, validations);
            if (Object.keys(valid).length > 0) {
                return Responses._400({ messages: valid });
            }

            const escapeRegEx = new RegExp(/(<([^>]+)>)/ig);

            // use replace for extra layer of security
            const validFirstname = parsed.firstname.toString().replace(escapeRegEx, '');
            const validLastname = parsed.lastname.toString().replace(escapeRegEx, '');
            const validName = `${validFirstname} ${validLastname}`;
            const validEmail = parsed.email.toString().replace(escapeRegEx, '').toLowerCase();
            const validPhone = parsed.telephone.toString().replace(escapeRegEx, '');

            const validOrganisationId = organisationData.requestId;
            const validCompany = organisationData.name;

            const queryData = {
                'IndexName': 'nominatorOrganisationRequest',
                'KeyConditionExpression': 'emailAddress = :emailAddress AND organisationId = :organisationId',
                'ExpressionAttributeValues': {
                    ':emailAddress': validEmail,
                    ':organisationId': validOrganisationId
                }
            };
            const existingUser = await Dynamo.query(queryData, nomTableName).catch(err => {
                console.log('error in dynamo query', err);
                return Responses._400({ messages: err });
            });

            if (existingUser.length) {
                console.log('Email address in use - dynamo');
                return Responses._400({ messages: { "duplicate": `Email address already in use. <a class="text-primary" href="/reset-password"><strong>Click here</strong></a> to reset your password` }});
            }

            try {
                const existingCognitoUser = await cognito.adminGetUser({
                    UserPoolId: userPoolId,
                    Username: validEmail
                }).promise();

                if (existingCognitoUser) {
                    console.log('Email address in use - cognito');
                    return Responses._400({ messages: { "duplicate": "Email address already in use" }});
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

            const userInitials = Functions.getUsersUniqueReference(validName);
            let userReference = userInitials;

            const referenceQueryData = {
                'IndexName': 'referenceSearch',
                'KeyConditionExpression': 'userInitials = :userInitials AND organisationId = :organisationId',
                'ExpressionAttributeValues': {
                    ':userInitials': userReference,
                    ':organisationId': validOrganisationId
                }
            };
            const existingReference = await Dynamo.query(referenceQueryData, nomTableName).catch(err => {
                console.log('error in dynamo query', err);
                return Responses._400({ messages: err });
            });
            if (existingReference.length > 0) {
                console.log(referenceQueryData);
                console.log(existingReference);
                console.log(existingReference.length);
                const userCount = existingReference.length + 1;
                userReference = `${userReference}${Functions.numToSSColumn(userCount)}`;
            }

            const timezone = process.env.TIMEZONE;
            const dateFormat = process.env.DATE_FORMAT;
            const timeStamp = moment((new Date()).getTime()).tz(timezone).format(dateFormat);
            const requestData = {
                "requestId": requestId,
                "cognitoId": "",
                "firstName": validFirstname,
                "lastName": validLastname,
                "emailAddress": validEmail,
                "telephoneNumber": validPhone,
                "organisationId": validOrganisationId,
                "userInitials": userInitials,
                "userReference": userReference,
                "dateSubmitted": timeStamp,
                "emailSent": true,
                "status": "",
            }
            
            const newRequest = await Dynamo.write(requestData, nomTableName).catch(err => {
                console.log('error in dynamo write', err);
                return Responses._400({ messages: err });
            });

            if (!newRequest) {
                console.log('Failed to write db by ID');
                return Responses._400({ message: 'Failed to write db by ID' });
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

            const congitoUser = await cognito.adminCreateUser(cognitoParams).promise();
            const cognitoId = congitoUser.User.Attributes.find(a => a.Name === 'sub').Value;

            const cognitoGroupParams = {
                GroupName: 'Nominator',
                UserPoolId: userPoolId,
                Username: validEmail,
            }
            await cognito.adminAddUserToGroup(cognitoGroupParams).promise();

            // Update user with cognitoId
            requestData.cognitoId = cognitoId;
            await Dynamo.write(requestData, nomTableName).catch(err => {
                console.log('error in dynamo write', err);
                return Responses._400({ messages: err });
            });

            const queryAdminData = {
                'IndexName': 'adminsRequest',
                'KeyConditionExpression': 'organisationId = :organisationId AND isAdmin = :isAdmin',
                'ExpressionAttributeValues': {
                    ':organisationId': validOrganisationId,
                    ':isAdmin': 'true',
                }
            };
            const orgAdmins = await Dynamo.query(queryAdminData, nomTableName).catch(err => {
                console.log('error in dynamo query', err);
                return Responses._400({ messages: err });
            });

            if (orgAdmins.length) {
                for (const admin of orgAdmins) {
                    const emailTemplateAdmin = {
                        appURL,
                        nominator: {name: validName, email: validEmail},
                        companyName: validCompany,
                    };
                    const AdminTemplateParams = await Functions.getEmailTemplate('adminNewNominator', emailTemplateAdmin);
                    const jsonAdminParameters = {
                        ToAddresses: [admin.emailAddress],
                        ...AdminTemplateParams,
                    };
                    await Notifications.sendTransactionalEmail(jsonAdminParameters);
                }
            }

            const emailTemplateNominator = {
                appURL,
                nominator: {firstName: validFirstname, email: validEmail, password: cognitoParams.TemporaryPassword},
            };
            const emailAccountTemplateParams = await Functions.getEmailTemplate('newNominatorConfirmation', emailTemplateNominator);
            const jsonNominatorParameters = {
                ToAddresses: [validEmail],
                ...emailAccountTemplateParams,
            };
            await Notifications.sendTransactionalEmail(jsonNominatorParameters);
            
            return Responses._200({ messages: { 'success': 'Registration successful' }, registrationId: requestId});
        } else {
            return Responses._400({ message: { 'notfound': 'Invalid organisation' } });
        } 
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};