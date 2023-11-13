const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');
const Notifications = require('../../common/Notifications');

const moment = require("moment-timezone");
exports.handler = async (event, context, cb) => {
    try {
        let { emailAddress } = event.pathParameters;
        const envSalt = process.env.HASHING_SALT;

        const donorsTableName = process.env.DONORS_TABLE;
        const campaignDonorsTableName = process.env.CAMPAIGN_DONORS_TABLE;

        const queryData = {
            'IndexName': 'donorRequest',
            'KeyConditionExpression': 'email = :email',
            'ExpressionAttributeValues': {
                ':email': emailAddress
            }
        };
        const res = await Dynamo.query(queryData, donorsTableName).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: { 'error': 'An unexpected error occurred. Please try again later' }});
        });
        if (res.length) {
            const existingDonor = res[0];

                    const timezone = process.env.TIMEZONE;
                    const dateFormat = process.env.DATE_FORMAT;
                    const timeStamp = moment((new Date()).getTime()).tz(timezone).format(dateFormat);

                    existingDonor.verified = true;
                    existingDonor.dateVerified = timeStamp;

                    const newRequest = await Dynamo.write(existingDonor, donorsTableName).catch(err => {
                        console.log('error in dynamo write', err);
                        return Responses._400({ messages: { 'error': 'An unexpected error occurred. Please try again later' }});
                    });

                    const queryCampaignDonorsData = {
                        'IndexName': 'donorRequest',
                        'KeyConditionExpression': 'donorId = :donorId',
                        'ExpressionAttributeValues': {
                            ':donorId': existingDonor.requestId
                        }
                    };
                    const donorCampaignData = await Dynamo.query(queryCampaignDonorsData, campaignDonorsTableName).catch(err => {
                        console.log('error in dynamo query', err);
                        return Responses._400({ messages: { 'error': 'An unexpected error occurred. Please try again later' }});
                    });

                    let familyCount = 0;
                    if (donorCampaignData.length) {
                        for (const [i, item] of donorCampaignData.entries()) {
                            familyCount += item.numberOfFamilies;

                        }
                    }

                    const emailTemplate = {
                        familyData: donorCampaignData,
                        familyCount, 
                        donorData: existingDonor, 
                    };
                    const emailTemplateParams = await Functions.getEmailTemplate('donorVerified', emailTemplate);
                    const jsonParameters = {
                        ToAddresses: [existingDonor.email],
                        ...emailTemplateParams,
                    };
                    await Notifications.sendTransactionalEmail(jsonParameters);

                    return Responses._200({ messages: { 'success': 'Your email address has successfully been verified' }});
        }
        return Responses._400({ messages: { 'error': 'There was an error verifying your email address ('+emailAddress+'), please try the link again or <a href="https://www.cause-foundation.org.uk/contact-us-i3">Contact Us</a> if the problem persists.' } })

    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred. Please try again later' } });
    }
};