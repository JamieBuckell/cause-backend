const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

const AWS = require("aws-sdk");
AWS.config.update({ region: "eu-west-2" });
const cognito = new AWS.CognitoIdentityServiceProvider({
  apiVersion: "2016-04-18",
});

exports.handler = async (event, context, cb) => {
  console.log("Start", event);
  try {
    if (
      !Functions.hasPermission(event, "Admin") &&
      !Functions.hasPermission(event, "TeamLead") &&
      !Functions.hasPermission(event, "Nominator")
    ) {
      return Responses._401({
        messages: {
          unauthorized: "You are not authorized to view this section",
        },
      });
    }
    console.log("access granted...");

    const parsed = event?.requestId ? event : JSON.parse(event.body);
    if (!parsed?.requestId) {
      console.log(`An unexpected error occurred`, parsed);
      return Responses._400({
        messages: { unexpected: "An unexpected error occurred" },
      });
    }
    console.log("got parsed", parsed);
    const requestId = parsed.requestId;
    const campaignId = parsed.campaignId;

    const userEmail = event.requestContext.authorizer.claims.email;

    const userPoolId = process.env.USER_POOL_V2;
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;
    const appURL = process.env.APP_URL;

    var nominatorData = {};

    const params = {
      TableName: mainTableName,
      FilterExpression: "#pk = :pk",
      ExpressionAttributeNames: {
        "#pk": "PK",
      },
      ExpressionAttributeValues: {
        ":pk": campaignId,
      },
    };
    let allCampaignData = await Dynamo.scan(params).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });
    console.log("got allCampaignData", allCampaignData.length);

    if (
      Functions.hasPermission(event, "TeamLead") ||
      Functions.hasPermission(event, "Nominator")
    ) {
      console.log("Not an admin");
      const userNominatorData = allCampaignData.find(
        (cd) => cd?.SK === `EMAIL#${userEmail}`
      );
      console.log(userNominatorData);

      if (!userNominatorData?.PK) {
        console.log("Updating user not found...");
        return Responses._400({
          messages: { unexpected: "An unexpected error occurred" },
        });
      }

      if (requestId === userNominatorData.GSI2PK) {
        nominatorData = userNominatorData;
      } else {
        const nominatorQuery = allCampaignData.find(
          (cd) => cd?.SK === `EMAIL#${parsed?.originalEmail ?? "UNKNOWN"}`
        );

        if (
          !nominatorQuery.GSI2PK ||
          nominatorQuery.GSI2PK != requestId ||
          nominatorQuery.GSI3PK != userNominatorData.GSI2PK
        ) {
          console.log(
            "Unauth...",
            nominatorQuery,
            requestId,
            userNominatorData.GSI2PK
          );
          return Responses._401({
            messages: {
              unauthorized: "You are not authorized to view this section 2",
            },
          });
        }
        nominatorData = nominatorQuery;
      }
    } else {
      nominatorData = allCampaignData.find((cd) => cd?.GSI2PK === requestId);
      if (!nominatorData?.GSI2PK) {
        return Responses._200({ message: "Record not found", result: false });
      }
    }

    if (
      parsed?.status &&
      parsed.status != nominatorData.status &&
      parsed.status === "authorised"
    ) {
      const cognitoParams = {
        UserPoolId: userPoolId,
        Username: nominatorData?.nominatorDetails?.email,
        UserAttributes: [
          {
            Name: "email",
            Value: nominatorData?.nominatorDetails?.email,
          },
          {
            Name: "name",
            Value: `${nominatorData.fullName}`,
          },
        ],
        TemporaryPassword: Functions.generateP({ length: 8 }),
      };

      let response = await cognito.adminCreateUser(cognitoParams).promise();
    }

    const updateData = {
      ...nominatorData,
    };
    updateData.nominatorDetails = { ...updateData.nominatorDetails, ...parsed };
    console.log("Initial updateData", updateData);

    if (updateData?.nominatorDetails?.originalEmail) {
      if (
        updateData?.nominatorDetails?.originalEmail !=
        updateData?.nominatorDetails?.email
      ) {
        console.log(
          `Email address changed from ${
            updateData?.nominatorDetails?.originalEmail
          } to  ${updateData?.nominatorDetails?.email ?? ""}`
        );
        let existingCognitoUser = {};
        let doDelete = false;
        try {
          existingCognitoUser = await cognito
            .adminGetUser({
              UserPoolId: userPoolId,
              Username: updateData?.nominatorDetails?.originalEmail,
            })
            .promise();

          if (!existingCognitoUser) {
            console.log(
              `Cognito User not found: ${updateData?.nominatorDetails?.originalEmail}`
            );
          } else {
            doDelete = true;
          }
        } catch (e) {
          switch (e.code) {
            case "UserNotFoundException":
              break;
            default:
              console.log(`Cognito User Check Error! - ${e}`);
              break;
          }
        }

        let doCreate = true;
        try {
          existingCognitoUser = await cognito
            .adminGetUser({
              UserPoolId: userPoolId,
              Username: updateData?.nominatorDetails?.email ?? "",
            })
            .promise();

          if (existingCognitoUser) {
            console.log(
              `New email address in use: ${
                updateData?.nominatorDetails?.email ?? ""
              }`
            );
            return Responses._400({
              messages: { duplicate: "New email address already in use" },
            });
          } else {
            doCreate = true;
          }
        } catch (e) {
          switch (e.code) {
            case "UserNotFoundException":
              break;
            default:
              console.log(`Cognito User Check Error! - ${e}`);
              break;
          }
        }

        // Do Delete
        if (doDelete) {
          console.log("Original cognito user deleted");
          await cognito
            .adminDeleteUser({
              UserPoolId: userPoolId,
              Username: updateData?.nominatorDetails?.originalEmail,
            })
            .promise();
        }

        // Do Create
        if (doCreate) {
          console.log("New cognito user added");
          const validName = `${updateData?.nominatorDetails?.firstName} ${updateData?.nominatorDetails?.lastName}`;

          const cognitoParams = {
            MessageAction: "SUPPRESS",
            UserPoolId: userPoolId,
            Username: updateData?.nominatorDetails?.email ?? "",
            UserAttributes: [
              {
                Name: "email",
                Value: updateData?.nominatorDetails?.email ?? "",
              },
              {
                Name: "email_verified",
                Value: "true",
              },
              {
                Name: "name",
                Value: `${validName}`,
              },
            ],
            TemporaryPassword: Functions.generateP({ length: 8 }),
          };
          const congitoUser = await cognito
            .adminCreateUser(cognitoParams)
            .promise();
          updateData.nominatorDetails.cognitoId =
            congitoUser.User.Attributes.find((a) => a.Name === "sub").Value;

          const cognitoGroupParams = {
            GroupName:
              updateData?.type === "team-lead" ? "TeamLead" : "Nominator",
            UserPoolId: userPoolId,
            Username: updateData?.nominatorDetails?.email ?? "",
          };
          await cognito.adminAddUserToGroup(cognitoGroupParams).promise();

          const emailTemplateNominator = {
            appURL,
            nominator: {
              firstName: updateData?.nominatorDetails?.firstName,
              email: updateData?.nominatorDetails?.email ?? "",
              password: cognitoParams.TemporaryPassword,
            },
          };
          const emailAccountTemplateParams = await Functions.getEmailTemplate(
            "newNominatorConfirmation",
            emailTemplateNominator
          );
          const jsonNominatorParameters = {
            ToAddresses: [updateData?.nominatorDetails?.email ?? ""],
            ...emailAccountTemplateParams,
          };
          await Notifications.sendTransactionalEmail(jsonNominatorParameters);
        }
      }
      delete updateData?.nominatorDetails?.originalEmail;
    }

    if (updateData?.campaignId) {
      delete updateData.campaignId;
    }

    if (updateData?.nominatorDetails?.fullName) {
      delete updateData.nominatorDetails.fullName;
    }

    console.log("Final updateData", updateData);
    console.log("Update nominator data");
    await Dynamo.write(updateData, mainTableName).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    return Responses._200({ success: true, nominator: updateData });

    /* */
  } catch (e) {
    console.log(`An unexpected error occurred`, e);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
