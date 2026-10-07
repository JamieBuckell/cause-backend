const Issues = require("../common/MailIssues");
exports.handler = async event => {
  if (!Array.isArray(event?.Records)) throw new Error("Queue records are required.");
  const batchItemFailures = [];
  for (const record of event.Records) {
    try { await Issues.ingest(JSON.parse(record.body)); }
    catch (error) {
      console.error("Email issue event failed", { messageId: record.messageId, error: error.code || error.message });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
};
