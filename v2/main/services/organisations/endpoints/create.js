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
    errorMsg: "Please enter a valid organisation name",
  },
  {
    key: "reference",
    required: true,
    errorMsg: "Please enter a valid organisation reference",
  },
  {
    key: "type",
    required: true,
    errorMsg: "Please specify and organisation type",
  },
  {
    key: "campaignId",
    required: true,
    errorMsg: "This organisation must be attached to a valid campaign",
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
    const campaignId = parsed.campaignId.toString().replace(escapeRegEx, "");
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

    //Check the campaign is legit...
    const params = {
      TableName: mainTableName,
      FilterExpression: "#pk = :pk AND #type = :type",
      ExpressionAttributeNames: {
        "#type": "type",
        "#pk": "PK",
      },
      ExpressionAttributeValues: {
        ":type": "campaign",
        ":pk": campaignId,
      },
    };
    const activeCampaigns = await Dynamo.scan(params).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    if (!activeCampaigns.length) {
      console.log(activeCampaigns);
      return Responses._400({ message: "Campaign not found." });
    }

    const requestId = nanoid(12);

    // use replace for extra layer of security
    const validOrganisationName = parsed.name
      .toString()
      .replace(escapeRegEx, "");
    const validOrganisationReference = parsed.reference
      .toString()
      .replace(escapeRegEx, "");

    const organisationGSI2SK = `SK#${validOrganisationReference}`;

    const timezone = process.env.TIMEZONE;
    const dateFormat = process.env.DATE_FORMAT;
    const timeStamp = moment(new Date().getTime())
      .tz(timezone)
      .format(dateFormat);

    const organisationData = {
      PK: campaignId,
      SK: validOrganisationReference,
      dateAdded: timeStamp,
      GSI1PK: requestId,
      GSI1SK: `C#${campaignId}`,
      GSI2PK: requestId,
      GSI2SK: organisationGSI2SK,
      hash: {
        data: Hashing.generateSalt(14) + "-" + Hashing.generateSalt(14),
        salt: Hashing.generateSalt(6),
      },
      organisation: {
        name: validOrganisationName,
        totalFamilies: "0",
        type: parsed?.type ?? "",
      },
      type: "organisation",
    };

    const newRequest = await Dynamo.write(
      organisationData,
      mainTableName
    ).catch((err) => {
      console.log("error in dynamo write", err);
      return Responses._400({ messages: err });
    });

    if (!newRequest) {
      return Responses._400({ message: "Failed to write db by ID" });
    }

    return Responses._200({
      messages: { success: "Creation successful" },
      organisation: organisationData,
    });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
