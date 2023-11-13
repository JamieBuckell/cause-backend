const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");

const moment = require("moment-timezone");

const validations = [
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
    const { organisationId } = event.pathParameters;
    const escapeRegEx = new RegExp(/(<([^>]+)>)/gi);

    const parsed = event.reference ? event : JSON.parse(event.body);

    if (!parsed) {
      return Responses._400({
        message: "Failed to read submitted data: " + JSON.stringify(parsed),
      });
    }

    const valid = await Functions.validateSubmission(parsed, validations);
    if (Object.keys(valid).length > 0) {
      return Responses._400({ messages: valid });
    }

    const campaignId = parsed.campaignId.toString().replace(escapeRegEx, "");

    const timezone = process.env.TIMEZONE;
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;

    const params = {
      TableName: mainTableName,
      FilterExpression: "#pk = :pk AND #gsi2pk = :gsi2pk AND #type = :type",
      ExpressionAttributeNames: {
        "#pk": "PK",
        "#gsi2pk": "GSI2PK",
        "#type": "type",
      },
      ExpressionAttributeValues: {
        ":pk": campaignId,
        ":gsi2pk": organisationId,
        ":type": "organisation",
      },
    };
    let organisationData = await Dynamo.scan(params).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });
    organisationData = organisationData[0] ?? {};

    if (!organisationData.GSI2PK) {
      return Responses._400({
        messages: { unexpected: "Organisation not found" },
      });
    }
    const timeStamp = moment(new Date().getTime())
      .tz(timezone)
      .format("YYYYMMDDHHmmss");

    const updateData = {
      ...organisationData,
    };
    updateData.status = "deleted";
    updateData.reference = `${updateData.reference}-DELETED-${timeStamp}`;

    await Dynamo.write(updateData, mainTableName).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    return Responses._200({
      messages: { success: "Organisations deleted successfully" },
    });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
