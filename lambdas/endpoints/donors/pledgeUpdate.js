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
    },
    {
        key: 'campaignId',
        required: true,
        errorMsg: 'Campaign is required',
    },
];

exports.handler = async (event, context, cb) => {
    try {
        if (!Functions.hasPermission(event, 'Admin')) {
            return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
        }
        
        const requestId = context.awsRequestId; // Change this so that we are generating our own ID

        const envSalt = process.env.HASHING_SALT;
        const websiteURL = process.env.WEBSITE_URL;
        const donorsTableName = process.env.DONORS_TABLE;
        const campaignDonorsTableName = process.env.CAMPAIGN_DONORS_TABLE;

        const parsed = event.donorId ? event : JSON.parse(event.body);
        
        const valid = await Functions.validateSubmission(parsed, validations);
        if (Object.keys(valid).length > 0) {
            return Responses._400({ messages: valid });
        }

        const queryCampaignDonorsData = {
            'IndexName': 'campaignDonorRequest',
            'KeyConditionExpression': 'campaignId = :campaignId AND donorId = :donorId',
            'ExpressionAttributeValues': {
                ':campaignId': parsed.campaignId,
                ':donorId': parsed.donorId
            }
        };
        const donorCampaignData = await Dynamo.query(queryCampaignDonorsData, campaignDonorsTableName).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: { 'error': 'An unexpected error occurred. Please try again later' }});
        });
        if (!donorCampaignData[0].donorId) {
          return Responses._400({ messages: { 'error': 'Donor not found' } });
        }

        const updateData = donorCampaignData[0];

        const escapeRegEx = new RegExp(/(<([^>]+)>)/i);
        if (parsed.additionalInfo) {
            updateData.additionalInfo = parsed.additionalInfo.toString().replace(escapeRegEx, '');
        }
        if (parsed.numberOfFamilies) {
            updateData.numberOfFamilies = parseInt(parsed.numberOfFamilies.toString().replace(escapeRegEx, ''));
        }
        if (parsed.familyDetail) {
            updateData.familyDetail = typeof parsed.familyDetail !== 'string' ? JSON.stringify(parsed.familyDetail) : parsed.familyDetail;
        }
        if (parsed.allocatedFamilies) {
            updateData.allocatedFamilies = parseInt(parsed.allocatedFamilies.toString().replace(escapeRegEx, ''));
        } else {
            updateData.allocatedFamilies = updateData.allocatedFamilies ?? 0;
        }

        await Dynamo.write(updateData, campaignDonorsTableName).catch(err => {
            console.log('error in dynamo write', err);
            return Responses._400({ messages: err });
        });

        if (parsed.sendEmail && parsed.donorEmail) {
            const emailTemplate = {
                familyData: [updateData],
                familyCount: updateData.numberOfFamilies, 
            };
            const emailTemplateParams = await Functions.getEmailTemplate('pledgeUpdated', emailTemplate);
            const jsonParameters = {
                ToAddresses: [parsed.donorEmail],
                ...emailTemplateParams,
            };
            await Notifications.sendTransactionalEmail(jsonParameters);
        }

        return Responses._200({ 'success': 'Pledge successfully updated' });
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};