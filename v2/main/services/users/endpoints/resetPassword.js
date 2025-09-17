const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

exports.handler = async (event, context, cb) => {
  try {
    const { emailAddress } = {
      emailAddress: (event.pathParameters.emailAddress || "")
        .replace(escapeRegEx, "")
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
    nominatorData = await Dynamo.scan(params).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    console.log(nominatorData);
    if (nominatorData[0]?.nominatorDetails?.cognitoId) {
      const nominator = nominatorData[0];
      nominator.emailVerification.resetPasswordHash =
        Hashing.generateSalt(14) + "-" + Hashing.generateSalt(14);
      await Dynamo.write(nominator, mainTableName).catch((err) => {
        console.log("error in dynamo write", err);
        return Responses._400({ messages: err });
      });

      const urlHash = Hashing.hash(
        nominator.GSI2PK,
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
