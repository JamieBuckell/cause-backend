const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");

const { nanoid } = require("nanoid");
const moment = require("moment-timezone");

const validations = [
  {
    key: "name",
    required: true,
    errorMsg: "Please enter a valid campaign name",
  },
  {
    key: "reference",
    required: true,
    errorMsg: "Please enter a valid campaign reference",
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
    const parsed = event.reference ? event : JSON.parse(event.body);

    const escapeRegEx = new RegExp(/(<([^>]+)>)/gi);
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;

    if (!parsed) {
      return Responses._400({
        message: "Failed to read submitted data: " + JSON.stringify(parsed),
      });
    }

    const valid = await Functions.validateSubmission(parsed, validations);
    if (Object.keys(valid).length > 0) {
      return Responses._400({ messages: valid });
    }

    // use replace for extra layer of security
    const validCampaignName = parsed.name.toString().replace(escapeRegEx, "");
    const validCampaignReference = parsed.reference
      .toString()
      .replace(escapeRegEx, "");

    const campaignSK = `A`;
    const campaignGSI2SK = `SK#${campaignSK}`;

    const timezone = process.env.TIMEZONE;
    const dateFormat = process.env.DATE_FORMAT;
    const timeStamp = moment(new Date().getTime())
      .tz(timezone)
      .format(dateFormat);

    const campaignData = {
      PK: validCampaignReference,
      SK: campaignSK,
      campaignDetails: {
        campaignEnd: parsed?.dates?.campaignEnd ?? "",
        campaignStart: parsed?.dates?.campaignStart ?? "",
        nominationsClosed: parsed?.dates?.nominationsClosed ?? "",
        nominationsOpen: parsed?.dates?.nominationsOpen ?? "",
        registrationClosed: parsed?.dates?.registrationClosed ?? "",
        registrationOpen: parsed?.dates?.registrationOpen ?? "",
      },
      campaignName: validCampaignName,
      GSI2SK: campaignGSI2SK,
      type: "campaign",
      status: "active",
    };

    const newRequest = await Dynamo.write(campaignData, mainTableName).catch(
      (err) => {
        console.log("error in dynamo write", err);
        return Responses._400({ messages: err });
      }
    );

    if (!newRequest) {
      return Responses._400({ message: "Failed to write db by ID" });
    }

    return Responses._200({
      messages: { success: "Creation successful" },
      campaign: campaignData,
    });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
