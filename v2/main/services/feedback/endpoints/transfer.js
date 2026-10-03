const Responses = require("../common/API_Responses");
exports.handler = async () => Responses._400({ messages: { disabled: "Function disabled" } });
