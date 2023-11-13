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

    const envSalt = process.env.HASHING_SALT;
    const envHashPrefix = process.env.HASHING_PREFIX;
    const websiteURL = process.env.WEBSITE_URL;
    const appURL = process.env.APP_URL;
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;
    const subscriberTableName = process.env.SUBSCRIBERS_TABLE;

    const parsed = event.donorId ? event : JSON.parse(event.body);

    const valid = await Functions.validateSubmission(parsed, validations);
    if (Object.keys(valid).length > 0) {
      return Responses._400({ messages: valid });
    }
    const campaignId = parsed.campaign ?? null;

    const params = {
      TableName: mainTableName,
      FilterExpression: "#pk = :pk and #type = :type",
      ExpressionAttributeNames: {
        "#pk": "PK",
        "#type": "type",
      },
      ExpressionAttributeValues: {
        ":pk": campaignId,
        ":type": "donor",
      },
    };
    let allDonorData = await Dynamo.scan(params).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    const donorData = allDonorData.find((d) => d.GSI2PK === parsed.donorId);

    if (!donorData?.PK || !donorData?.SK) {
      console.log(
        "Donor not found",
        donorData,
        campaignId,
        parsed,
        allDonorData
      );
      return Responses._400({
        messages: { error: "There was an error matching the Donor IDs." },
      });
    }

    console.log(donorData);

    // Specifically Verify any subscriptions
    const subscriberQueryData = {
      KeyConditionExpression: "#pk= :pk And begins_with(#sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": donorData.GSI3PK,
        ":sk": envHashPrefix,
      },
      ExpressionAttributeNames: {
        "#pk": "PK",
        "#sk": "SK",
      },
    };
    const subscribers = await Dynamo.query(
      subscriberQueryData,
      subscriberTableName
    ).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    if (subscribers.length) {
      const existingSubscriber = subscribers[0];

      if (existingSubscriber.PK) {
        donorData.emailVerification.hash = existingSubscriber.SK;
      }
    } else {
      console.log("Subscriber not found?", emailAddress);
    }

    const donorHash = Hashing.hash(
      donorData.emailVerification.hash.replace(envHashPrefix, ""),
      envSalt
    ).hashedpassword;

    donorData.emailVerification.bounced = false;
    donorData.emailVerification.bouncedDetail = "";
    donorData.emailVerification.verified = false;

    await Dynamo.write(donorData, mainTableName).catch((err) => {
      console.log("error in dynamo write", err);
      return Responses._400({ messages: err });
    });

    const emailTemplate = {
      websiteURL,
      appURL,
      campaignId,
      emailAddress: donorData.GSI3PK,
      donorHash,
    };
    const emailTemplateParams = await Functions.getEmailTemplate(
      "donorRegister",
      emailTemplate
    );
    const jsonParameters = {
      ToAddresses: [donorData.GSI3PK],
      ...emailTemplateParams,
    };
    await Notifications.sendTransactionalEmail(jsonParameters);

    return Responses._200({
      messages: { success: "Email successfully updated" },
    });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
