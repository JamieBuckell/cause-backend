const { deliver, batch } = require("../common/MailWorker");
exports.handler = event => batch(event, deliver, true);
