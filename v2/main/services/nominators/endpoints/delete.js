const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Functions = require("../common/Functions");

const AWS = require("aws-sdk");
AWS.config.update({ region: "eu-west-2" });
const cognito = new AWS.CognitoIdentityServiceProvider({
  apiVersion: "2016-04-18",
});

exports.handler = async (event, context, cb) => {
  try {
    const isAdmin = Functions.hasPermission(event, "Admin");
    const isTeamLead = Functions.hasPermission(event, "TeamLead");

    if (!isAdmin && !isTeamLead) {
      return Responses._401({
        messages: {
          unauthorized: "You are not authorized to delete this nominator",
        },
      });
    }

    const { nominatorId } = event.pathParameters ?? {};
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;
    const userPoolId = process.env.USER_POOL;
    const userEmail = event.requestContext.authorizer.claims.email;

    const nominatorParams = {
      TableName: mainTableName,
      FilterExpression:
        "#gsi2pk = :gsi2pk AND begins_with(#gsi2sk, :gsi2sk)",
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
    const nominatorSearchData = await Dynamo.scan(
      nominatorParams
    );
    const nominatorData = nominatorSearchData.find(
      (item) =>
        item.GSI2PK === nominatorId &&
        ["nominator", "team-lead"].includes(item.type)
    );

    if (!nominatorData?.PK) {
      return Responses._400({
        messages: { error: "Nominator not found" },
      });
    }

    if (userEmail === nominatorData.nominatorDetails?.email) {
      return Responses._401({
        messages: { error: "You cannot delete yourself" },
      });
    }

    if (isTeamLead && !isAdmin) {
      const organisationId = nominatorData.GSI3PK;
      const leadParams = {
        TableName: mainTableName,
        FilterExpression:
          "#gsi3pk = :gsi3pk AND begins_with(#gsi3sk, :gsi3sk)",
        IndexName: "GSI3",
        ExpressionAttributeNames: {
          "#gsi3pk": "GSI3PK",
          "#gsi3sk": "GSI3SK",
        },
        ExpressionAttributeValues: {
          ":gsi3pk": organisationId ?? "UNKNOWN",
          ":gsi3sk": "LASTNAME#",
        },
      };
      const organisationNominators = await Dynamo.scan(leadParams);
      const leadData = organisationNominators.find(
        (item) =>
          item.SK === `EMAIL#${userEmail}` && item.type === "team-lead"
      );

      if (!organisationId || !leadData?.PK) {
        return Responses._401({
          messages: {
            unauthorized: "You are not authorized to delete this nominator",
          },
        });
      }
    }

    const emailAddress = nominatorData.nominatorDetails?.email;
    if (emailAddress) {
      try {
        await cognito
          .adminDeleteUser({
            UserPoolId: userPoolId,
            Username: emailAddress,
          })
          .promise();
      } catch (error) {
        if (error.code !== "UserNotFoundException") {
          console.log(`Cognito Auth Error! - ${error}`);
          return Responses._400({
            messages: { error: "Failed to delete the user's account" },
          });
        }
      }
    }

    await Dynamo.delete(
      { PK: nominatorData.PK, SK: nominatorData.SK },
      mainTableName
    );

    return Responses._200({ success: true });
  } catch (error) {
    console.log(`An unexpected error occurred ${error}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
