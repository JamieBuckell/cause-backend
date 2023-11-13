const Responses = require('../common/API_Responses');
const Dynamo = require('../common/Dynamo');
const Hashing = require('../common/Hashing');
const Functions = require('../common/Functions');
const Notifications = require('../common/Notifications');

var AWS = require("aws-sdk");
AWS.config.region = 'eu-west-2';
var lambda = new AWS.Lambda();

const validations = [
    {
        key: 'campaignId',
        required: true,
        errorMsg: 'Campaign ID is required',
    }
];

exports.handler = async (event, context, cb) => {
    try {
        const envSalt = process.env.HASHING_SALT;

        const parsed = event.email ? event : JSON.parse(event.body);
        
        const valid = await Functions.validateSubmission(parsed, validations);
        if (Object.keys(valid).length > 0) {
            return Responses._400({ messages: valid });
        }
        
        const pdfPages = [];
        const qrCode = `https://portal.cause-foundation.org.uk/feedback/hamper/${parsed.campaignId}`;
        const pdfData = {
            template: "feedbackSlip",
            qrCode: qrCode,
            replaceStrings: {
                '###HAMPER_ID###': "",
            },
        };
        pdfPages.push(pdfData);
        pdfPages.push(pdfData);
        pdfPages.push(pdfData);
        pdfPages.push(pdfData);

        var params = {
            FunctionName: 'pdf-live-downloadPdf', // the lambda function we are going to invoke
            InvocationType: 'RequestResponse',
            LogType: 'Tail',
            Payload: `{ "pdfPages" : ${JSON.stringify(pdfPages)}, "version" : "basic" }`
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
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};