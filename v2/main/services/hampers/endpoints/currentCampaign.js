const Responses = require("../common/API_Responses");
const Scanner = require("../common/HamperScanner");

exports.handler = async () => {
  try {
    const campaign = await Scanner.currentCampaign(process.env.MAIN_DYNAMO_TABLE);
    return Responses._200({ success: true, ...campaign });
  } catch (error) {
    console.log("Scanner campaign resolution failed", error);
    return Responses._400({ success: false, messages: {
      error: error.scannerMessage || "Unable to load the current campaign. Please try again.",
    } });
  }
};
