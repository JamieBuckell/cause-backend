const AWS = require("aws-sdk");
const crypto = require("crypto");
const moment = require("moment-timezone");
const Store = require("./MailStore");
const { normalize, hash } = require("./MailRecipients");
const Hashing = require("./Hashing");
// SES has no idempotency key. SDK retries after an ambiguous network failure
// could send a second copy, so retry decisions belong to the durable ledger.
const ses = new AWS.SES({ region: "eu-west-1", maxRetries: 0 });
const sqs = new AWS.SQS({ region: process.env.AWS_ACCOUNT_REGION || "eu-west-2" });
const runKey = id => ({ PK: "MAIL_RUN", SK: id });
const deliveryKey = (id, email) => ({ PK: `MAIL_DELIVERY#${id}`, SK: email });
const definitelyNotAccepted = new Set(["Throttling", "ThrottlingException", "TooManyRequestsException"]);
const rejected = new Set(["MessageRejected", "InvalidParameterValue", "InvalidParameter", "MailFromDomainNotVerifiedException", "ConfigurationSetDoesNotExistException", "AccountSendingPausedException"]);

async function readRun(body) {
  if (body.version !== 2 || !/^[a-f0-9]{32}$/.test(body.runId || "")) {
    throw new Error("Legacy or invalid queued email requires review; it will not be sent automatically.");
  }
  const run = await Store.get(runKey(body.runId));
  if (!run || !["DISPATCHING", "QUEUED"].includes(run.status)) throw new Error("Mailing is not confirmed.");
  return run;
}

async function generate(record) {
  const body = JSON.parse(record.body);
  const run = await readRun(body);
  if (!Number.isInteger(body.offset) || body.offset < 0 || body.offset % 100 !== 0 || body.offset >= run.recipients.length) {
    throw new Error("Invalid mailing batch offset.");
  }
  for (const recipient of run.recipients.slice(body.offset, body.offset + 100)) {
    const email = normalize(recipient.email);
    const identity = hash(`${run.SK}:${email}`);
    await sqs.sendMessage({
      QueueUrl: `https://sqs.${process.env.AWS_ACCOUNT_REGION}.amazonaws.com/${process.env.AWS_ACCOUNT_ID}/${process.env.MAILER_QUEUE}`,
      MessageBody: JSON.stringify({ version: 2, runId: run.SK, email }),
      MessageDeduplicationId: identity,
      // One problematic address must not block the rest of the mailing.
      MessageGroupId: identity,
    }).promise();
  }
}

async function deliver(record) {
  const body = JSON.parse(record.body);
  const run = await readRun(body);
  const email = normalize(body.email);
  const recipient = run.recipients.find(r => r.email === email);
  if (!recipient) throw new Error("Recipient is not in the confirmed preview.");
  const key = deliveryKey(run.deliveryScope || run.SK, email);
  const owner = crypto.randomBytes(16).toString("hex");
  const created = await Store.create({ ...key, type: "mail-delivery", status: "SENDING", owner, startedAt: Date.now(), emailId: run.emailId });
  if (!created) {
    const current = await Store.get(key);
    if (current?.status === "SENT") return;
    if (current?.status !== "READY") throw new Error(`Delivery ${current?.status || "unknown"}: review required before another send.`);
    try { await Store.update(key, { status: "SENDING", owner, startedAt: Date.now() }, { status: "READY" }); }
    catch (error) {
      if (error.code === "ConditionalCheckFailedException") throw new Error("Another worker claimed this recipient.");
      throw error;
    }
  }
  const mail = run.emailData.email;
  let result;
  try {
    const unsubscribeLink = mail.type === "subscriber" && recipient.SK
      ? `${process.env.APP_URL}/subscription/unsubscribe/${encodeURIComponent(email)}/${encodeURIComponent(Hashing.hash(recipient.SK, process.env.HASHING_SALT).hashedpassword)}` : "";
    const fromAddress = `${mail.sendFrom}@cause-foundation.org.uk`;
    result = await ses.sendTemplatedEmail({ Source: fromAddress, ReplyToAddresses: [fromAddress],
      Destination: { ToAddresses: [email] }, Template: unsubscribeLink ? "CauseFSubscriber" : "CauseFStandard",
      TemplateData: JSON.stringify({ fromAddress, subject: mail.subject, pageTitle: mail.title,
        pageContent: mail.content, unsubscribeLink, type: mail.type }),
    }).promise();
  } catch (error) {
    const status = definitelyNotAccepted.has(error.code) ? "READY" : rejected.has(error.code) ? "FAILED" : "UNCERTAIN";
    await Store.update(key, { status, errorCode: error.code || "UnknownSendResult" }, { status: "SENDING", owner });
    throw error;
  }
  if (!result?.MessageId) {
    await Store.update(key, { status: "UNCERTAIN", errorCode: "MissingSESMessageId" }, { status: "SENDING", owner });
    throw new Error("SES returned no message ID; review required.");
  }
  const dateSent = moment().tz(process.env.TIMEZONE).format(process.env.DATE_FORMAT);
  try {
    await Store.recordSent(key, owner, { PK: "RECIPIENT", SK: `RUN#${run.SK}#${hash(email)}`,
      type: "recipient", emailAddress: email, emailData: run.emailData, dateSent,
      GSI1PK: run.emailId, GSI1SK: `SORT#${dateSent}`, runId: run.SK, sesMessageId: result.MessageId,
    }, result.MessageId);
  } catch (error) {
    // The transaction may have committed despite a lost acknowledgement.
    const current = await Store.get(key);
    if (current?.status === "SENT") return;
    await Store.update(key, { status: "UNCERTAIN", errorCode: "SentButRecordFailed", sesMessageId: result.MessageId }, { status: "SENDING", owner });
    throw error;
  }
  console.log("Mail delivery accepted", { runId: run.SK, email, messageId: result.MessageId });
}

async function batch(event, worker, fifo = false) {
  if (!Array.isArray(event?.Records)) throw new Error("Queue records are required.");
  const batchItemFailures = [];
  const blockedGroups = new Set();
  for (const record of event.Records) {
    const group = record.attributes?.MessageGroupId || "default";
    if (fifo && blockedGroups.has(group)) {
      batchItemFailures.push({ itemIdentifier: record.messageId }); continue;
    }
    try { await worker(record); }
    catch (error) {
      console.error("Mail queue item failed", { messageId: record.messageId, error: error.code || error.message });
      batchItemFailures.push({ itemIdentifier: record.messageId });
      if (fifo) blockedGroups.add(group);
    }
  }
  return { batchItemFailures };
}
module.exports = { generate, deliver, batch };
