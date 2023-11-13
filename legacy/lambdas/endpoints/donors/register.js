const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');
const Notifications = require('../../common/Notifications');

var uuid = require('uuid');
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
        const parsed = event.emailAddress ? event : JSON.parse(event.body);
        
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
        const validEmail = parsed.email.toString().replace(escapeRegEx, '').toLowerCase();
        const validCompany = parsed.company ? parsed.company.toString().replace(escapeRegEx, '') : '';
        const validTelephone = parsed.telephone ? parsed.telephone.toString().replace(escapeRegEx, '') : '';
        const validFamilies = parsed.families ? parseInt(parsed.families.toString().replace(escapeRegEx, '')) : '';
        const validAdditionalInformation = parsed.additionalInformation ? parsed.additionalInformation.toString().replace(escapeRegEx, '') : '';
        const validHowHeard = parsed.howHeard ? parsed.howHeard.toString().replace(escapeRegEx, '') : 'Not Specified';
        const validHowHeardOther = parsed.howHeardOther ? parsed.howHeardOther.toString().replace(escapeRegEx, '') : '';

        console.log(`Donor Registration: ${validEmail}`);

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
        let isSubscribed = parsed.marketing ?? false;

        let registerTemplateEmail = 'donorRegister';
        let donorData = {};
        if (existingDonor.length) {
            registerTemplateEmail = 'donorRegisterSubsequent'
            donorData = existingDonor[0];
            if (donorData.subscribed && !isSubscribed) {
                donorData.subscribed = donorData.subscribed ;
            }
            if (!donorData.dateSubscribed && isSubscribed) {
                donorData.dateSubscribed = timeStamp;
            }
            if (!donorData.dateAdded) {
                donorData.dateAdded = timeStamp;
            }
        } else {        
            donorData = {
                "requestId": requestId,
                "firstName": validFirstName,
                "lastName": validLastName,
                "email": validEmail,
                "company": validCompany,
                "telephone": validTelephone,
                "dateAdded": timeStamp,
                "subscribed": isSubscribed,
                "dateSubscribed": isSubscribed ? timeStamp : '',
                "howHeard": validHowHeard === 'other' ? validHowHeardOther : validHowHeard,
                "dateUnsubcribed": "",
                "verified": false,
                "dateVerified": "",
            }
        }
        
        const donorRequest = await Dynamo.write(donorData, donorsTableName).catch(err => {
            console.log('error in dynamo write', err);
            return Responses._400({ messages: err });
        });

        if (!donorRequest) {
            return Responses._400({ message: 'Failed to write db by ID' });
        }
        
        const campaignData = {
            "requestId": uuid.v4(),
            "donorId": requestId,
            "campaignId": campaignId,
            "numberOfFamilies": validFamilies,
            "allocatedFamilies": 0,
            "additionalInfo": validAdditionalInformation,
            "familyDetail": JSON.stringify(parsed.familyDetail),
        }
        
        const campaignRequest = await Dynamo.write(campaignData, campaignDonorsTableName).catch(err => {
            console.log('error in dynamo write', err);
            return Responses._400({ messages: err });
        });

        const donorHash = Hashing.hash(requestId, envSalt).hashedpassword;
        const emailTemplate = {
            websiteURL,
            appURL,
            emailAddress: validEmail, 
            donorHash,
            donorData: donorData,
            familyCount: validFamilies,
            familyData: campaignData,
        };
        const emailTemplateParams = await Functions.getEmailTemplate(registerTemplateEmail, emailTemplate);
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