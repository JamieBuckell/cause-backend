const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');
const Notifications = require('../../common/Notifications');

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
    }
];

exports.handler = async (event, context, cb) => {
    try {
        if (!Functions.hasPermission(event, 'Admin')) {
            return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
        }

        const requestId = context.awsRequestId; // Change this so that we are generating our own ID

        const parsed = event.email ? event : JSON.parse(event.body);
        const { organisationId } = event.pathParameters;
        const nomTableName = process.env.NOMINATORS_TABLE;
        
        if (!parsed) {
            return Responses._400({ message: 'Failed to read submitted data: '+JSON.stringify(parsed) });
        }

        const valid = await Functions.validateSubmission(parsed, validations);
        if (Object.keys(valid).length > 0) {
            return Responses._400({ messages: valid });
        }

        const orgTableName = process.env.ORGANISATIONS_TABLE;

        const organisationData = await Dynamo.get(
            {
                "requestId": organisationId,
            }, 
            orgTableName
        ).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        if (!organisationData.requestId) {
            return Responses._200({ message: 'Record not found', result: false});
        }
        const validOrganisationId = organisationData.requestId;

        const escapeRegEx = new RegExp(/(<([^>]+)>)/ig);

        // use replace for extra layer of security
        const validEmail = parsed.email.toString().replace(escapeRegEx, '').toLowerCase();
        const validFirstname = parsed.firstname.toString().replace(escapeRegEx, '');
        const validLastname = parsed.lastname.toString().replace(escapeRegEx, '');
        const validName = `${validFirstname} ${validLastname}`;
        const validPhone = parsed.telephone ? parsed.telephone.toString().replace(escapeRegEx, '') : '';
        const userInitials = Functions.getUsersUniqueReference(validName);
        let userReference = userInitials;

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
            return Responses._400({ messages: { "duplicate": "User already exists" }});
        }

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
            "emailSent": false,
            "status": "Approved",
            "isAdmin": 'true',
        }
        
        const newRequest = await Dynamo.write(requestData, nomTableName).catch(err => {
            console.log('error in dynamo write', err);
            return Responses._400({ messages: err });
        });

        if (!newRequest) {
            return Responses._400({ message: 'Failed to write db by ID' });
        }

        return Responses._200({ success: true, adminId: requestId });
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};