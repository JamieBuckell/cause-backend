const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");

const validations = [
  {
    key: "name",
    required: true,
    errorMsg: "Please enter a valid organisation name",
  },
  {
    key: "requestId",
    required: true,
    errorMsg: "Please enter a valid organisation id",
  },
  {
    key: "campaign",
    required: true,
    errorMsg: "This organisation must be attached to a valid campaign",
  },
];

exports.handler = async (event, context, cb) => {
  try {
    if (!Functions.hasPermission(event, "Admin")) {
      return Responses._401({
        messages: {
          unauthorized: "You are not authorized to view this section",
        },
      });
    }
    const parsed = event?.requestId ? event : JSON.parse(event.body);
    console.log("parsed data", parsed);

    if (!parsed) {
      console.log("Failed to read submitted data: " + JSON.stringify(parsed));
      return Responses._400({
        message: "Failed to read submitted data",
      });
    }

    const valid = await Functions.validateSubmission(parsed, validations);
    if (Object.keys(valid).length > 0) {
      return Responses._400({ messages: valid });
    }

    const escapeRegEx = new RegExp(/(<([^>]+)>)/gi);
    const campaignId = parsed.campaign.toString().replace(escapeRegEx, "");
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;

    //Check the campaign is legit...
    const params = {
      TableName: mainTableName,
      FilterExpression: "#pk = :pk AND #type = :type",
      ExpressionAttributeNames: {
        "#type": "type",
        "#pk": "PK",
      },
      ExpressionAttributeValues: {
        ":type": "campaign",
        ":pk": campaignId,
      },
    };
    const activeCampaigns = await Dynamo.scan(params).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    if (!activeCampaigns.length) {
      console.log(activeCampaigns);
      return Responses._400({ message: "Campaign not found." });
    }

    const organisationId = parsed.requestId;

    const orgsQueryData = {
      IndexName: "GSI2",
      KeyConditionExpression:
        "#gsi2pk = :gsi2pk AND begins_with(#gsi2sk, :gsi2sk)",
      ExpressionAttributeValues: {
        ":gsi2pk": organisationId,
        ":gsi2sk": "SK#",
      },
      ExpressionAttributeNames: {
        "#gsi2pk": "GSI2PK",
        "#gsi2sk": "GSI2SK",
      },
    };
    const matchedOrgs = await Dynamo.query(orgsQueryData, mainTableName).catch(
      (err) => {
        console.log("error in dynamo query", err);
        return Responses._400({ messages: err });
      }
    );
    if (matchedOrgs.length) {
      const organisationData = matchedOrgs.find((o) => o?.PK === campaignId);
      if (organisationData?.organisation?.name) {
        // use replace for extra layer of security
        const validOrganisationName = parsed.name
          .toString()
          .replace(escapeRegEx, "");

        organisationData.organisation.name = validOrganisationName;

        await Dynamo.write(organisationData, mainTableName).catch((err) => {
          console.log("error in dynamo query", err);
          return Responses._400({ messages: err });
        });

        return Responses._200({
          messages: { success: "Update successful" },
          organisation: organisationData,
        });
      } else {
        console.log("Dodgy org data", orgsQueryData);
      }
    } else {
      console.log(
        "Organisation not found",
        organisationData,
        matchedOrgs,
        campaignId
      );
    }

    return Responses._400({ message: "An unexpected error occurred" });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
