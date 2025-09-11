const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

const { nanoid } = require("nanoid");
const moment = require("moment-timezone");
const validations = [
  {
    key: "firstname",
    required: true,
    pattern: new RegExp(/[a-zA-ZÀ-ÖØ-öø-ÿ.\-\s']{1,50}/i),
    errorMsg: "Please enter a valid first name",
  },
  {
    key: "lastname",
    required: true,
    pattern: new RegExp(/[a-zA-ZÀ-ÖØ-öø-ÿ.\-\s']{1,50}/i),
    errorMsg: "Please enter a valid last name",
  },
  {
    key: "email",
    required: true,
  },
  {
    key: "company",
    required: false,
    pattern: new RegExp(/[a-zA-ZÀ-ÖØ-öø-ÿ.\-\s']{1,50}/i),
    errorMsg: "Please enter a valid company name",
  },
];

exports.handler = async (event, context, cb) => {
  try {
    if (!Functions.hasPermission(event, "Admin")) {
      console.log(
        "Access Denied!",
        event?.requestContext?.authorizer?.claims["cognito:groups"]
      );
      return Responses._401({
        messages: {
          unauthorized: "You are not authorized to view this section",
        },
      });
    }

    const subscriberTableName = process.env.SUBSCRIBERS_TABLE;
    const envHashPrefix = process.env.HASHING_PREFIX;

    const parsed = event.emailAddress ? event : JSON.parse(event.body);

    const valid = await Functions.validateSubmission(parsed, validations);
    if (Object.keys(valid).length > 0) {
      return Responses._400({ messages: valid });
    }

    const escapeRegEx = new RegExp(/(<([^>]+)>)/i);

    const validEmail = parsed.email
      .toString()
      .replace(escapeRegEx, "")
      .toLowerCase();

    // Specifically Verify any subscriptions
    const subscriberQueryData = {
      KeyConditionExpression: "#pk= :pk And begins_with(#sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": validEmail,
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

    if (subscribers.length) {
      return Responses._400({
        messages: { error: "Subscriber already exists" },
      });
    }

    // use replace for extra layer of security
    const validFirstName = parsed.firstname.toString().replace(escapeRegEx, "");
    const validLastName = parsed.lastname.toString().replace(escapeRegEx, "");
    const validCompany = parsed.company
      ? parsed.company.toString().replace(escapeRegEx, "")
      : "";
    const validTelephone = parsed.telephone
      ? parsed.telephone.toString().replace(escapeRegEx, "")
      : "";
    const validHowHeard = parsed.howHeard
      ? parsed.howHeard.toString().replace(escapeRegEx, "")
      : "";

    const timezone = process.env.TIMEZONE;
    const dateFormat = process.env.DATE_FORMAT;
    const timeStamp = moment(new Date().getTime())
      .tz(timezone)
      .format(dateFormat);

    let subscriptionData = {
      PK: validEmail,
      SK: `${envHashPrefix}${nanoid(12)}`,
      firstName: validFirstName,
      lastName: validLastName,
      company: validCompany,
      telephone: validTelephone,
      subscribed: true,
      dateAdded: timeStamp,
      dateSubscribed: timeStamp,
      dateVerified: timeStamp,
      verified: true,
      bounced: "",
      bouncedDetail: "",
      howHeard: validHowHeard,
    };

    console.log(`Create Subscriber: ${subscriptionData}`);

    const subscriberRequest = await Dynamo.write(
      subscriptionData,
      subscriberTableName
    ).catch((err) => {
      console.log("error in dynamo write", err);
      return Responses._400({ messages: err });
    });

    if (!subscriberRequest) {
      return Responses._400({ message: "Failed to write db by ID" });
    }

    return Responses._200({
      messages: { success: "Subscriber creaated successfully" },
      subscriberId: subscriptionData.PK,
    });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
