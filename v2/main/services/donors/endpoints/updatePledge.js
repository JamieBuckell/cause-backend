const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

const validations = [
  {
    key: "donorId",
    required: true,
    errorMsg: "Donor is required",
  },
  {
    key: "campaignData",
    required: true,
    errorMsg: "Campaign data is required",
  },
  {
    key: "campaignId",
    required: true,
    errorMsg: "Campaign is required",
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

    const requestId = context.awsRequestId; // Change this so that we are generating our own ID

    const envSalt = process.env.HASHING_SALT;
    const websiteURL = process.env.WEBSITE_URL;
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;

    const parsed = event.donorId ? event : JSON.parse(event.body);
    console.log("parsed", parsed);

    const valid = await Functions.validateSubmission(parsed, validations);
    if (Object.keys(valid).length > 0) {
      return Responses._400({ messages: valid });
    }

    const params = {
      TableName: mainTableName,
      FilterExpression: "#pk = :pk and #type = :type",
      ExpressionAttributeNames: {
        "#pk": "PK",
        "#type": "type",
      },
      ExpressionAttributeValues: {
        ":pk": parsed.campaignId,
        ":type": "donor",
      },
    };
    let allDonorData = await Dynamo.scan(params).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    const updateData = allDonorData.find((d) => d.GSI2PK === parsed.donorId);
    const previousData = { ...updateData };

    if (!updateData.PK) {
      return Responses._400({ messages: { error: "Donor not found" } });
    }

    const escapeRegEx = new RegExp(/(<([^>]+)>)/i);

    const historicData = {
      donorDetails: previousData?.donorDetails ?? {},
      familyDetails: previousData?.familyDetails ?? {},
      dateAdded: previousData.dateAdded,
    };
    const existingHistory = previousData.history ?? [];
    updateData.history = [historicData, ...existingHistory];
    updateData.totalChanges = previousData?.totalChanges
      ? previousData?.totalChanges + 1
      : 1;

    updateData.familyDetails.request = JSON.parse(parsed.campaignData);

    console.log(updateData.familyDetails.request, updateData);
    /* */
    await Dynamo.write(updateData, mainTableName).catch((err) => {
      console.log("error in dynamo write", err);
      return Responses._400({ messages: err });
    });
    /* */

    const familyCount = 1;

    if (
      parsed?.sendEmail &&
      updateData?.GSI3PK &&
      updateData.familyDetails.request.length
    ) {
      const emailTemplate = {
        familyData: updateData.familyDetails.request,
        familyCount: familyCount,
      };
      const emailTemplateParams = await Functions.getEmailTemplate(
        "pledgeUpdated",
        emailTemplate
      );
      const jsonParameters = {
        ToAddresses: [updateData.GSI3PK],
        ...emailTemplateParams,
      };
      await Notifications.sendTransactionalEmail(jsonParameters);
    }

    return Responses._200({ success: "Pledge successfully updated" });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
