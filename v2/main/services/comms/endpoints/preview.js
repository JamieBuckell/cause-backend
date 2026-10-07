const Responses = require("../common/API_Responses");
const Process = require("./process");

// A separate endpoint prevents a new portal's preview request from reaching
// an older process handler that would otherwise interpret it as a send.
exports.handler = async event => {
  try {
    const input = event.email ? event : JSON.parse(event.body || "{}");
    return Process.handler({ ...event, email: undefined,
      body: JSON.stringify({ ...input, action: "preview" }),
    });
  } catch (error) {
    return Responses._400({ message: "Unable to read the recipient preview request." });
  }
};
