const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

const AWS = require("aws-sdk");
AWS.config.update({ region: "eu-west-2" });
const cognito = new AWS.CognitoIdentityServiceProvider({ apiVersion: "2016-04-18" });

exports.handler = async (event, context, cb) => {
  try {
    const rawEmail = event.pathParameters?.emailAddress ?? "";
    const decodedEmail = rawEmail.includes("@") ? rawEmail : decodeURIComponent(rawEmail);
    const { emailAddress } = {
      emailAddress: decodedEmail
        .replace(/(<([^>]+)>)/gi, "")
        .toLowerCase(),
    };
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;
    const appURL = process.env.APP_URL;
    const envSalt = process.env.HASHING_SALT;

    console.log(`${emailAddress} is attempting to reset their password.`);

    const params = {
      TableName: mainTableName,
      FilterExpression: "#sk = :sk",
      ExpressionAttributeNames: {
        "#sk": "SK",
      },
      ExpressionAttributeValues: {
        ":sk": `EMAIL#${emailAddress}`,
      },
    };
    const nominatorData = await Dynamo.scan(params);

    // Admins can exist only in Cognito. Store their reset state separately
    // so that it cannot be mistaken for a campaign/nominator record.
    if (!nominatorData.some(user => user?.nominatorDetails?.cognitoId)) {
      const result = await cognito.listUsers({
        UserPoolId: process.env.USER_POOL,
        Filter: `email = "${emailAddress.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
        Limit: 2,
      }).promise();
      if (result.Users?.length === 1 && result.Users[0].Enabled) {
        const user = result.Users[0];
        const attributes = Object.fromEntries((user.Attributes ?? []).map(a => [a.Name, a.Value]));
        nominatorData.unshift({
          PK: `PASSWORD_RESET#${user.Username}`,
          SK: `PASSWORD_RESET#${emailAddress}`,
          type: "password-reset",
          resetUserId: user.Username,
          nominatorDetails: {
            cognitoId: user.Username,
            email: attributes.email,
            firstName: attributes.given_name || attributes.name || "",
          },
        });
      }
    }
    const account = nominatorData.find(user => user?.nominatorDetails?.cognitoId);
    if (account) {
      const nominator = account;
      nominator.emailVerification = nominator.emailVerification ?? {};
      nominator.emailVerification.resetPasswordHash =
        Hashing.generateSalt(14) + "-" + Hashing.generateSalt(14);
      await Dynamo.write(nominator, mainTableName);

      const urlHash = Hashing.hash(
        nominator.resetUserId ?? nominator.GSI2PK,
        envSalt + nominator.emailVerification.resetPasswordHash
      ).hashedpassword;
      const resetPasswordLink = `${appURL}/reset-password/${nominator.nominatorDetails.email}/${urlHash}`;

      const emailTemplate = {
        resetPasswordLink,
        nominator: nominator.nominatorDetails,
      };
      const emailAccountTemplateParams = await Functions.getEmailTemplate(
        "userPasswordResetInit",
        emailTemplate
      );
      const jsonAccountParameters = {
        ToAddresses: [nominator.nominatorDetails.email],
        ...emailAccountTemplateParams,
      };
      await Notifications.sendTransactionalEmail(jsonAccountParameters);
    } else {
      console.log("Password reset account not found");
      return Responses._400({
        messages: { unexpected: "An unexpected error occurred" },
      });
    }

    return Responses._200({ success: true });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
