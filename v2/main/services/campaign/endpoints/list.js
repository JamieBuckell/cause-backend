const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
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

    const mainTableName = process.env.MAIN_DYNAMO_TABLE;
    let usersCampaigns = [];
    if (!Functions.hasPermission(event, "Admin")) {
      const userEmail = event.requestContext.authorizer.claims.email;

      const params = {
        TableName: mainTableName,
        FilterExpression: "#sk = :sk",
        ExpressionAttributeNames: {
          "#sk": "SK",
        },
        ExpressionAttributeValues: {
          ":sk": `EMAIL#${userEmail}`,
        },
      };
      usersCampaigns = await Dynamo.scan(params).catch((err) => {
        console.log("error in dynamo query", err);
        return Responses._400({ messages: err });
      });

      usersCampaigns = usersCampaigns.map((u) => u?.PK);
    }

    const params = {
      TableName: mainTableName,
      FilterExpression: "#type = :type",
      ExpressionAttributeNames: {
        "#type": "type",
      },
      ExpressionAttributeValues: {
        ":type": "campaign",
      },
    };
    let allCampaigns = await Dynamo.scan(params).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    if (!Functions.hasPermission(event, "Admin")) {
      allCampaigns = allCampaigns.filter((c) => usersCampaigns.includes(c?.PK));
    }
    allCampaigns = allCampaigns.filter((c) => !("status" in c) || c.status);

    if (!allCampaigns) {
      return Responses._400({ message: "Failed to find campaign data" });
    }

    return Responses._200([...allCampaigns]);
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
