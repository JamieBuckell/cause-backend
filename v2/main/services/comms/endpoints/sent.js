const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

exports.handler = async (event, context, cb) => {
  try {
    if (!Functions.hasPermission(event, "Admin")) {
      return Responses._401({
        messages: {
          unauthorized: "You are not authorized to view this section",
        },
      });
    }
    const commsTableName = process.env.COMMS_DYNAMO_TABLE;

    const sentEmailParams = {
      KeyConditionExpression: "#pk= :pk",
      ExpressionAttributeValues: {
        ":pk": "EMAIL",
      },
      ExpressionAttributeNames: {
        "#pk": "PK",
      },
    };
    let sentEmailsData = await Dynamo.query(
      sentEmailParams,
      commsTableName
    ).catch((err) => {
      console.log("error in dynamo query", err);
      throw err;
    });

    if (!sentEmailsData) {
      return Responses._400({ message: "Failed to retrieve all via query" });
    }

    const runs = await Dynamo.query({ KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": "MAIL_RUN" },
      ProjectionExpression: "SK, emailId, createdAt, #status, recipientCount, deliveryScope, recipients",
      ExpressionAttributeNames: { "#status": "status" },
    }, commsTableName);
    const latest = new Map();
    for (const run of runs.filter(r => ["DISPATCHING", "QUEUED"].includes(r.status)).sort((a, b) => b.createdAt - a.createdAt)) {
      if (!latest.has(run.emailId)) latest.set(run.emailId, run);
    }
    for (const email of sentEmailsData) {
      const run = latest.get(email.GSI1PK);
      if (!run) continue;
      const selected = new Set(run.recipients.map(r => r.email));
      const allDeliveries = await Dynamo.query({ KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": `MAIL_DELIVERY#${run.deliveryScope || run.SK}` }, ConsistentRead: true,
      }, commsTableName);
      const deliveries = allDeliveries.filter(d => selected.has(d.SK));
      const accepted = deliveries.filter(d => d.status === "SENT").length;
      const failed = deliveries.filter(d => d.status === "FAILED").length;
      const review = deliveries.filter(d => d.status === "UNCERTAIN" ||
        (d.status === "SENDING" && Date.now() - d.startedAt > 5 * 60 * 1000)).length;
      const pending = Math.max(0, run.recipientCount - accepted - failed - review);
      email.deliveryStatus = `Latest mailing: ${accepted}/${run.recipientCount} accepted, ${pending} pending, ${failed} failed, ${review} need review`;
    }

    const standardTemplate = await Notifications.getEmailTemplate();

    return Responses._200({
      emails: { ...sentEmailsData },
      template: standardTemplate,
    });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
