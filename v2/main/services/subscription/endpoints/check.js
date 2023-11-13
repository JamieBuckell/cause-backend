const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

exports.handler = async (event, context, cb) => {
  try {
    const { emailAddress, hash } = event.pathParameters;

    const envSalt = process.env.HASHING_SALT;
    const envHashPrefix = process.env.HASHING_PREFIX;
    const subscriberTableName = process.env.SUBSCRIBERS_TABLE;

    console.log("email verification for ", emailAddress);

    // Specifically Verify any subscriptions
    const subscriberQueryData = {
      KeyConditionExpression: "#pk= :pk And begins_with(#sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": emailAddress,
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

    console.log("subscriber found?", subscribers.length, subscribers);

    if (subscribers.length) {
      console.log("Subscriber found...");
      const existingSubscriber = subscribers[0];

      const hashCompare = Hashing.compare(existingSubscriber.SK, {
        salt: envSalt,
        hashedpassword: hash,
      });

      if (hashCompare) {
        console.log("Hash matched...");

        return Responses._200({
          messages: {
            success: "Subscription confirmed",
          },
          subscribed: existingSubscriber?.subscribed ?? false,
        });
      } else {
        console.log("Hash not matched...", hashCompare, hash, {
          salt: envSalt,
          hashedpassword: existingSubscriber.SK,
        });
      }
    }

    return Responses._400({
      messages: {
        error: "Subscription not found",
      },
    });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: {
        unexpected: "An unexpected error occurred. Please try again later",
      },
    });
  }
};
