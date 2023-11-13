const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");

const validations = [
  {
    key: "name",
    required: true,
    errorMsg: "Please enter a valid campaign name",
  },
  {
    key: "campaignId",
    required: true,
    errorMsg: "Please enter a valid campaign id",
  },
  {
    key: "dates.campaignStart",
    required: true,
    errorMsg: "This campaign have a start date",
  },
  {
    key: "dates.campaignEnd",
    required: true,
    errorMsg: "This campaign have an end date",
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
    const parsed = event?.campaignId ? event : JSON.parse(event.body);
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
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;

    const campaignId = parsed.campaignId;

    const campaignsQueryData = {
      TableName: mainTableName,
      FilterExpression: "#pk = :pk AND #sk = :sk AND #type = :type",
      ExpressionAttributeNames: {
        "#pk": "PK",
        "#sk": "SK",
        "#type": "type",
      },
      ExpressionAttributeValues: {
        ":pk": campaignId,
        ":sk": "A",
        ":type": "campaign",
      },
    };
    let matchedCampaigns = await Dynamo.scan(campaignsQueryData).catch(
      (err) => {
        console.log("error in dynamo query", err);
        return Responses._400({ messages: err });
      }
    );
    if (matchedCampaigns.length) {
      const campaignData = matchedCampaigns.find((o) => o?.PK === campaignId);
      if (campaignData?.campaignName) {
        // use replace for extra layer of security
        const validCampaignName = parsed.name
          .toString()
          .replace(escapeRegEx, "");

        campaignData.campaignName = validCampaignName;
        campaignData.campaignDetails.campaignStart = parsed.dates.campaignStart;
        campaignData.campaignDetails.campaignEnd = parsed.dates.campaignEnd;
        if (parsed.dates?.nominationsOpen) {
          campaignData.campaignDetails.nominationsOpen =
            parsed.dates.nominationsOpen;
          campaignData.campaignDetails.nominationsClosed =
            parsed.dates.nominationsClosed;
        }
        if (parsed.dates?.registrationOpen) {
          campaignData.campaignDetails.registrationOpen =
            parsed.dates.registrationOpen;
          campaignData.campaignDetails.registrationClosed =
            parsed.dates.registrationClosed;
        }

        await Dynamo.write(campaignData, mainTableName).catch((err) => {
          console.log("error in dynamo query", err);
          return Responses._400({ messages: err });
        });

        return Responses._200({
          messages: { success: "Update successful" },
          campaign: campaignData,
        });
      } else {
        console.log("Dodgy campaign data", campaignsQueryData);
      }
    } else {
      console.log(
        "Campaign not found",
        campaignData,
        matchedCampaigns,
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
