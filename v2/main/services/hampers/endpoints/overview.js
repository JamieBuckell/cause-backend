const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");

exports.handler = async (event, context, cb) => {
  try {
    if (!Functions.hasPermission(event, "Admin")) {
      // return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
    }
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;

    const familiesTableName = process.env.FAMILIES_TABLE;

    const { hamperRef } = event.pathParameters;
    const campaignId = Functions.defaultCampaign();

    const campaignQueryData = {
      TableName: mainTableName,
      FilterExpression: "#pk= :pk AND begins_with(#sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": campaignId,
        ":sk": "REF#",
      },
      ExpressionAttributeNames: {
        "#pk": "PK",
        "#sk": "SK",
      },
    };
    var campaignData = await Dynamo.scan(campaignQueryData).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    const hamper = campaignData.find(
      (h) => h.GSI2SK === `SK#${hamperRef}` && h.status != "deleted"
    );

    if (hamper && hamper?.PK) {
      const hamperDetail = {
        hashKey: hamper.requestId,
        reference: hamperRef,
        hasFeedback: hamper?.feedback && hamper?.feedback !== "",
        receiveStatus: hamper?.receiveStatus,
        bagsReceived: hamper?.bagsReceived ?? 0,
      };

      return Responses._200({ hamper: hamperDetail, success: true });
    } else {
      console.log("Hamper not found");
    }

    return Responses._200({ messages: { error: "Hamper not found" } });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
