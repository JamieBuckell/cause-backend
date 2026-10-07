const Responses = require("../common/API_Responses");
const Allocations = require("../common/DonorAllocations");
exports.handler = async event => {
  if (!Allocations.isJamie(event)) return Responses._401({ messages: { unauthorized: "This action is restricted to Jamie's verified administrator account." } });
  try {
    const input = JSON.parse(event.body || "{}");
    if (!["preview", "repair"].includes(input.action)) throw new Error("Preview the reconnection before applying it.");
    const { donor, families } = await Allocations.read(input.campaignId, input.donorId);
    const plan = Allocations.planRepair(donor, families, input.targetRequestId);
    if (input.action === "preview") return Responses._200({ references: plan.references, targetRequestId: plan.targetRequestId, fingerprint: plan.fingerprint });
    if (input.fingerprint !== plan.fingerprint) throw new Error("The assignments changed. Create a fresh preview before reconnecting them.");
    const updated = plan.references.length
      ? await Allocations.commit(donor, plan.requests, event.requestContext.authorizer.claims.email, "reconnect-allocations", families) : donor;
    return Responses._200({ donor: updated, reconnected: plan.references, message: "Allocation links checked. No email was sent." });
  } catch (error) {
    console.error("Allocation reconnection failed", error.code || error.message);
    return Responses._400({ messages: { error: error.code ? "Could not reconnect allocations. Refresh and try again." : error.message } });
  }
};
