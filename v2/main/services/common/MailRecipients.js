const crypto = require("crypto");
const Dynamo = require("./Dynamo");
const normalize = value => typeof value === "string" ? value.trim().toLowerCase() : "";
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const valid = email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

async function select(options, existingEmailId) {
  const type = options.type;
  if (!["specific", "subscribers", "donors", "nominators", "teamleads"].includes(type)) {
    throw new Error("Choose a valid recipient group.");
  }
  if ((["donors", "nominators", "teamleads"].includes(type) || (type === "subscribers" && options.excludePledged)) &&
      (typeof options.campaignId !== "string" || !options.campaignId.trim())) {
    throw new Error("Choose a campaign before previewing recipients.");
  }
  let source = [];
  const campaignContacts = async () => Dynamo.query({
    KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :sk)",
    ExpressionAttributeNames: { "#pk": "PK", "#sk": "SK" },
    ExpressionAttributeValues: { ":pk": options.campaignId, ":sk": "EMAIL#" },
  }, process.env.MAIN_DYNAMO_TABLE);
  if (type === "specific") {
    if (!Array.isArray(options.toAddresses)) throw new Error("Enter at least one recipient.");
    source = options.toAddresses.map(email => ({ email, role: "Specific recipient" }));
  } else if (type === "subscribers") {
    source = (await Dynamo.scan({ TableName: process.env.SUBSCRIBERS_TABLE }))
      .filter(r => r.subscribed === true && r.verified === true && r.status !== "deleted")
      .map(r => ({ email: r.PK, SK: r.SK, role: "Subscriber" }));
    if (options.excludePledged) {
      const pledged = new Set((await campaignContacts()).filter(r => r.type === "donor" && r.status !== "deleted").map(r => normalize(r.GSI3PK)));
      source = source.filter(r => !pledged.has(normalize(r.email)));
    }
  } else {
    const types = type === "nominators"
      ? (options.excludeTeamLeads === true ? ["nominator"] : ["nominator", "team-lead"])
      : [type === "teamleads" ? "team-lead" : "donor"];
    source = (await campaignContacts()).filter(r => types.includes(r.type) && r.status !== "deleted")
      .map(r => ({ email: r.type === "donor" ? r.GSI3PK : r.nominatorDetails?.email, role: r.type }));
    if (type === "donors" && options.excludeSubscribers) {
      const subscribers = new Set((await Dynamo.scan({ TableName: process.env.SUBSCRIBERS_TABLE }))
        .filter(r => r.subscribed && r.status !== "deleted").map(r => normalize(r.PK)));
      source = source.filter(r => !subscribers.has(normalize(r.email)));
    }
  }
  const invalidCount = source.filter(r => !valid(normalize(r.email))).length;
  const unique = new Map();
  for (const r of source) {
    const email = normalize(r.email);
    if (!valid(email)) continue;
    if (!unique.has(email)) unique.set(email, { email, roles: [], ...(r.SK ? { SK: r.SK } : {}) });
    if (!unique.get(email).roles.includes(r.role)) unique.get(email).roles.push(r.role);
  }
  let recipients = [...unique.values()].sort((a, b) => a.email.localeCompare(b.email));
  let previouslySentCount = 0;
  if (existingEmailId && options.ignorePreviouslySent !== true) {
    const previous = await Dynamo.query({ KeyConditionExpression: "PK = :pk",
      FilterExpression: "GSI1PK = :mail AND #type = :type", ExpressionAttributeNames: { "#type": "type" },
      ExpressionAttributeValues: { ":pk": "RECIPIENT", ":mail": existingEmailId, ":type": "recipient" },
      ConsistentRead: true,
    }, process.env.COMMS_DYNAMO_TABLE);
    const sent = new Set(previous.map(r => normalize(r.emailAddress)));
    previouslySentCount = recipients.filter(r => sent.has(r.email)).length;
    recipients = recipients.filter(r => !sent.has(r.email));
  }
  return { recipients, invalidCount, previouslySentCount,
    duplicateCount: source.length - invalidCount - unique.size };
}
module.exports = { select, normalize, hash };
