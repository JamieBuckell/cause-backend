const Dynamo = require("./Dynamo");

function scannerError(message) {
  const error = new Error(message);
  error.scannerMessage = message;
  return error;
}

async function currentCampaign(TableName, now = Date.now()) {
  const campaigns = await Dynamo.query({
    IndexName: "GSI2",
    KeyConditionExpression: "#pk = :pk AND #sk = :sk",
    ExpressionAttributeNames: { "#pk": "GSI2PK", "#sk": "GSI2SK" },
    ExpressionAttributeValues: { ":pk": "campaign", ":sk": "SK#A" },
  }, TableName);
  const active = campaigns.filter(c => {
    const start = Date.parse(c.campaignDetails?.campaignStart);
    const end = Date.parse(c.campaignDetails?.campaignEnd);
    return c.type === "campaign" && c.status !== "deleted" &&
      Number.isFinite(start) && Number.isFinite(end) && start <= now && now <= end;
  });
  if (active.length !== 1) {
    throw scannerError(active.length
      ? "Multiple campaigns are currently running. Please contact an administrator."
      : "No campaign is currently running. Please contact an administrator.");
  }
  return { campaignId: active[0].PK, campaignName: active[0].campaignName };
}

function normalizeHamperId(value) {
  if (typeof value !== "string") throw scannerError("Please enter a valid Hamper ID");
  let id = value.trim().toUpperCase();
  if (!id.includes("-") && id.length > 3) id = id.slice(0, -3) + "-" + id.slice(-3);
  if (!/^[A-Z0-9]+-[0-9]{3}$/.test(id)) throw scannerError("Please enter a valid Hamper ID");
  return id;
}

async function findHamper(TableName, campaignId, hamperId) {
  const families = await Dynamo.query({
    ConsistentRead: true,
    KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :sk)",
    ExpressionAttributeNames: { "#pk": "PK", "#sk": "SK" },
    ExpressionAttributeValues: { ":pk": campaignId, ":sk": "REF#" },
  }, TableName);
  return families.find(h => h.GSI2SK === `SK#${hamperId}` && h.status !== "deleted");
}

module.exports = { currentCampaign, normalizeHamperId, findHamper, scannerError };
