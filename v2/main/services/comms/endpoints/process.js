const Responses = require("../common/API_Responses");
const Functions = require("../common/Functions");
const Dynamo = require("../common/Dynamo");
const Store = require("../common/MailStore");
const Recipients = require("../common/MailRecipients");
const moment = require("moment-timezone");
const AWS = require("aws-sdk");
const sqs = new AWS.SQS({ region: process.env.AWS_ACCOUNT_REGION || "eu-west-2" });
const key = id => ({ PK: "MAIL_RUN", SK: id });
const preview = run => ({ requestId: run.SK, recipients: run.recipients.map(({ email, roles }) => ({ email, roles })),
  count: run.recipients.length, invalidCount: run.invalidCount, duplicateCount: run.duplicateCount,
  previouslySentCount: run.previouslySentCount, campaignId: run.options.campaignId || "",
  includesPreviouslySent: run.options.ignorePreviouslySent === true, status: run.status, expiresAt: run.createdAt + 24 * 60 * 60 * 1000 });

exports.handler = async event => {
  try {
    if (!Functions.hasPermission(event, "Admin")) return Responses._401({ message: "Administrator access is required." });
    const input = event.email ? event : JSON.parse(event.body || "{}");
    if (!["preview", "send"].includes(input.action) || !/^[a-f0-9]{32}$/.test(input.requestId || "")) {
      return Responses._400({ message: "Reload the portal and preview the recipients before sending." });
    }
    let run = await Store.get(key(input.requestId));
    if (input.action === "preview") {
      const fingerprint = Recipients.hash(JSON.stringify({ email: input.email, options: input.options, existingEmailId: input.existingEmailId || "" }));
      if (run) {
        if (run.fingerprint !== fingerprint) throw new Error("The message changed. Create a new recipient preview.");
        return Responses._200(preview(run));
      }
      if (!input.email?.subject?.trim() || !input.email?.content?.trim()) throw new Error("Enter a subject and email content.");
      let savedOptions = {};
      if (input.existingEmailId) {
        const original = await Dynamo.query({ KeyConditionExpression: "PK = :pk", FilterExpression: "GSI1PK = :id",
          ExpressionAttributeValues: { ":pk": "EMAIL", ":id": input.existingEmailId } }, process.env.COMMS_DYNAMO_TABLE);
        if (original.length !== 1) throw new Error("The original email could not be found uniquely.");
        savedOptions = JSON.parse(original[0].email.options || "{}");
      }
      const options = { ...savedOptions, ...input.options };
      // An intentional resend must be explicit; previews default to unsent recipients.
      options.ignorePreviouslySent = input.options?.ignorePreviouslySent === true;
      const selection = await Recipients.select(options, input.existingEmailId);
      const dateAdded = moment().tz(process.env.TIMEZONE).format(process.env.DATE_FORMAT);
      run = { ...key(input.requestId), type: "mail-run", status: "PREVIEW", fingerprint,
        createdAt: Date.now(), emailId: input.existingEmailId || input.requestId,
        deliveryScope: options.ignorePreviouslySent ? input.requestId : (input.existingEmailId || input.requestId),
        options, ...selection, recipientCount: selection.recipients.length, emailData: { dateAdded, email: {
          subject: input.email.subject.replace(/<[^>]*>/g, "").trim(),
          title: (input.email.title || "").replace(/<[^>]*>/g, ""), content: input.email.content,
          sendFrom: input.email.fromAddress || "hampers", options: JSON.stringify(options),
          recipientCount: selection.recipients.length, type: options.type === "subscribers" ? "subscriber" : "transactional",
        } } };
      if (!/^[a-zA-Z0-9._+-]+$/.test(run.emailData.email.sendFrom)) throw new Error("Invalid sender address.");
      if (Buffer.byteLength(JSON.stringify(run)) > 350000) throw new Error("This mailing is too large. Please split it into smaller groups.");
      if (!await Store.create(run)) {
        run = await Store.get(key(input.requestId));
        if (run.fingerprint !== fingerprint) throw new Error("The message changed. Create a new recipient preview.");
      }
      return Responses._200(preview(run));
    }
    if (!run) throw new Error("Preview the recipients before sending.");
    if (run.status === "QUEUED") return Responses._200({ message: "This mailing is already queued.", requestId: run.SK, count: run.recipients.length });
    if (run.invalidCount) throw new Error(`Fix the ${run.invalidCount} missing or invalid recipient addresses before sending.`);
    if (!run.recipients.length) throw new Error("There are no recipients to send to.");
    if (run.status === "PREVIEW" && Date.now() - run.createdAt > 24 * 60 * 60 * 1000) throw new Error("This preview has expired. Create a new preview.");
    if (run.status === "PREVIEW") {
      try { await Store.update(key(run.SK), { status: "DISPATCHING" }, { status: "PREVIEW" }); }
      catch (error) { if (error.code !== "ConditionalCheckFailedException") throw error; }
    }
    // Deterministic keys make API retries and concurrent confirmations harmless.
    if (run.emailId === run.SK) await Store.create({ PK: "EMAIL", SK: `RUN#${run.SK}`, GSI1PK: run.emailId, type: "email",
      dateAdded: run.emailData.dateAdded, email: run.emailData.email, runId: run.SK });
    for (let offset = 0; offset < run.recipients.length; offset += 100) {
      await sqs.sendMessage({ QueueUrl: `https://sqs.${process.env.AWS_ACCOUNT_REGION}.amazonaws.com/${process.env.AWS_ACCOUNT_ID}/${process.env.MAIL_PROCESSOR_QUEUE}`,
        MessageBody: JSON.stringify({ version: 2, runId: run.SK, offset }),
      }).promise();
    }
    await Store.update(key(run.SK), { status: "QUEUED" });
    return Responses._200({ message: "Mailing queued. Check its sending status for failures or messages needing review.", requestId: run.SK, count: run.recipients.length });
  } catch (error) {
    console.error("Mailing request failed", error.code || error.message);
    return Responses._400({ message: error.message || "Unable to queue this mailing." });
  }
};
