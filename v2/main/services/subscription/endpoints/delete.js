const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
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

    const { emailAddress } = event.pathParameters;
    const subscriberTableName = process.env.SUBSCRIBERS_TABLE;
    const envHashPrefix = process.env.HASHING_PREFIX;

    console.log("delete ", emailAddress);

    const subscriberParams = {
      KeyConditionExpression: "#pk= :pk AND begins_with(#sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": emailAddress,
        ":sk": envHashPrefix,
      },
      ExpressionAttributeNames: {
        "#pk": "PK",
        "#sk": "SK",
      },
    };

    const existingSubscriber = await Dynamo.query(
      subscriberParams,
      subscriberTableName
    ).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    if (existingSubscriber.length) {
      const subscriber = existingSubscriber[0];
      await Dynamo.delete(
        { PK: subscriber?.PK, SK: subscriber?.SK },
        subscriberTableName
      ).catch((err) => {
        console.log("error in dynamo query", err);
        return Responses._400({ messages: err });
      });
      return Responses._200({ messages: { success: "Subscriber deleted" } });
    } else {
      return Responses._400({
        messages: { error: "Subscriber not found" },
      });
    }
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
