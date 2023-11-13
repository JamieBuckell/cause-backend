const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

const moment = require("moment-timezone");

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
    const escapeRegEx = new RegExp(/(<([^>]+)>)/gi);
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
      return Responses._400({ messages: err });
    });

    if (familyData.length) {
      const familyToDelete = familyData[0];

      await Dynamo.delete(
        { PK: familyToDelete?.PK, SK: familyToDelete?.SK },
        mainTableName
      ).catch((err) => {
        console.log("error in dynamo query", err);
        return Responses._400({ messages: err });
      });

      return Responses._200({
        messages: {
          success: `Family deleted successfully`,
        },
      });
    }
    console.log("family data recieved...", familyData.length);

    console.log(familyData);

    /* *
    if (familyData?.status == 'Allocated') {
      return Responses._400({ messages: { 'error': 'This family has been assigned to a donor, please contact us to delete it.' } });
  }
  /* */

    return Responses._400({
      messages: { notfound: "Invalid Family" },
    });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
