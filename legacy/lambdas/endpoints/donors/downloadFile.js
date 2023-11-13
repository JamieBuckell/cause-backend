const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');
const Notifications = require('../../common/Notifications');

var AWS = require("aws-sdk");
AWS.config.region = 'eu-west-2';
var lambda = new AWS.Lambda();

const validations = [
    {
        key: 'donorId',
        required: true,
        errorMsg: 'Donor is required',
    },
];

exports.handler = async (event, context, cb) => {
    try {
        if (!Functions.hasPermission(event, 'Admin')) {
            return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
        }
        
        const parsed = event.emailAddress ? event : JSON.parse(event.body);
        
        const valid = await Functions.validateSubmission(parsed, validations);
        if (Object.keys(valid).length > 0) {
            return Responses._400({ messages: valid });
        } 

        const donorsTableName = process.env.DONORS_TABLE;
        const familiesTableName = process.env.FAMILIES_TABLE;
        const familyMembersTableName = process.env.FAMILY_MEMBERS_TABLE;

        const downloadType = parsed.type;
        const downloadVersion = parsed?.version ? parsed.version : 'full';

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

        const queryFamilyData = {
            'IndexName': 'allocatedToRequest',
            'KeyConditionExpression': 'allocatedTo = :donorId',
            'ExpressionAttributeValues': {
                ':donorId': parsed.donorId
            }
        };
        const donorFamiliesData = await Dynamo.query(queryFamilyData, familiesTableName).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: { 'error': 'An unexpected error occurred. Please try again later' }});
        });

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

        let hamperCount = 0;
        let csvContent = "";
        const pdfPages = [];
        for (const family of donorFamiliesData) {
            hamperCount++;
            
            const currentFamilyMembers = familyMemberData.filter(fm => fm.familyId == family.requestId)
            currentFamilyMembers.sort((a, b) =>
                b.age > a.age ? 1 : a.age > b.age ? -1 : 0
            );
            
            let familyDynamics = [];
            csvContent += '"Hamper '+hamperCount+'"'+"\r\n";
            csvContent += '"Hamper ID","Family Member","Age","Additional Information"'+"\r\n";
            for (const familyMember of currentFamilyMembers) {
                const familyWho = familyMember.who

                csvContent += `"${family.reference}","${familyWho}","${familyMember.age}${familyMember.age ? ' '+familyMember.ageType : ''}","${familyMember.additionalInfo ? familyMember.additionalInfo : ''}"`+"\r\n";
                familyDynamics.push(` ${familyWho} ${familyMember.age ? familyMember.age + ' ' + familyMember.ageType : ''}`);
            }

            // Seperate Familes with a blank line
            csvContent += "\r\n";

            pdfPages.push({
                template: downloadVersion === 'basic' ? "labelsBasic" : "labels",
                qrCode: family.reference,
                replaceStrings: {
                    '###DONOR_NAME###': `${donorData.firstName} ${donorData.lastName}`,
                    '###HAMPER_ID###': `${family.reference}`,
                    '###FAMILY_DYNAMICS###': `${familyDynamics.join(',')}`,
                },
            });
        }

            let response = {
                statusCode: 200,
                isBase64Encoded : true,
            }
            switch (downloadType) {
                case 'pdf':

                    var params = {
                        FunctionName: 'pdf-live-downloadPdf', // the lambda function we are going to invoke
                        InvocationType: 'RequestResponse',
                        LogType: 'Tail',
                        Payload: `{ "pdfPages" : ${JSON.stringify(pdfPages)}, "version": "${downloadVersion}" }`
                    };

                    const lambdaResult = await lambda.invoke(params).promise();
                    const resultObject = JSON.parse(lambdaResult.Payload)

                    return {
                        headers: {
                            'Content-Type': 'application/pdf',
                            'Access-Control-Allow-Methods': '*',
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Headers': '*',
                            'Access-Control-Max-Age': '3600',
                        },
                        statusCode: 200,
                        body: resultObject,
                    }
                case 'csv':
                    response.headers = {'Content-type' : 'text/csv'}
                    response.body = csvContent
                    return cb(null, response);
                    break;
            }
            
        if (donorFamiliesData.length >= 5) {
            rawEmailJsonParameters.csvAttachment = csvContent;
            rawEmailJsonParameters.csvAttachmentFilename = 'your-allocation-families.csv';
        }
    
        return Responses._200({ messages: { 'success': 'Email Sending Complete' }});
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred. Please try again later' } });
    }
};