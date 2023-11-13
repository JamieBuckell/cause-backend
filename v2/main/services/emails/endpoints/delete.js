const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");

const moment = require("moment-timezone");

exports.handler = async (event, context, cb) => {
  try {
    if (!Functions.hasPermission(event, "Admin")) {
      return Responses._401({
        messages: {
          unauthorized: "You are not authorized to view this section",
        },
      });
    }
    const { campaignId } = event.pathParameters;

    const timezone = process.env.TIMEZONE;
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;

    const params = {
      TableName: mainTableName,
      FilterExpression: "#pk = :pk AND #sk = :sk AND #type = :type",
      ExpressionAttributeNames: {
        "#pk": "PK",
        "#sk": "SK",
        "#type": "type",
      },
      ExpressionAttributeValues: {
        ":pk": campaignId,
        ":sk": "A",
        ":type": "campaign",
      },
    };
    let campaignData = await Dynamo.scan(params).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });
    campaignData = campaignData[0] ?? {};

    if (!campaignData.PK) {
      return Responses._400({
        messages: { unexpected: "Campaign not found" },
      });
    }
    const timeStamp = moment(new Date().getTime())
      .tz(timezone)
      .format("YYYYMMDDHHmmss");

    const updateData = {
      ...campaignData,
    };
    updateData.status = "deleted";
    updateData.deletedOn = timeStamp;

    await Dynamo.write(updateData, mainTableName).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    return Responses._200({
      messages: { success: "Campaigns deleted successfully" },
    });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
