const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

const AWS = require("aws-sdk");
AWS.config.update({ region: "eu-west-2" });
const cognito = new AWS.CognitoIdentityServiceProvider({
  apiVersion: "2016-04-18",
});

exports.handler = async (event, context, cb) => {
  try {
    const { emailAddress, verificationHash } = {
      emailAddress: (event.pathParameters.emailAddress || "")
        .replace(escapeRegEx, "")
        .toLowerCase(),
    };
    const nomTableName = process.env.NOMINATORS_TABLE;
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;
    const appURL = process.env.APP_URL;
    const envSalt = process.env.HASHING_SALT;
    const userPoolId = process.env.USER_POOL;

    console.log(
      `${emailAddress} is attempting to commit their password reset.`
    );

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
    nominatorData = await Dynamo.scan(params).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    if (nominatorData[0]?.nominatorDetails?.cognitoId) {
      if (nominatorData[0]?.emailVerification?.resetPasswordHash) {
        const nominator = nominatorData[0];

        const hashCompare = Hashing.compare(nominator.GSI2PK, {
          salt: envSalt + nominator.emailVerification.resetPasswordHash,
          hashedpassword: verificationHash,
        });

        if (hashCompare) {
          const temporaryPassword = Functions.generateP({ length: 8 });
          const cognitoParams = {
            UserPoolId: userPoolId,
            Username: nominator.nominatorDetails.email,
            Password: temporaryPassword,
            Permanent: false,
          };
          await cognito.adminSetUserPassword(cognitoParams).promise();

          const emailTemplate = {
            temporaryPassword,
            appURL,
            nominator: nominator.nominatorDetails,
          };
          const emailAccountTemplateParams = await Functions.getEmailTemplate(
            "userPasswordResetConfirm",
            emailTemplate
          );
          const jsonAccountParameters = {
            ToAddresses: [nominator.nominatorDetails.email],
            ...emailAccountTemplateParams,
          };
          console.log("Send email", emailTemplate, jsonAccountParameters);
          await Notifications.sendTransactionalEmail(jsonAccountParameters);

          nominator.emailVerification.resetPasswordHash = "";
          await Dynamo.write(nominator, nomTableName).catch((err) => {
            console.log("error in dynamo write", err);
            return Responses._400({ messages: err });
          });
        } else {
          console.log(`Invalid hash: ${verificationHash}`);
          return Responses._400({
            messages: { error: "Your password reset link has expired" },
          });
        }
      } else {
        console.log(
          `No password reset hash: ${nominatorData[0]?.emailVerification.resetPasswordHash}`
        );
        return Responses._400({
          messages: { error: "Your password reset link has expired" },
        });
      }
    } else {
      console.log(`Nominator not found: ${JSON.stringify(nominatorData)}`);
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
