const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Scanner = require("../common/HamperScanner");
const Functions = require("../common/Functions");

const validations = [
  {
    key: "hamperId",
    required: true,
    errorMsg: "Hamper ID is required",
  },
];

exports.handler = async (event, context, cb) => {
  try {
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;

    const parsed = event.hamperId ? event : JSON.parse(event.body);

    const valid = await Functions.validateSubmission(parsed, validations);
    if (Object.keys(valid).length > 0) {
      return Responses._400({ messages: valid });
    }

    const campaign = await Scanner.currentCampaign(mainTableName);
    // New scanner clients pin their displayed campaign. Reject a rollover
    // rather than recording receipt against a campaign the volunteer never saw.
    if (parsed.expectedCampaignId && parsed.expectedCampaignId !== campaign.campaignId) {
      throw Scanner.scannerError("The current campaign has changed. Please reload the scanner.");
    }
    const hamperId = Scanner.normalizeHamperId(parsed.hamperId);
    const hamper = await Scanner.findHamper(mainTableName, campaign.campaignId, hamperId);
    if (!hamper) {
      console.log("Hamper not found", { ...campaign, hamperId });
      return Responses._200({ success: false, ...campaign, messages: { error: "Hamper ID not found" } });
    }
    const donorQueryData = {
      KeyConditionExpression: "#pk= :pk And begins_with(#sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": campaign.campaignId,
        ":sk": `EMAIL#D#`,
      },
      ExpressionAttributeNames: {
        "#pk": "PK",
        "#sk": "SK",
      },
    };
    var campaignDonors = await Dynamo.query(
      donorQueryData,
      mainTableName
    ).catch((err) => {
      console.log("error in dynamo query", err);
      throw err;
    });

    const campaignDonorsMapped = campaignDonors.map((d) => ({
      donorId: d.GSI2PK,
      name: `${d.donorDetails.firstName} ${d.donorDetails.lastName}`,
      company: d.donorDetails.company,
    }));

    const allDonorPledges = Object.fromEntries(
      campaignDonorsMapped.map((d) => [d.donorId, d])
    );

    if (hamper && hamper?.PK) {
      const returnRes = {
        success: true,
        ...campaign,
        hamperId,
        bagsReceived: hamper?.bagsReceived ? hamper.bagsReceived : 0,
        donor: hamper?.allocatedTo ? allDonorPledges[hamper.allocatedTo] : {},
        familyUnitTotal: hamper?.totalUnit ?? 0,
        familyDynamic: await Functions.generateFamilyDynamics(
          { reference: hamperId },
          hamper?.members ?? []
        ),
      };
      if (returnRes.bagsReceived > 0) {
        returnRes.success = false;
        returnRes.messages = {
          error: "This hamper has already been received!",
        };
      }
      return Responses._200(returnRes);
    }
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      success: false, messages: { unexpected: e.scannerMessage || "An unexpected error occurred. Please try again." },
    });
  }
};
