const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

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

    const userEmail = event.requestContext.authorizer.claims.email;

    const parsed = event.donorId ? event : JSON.parse(event.body);
    const campaignId = parsed.campaign ?? null;

    console.log(`${userEmail} is attempting to delete donor ${parsed.donorId}`);

    const params = {
      TableName: mainTableName,
      FilterExpression: "#pk = :pk and #type = :type",
      ExpressionAttributeNames: {
        "#pk": "PK",
        "#type": "type",
      },
      ExpressionAttributeValues: {
        ":pk": campaignId,
        ":type": "donor",
      },
    };
    let allDonorData = await Dynamo.scan(params).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    const donor = allDonorData.find((d) => d.GSI2PK === parsed.donorId);

    if (!donor?.PK || !donor?.SK) {
      console.log("Donor not found", donor, campaignId, parsed, allDonorData);
      return Responses._400({
        messages: { error: "There was an error matching the Donor IDs." },
      });
    }

    donor.status = "deleted";
    await Dynamo.write(donor, mainTableName).catch((err) => {
      console.log("error in dynamo write (deleted)", err);
      return Responses._400({ messages: err });
    });

    //Todo: Unallocate families
    //Todo: Unallocate family members

    return Responses._200({
      messages: { success: "Donor deleted successfully" },
    });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
