const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

var AWS = require("aws-sdk");
AWS.config.region = "eu-west-2";
var lambda = new AWS.Lambda();

const validations = [
  {
    key: "campaignId",
    required: true,
    errorMsg: "Campaign ID is required",
  },
];

exports.handler = async (event, context, cb) => {
  try {
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
        "###HAMPER_ID###": "",
      },
    };
    console.log(pdfData);
    pdfPages.push(pdfData);
    pdfPages.push(pdfData);
    pdfPages.push(pdfData);
    pdfPages.push(pdfData);

    const FunctionName =
      "PdfGeneratorV2Stack-HtmlToPdfLambdaB7443488-LJXTgl6nvBE2";

    var params = {
      FunctionName, // the lambda function we are going to invoke
      InvocationType: "RequestResponse",
      LogType: "Tail",
      Payload: `{ "body": ${JSON.stringify({
        pdfPages: pdfPages,
        version: "basic",
      })} }`,
    };

    console.log("params", params);
    const lambdaResult = await lambda.invoke(params).promise();
    console.log("lambdaResult", lambdaResult);
    const resultObject = JSON.parse(lambdaResult.Payload);

    if (resultObject?.body) {
      const resultBody = JSON.parse(resultObject?.body);
      if (resultBody?.pdfUrl) {
        return Responses._200({
          pdfUrl: resultBody.pdfUrl,
        });
      }
    }

    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
