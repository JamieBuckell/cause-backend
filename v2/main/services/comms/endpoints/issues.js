const Responses = require("../common/API_Responses");
const Functions = require("../common/Functions");
const Issues = require("../common/MailIssues");
exports.handler = async event => {
  if (!Functions.hasPermission(event, "Admin")) return Responses._401({ message: "Administrator access is required." });
  try {
    const { source = "events", cursor } = event.queryStringParameters || {};
    return Responses._200(await Issues.list(source, cursor));
  } catch (error) {
    console.error("Email issue list failed", error.code || error.message);
    return Responses._400({ message: "Could not load email issues. Refresh and try again." });
  }
};
