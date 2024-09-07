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
    const { campaignId } = event.pathParameters;
    console.log("cid", campaignId);
    if (!campaignId) {
      return Responses._401({
        messages: "Campaign ID is required",
      });
    }

    const parsed = event.donorId ? event : JSON.parse(event.body);

    let currentUser = {};
    if (!Functions.hasPermission(event, "Admin")) {
      const userEmail = event.requestContext.authorizer.claims.email;

      const params = {
        KeyConditionExpression: "#pk= :pk AND #sk= :sk",
        ExpressionAttributeValues: {
          ":pk": campaignId,
          ":sk": `EMAIL#${userEmail}`,
        },
        ExpressionAttributeNames: {
          "#pk": "PK",
          "#sk": "SK",
        },
      };
      currentUser = await Dynamo.query(params, mainTableName).catch((err) => {
        console.log("error in dynamo query", err);
        return Responses._400({ messages: err });
      });
      if (currentUser.length) {
        currentUser = currentUser[0];
      }
    }

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

    let donors = [
      ...allCampaignData.filter(
        (d) => d.type === "donor" && d?.status !== "deleted"
      ),
    ];
    let nominators = [
      ...allCampaignData.filter(
        (n) =>
          (n.type === "nominator" || n.type === "team-lead") &&
          n?.status !== "deleted"
      ),
    ];

    let allFamilies = [
      ...allCampaignData
        .filter((f) => f.type === "family" && f?.status !== "deleted")
        .map((f) => {
          const newFam = { ...f };
          delete newFam.familyDetail;
          delete newFam.nominatorDetail;
          newFam.nominatorDetail = Functions.createNominatorDetail(
            f?.GSI3SK,
            nominators
          );
          newFam.donorDetail = Functions.createDonorDetail(
            f?.allocatedTo,
            donors
          );
          delete newFam.GSI1PK;
          delete newFam.GSI1SK;
          return newFam;
        }),
    ];

    if (parsed.donorId) {
      allFamilies = allFamilies.filter(
        (f) => f?.allocatedTo === parsed.donorId
      );
    }

    if (parsed.nominatorId) {
      allFamilies = allFamilies.filter((f) => f?.GSI3SK === parsed.nominatorId);
    }

    if (parsed.organisationId) {
      allFamilies = allFamilies.filter(
        (f) => f?.GSI3PK === parsed.organisationId
      );
    }

    if (!Functions.hasPermission(event, "Admin")) {
      allFamilies = allFamilies.filter((f) => f?.GSI3PK === currentUser.GSI3PK);
      if (!Functions.hasPermission(event, "TeamLead")) {
        allFamilies = allFamilies.filter(
          (f) => f?.GSI3SK === currentUser?.GSI2PK
        );
      }
    }

    if (!allFamilies) {
      return Responses._400({ message: "Failed to find campaign data" });
    }

    return Responses._200([...allFamilies]);
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
