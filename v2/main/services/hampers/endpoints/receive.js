const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Scanner = require("../common/HamperScanner");
const Functions = require("../common/Functions");

const moment = require("moment-timezone");

const validations = [
  {
    key: "hamperId",
    required: true,
    errorMsg: "Hamper ID is required",
  },
  {
    key: "noBags",
    required: true,
    errorMsg: "Number of bags is required",
  },
];

exports.handler = async (event, context, cb) => {
  try {
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;
    const timezone = process.env.TIMEZONE;
    const dateFormat = process.env.DATE_FORMAT;

    const parsed = event.hamperId ? event : JSON.parse(event.body);

    const valid = await Functions.validateSubmission(parsed, validations);
    if (Object.keys(valid).length > 0) {
      return Responses._400({ messages: valid });
    }

    if (!Number.isInteger(Number(parsed.noBags)) || Number(parsed.noBags) <= 0) {
      return Responses._400({ messages: { noBags: "Number of bags must be a positive integer" } });
    }
    parsed.noBags = Number(parsed.noBags);
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
    if (hamper && hamper?.PK) {
      // if (!hamper.bagsReceived) {
      if (!hamper.bagsReceived || hamper.bagsReceived !== parsed.noBags) {
        console.log(
          parsed.hamperId,
          "recieved",
          parsed.noBags,
          "bags",
          "(",
          hamper.bagsReceived,
          ")"
        );

        hamper.bagsReceived = parsed.noBags;
        hamper.receiveStatus = "hamper-received";

        const timeStamp = moment(new Date().getTime())
          .tz(timezone)
          .format(dateFormat);
        hamper.receivedDate = timeStamp;

        await Dynamo.write(hamper, mainTableName).catch((err) => {
          console.log("error in dynamo write", err);
          throw err;
        });

        return Responses._200({ success: true, hamperId, ...campaign });
        // } else {
        // return Responses._400({ messages: { 'error': 'This hamper has already been received!' } });
      } else {
        console.log(parsed.hamperId, " bags already recieved");
        return Responses._200({ success: true, hamperId, ...campaign });
      }
    }

  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      success: false, messages: { unexpected: e.scannerMessage || "An unexpected error occurred. Please try again." },
    });
  }
};
