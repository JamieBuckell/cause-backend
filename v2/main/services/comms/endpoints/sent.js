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

    const nomParams = {
      TableName: commsTableName,
      FilterExpression:
        "attribute_not_exists(#gsi1pk) AND attribute_not_exists(#gsi1sk)",
      ExpressionAttributeNames: {
        "#gsi1pk": "GSI1PK",
        "#gsi1sk": "GSI1SK",
      },
    };
    const sentEmailsData = await Dynamo.scan(nomParams).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    /*
    const params = { TableName: commsTableName };
    const sentEmailsData = await Dynamo.scan(params).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });
    */
    /*
    const queryData = {
      KeyConditionExpression: "#type = :type",
      ExpressionAttributeValues: {
        ":type": "email",
      },
      ExpressionAttributeNames: {
        "#type": "type",
      },
    };
    const sentEmailsData = await Dynamo.query(queryData, commsTableName).catch(
      (err) => {
        console.log("error in dynamo query", err);
        return Responses._400({ messages: err });
      }
    );
    */

    if (!sentEmailsData) {
      return Responses._400({ message: "Failed to retrieve all via scan" });
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
