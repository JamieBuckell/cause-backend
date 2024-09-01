const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");

const moment = require("moment-timezone");

exports.handler = async (event, context, cb) => {
  try {
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;

    const params = {
      IndexName: "GSI2",
      KeyConditionExpression: "#pk= :pk AND #sk= :sk",
      ExpressionAttributeValues: {
        ":pk": "campaign",
        ":sk": `SK#A`,
      },
      ExpressionAttributeNames: {
        "#pk": "GSI2PK",
        "#sk": "GSI2SK",
      },
    };
    let allCampaignData = await Dynamo.query(params, mainTableName).catch(
      (err) => {
        console.log("error in dynamo query", err);
        return Responses._400({ messages: err });
      }
    );

    console.log(allCampaignData);

    const activeCampaigns = allCampaignData.length
      ? allCampaignData.filter(
          (c) =>
            moment().isBefore(moment(c.campaignDetails.registrationClosed)) &&
            moment().isAfter(moment(c.campaignDetails.registrationOpen))
        )
      : [];
    return Responses._200({
      campaignActive: activeCampaigns.length > 0,
      campaignKeys:
        activeCampaigns.length > 0 ? activeCampaigns.map((c) => c?.PK) : [],
    });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
