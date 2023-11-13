const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");

const AWS = require("aws-sdk");
const cognito = new AWS.CognitoIdentityServiceProvider({
  apiVersion: "2016-04-18",
});
AWS.config.update({ region: "eu-west-2" });
var sqs = new AWS.SQS({ apiVersion: "2012-11-05" });

const validations = [
  {
    key: "campaign",
    required: true,
    errorMsg: "Campaign ID is required",
  },
  {
    key: "nominatorId",
    required: true,
    errorMsg: "Nominator ID is required",
  },
];

exports.handler = async (event, context, cb) => {
  try {
    // Check permissions
    if (!Functions.hasPermission(event, "Admin")) {
      return Responses._401({
        messages: {
          unauthorized: "You are not authorized to view this section",
        },
      });
    }

    // Validate submission
    const parsed = event.nominatorId ? event : JSON.parse(event.body);
    const valid = await Functions.validateSubmission(parsed, validations);
    if (Object.keys(valid).length > 0) {
      return Responses._400({ messages: valid });
    }

    var params = {
      DelaySeconds: 10,
      MessageAttributes: {
        campaign: {
          DataType: "String",
          StringValue: parsed?.campaign,
        },
        nominatorId: {
          DataType: "String",
          StringValue: parsed?.nominatorId,
        },
      },
      MessageBody: `Fixing references for nominator: ${parsed?.nominatorId} on campaign ${parsed?.campaign}`,
      QueueUrl: `https://sqs.${process.env.AWS_ACCOUNT_REGION}.amazonaws.com/${process.env.AWS_ACCOUNT_ID}/${process.env.FIX_DONOR_REFERENCES_QUEUE}`,
    };

    await sqs.sendMessage(params).promise();

    return Responses._200({
      messages: { success: "References updated queued" },
    });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
