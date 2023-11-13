const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

const moment = require("moment-timezone");

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
  {
    key: "previousEmail",
    required: true,
    errorMsg: "Previous Email Address is required",
  },
  {
    key: "updatedEmail",
    required: true,
    errorMsg: "Updated Email Address is required",
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

    const timezone = process.env.TIMEZONE;
    const dateFormat = process.env.DATE_FORMAT;
    const timeStamp = moment(new Date().getTime())
      .tz(timezone)
      .format(dateFormat);

    const parsed = event.donorId ? event : JSON.parse(event.body);

    const valid = await Functions.validateSubmission(parsed, validations);
    if (Object.keys(valid).length > 0) {
      return Responses._400({ messages: valid });
    }

    const campaignId = parsed.campaign ?? null;
    const escapeRegEx = new RegExp(/(<([^>]+)>)/i);
    const validUpdatedEmail = parsed.updatedEmail
      .toString()
      .replace(escapeRegEx, "");

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
    console.log(allDonorData, params);

    const emailCheckRes = allDonorData.find(
      (d) => d.GSI3PK === validUpdatedEmail
    );

    if (emailCheckRes && emailCheckRes.length) {
      return Responses._400({
        messages: { error: "Email address already exists!" },
      });
    }

    const donorData = allDonorData.find((d) => d.GSI2PK === parsed.donorId);
    console.log(donorData);

    if (!donorData?.PK) {
      return Responses._400({ messages: { error: "Donor not found" } });
    }

    console.log(donorData);

    const ogDonor = { ...donorData };

    donorData.SK = donorData.GSI2SK = `EMAIL#${validUpdatedEmail}`;
    donorData.GSI3PK = validUpdatedEmail;
    donorData.emailVerification.bounced = false;
    donorData.emailVerification.bouncedDetail = "";
    if (parsed.sendEmail) {
      donorData.emailVerification.dateVerified = "";
      donorData.emailVerification.verified = false;
    }
    await Dynamo.write(donorData, mainTableName).catch((err) => {
      console.log("error in dynamo write", err);
      return Responses._400({ messages: err });
    });

    // Because we're changing the SK, it's going to create a new record, so let's now SOFT delete the old one!
    ogDonor.dateDeleted = timeStamp;
    ogDonor.status = "deleted";
    await Dynamo.write(ogDonor, mainTableName).catch((err) => {
      console.log("error in dynamo write", err);
      return Responses._400({ messages: err });
    });

    const donorHash = Hashing.hash(
      donorData.emailVerification.hash.replace(envHashPrefix, ""),
      envSalt
    ).hashedpassword;
    if (parsed.sendEmail) {
      const emailTemplate = {
        websiteURL,
        appURL,
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
    }

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
