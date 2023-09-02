const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');
const Notifications = require('../../common/Notifications');

var AWS = require("aws-sdk");
AWS.config.region = 'eu-west-2';
var lambda = new AWS.Lambda();

exports.handler = async (event, context, cb) => {
    try {
        if (event?.Records) {
            for (const r of event?.Records) {
                console.log(`Running message: ${r.body}`);

                if (r?.messageAttributes?.donorDetails) {
                    const donorDetails = JSON.parse(r.messageAttributes.donorDetails.stringValue);
                    const donorFamiliesData = JSON.parse(r.messageAttributes.donorFamiliesData.stringValue);
                    const familyMemberData = JSON.parse(r.messageAttributes.familyMemberData.stringValue);

                    let standardTemplate = await Notifications.getEmailTemplate();

                    const emailTemplate = {
                        familyData: donorFamiliesData,
                        familyMemberData: familyMemberData, 
                    };
                    const emailTemplateParams = await Functions.getEmailTemplate('donorFamilyAllocationConfirmed', emailTemplate);

                    standardTemplate = standardTemplate.replace("{{pageTitle}}", emailTemplateParams.pageTitle);
                    standardTemplate = standardTemplate.replace("{{pageContent}}", emailTemplateParams.pageContent);

                    const rawEmailJsonParameters = {
                        ToAddress: donorDetails.email,
                        htmlContent: standardTemplate,
                        subject: emailTemplateParams.subject,
                    };

                    let hamperCount = 0;
                    let csvContent = "";
                    const pdfPages = [];
                    for (const family of donorFamiliesData) {
                        hamperCount++;

                        csvContent += '"Hamper '+hamperCount+'"'+"\r\n";
                        csvContent += '"Hamper ID","Family Member","Age","Additional Information"'+"\r\n";
                        const currentFamilyMembers = familyMemberData.filter(fm => fm.familyId == family.requestId)

                        currentFamilyMembers.sort((a, b) =>
                            b.age > a.age ? 1 : a.age > b.age ? -1 : 0
                        );

                        let familyDynamics = [];
                        for (const familyMember of currentFamilyMembers) {
                            const familyWho = familyMember.who

                            csvContent += `"${family.reference}","${familyWho}","${familyMember.age}${familyMember.age ? ' '+familyMember.ageType : ''}","${familyMember.additionalInfo ? familyMember.additionalInfo : ''}"`+"\r\n";
                            familyDynamics.push(` ${familyWho} ${familyMember.age ? familyMember.age + ' ' + familyMember.ageType : ''}`);
                        }

                        // Seperate Familes with a blank line
                        csvContent += "\r\n";

                        pdfPages.push({
                            template: "labels",
                            qrCode: family.reference,
                            replaceStrings: {
                                '###DONOR_NAME###': `${donorDetails.firstName} ${donorDetails.lastName}`,
                                '###HAMPER_ID###': `${family.reference}`,
                                '###FAMILY_DYNAMICS###': `${familyDynamics.join(',')}`,
                            },
                        });
                    }
                        
                    if (donorFamiliesData.length >= 5) {
                        rawEmailJsonParameters.csvAttachment = csvContent;
                        rawEmailJsonParameters.csvAttachmentFilename = 'your-allocation-families.csv';
                    }

                    var params = {
                        FunctionName: 'pdf-live-downloadPdf', // the lambda function we are going to invoke
                        InvocationType: 'RequestResponse',
                        LogType: 'Tail',
                        Payload: `{ "pdfPages" : ${JSON.stringify(pdfPages)} }`
                    };

                    const lambdaResult = await lambda.invoke(params).promise();
                    const resultObject = JSON.parse(lambdaResult.Payload)
                    console.log(resultObject);

                    /* */
                    rawEmailJsonParameters.pdfAttachment = resultObject;
                    rawEmailJsonParameters.pdfAttachmentFilename = 'family-hamper-labels.pdf';

                    await Notifications.sendRawEmail(rawEmailJsonParameters);
                }
            }
            return Responses._200({ messages: { 'success': 'Email Sending Complete' }});
        } else {
            console.log(`No records found`, event);
            return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
        }
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred. Please try again later' } });
    }
};