const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');
const Notifications = require('../../common/Notifications');

const moment = require("moment-timezone");

const validations = [
    {
        key: 'donorId',
        required: true,
        errorMsg: 'Donor is required',
    },
];

exports.handler = async (event, context, cb) => {
    try {
        if (
            !Functions.hasPermission(event, 'Admin')
        ) {
            return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
        }
        const familiesTableName = process.env.FAMILIES_TABLE;
        const familyMembersTableName = process.env.FAMILY_MEMBERS_TABLE;
        const donorsTableName = process.env.DONORS_TABLE;
        const websiteURL = process.env.WEBSITE_URL;
        const appURL = process.env.APP_URL;
        const envSalt = process.env.HASHING_SALT;

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
            return Responses._400({ messages: { 'unexpected': 'Donor not found' } });
        }

        const queryFamilyData = {
            'IndexName': 'allocatedToRequest',
            'KeyConditionExpression': 'allocatedTo = :donorId',
            'ExpressionAttributeValues': {
                ':donorId': parsed.donorId
            }
        };
        let donorFamiliesData = await Dynamo.query(queryFamilyData, familiesTableName).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: { 'error': 'An unexpected error occurred. Please try again later' }});
        });

        if (parsed.campaignRequestId) {
            donorFamiliesData = donorFamiliesData.filter(
                (f) => !f?.campaignRequestId || f.campaignRequestId === parsed.campaignRequestId
            )
        }

        if (!donorFamiliesData.length) {
          return Responses._400({ messages: { 'error': 'No families found for Donor' } });
        }

        const familyMemberQueryData = {
            'IndexName': 'donorFamilyRequest',
            'KeyConditionExpression': 'allocatedTo = :allocatedTo',
            'ExpressionAttributeValues': {
                ':allocatedTo': parsed.donorId
            }
        };
        let familyMemberData = await Dynamo.query(familyMemberQueryData, familyMembersTableName).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        if (!familyMemberData.length) {
          return Responses._400({ messages: { 'error': 'No family members found for family' } });
        }


        let hamperCount = 0;
        let csvContent = "";
        if (donorFamiliesData.length) {
            const timezone = process.env.TIMEZONE;
            const dateFormat = process.env.DATE_FORMAT;
            const timeStamp = moment((new Date()).getTime()).tz(timezone).format(dateFormat);
            let batchData = [];
            for (const family of donorFamiliesData) {
                hamperCount++;
                family.allocationEmailSentDate = timeStamp;
                batchData.push({
                    PutRequest: {
                        Item: family
                    }
                });
                csvContent += '"Hamper '+hamperCount+'"'+"\r\n";
                csvContent += '"Family Member","Age","Additional Information"'+"\r\n";

                const currentFamilyMembers = familyMemberData.filter(fm => fm.familyId == family.requestId)

                currentFamilyMembers.sort((a, b) =>
                    b.age > a.age ? 1 : a.age > b.age ? -1 : 0
                );

                let familyDynamics = [];
                for (const familyMember of currentFamilyMembers) {
                    const familyWho = familyMember.who

                    csvContent += `"${familyWho}","${familyMember.age}${familyMember.age ? ' '+familyMember.ageType : ''}","${familyMember.additionalInfo ? familyMember.additionalInfo : ''}"`+"\r\n";
                    familyDynamics.push(` ${familyWho} ${familyMember.age ? familyMember.age + ' ' + familyMember.ageType : ''}`);
                }

                // Seperate Familes with a blank line
                csvContent += "\r\n";
            }

            if (batchData.length) {
                console.log(`${batchData.length} families to update`)
                const chunkSize = 25;
                for (let i = 0; i < batchData.length; i += chunkSize) {
                    const chunk = batchData.slice(i, i + chunkSize);

                    await Dynamo.batchWrite(chunk, familiesTableName).catch(err => {
                        console.log('error in dynamo write', err);
                        return Responses._400({ messages: err });
                    });
                }
            }
        } else {
            console.log('NO FAMILY MEMBERS FOUND!?', familyMemberData, familyMemberQueryData);
        }

        /* */
        const donorHash = Hashing.hash(donorData.requestId, envSalt).hashedpassword;
        let standardTemplate = await Notifications.getEmailTemplate();

        const emailTemplate = {
            appURL,
            websiteURL,
            emailAddress: donorData.email, 
            familyData: donorFamiliesData, 
            familyMemberData: familyMemberData, 
            donorHash,
        };
        if (parsed.campaignRequestId) {
            emailTemplate.campaignRequestId = parsed.campaignRequestId
        }
        const emailTemplateParams = await Functions.getEmailTemplate('donorFamilyAllocation', emailTemplate);

        standardTemplate = standardTemplate.replace("{{pageTitle}}", emailTemplateParams.pageTitle);
        standardTemplate = standardTemplate.replace("{{pageContent}}", emailTemplateParams.pageContent);

        const rawEmailJsonParameters = {
            ToAddress: donorData.email,
            htmlContent: standardTemplate,
            subject: emailTemplateParams.subject,
        };
                        
        if (donorFamiliesData.length >= 5) {
            rawEmailJsonParameters.csvAttachment = csvContent;
            rawEmailJsonParameters.csvAttachmentFilename = 'your-allocation-families.csv';
        }

        await Notifications.sendRawEmail(rawEmailJsonParameters);
        /* */

        return Responses._200({ messages: { 'success': `Family allocated successful` } });
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};