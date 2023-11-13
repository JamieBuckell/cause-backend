const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

exports.handler = async (event, context, cb) => {
  try {
    if (
      !Functions.hasPermission(event, "Admin") &&
      !Functions.hasPermission(event, "TeamLead")
    ) {
      console.log("You are not authorized to view this section", event);
      return Responses._401({
        messages: {
          unauthorized: "You are not authorized to view this section",
        },
      });
    }

    const { nominatorId, organisationId } = event.pathParameters;

    const userEmail = event.requestContext.authorizer.claims.email;
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;
    const validUserTypes = ["team-lead", "nominator"];

    const nomParams = {
      TableName: mainTableName,
      FilterExpression: "#gsi3pk = :gsi3pk AND begins_with(#gsi3sk, :gsi3sk)",
      IndexName: "GSI3",
      ExpressionAttributeNames: {
        "#gsi3pk": "GSI3PK",
        "#gsi3sk": "GSI3SK",
      },
      ExpressionAttributeValues: {
        ":gsi3pk": organisationId,
        ":gsi3sk": "LASTNAME#",
      },
    };
    const nomSearchData = await Dynamo.scan(nomParams).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });
    if (!nomSearchData.length) {
      console.log(organisationId, "Organisation not found");
      return Responses._400({ messages: { error: "Organisation not found" } });
    }

    let lead = {};

    if (Functions.hasPermission(event, "TeamLead")) {
      lead = nomSearchData.find(
        (n) => n.SK === `EMAIL#${userEmail}` && n?.type === "team-lead"
      );

      if (!lead?.PK) {
        console.log(userEmail, "is not authorized to view this section");
        return Responses._401({
          messages: {
            unauthorized: "You are not authorized to view this section",
          },
        });
      }
    }

    const nominatorData = nomSearchData.find(
      (n) => n.GSI2PK === nominatorId && validUserTypes.includes(n?.type)
    );

    if (!nominatorData?.PK) {
      console.log("Nominator not found", nominatorData, nomSearchData);
      return Responses._400({ messages: { error: "Nominator not found" } });
    }

    nominatorData.status = "Approved";
    await Dynamo.write(nominatorData, mainTableName).catch((err) => {
      console.log("error in dynamo write", err);
      return Responses._400({ messages: err });
    });

    console.log("Success", nominatorData);
    return Responses._200({
      messages: { success: "Nominator successfully approved" },
    });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
