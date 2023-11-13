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
    key: "campaign",
    required: true,
    errorMsg: "Campaign is required",
  },
  {
    key: "donorId",
    required: true,
    errorMsg: "Donor is required",
  },
];

exports.handler = async (event, context, cb) => {
  try {
    if (!Functions.hasPermission(event, "Admin")) {
      return Responses._401({
        messages: {
          unauthorized: "You are not authorized to view this section",
        },
      });
    }

    const parsed = event.donorId ? event : JSON.parse(event.body);

    const valid = await Functions.validateSubmission(parsed, validations);
    if (Object.keys(valid).length > 0) {
      return Responses._400({ messages: valid });
    }

    const mainTableName = process.env.MAIN_DYNAMO_TABLE;

    const downloadType = parsed.type;
    const downloadVersion = parsed?.version ? parsed.version : "full";

    const campaignParams = {
      TableName: mainTableName,
      FilterExpression: "#pk = :pk",
      ExpressionAttributeNames: {
        "#pk": "PK",
      },
      ExpressionAttributeValues: {
        ":pk": parsed.campaign,
      },
    };
    let allCampaignData = await Dynamo.scan(campaignParams).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    const donorData = allCampaignData.find(
      (d) => d.GSI2PK === parsed.donorId && d.type === "donor"
    );
    if (!donorData?.PK) {
      return Responses._400({ messages: { error: "Donor not found" } });
    }

    const donorFamiliesData = allCampaignData.filter(
      (f) => f.allocatedTo === parsed.donorId && f.type === "family"
    );

    let hamperCount = 0;
    let csvContent = "";
    const pdfPages = [];

    for (const family of donorFamiliesData) {
      hamperCount++;
      const hamperReference = family.GSI2SK.replace("SK#", "");

      csvContent += '"Hamper ' + hamperCount + '"' + "\r\n";
      csvContent +=
        '"Hamper ID","Family Member","Age","Additional Information"' + "\r\n";
      const currentFamilyMembers = [...family.members];

      currentFamilyMembers.sort((a, b) =>
        b.age > a.age ? 1 : a.age > b.age ? -1 : 0
      );

      let familyDynamics = [];
      for (const familyMember of currentFamilyMembers) {
        const familyWho = familyMember.who;

        csvContent +=
          `"${hamperReference}","${familyWho}","${familyMember.age}${
            familyMember.age ? " " + familyMember.ageType : ""
          }","${
            familyMember.additionalInfo ? familyMember.additionalInfo : ""
          }"` + "\r\n";
        familyDynamics.push(
          ` ${familyWho} ${
            familyMember.age
              ? familyMember.age + " " + familyMember.ageType
              : ""
          }`
        );
      }

      // Seperate Familes with a blank line
      csvContent += "\r\n";

      pdfPages.push({
        template: downloadVersion === "basic" ? "labelsBasic" : "labels",
        qrCode: hamperReference,
        replaceStrings: {
          "###DONOR_NAME###": `${donorData.donorDetails.firstName} ${donorData.donorDetails.lastName}`,
          "###HAMPER_ID###": `${hamperReference}`,
          "###FAMILY_DYNAMICS###": `${familyDynamics.join(",")}`,
        },
      });
    }

    let response = {
      statusCode: 200,
      isBase64Encoded: true,
    };
    switch (downloadType) {
      case "pdf":
        var params = {
          FunctionName: "pdf-live-downloadPdf", // the lambda function we are going to invoke
          InvocationType: "RequestResponse",
          LogType: "Tail",
          Payload: `{ "pdfPages" : ${JSON.stringify(
            pdfPages
          )}, "version": "${downloadVersion}" }`,
        };

        const lambdaResult = await lambda.invoke(params).promise();
        const resultObject = JSON.parse(lambdaResult.Payload);

        return {
          headers: {
            "Content-Type": "application/pdf",
            "Access-Control-Allow-Methods": "*",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Max-Age": "3600",
          },
          statusCode: 200,
          body: resultObject,
        };
      case "csv":
        response.headers = { "Content-type": "text/csv" };
        response.body = csvContent;
        return cb(null, response);
        break;
    }

    if (donorFamiliesData.length >= 5) {
      rawEmailJsonParameters.csvAttachment = csvContent;
      rawEmailJsonParameters.csvAttachmentFilename =
        "your-allocation-families.csv";
    }

    return Responses._200({ messages: { success: "Email Sending Complete" } });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: {
        unexpected: "An unexpected error occurred. Please try again later",
      },
    });
  }
};
