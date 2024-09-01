const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");

const moment = require("moment-timezone");

const validations = [
  {
    key: "campaignId",
    required: true,
    errorMsg: "Campaign ID is required",
  },
  {
    key: "hamperIds",
    required: true,
    errorMsg: "Hamper IDs are required",
  },
];

exports.handler = async (event, context, cb) => {
  try {
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;
    const timezone = process.env.TIMEZONE;
    const dateFormat = process.env.DATE_FORMAT;

    const parsed = event.hamperId ? event : JSON.parse(event.body);

    const valid = await Functions.validateSubmission(parsed, validations);
    if (Object.keys(valid).length > 0) {
      return Responses._400({ messages: valid });
    }

    const campaignQueryData = {
      TableName: mainTableName,
      FilterExpression: "#pk= :pk AND begins_with(#sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": parsed.campaignId,
        ":sk": "REF#",
      },
      ExpressionAttributeNames: {
        "#pk": "PK",
        "#sk": "SK",
      },
    };
    var campaignData = await Dynamo.scan(campaignQueryData).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    console.log("hamperIds", parsed.hamperIds);
    if (parsed.hamperIds.length) {
      const errors = [];
      const batchData = [];
      for (const hamperId of parsed.hamperIds) {
        const hamper = campaignData.find((h) => h.GSI2SK === `SK#${hamperId}`);
        if (hamper && hamper?.PK) {
          hamper.receiveStatus = "direct-hamper";

          const timeStamp = moment(new Date().getTime())
            .tz(timezone)
            .format(dateFormat);
          hamper.receivedDate = timeStamp;

          batchData.push({
            PutRequest: {
              Item: hamper,
            },
          });
        } else {
          let error = [];
          error[hamperId] = "Hamper ID not founds";
          errors.push(error);
        }
      }

      await Functions.doBatchImport(batchData, mainTableName);
      return Responses._200({ success: true, errors });
    }

    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
