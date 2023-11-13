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
    },
    {
        key: 'company',
        required: false,
        pattern: new RegExp(/[a-zA-ZÀ-ÖØ-öø-ÿ.\-\s']{1,50}/i),
        errorMsg: 'Please enter a valid company name',
    },
];

exports.handler = async (event, context, cb) => {
    try {
        const websiteURL = process.env.WEBSITE_URL;
        const appURL = process.env.APP_URL;
        const campaignTableName = process.env.CAMPAIGNS_TABLE;
        const campaignDonorsTableName = process.env.CAMPAIGN_DONORS_TABLE;
        const donorsTableName = process.env.DONORS_TABLE;

        const envSalt = process.env.HASHING_SALT;
        const parsed = event.email ? event : JSON.parse(event.body);
        
        const campaignId = parsed.campaign ?? '6fd91723-9316-4502-99cb-0fc6399aed86'; // 2022 Campaign

        const currentCampaign = await Dynamo.get(
            {
                "requestId": campaignId,
            }, 
            campaignTableName
        ).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        if (!currentCampaign.requestId) {
            return Responses._400({ messages: { "notfound": "Campaign not found" }});
        }

        const valid = await Functions.validateSubmission(parsed, validations);
        if (Object.keys(valid).length > 0) {
            return Responses._400({ messages: valid });
        }

        const escapeRegEx = new RegExp(/(<([^>]+)>)/i);

        // use replace for extra layer of security
        const validFirstName = parsed.firstname.toString().replace(escapeRegEx, '');
        const validLastName = parsed.lastname.toString().replace(escapeRegEx, '');
        const validEmail = parsed.email.toString().replace(escapeRegEx, '');
        const validCompany = parsed.company ? parsed.company.toString().replace(escapeRegEx, '') : '';

        const timezone = process.env.TIMEZONE;
        const dateFormat = process.env.DATE_FORMAT;
        const timeStamp = moment((new Date()).getTime()).tz(timezone).format(dateFormat);

        const queryData = {
            'IndexName': 'donorRequest',
            'KeyConditionExpression': 'email = :email',
            'ExpressionAttributeValues': {
                ':email': validEmail
            }
        };
        const existingDonor = await Dynamo.query(queryData, donorsTableName).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        const requestId = existingDonor.length ? existingDonor[0].requestId : context.awsRequestId;
        var donorData = {};

        if (existingDonor.length) { 
            if (existingDonor[0].subscribed) {
                return Responses._400({ messages: { 'error': 'Email address is already subscribed' }});
            } else {
                donorData = existingDonor[0];
            }
        } else {
            donorData = {
                "requestId": requestId,
                "firstName": validFirstName,
                "lastName": validLastName,
                "email": validEmail,
                "company": validCompany,
                "telephone": "",
                "dateAdded": timeStamp,
                "dateUnsubcribed": "",
                "verified": false,
                "dateVerified": "",
            }
        }
        donorData.subscribed = true;
        donorData.dateSubcribed = timeStamp;
        
        const donorRequest = await Dynamo.write(donorData, donorsTableName).catch(err => {
            console.log('error in dynamo write', err);
            return Responses._400({ messages: err });
        });

        if (!donorRequest) {
            return Responses._400({ message: 'Failed to write db by ID' });
        }
        
        const donorHash = Hashing.hash(requestId, envSalt).hashedpassword;
        const emailTemplate = {
            websiteURL,
            appURL,
            emailAddress: validEmail, 
            donorHash,
        };
        const emailTemplateParams = await Functions.getEmailTemplate('donorRegister', emailTemplate);
        const jsonParameters = {
            ToAddresses: [validEmail],
            ...emailTemplateParams,
        };
        await Notifications.sendTransactionalEmail(jsonParameters);

        return Responses._200({ messages: { 'success': 'Registration successful' }, registrationId: requestId});
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};