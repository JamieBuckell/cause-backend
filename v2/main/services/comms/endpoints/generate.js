const { generate, batch } = require("../common/MailWorker");
exports.handler = event => batch(event, generate);
