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

    /*

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
    */
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;
    console.log("Checking Table", mainTableName);

    const campaignId = parsed?.campaign;
    const nominatorId = parsed?.nominatorId;

    console.log("Get Campaign data", campaignId);
    const campaignParams = {
      TableName: mainTableName,
      FilterExpression: "#pk = :pk",
      ExpressionAttributeNames: {
        "#pk": "PK",
      },
      ExpressionAttributeValues: {
        ":pk": campaignId,
      },
    };

    let allCampaignData = await Dynamo.scan(campaignParams).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });
    console.log(
      "campaign data recieved...",
      allCampaignData.length,
      allCampaignData
    );
    console.log("Get Nominator", nominatorId);
    const nominatorData = allCampaignData.find(
      (cd) =>
        cd.GSI2PK === nominatorId &&
        (cd.type === "nominator" || cd.type === "team-lead")
    );
    if (!nominatorData) {
      console.log(nominatorId, nominatorData);
      return Responses._400({ message: "Failed to retrieve nom by ID" });
    }

    console.log("Get Organisation", nominatorData?.GSI3PK);
    const organisationData = allCampaignData.find(
      (cd) => cd.GSI2PK === nominatorData?.GSI3PK && cd.type === "organisation"
    );
    if (!organisationData) {
      return Responses._400({ message: "Failed to retrieve org by ID" });
    }

    const nominatorsFamilies = allCampaignData.filter(
      (cd) => cd?.GSI3SK === nominatorData?.GSI2PK && cd.type === "family"
    );
    if (nominatorsFamilies.length) {
      nominatorsFamilies.sort((a, b) =>
        b.dateAdded < a.dateAdded ? 1 : a.dateAdded < b.dateAdded ? -1 : 0
      );

      let count = 1;
      const newData = [];
      for (const [i, family] of nominatorsFamilies.entries()) {
        const newRef = `${organisationData.SK}${
          nominatorData.nominatorDetails.reference
        }-${count.toString().padStart(3, "0")}`;
        if (`SK#${newRef}` != family.GSI2SK) {
          console.log(`NominatorId: ${family.GSI3SK}`);
          console.log(`Previous Ref: ${family.GSI2SK.replace("SK#", "")}`);
          console.log(`New Ref: ${newRef}`);
          family.GSI2SK = `SK#${newRef}`;
          family.status = family.status ?? "unallocated";
          if (family?.reference) {
            delete family.reference;
          }

          // Update family
          const newRequest = await Dynamo.write(family, mainTableName).catch(
            (err) => {
              console.log("error in dynamo write", err);
              return Responses._400({ messages: err });
            }
          );

          if (!newRequest) {
            return Responses._400({
              message: "Failed to write family to db by ID",
            });
          }
        } else {
          console.log(`Sticking with reference: ${newRef}`);
        }
        newData.push({ ...family });

        count++;
      }
    }

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
