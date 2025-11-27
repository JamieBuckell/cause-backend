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
    if (!campaignId) {
      return Responses._401({
        messages: "Campaign ID is required",
      });
    }

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

    const subscriberParams = { TableName: subscribersTableName };
    const allSubscribers = await Dynamo.scan(subscriberParams).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    return Responses._200({
      donors: allCampaignData.filter(
        (d) => d.type === "donor" && d?.status !== "deleted"
      ).length,
      verifiedDonors: allCampaignData.filter(
        (d) =>
          d.type === "donor" &&
          d?.status !== "deleted" &&
          d?.emailVerification?.verified === true
      ).length,
      families: allCampaignData.filter(
        (f) => f.type === "family" && f?.status !== "deleted"
      ).length,
      individuals: allCampaignData
        .filter((f) => f.type === "family" && f?.status !== "deleted")
        .reduce((a, b) => parseInt(a) + parseInt(b?.totalUnit ?? 0), 0),
      hampersDelivered: allCampaignData.filter(
        (f) =>
          f.type === "family" &&
          f?.status !== "deleted" &&
          f?.receiveStatus === "hamper-received"
      ).length,
      organisations: allCampaignData.filter(
        (o) => o.type === "organisation" && o?.status !== "deleted"
      ).length,
      nominators: allCampaignData.filter(
        (n) =>
          (n.type === "nominator" || n.type === "team-lead") &&
          n?.status !== "deleted"
      ).length,
      pledged: allCampaignData
        .filter((d) => d.type === "donor" && d?.status !== "deleted")
        .reduce((accumulator, d) => {
          return (
            accumulator +
            d.familyDetails.request.reduce((subAccumulator, r) => {
              return subAccumulator + parseInt(r?.numberOfFamilies ?? 0);
            }, 0)
          );
        }, 0),
      verifiedPledged: allCampaignData
        .filter(
          (d) =>
            d.type === "donor" &&
            d?.status !== "deleted" &&
            d?.emailVerification?.verified === true
        )
        .reduce((accumulator, d) => {
          return (
            accumulator +
            d.familyDetails.request.reduce((subAccumulator, r) => {
              return subAccumulator + parseInt(r?.numberOfFamilies ?? 0);
            }, 0)
          );
        }, 0),
      allocated: allCampaignData
        .filter((d) => d.type === "donor" && d?.status !== "deleted")
        .reduce((accumulator, d) => {
          const donorAllocated =
            d?.familyDetails?.request?.reduce((sum, r) => {
              const count = r?.allocation ? r.allocation.length : 0;
              return sum + count;
            }, 0) ?? 0;

          return accumulator + donorAllocated;
        }, 0),
      subscribers: allSubscribers.filter(
        (s) =>
          s?.subscribed === true &&
          s?.verified === true &&
          s?.status !== "deleted"
      ).length,
      unsubscribedSubscribers: allSubscribers.filter(
        (s) =>
          s?.subscribed === false &&
          s?.verified === true &&
          s?.status !== "deleted"
      ).length,
    });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
