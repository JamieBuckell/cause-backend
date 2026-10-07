const Responses = require("../common/API_Responses");
const Functions = require("../common/Functions");
const Issues = require("../common/MailIssues");
exports.handler = async event => {
  if (!Functions.hasPermission(event, "Admin")) return Responses._401({ message: "Administrator access is required." });
  try {
    const input = JSON.parse(event.body || "{}");
    const actor = event.requestContext.authorizer.claims.email || event.requestContext.authorizer.claims.sub;
    return Responses._200({ issue: await Issues.review(input, actor) });
  } catch (error) {
    console.error("Email issue review failed", error.code || error.message);
    return Responses._400({ message: "Could not save this review. Refresh in case the issue was updated by someone else." });
  }
};
