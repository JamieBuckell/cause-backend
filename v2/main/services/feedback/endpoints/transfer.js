const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");

const uuid = require("uuid");

exports.handler = async (event, context, cb) => {
  try {
    return Responses._400({ messages: { disabled: "Function disabled" } });
    const originalFeedbackTableName = "cause-campaign-feedback-live";
    const feedbackTableName = process.env.FEEDBACK_TABLE;

    const feedbackParams = { TableName: originalFeedbackTableName };
    const allFeedback = await Dynamo.scan(feedbackParams).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    for (const [key, f] of Object.entries(allFeedback)) {
      const feedbackObj = {
        ...f,
      };
      delete feedbackObj.hamperId;
      feedbackObj.campaignId = Functions.defaultCampaign();

      console.log(feedbackObj);

      /* *
            await Dynamo.write(feedbackObj, feedbackTableName).catch(err => {
                console.log('error in dynamo write', err);
                return Responses._400({ messages: err });
            });
            /* */
    }

    return Responses._200({ success: true });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
