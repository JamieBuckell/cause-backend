const Responses = require('../common/API_Responses');
const Dynamo = require('../common/Dynamo');
const Hashing = require('../common/Hashing');
const Functions = require('../common/Functions');
const Notifications = require('../common/Notifications');

var AWS = require("aws-sdk");
AWS.config.region = 'eu-west-2';
var lambda = new AWS.Lambda();

exports.handler = async (event, context, cb) => {
    try {
        const familiesTableName = process.env.FAMILIES_TABLE;
        const envSalt = process.env.HASHING_SALT;

        const parsed = event.email ? event : JSON.parse(event.body);
        const offset = parsed?.offset ? parsed.offset : 0;
        
        const famParam = {"TableName": familiesTableName};
        let allFamilies = await Dynamo.scan(famParam).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        allFamilies = allFamilies.filter(f => f.receiveStatus !== 'direct-hamper');
        allFamilies.sort((a, b) =>
            b.reference < a.reference ? 1 : a.reference < b.reference ? -1 : 0
        );
        let limit = offset+500 > allFamilies.length ? allFamilies.length : offset+500;
        allFamilies = allFamilies.slice(offset, limit);

        const pdfPages = [];
        let count = 0;
        for (const [i, f] of allFamilies.entries()) {
            count++;
            const hamperHash = Hashing.hash(f.reference, envSalt+f.requestId).hashedpassword;
            const qrCode = `https://portal.cause-foundation.org.uk/feedback/hamper/${f.reference}/${hamperHash}`;
            pdfPages.push({
                template: "feedbackSlip",
                qrCode: qrCode,
                replaceStrings: {
                    '###HAMPER_ID###': `${f.reference}`,
                },
            });
            if (count % 4 === 0) {
                pdfPages.push({
                    template: "pageBreak",
                });
            }
        }

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

        return Responses._400({ messages: { 'error': 'Hamper not found' } });
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};