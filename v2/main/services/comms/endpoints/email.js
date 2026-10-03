// Retired legacy handler. See ENDPOINT_REVIEW.md for the replacement/reason.
const Responses = require("../common/API_Responses");
exports.handler = async () => Responses._400({ messages: { retired: "This legacy endpoint has been retired" } });
