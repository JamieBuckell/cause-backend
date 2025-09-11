const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

exports.handler = async (event, context, cb) => {
  try {
    if (!Functions.hasPermission(event, "Admin")) {
      return Responses._401({
        messages: {
          unauthorized: "You are not authorized to view this section",
        },
      });
    }
    const commsTableName = process.env.COMMS_DYNAMO_TABLE;

    const sentEmailParams = {
      KeyConditionExpression: "#pk= :pk",
      ExpressionAttributeValues: {
        ":pk": "EMAIL",
      },
      ExpressionAttributeNames: {
        "#pk": "PK",
      },
    };
    let sentEmailsData = await Dynamo.query(
      sentEmailParams,
      commsTableName
    ).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    if (!sentEmailsData) {
      return Responses._400({ message: "Failed to retrieve all via query" });
    }

    const standardTemplate = await Notifications.getEmailTemplate();

    return Responses._200({
      emails: { ...sentEmailsData },
      template: standardTemplate,
    });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
