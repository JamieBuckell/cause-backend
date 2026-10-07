const crypto = require("crypto");
const AWS = require("aws-sdk");
const Dynamo = require("./Dynamo");
const db = new AWS.DynamoDB.DocumentClient({ region: process.env.AWS_ACCOUNT_REGION || "eu-west-2" });
const table = () => process.env.MAIN_DYNAMO_TABLE;
const copy = value => JSON.parse(JSON.stringify(value));
const reference = family => family.GSI2SK?.startsWith("SK#") ? family.GSI2SK.slice(3) : "";
const isJamie = event => {
  const claims = event?.requestContext?.authorizer?.claims || {};
  return claims.email === "email@jamiebuckell.co.uk" && String(claims.email_verified) === "true" &&
    (claims["cognito:groups"] || "").split(",").includes("Admin");
};
async function read(campaignId, donorId) {
  if (typeof campaignId !== "string" || !campaignId.trim() || typeof donorId !== "string" || !donorId.trim()) throw new Error("Campaign and donor are required.");
  const rows = await Dynamo.query({ KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
    ExpressionAttributeValues: { ":pk": campaignId, ":sk": "EMAIL#" }, ConsistentRead: true }, table());
  const matches = rows.filter(d => d.type === "donor" && d.GSI2PK === donorId && d.status !== "deleted");
  if (matches.length !== 1) throw new Error("Donor could not be found uniquely in this campaign.");
  const families = (await Dynamo.query({ KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
    ExpressionAttributeValues: { ":pk": campaignId, ":sk": "REF#" }, ConsistentRead: true }, table()))
    .filter(f => f.type === "family" && f.status !== "deleted" && f.allocatedTo === donorId)
    .sort((a, b) => a.SK.localeCompare(b.SK));
  return { donor: matches[0], families };
}
function validateLinks(donor, families) {
  const requests = donor.familyDetails?.request;
  if (!Array.isArray(requests) || !requests.length) throw new Error("Donor has no pledge requests to reconnect.");
  const ids = new Set(), links = new Set(), actual = new Map();
  for (const family of families) {
    const ref = reference(family);
    if (!ref || actual.has(ref) || !Array.isArray(family.members)) throw new Error("Family records need manual review before reconnecting.");
    actual.set(ref, family);
  }
  for (const request of requests) {
    if (typeof request.requestId !== "string" || !request.requestId || ids.has(request.requestId) ||
      !Number.isInteger(Number(request.numberOfFamilies)) || Number(request.numberOfFamilies) < 1 ||
      (request.allocation !== undefined && !Array.isArray(request.allocation))) throw new Error("Pledge requests need manual review.");
    ids.add(request.requestId);
    for (const allocation of request.allocation || []) {
      if (!actual.has(allocation.hamperId) || links.has(allocation.hamperId)) throw new Error("A pledge contains duplicate or conflicting family links. Review these before making changes.");
      links.add(allocation.hamperId);
    }
    if ((request.allocation || []).length > Number(request.numberOfFamilies)) throw new Error("Existing allocations exceed a pledge's family count.");
  }
  return { requests, missing: families.filter(f => !links.has(reference(f))) };
}
function planRepair(donor, families, targetRequestId) {
  const { requests, missing } = validateLinks(donor, families);
  const next = copy(requests);
  let target;
  if (missing.length) {
    if (families.length > 98) throw new Error("This donor has too many assignments for a single safe repair. Manual review is required.");
    const candidates = next.filter(r => Number(r.numberOfFamilies) - (r.allocation || []).length >= missing.length && (!targetRequestId || r.requestId === targetRequestId));
    if (candidates.length !== 1) throw new Error("Choose one pledge with enough free places for the missing assignments; this repair will not guess between pledges.");
    target = candidates[0];
    target.allocation = [...(target.allocation || []), ...missing.map(f => ({ hamperId: reference(f), members: copy(f.members) }))];
  }
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify([donor.PK, donor.SK, donor.GSI2PK, donor.familyDetails,
    families.map(f => [f.PK, f.SK, f.GSI2SK, f.allocatedTo, f.status, f.members]), target?.requestId || ""])).digest("hex");
  return { requests: next, references: missing.map(reference), targetRequestId: target?.requestId || "", fingerprint };
}
function mergePledges(donor, families, submitted) {
  if (!Array.isArray(submitted)) throw new Error("Pledge requests must be a list.");
  const previous = donor.familyDetails?.request;
  if (!Array.isArray(previous)) throw new Error("Existing pledge requests need review.");
  if (previous.length) {
    const { missing } = validateLinks(donor, families);
    if (missing.length) throw new Error("This donor has disconnected allocations. Reconnect the allocation links before editing the pledge.");
  } else if (families.length) throw new Error("Reconnect this donor's existing assignments before editing the pledge.");
  const ids = new Set();
  const next = submitted.map(input => {
    if (!input || typeof input.requestId !== "string" || !input.requestId.trim() || input.requestId.length > 128 || ids.has(input.requestId)) throw new Error("Each pledge needs a unique request reference.");
    ids.add(input.requestId);
    const old = previous.find(r => r.requestId === input.requestId);
    const count = Number(input.numberOfFamilies);
    if (!Number.isInteger(count) || count < 1 || count > 10000) throw new Error("Enter a valid number of families.");
    const allocation = copy(old?.allocation || []);
    if (count < allocation.length) throw new Error("Unallocate families before reducing this pledge below its allocated family count.");
    let preferences = input.familyDetail ?? old?.familyDetail ?? [];
    if (typeof preferences === "string") { try { preferences = JSON.parse(preferences); } catch (_) { throw new Error("Invalid family preferences."); } }
    if (!Array.isArray(preferences) || preferences.some(p => !["any", "single", "small", "medium", "large", "extralarge"].includes(p))) throw new Error("Invalid family preferences.");
    if (input.additionalInfo !== undefined && typeof input.additionalInfo !== "string") throw new Error("Invalid pledge notes.");
    // Allocations and server fields belong to the server, never to a stale edit form.
    return { ...(old || {}), requestId: input.requestId, numberOfFamilies: count,
      familyDetail: preferences.slice(0, count), additionalInfo: input.additionalInfo ?? old?.additionalInfo ?? "", allocation };
  });
  if (previous.some(r => !ids.has(r.requestId) && r.allocation?.length)) throw new Error("Unallocate families before deleting or replacing their pledge request.");
  return next;
}
async function commit(donor, requests, actor, kind, families = []) {
  if (families.length > 98) throw new Error("This donor has too many assignments for a single safe repair. Manual review is required.");
  const now = new Date().toISOString(), token = crypto.randomBytes(16).toString("hex");
  const details = { ...donor.familyDetails, request: requests };
  const change = { at: now, by: actor, kind, auditId: token };
  const operations = [{ Update: { TableName: table(), Key: { PK: donor.PK, SK: donor.SK },
    UpdateExpression: "SET #details = :next, lastPledgeChange = :change ADD totalChanges :one",
    ConditionExpression: "#details = :before AND GSI2PK = :donor AND #type = :type AND (attribute_not_exists(#status) OR #status <> :deleted)",
    ExpressionAttributeNames: { "#details": "familyDetails", "#type": "type", "#status": "status" },
    ExpressionAttributeValues: { ":next": details, ":before": donor.familyDetails, ":donor": donor.GSI2PK,
      ":type": "donor", ":deleted": "deleted", ":change": change, ":one": 1 } } }];
  for (const family of families) operations.push({ ConditionCheck: { TableName: table(), Key: { PK: family.PK, SK: family.SK },
    ConditionExpression: "allocatedTo = :donor AND GSI2SK = :ref AND #status = :status AND members = :members",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: { ":donor": donor.GSI2PK, ":ref": family.GSI2SK, ":status": family.status, ":members": family.members } } });
  operations.push({ Put: { TableName: table(), Item: { PK: `DONOR_CHANGE#${donor.GSI2PK}`, SK: `${now}#${token}`,
    type: "donor-pledge-change", campaignId: donor.PK, actor, kind, before: donor.familyDetails.request, after: requests },
    ConditionExpression: "attribute_not_exists(PK)" } });
  try { await db.transactWrite({ TransactItems: operations, ClientRequestToken: token }).promise(); }
  catch (error) {
    if (["TransactionCanceledException", "ConditionalCheckFailedException"].includes(error.code)) throw new Error("The donor or assignments changed while saving. Refresh and try again.");
    throw error;
  }
  return { ...donor, familyDetails: details, lastPledgeChange: change, totalChanges: (donor.totalChanges || 0) + 1 };
}
module.exports = { isJamie, read, planRepair, mergePledges, commit };
