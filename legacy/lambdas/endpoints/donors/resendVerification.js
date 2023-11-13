const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');
const Notifications = require('../../common/Notifications')

const validations = [
    {
        key: 'donorId',
        required: true,
        errorMsg: 'Donor is required',
    }
];

exports.handler = async (event, context, cb) => {
    try {
        if (!Functions.hasPermission(event, 'Admin')) {
            return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
        }
        
        const envSalt = process.env.HASHING_SALT;
        const websiteURL = process.env.WEBSITE_URL;
        const appURL = process.env.APP_URL;
        const donorsTableName = process.env.DONORS_TABLE;

        const parsed = event.donorId ? event : JSON.parse(event.body);
        
        const valid = await Functions.validateSubmission(parsed, validations);
        if (Object.keys(valid).length > 0) {
            return Responses._400({ messages: valid });
        }
        
        const donorData = await Dynamo.get(
            {
                "requestId": parsed.donorId,
            }, 
            donorsTableName
        ).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });
        if (!donorData.requestId) {
          return Responses._400({ messages: { 'error': 'Donor not found' } });
        }

        console.log(donorData);

        donorData.bounced = false;
        donorData.bouncedDetail = "";
        donorData.verified = false;

        await Dynamo.write(donorData, donorsTableName).catch(err => {
            console.log('error in dynamo write', err);
            return Responses._400({ messages: err });
        });
        const donorHash = Hashing.hash(donorData.requestId, envSalt).hashedpassword;

        const emailTemplate = {
            websiteURL,
            appURL,
            emailAddress: donorData.email, 
            donorHash,
        };
        const emailTemplateParams = await Functions.getEmailTemplate('donorRegister', emailTemplate);
        const jsonParameters = {
            ToAddresses: [donorData.email],
            ...emailTemplateParams,
        };
        await Notifications.sendTransactionalEmail(jsonParameters);

        return Responses._200({ messages: { 'success': 'Email successfully updated' } });
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};