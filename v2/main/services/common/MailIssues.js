const AWS = require("aws-sdk");
const crypto = require("crypto");
const db = new AWS.DynamoDB.DocumentClient({ region: process.env.AWS_ACCOUNT_REGION || "eu-west-2" });
const table = () => process.env.COMMS_DYNAMO_TABLE;
const digest = text => crypto.createHash("sha256").update(text).digest("hex");
const text = (value, limit = 2000) => typeof value === "string" ? value.slice(0, limit) : "";
const sources = ["events", "failures", "unsubscribes"];
const sourceTable = source => source === "unsubscribes" ? process.env.SUBSCRIBERS_TABLE : table();
const identity = (source, item) => digest(JSON.stringify([source, item.PK, item.SK,
  source === "failures" ? [item.status, item.startedAt, item.errorCode] : source === "unsubscribes" ? item.dateUnsubscribed : ""]));
function isIssue(source, item) {
  if (!item) return false;
  if (source === "events") return item.PK === "MAIL_ISSUE";
  if (source === "unsubscribes") return item.subscribed === false && !!item.dateUnsubscribed;
  return item.PK?.startsWith("MAIL_DELIVERY#") && (["FAILED", "UNCERTAIN"].includes(item.status) ||
    (["SENDING", "READY"].includes(item.status) && item.startedAt < Date.now() - 300000));
}
function present(source, item, review = {}) {
  const key = { PK: item.PK, SK: item.SK };
  const base = { source, key, id: identity(source, item), reviewStatus: review.status || "open",
    note: review.note || "", version: review.version || 0, reviewedBy: review.actor || "", reviewedAt: review.updatedAt || "" };
  if (source === "events") return { ...base, kind: item.kind, email: item.email, subject: item.subject,
    occurredAt: item.occurredAt, detail: item.detail, messageId: item.messageId, runId: item.runId };
  if (source === "unsubscribes") return { ...base, kind: "Unsubscribe", email: item.PK,
    occurredAt: item.dateUnsubscribed, detail: "Subscriber has opted out. Resolving this review does not resubscribe them." };
  return { ...base, kind: item.status === "FAILED" ? "Send failure" : item.status === "READY" ? "Send delayed" : "Uncertain send",
    email: item.SK, occurredAt: item.startedAt ? new Date(item.startedAt).toISOString() : "",
    detail: item.errorCode || "Sending has not completed. Check delivery before considering another send.",
    messageId: item.sesMessageId || "", emailId: item.emailId || "" };
}
function cursorKey(source, cursor) {
  if (!cursor) return undefined;
  if (typeof cursor !== "string" || cursor.length > 6000) throw new Error("Invalid page cursor.");
  let value;
  try { value = JSON.parse(Buffer.from(cursor, "base64").toString()); } catch (_) { throw new Error("Invalid page cursor."); }
  if (value.source !== source || typeof value.key?.PK !== "string" || typeof value.key?.SK !== "string") throw new Error("Invalid page cursor.");
  return { PK: value.key.PK, SK: value.key.SK };
}
async function list(source, cursor) {
  if (!sources.includes(source)) throw new Error("Choose a valid issue source.");
  const params = { TableName: sourceTable(source), Limit: source === "events" ? 50 : 250,
    ExclusiveStartKey: cursorKey(source, cursor), ConsistentRead: true };
  let result;
  if (source === "events") {
    result = await db.query({ ...params, KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": "MAIL_ISSUE" }, ScanIndexForward: false }).promise();
  } else {
    // Bounded scan pages avoid loading every subscriber or frozen mailing body into Lambda.
    result = await db.scan({ ...params,
      ProjectionExpression: "PK, SK, #status, startedAt, errorCode, sesMessageId, emailId, subscribed, dateUnsubscribed",
      ExpressionAttributeNames: { "#status": "status" } }).promise();
  }
  const items = (result.Items || []).filter(item => isIssue(source, item));
  const reviews = new Map();
  for (let offset = 0; offset < items.length; offset += 100) {
    let keys = items.slice(offset, offset + 100).map(item => ({ PK: "MAIL_ISSUE_REVIEW", SK: identity(source, item) }));
    // An incomplete metadata read must not falsely display a reviewed issue as open.
    for (let attempt = 0; keys.length; attempt++) {
      if (attempt >= 3) throw new Error("Issue reviews are busy. Please try again.");
      const data = await db.batchGet({ RequestItems: { [table()]: { Keys: keys, ConsistentRead: true } } }).promise();
      for (const row of data.Responses?.[table()] || []) reviews.set(row.SK, row);
      keys = data.UnprocessedKeys?.[table()]?.Keys || [];
    }
  }
  return { issues: items.map(item => present(source, item, reviews.get(identity(source, item)))),
    nextCursor: result.LastEvaluatedKey ? Buffer.from(JSON.stringify({ source, key: result.LastEvaluatedKey })).toString("base64") : null };
}
async function review(input, actor) {
  const { source, key, id, status, note, version } = input;
  if (!sources.includes(source) || typeof key?.PK !== "string" || typeof key?.SK !== "string" ||
      !["open", "resolved"].includes(status) || typeof note !== "string" || note.length > 4000 ||
      !Number.isInteger(version) || version < 0 || !/^[a-f0-9]{64}$/.test(id || "")) throw new Error("Invalid issue review.");
  // Read the actual source; clients cannot create arbitrary issues or alter send/subscriber records.
  const item = (await db.get({ TableName: sourceTable(source), Key: { PK: key.PK, SK: key.SK }, ConsistentRead: true }).promise()).Item;
  if (!isIssue(source, item) || identity(source, item) !== id) throw new Error("This issue has changed. Refresh the list before reviewing it.");
  const record = { PK: "MAIL_ISSUE_REVIEW", SK: id, status, note, version: version + 1,
    actor: text(actor, 320), updatedAt: new Date().toISOString() };
  await db.transactWrite({ TransactItems: [
    { Put: { TableName: table(), Item: record,
      ConditionExpression: version ? "#version = :version" : "attribute_not_exists(PK)",
      ...(version ? { ExpressionAttributeNames: { "#version": "version" }, ExpressionAttributeValues: { ":version": version } } : {}) } },
    { Put: { TableName: table(), Item: { ...record, PK: `MAIL_ISSUE_HISTORY#${id}`, SK: String(version + 1).padStart(10, "0") },
      ConditionExpression: "attribute_not_exists(PK)" } },
  ] }).promise();
  return present(source, item, record);
}
async function ingest(event) {
  const kind = event.eventType || event.notificationType;
  const fields = { Bounce: "bounce", Complaint: "complaint", Reject: "reject", "Rendering Failure": "failure", RenderingFailure: "failure", DeliveryDelay: "deliveryDelay" };
  if (!fields[kind]) return; // Delivery/open/click events are not issues.
  const mail = event.mail, detail = event[fields[kind]];
  if (!mail?.messageId || !mail.timestamp || !detail) throw new Error("Invalid SES issue event.");
  const expectedSet = require("./MailTracking")().ConfigurationSetName;
  const actualSet = mail.tags?.["ses:configuration-set"]?.[0];
  if (actualSet && actualSet !== expectedSet) throw new Error("Email event belongs to another environment.");
  let recipients = kind === "Bounce" ? detail.bouncedRecipients : kind === "Complaint" ? detail.complainedRecipients :
    kind === "DeliveryDelay" ? detail.delayedRecipients : (mail.destination || []).map(emailAddress => ({ emailAddress }));
  if (!Array.isArray(recipients) || !recipients.length) throw new Error("SES issue has no affected recipients.");
  const occurredAt = new Date(detail.timestamp || mail.timestamp).toISOString();
  for (const recipient of recipients) {
    const email = text(recipient.emailAddress, 320).trim().toLowerCase();
    if (!email || !email.includes("@")) throw new Error("Invalid SES recipient.");
    const eventId = digest(JSON.stringify([kind, mail.messageId, email, detail.feedbackId || occurredAt]));
    const item = { PK: "MAIL_ISSUE", SK: `${occurredAt}#${eventId}`, kind, email, occurredAt,
      subject: text(mail.commonHeaders?.subject, 500), messageId: text(mail.messageId, 250),
      runId: text(mail.tags?.runId?.[0], 64),
      detail: [detail.bounceType, detail.bounceSubType, detail.complaintFeedbackType, detail.delayType,
        detail.reason, detail.errorMessage, recipient.status, recipient.diagnosticCode].filter(Boolean).map(v => text(v, 1200)).join(" — ").slice(0, 4000) };
    try { await db.put({ TableName: table(), Item: item, ConditionExpression: "attribute_not_exists(PK)" }).promise(); }
    catch (error) { if (error.code !== "ConditionalCheckFailedException") throw error; }
  }
}
module.exports = { list, review, ingest, present, identity, isIssue };
