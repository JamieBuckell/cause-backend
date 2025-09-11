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
    if (
      !Functions.hasPermission(event, "Admin") &&
      !Functions.hasPermission(event, "TeamLead")
    ) {
      return Responses._401({
        messages: {
          unauthorized: "You are not authorized to view this section",
        },
      });
    }

    const { organisationId, emailAddress } = event.pathParameters;
    const userType = event.pathParameters?.userType ?? false;
    const userEmail = event.requestContext.authorizer.claims.email;
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;
    const userPoolId = process.env.USER_POOL;

    console.log(
      `${userEmail} is attempting to delete ${emailAddress} from org id: ${organisationId}`
    );

    if (userEmail == emailAddress) {
      return Responses._401({
        messages: { error: "You cannot delete yourself" },
      });
    }

    const params = {
      TableName: mainTableName,
      FilterExpression: "#gsi2pk = :gsi2pk AND begins_with(#gsi2sk, :gsi2sk)",
      IndexName: "GSI2",
      ExpressionAttributeNames: {
        "#gsi2pk": "GSI2PK",
        "#gsi2sk": "GSI2SK",
      },
      ExpressionAttributeValues: {
        ":gsi2pk": organisationId ?? "UNKNOWN",
        ":gsi2sk": "SK#",
      },
    };
    let orgsSearchData = await Dynamo.scan(params).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    const organisationData = orgsSearchData.find(
      (o) => o.GSI2PK === organisationId
    );

    if (organisationData?.PK || userType === "admin") {
      if (organisationData?.PK) {
        console.log("Org Found", organisationData);
        const campaignId = organisationData?.PK;

        const campaignParams = {
          TableName: mainTableName,
          FilterExpression: "#pk = :pk",
          ExpressionAttributeNames: {
            "#pk": "PK",
          },
          ExpressionAttributeValues: {
            ":pk": campaignId ?? "UNKNWON",
          },
        };
        let allCampaignData = await Dynamo.scan(campaignParams).catch((err) => {
          console.log("error in dynamo query", err);
          return Responses._400({ messages: err });
        });

        if (Functions.hasPermission(event, "TeamLead")) {
          const leadData = allCampaignData.find(
            (o) =>
              o?.GSI3PK === organisationId &&
              o?.SK === `EMAIL#${userEmail}` &&
              o?.type === "team-lead"
          );

          if (!leadData || !leadData.length) {
            console.log("Lead not found");
            return Responses._401({
              messages: {
                unauthorized: "You are not authorized to view this section",
              },
            });
          }
        }
        const nominatorData = allCampaignData.find(
          (o) =>
            o?.GSI3PK === organisationId && o?.SK === `EMAIL#${emailAddress}`
        );

        // Delete the nominator if they exist...
        // Todo: also delete any data they have created!
        if (nominatorData?.PK) {
          await Dynamo.delete(
            { PK: nominatorData.PK, SK: nominatorData.SK },
            mainTableName
          ).catch((err) => {
            console.log("error in dynamo query 2", err, nominatorData.GSI2PK);
            return Responses._400({ messages: err });
          });

          // Todo: Figure out how we delete this once the data is in...
          /* *
        const nomFamilyQueryData = {
          IndexName: "nominatorRequest",
          KeyConditionExpression: "nominatorId = :nominatorId",
          ExpressionAttributeValues: {
            ":nominatorId": nominatorData[0]?.requestId,
          },
        };
        const nomFamilyData = await Dynamo.query(
          nomFamilyQueryData,
          familiesTableName
        ).catch((err) => {
          console.log("error in dynamo query 3", err);
          console.log(nomFamilyQueryData, familiesTableName);
          return Responses._400({ messages: err });
        });

        if (nomFamilyData.length) {
          for (const family of nomFamilyData) {
            await Dynamo.delete(
              { requestId: family.requestId },
              familiesTableName
            ).catch((err) => {
              console.log("error in dynamo query 4", err, family.requestId);
              return Responses._400({ messages: err });
            });
          }
        }
        /* */
          /* *
        const nomFamilyMembersQueryData = {
          IndexName: "nominatorRequest",
          KeyConditionExpression: "nominatorId = :nominatorId",
          ExpressionAttributeValues: {
            ":nominatorId": nominatorData[0]?.requestId,
          },
        };
        const nomFamilyMembersData = await Dynamo.query(
          nomFamilyMembersQueryData,
          familyMembersTableName
        ).catch((err) => {
          console.log("error in dynamo query 5", err);
          console.log(nomFamilyMembersQueryData, familyMembersTableName);
          return Responses._400({ messages: err });
        });

        if (nomFamilyMembersData.length) {
          for (const familyMember of nomFamilyMembersData) {
            await Dynamo.delete(
              { requestId: familyMember.requestId },
              familyMembersTableName
            ).catch((err) => {
              console.log(
                "error in dynamo query 6",
                err,
                familyMember.requestId
              );
              return Responses._400({ messages: err });
            });
          }
        }
        /* */
        } else {
          console.log(`Nominator not found: ${JSON.stringify(nominatorData)}`);
        }
      }

      try {
        const existingCognitoUser = await cognito
          .adminGetUser({
            UserPoolId: userPoolId,
            Username: emailAddress,
          })
          .promise();

        if (existingCognitoUser) {
          await cognito
            .adminDeleteUser({
              UserPoolId: userPoolId,
              Username: emailAddress,
            })
            .promise();
        } else {
          console.log(`Cognito User not found: ${emailAddress}`);
        }
      } catch (e) {
        console.log(`Cognito Auth Error! - ${e}`);
        return Responses._200({ success: true });
      }

      return Responses._200({ success: true });
    } else {
      console.log(`Organisation not found ${organisationId}`);
      return Responses._400({
        messages: { unexpected: "Organisation not found" },
      });
    }
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
