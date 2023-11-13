const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

const validations = [
  {
    key: "details",
    required: true,
    errorMsg: "Change details is required",
  },
];
exports.handler = async (event, context, cb) => {
  try {
    const { emailAddress } = event.pathParameters;
    const { v, c } = event.queryStringParameters;
    const envSalt = process.env.HASHING_SALT;

    const mainTableName = process.env.MAIN_DYNAMO_TABLE;
    const appURL = process.env.APP_URL;

    const parsed = event.donorId ? event : JSON.parse(event.body);

    console.log("Change Pledge Request", c, v, parsed);

    const valid = await Functions.validateSubmission(parsed, validations);
    if (Object.keys(valid).length > 0) {
      return Responses._400({ messages: valid });
    }

    const donorQueryData = {
      KeyConditionExpression: "#pk= :pk AND #sk= :sk",
      ExpressionAttributeValues: {
        ":pk": c,
        ":sk": `EMAIL#D#${emailAddress}`,
      },
      ExpressionAttributeNames: {
        "#pk": "PK",
        "#sk": "SK",
      },
    };
    var donorData = await Dynamo.query(donorQueryData, mainTableName).catch(
      (err) => {
        console.log("error in dynamo query", err);
        return Responses._400({ messages: err });
      }
    );

    if (donorData && donorData[0]) {
      const existingDonor = donorData[0];
      console.log("Donor Found", existingDonor);

      const hashCompare = Hashing.compare(
        existingDonor.emailVerification.hash,
        {
          salt: envSalt,
          hashedpassword: v,
        }
      );

      if (hashCompare) {
        console.log("Hash matched");
        /* */
        const donorManageLink = `${appURL}/donors/view/${existingDonor.GSI2PK}`;
        const jsonParameters = {
          subject: "CAUSE Foundation: Pledge Change Request",
          messageBody: `A donor has request a change to their hamper allocation:<br /><br /><strong>Donor:</strong> ${emailAddress}<br /><strong>Request:</strong><br />${parsed.details}<br /><br /><strong>Manage Donor: </strong><a href="${donorManageLink}">${donorManageLink}</a>`,
        };
        await Notifications.sendInternalEmail(jsonParameters);
        /* */

        return Responses._200({
          messages: { success: "Thank you, your request has been received." },
        });
      } else {
        console.log(
          "Hash not matched...",
          hashCompare,
          existingDonor.emailVerification.hash,
          {
            salt: envSalt,
            hashedpassword: v,
          }
        );
      }
    } else {
      console.log(`Cannot find donor!`, emailAddress, "for campaign", c);
    }
    return Responses._400({
      messages: {
        unexpected: "An unexpected error occurred. Please try again later",
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
