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
    if (!Functions.hasPermission(event, "Admin")) {
      return Responses._401({
        messages: {
          unauthorized: "You are not authorized to view this section",
        },
      });
    }

    const mainTableName = process.env.MAIN_DYNAMO_TABLE;
    const appURL = process.env.APP_URL;
    const userPoolId = process.env.USER_POOL;
    const { nominatorId } = event.pathParameters;

    const nomParams = {
      TableName: mainTableName,
      FilterExpression: "#gsi2pk = :gsi2pk AND begins_with(#gsi2sk, :gsi2sk)",
      IndexName: "GSI2",
      ExpressionAttributeNames: {
        "#gsi2pk": "GSI2PK",
        "#gsi2sk": "GSI2SK",
      },
      ExpressionAttributeValues: {
        ":gsi2pk": nominatorId ?? "UNKNOWN",
        ":gsi2sk": "SK#",
      },
    };
    const nomSearchData = await Dynamo.scan(nomParams).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });
    const nominatorData = nomSearchData.find((o) => o.GSI2PK === nominatorId);

    const userEmail = nominatorData?.nominatorDetails?.email;
    if (!userEmail) {
      return Responses._200({ message: "Nominator not found", result: false });
    }
    if (!nominatorData.nominatorDetails.cognitoId) {
      return Responses._400({
        messages: { error: "User does not have a full user account." },
      });
    }

    const cognitoCheckParams = {
      UserPoolId: userPoolId,
      AttributesToGet: ["email"],
      Limit: 25,
      Filter: 'email="' + userEmail + '"',
    };
    const cognitoCheck = await cognito.listUsers(cognitoCheckParams).promise();
    if (!cognitoCheck?.Users.length) {
      console.log(`Cannot find ${userEmail}`, nominatorData);
      return Responses._400({ messages: { error: "User not found" } });
    }
    const congitoUser = cognitoCheck.Users[0];
    console.log(congitoUser);
    const cognitoId = congitoUser.Username;

    const userPassword = Functions.generateP({ length: 8 });
    const passwordSetParams = {
      Password: userPassword,
      Permanent: false,
      Username: cognitoId,
      UserPoolId: userPoolId,
    };
    await cognito.adminSetUserPassword(passwordSetParams).promise();
    if (cognitoId != nominatorData.nominatorDetails.cognitoId) {
      console.log(
        `Updating Cognito ID from ${nominatorData.nominatorDetails.cognitoId} to ${cognitoId}`
      );
      nominatorData.nominatorDetails.cognitoId = cognitoId;
      await Dynamo.write(nominatorData, mainTableName).catch((err) => {
        console.log("error in dynamo write", err);
        return Responses._400({ messages: err });
      });
    }

    const emailTemplateNominator = {
      appURL,
      nominator: {
        firstName: nominatorData?.nominatorDetails?.firstName,
        email: userEmail,
        password: userPassword,
      },
    };
    const emailAccountTemplateParams = await Functions.getEmailTemplate(
      "nominatorResetConfirmation",
      emailTemplateNominator
    );
    const jsonNominatorParameters = {
      ToAddresses: [userEmail],
      ...emailAccountTemplateParams,
    };
    await Notifications.sendTransactionalEmail(jsonNominatorParameters);

    return Responses._200({ success: true });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
