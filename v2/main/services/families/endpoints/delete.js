const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const { deleteFamily } = require("../common/DeleteFamily");
const Functions = require("../common/Functions");

exports.handler = async (event, context, cb) => {
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

    console.log("We are authorised...");

    const { familyId } = event.pathParameters;
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;

    const userEmail = event.requestContext.authorizer.claims.email;

    const familyParams = {
      TableName: mainTableName,
      FilterExpression: "#gsi2pk = :gsi2pk",
      ExpressionAttributeNames: {
        "#gsi2pk": "GSI2PK",
      },
      ExpressionAttributeValues: {
        ":gsi2pk": familyId ?? "UNKNOWN",
      },
    };
    let familyData = await Dynamo.scan(familyParams).catch((err) => {
      console.log("error in dynamo query", err);
      throw err;
    });

    if (familyData.length === 1) {
      const familyToDelete = familyData[0];

      if (familyToDelete.type !== "family") {
        return Responses._400({ messages: { error: "Family not found" } });
      }
      if (!Functions.hasPermission(event, "Admin")) {
        const actors = await Dynamo.query({
          KeyConditionExpression: "#pk = :pk AND #sk = :sk",
          ExpressionAttributeNames: { "#pk": "PK", "#sk": "SK" },
          ExpressionAttributeValues: { ":pk": familyToDelete.PK, ":sk": `EMAIL#${userEmail}` },
        }, mainTableName);
        const actor = actors.find(row => row.status !== "deleted" && ["nominator", "team-lead"].includes(row.type));
        if (!actor?.GSI3PK || actor.GSI3PK !== familyToDelete.GSI3PK ||
            (!Functions.hasPermission(event, "TeamLead") && actor.GSI2PK !== familyToDelete.GSI3SK)) {
          return Responses._401({ messages: { unauthorized: "You cannot delete this family" } });
        }
      }
      await deleteFamily(familyToDelete, userEmail);

      return Responses._200({
        messages: {
          success: `Family deleted successfully`,
        },
      });
    }
    return Responses._400({
      messages: { notfound: "Invalid Family" },
    });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: e.code ? "Could not delete the family. Refresh and try again." : e.message },
    });
  }
};
