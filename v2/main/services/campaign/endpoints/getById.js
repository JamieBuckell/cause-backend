const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
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
    const { campaignId } = event.pathParameters;
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;
    const subscribersTableName = process.env.SUBSCRIBERS_TABLE;

    const envSalt = process.env.HASHING_SALT;

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

    let allSubscribers = [];
    if (
      !Functions.hasPermission(event, "TeamLead") &&
      !Functions.hasPermission(event, "Nominator")
    ) {
      const subscriberParams = { TableName: subscribersTableName };
      allSubscribers = await Dynamo.scan(subscriberParams).catch((err) => {
        console.log("error in dynamo query", err);
        return Responses._400({ messages: err });
      });
    }

    let donors = [
      ...allCampaignData.filter(
        (d) => d.type === "donor" && d?.status !== "deleted"
      ),
    ];

    let organisations = [
      ...allCampaignData
        .filter((o) => o.type === "organisation" && o?.status !== "deleted")
        .map((o) => {
          o.urlHash = Hashing.hash(
            o.hash.data,
            envSalt + o.hash.salt
          ).hashedpassword;
          delete o.hashedData;
          delete o.hashSalt;
          return o;
        }),
    ];
    let nominators = [
      ...allCampaignData.filter(
        (n) =>
          (n.type === "nominator" || n.type === "team-lead") &&
          n?.status !== "deleted"
      ),
    ];
    let families = [
      ...allCampaignData
        .filter((f) => f.type === "family" && f?.status !== "deleted")
        .map((f) => {
          const newFam = { ...f };
          delete newFam.familyDetail;
          delete newFam.nominatorDetail;
          delete newFam.GSI1PK;
          delete newFam.GSI1SK;
          return newFam;
        }),
    ];
    if (!Functions.hasPermission(event, "Admin")) {
      const userEmail = event.requestContext.authorizer.claims.email;
      const thisUser = allCampaignData.find(
        (n) => n?.SK === `EMAIL#${userEmail}`
      );

      donors = [];
      organisations = organisations.filter(
        (o) => o?.GSI2PK === thisUser?.GSI3PK
      );
      const orgIds = organisations.map((o) => o?.GSI2PK ?? "");
      nominators = nominators.filter((n) => orgIds.includes(n?.GSI3PK));
    }

    return Responses._200({
      donors,
      organisations,
      nominators,
      families,
      subscribers: [...allSubscribers.filter((s) => s?.status !== "deleted")],
    });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
