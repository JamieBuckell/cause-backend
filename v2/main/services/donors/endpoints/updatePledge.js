const Responses = require("../common/API_Responses");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");
const Allocations = require("../common/DonorAllocations");
exports.handler = async event => {
  if (!Functions.hasPermission(event, "Admin")) return Responses._401({ messages: { unauthorized: "Administrator access is required." } });
  try {
    const input = JSON.parse(event.body || "{}");
    const submitted = typeof input.campaignData === "string" ? JSON.parse(input.campaignData) : input.campaignData;
    const { donor, families } = await Allocations.read(input.campaignId, input.donorId);
    const requests = Allocations.mergePledges(donor, families, submitted);
    const updated = await Allocations.commit(donor, requests, event.requestContext.authorizer.claims.email || event.requestContext.authorizer.claims.sub, "edit-pledge");
    let notificationWarning;
    if (input.sendEmail === true && updated.GSI3PK && requests.length) {
      try {
        const template = await Functions.getEmailTemplate("pledgeUpdated", { familyData: requests, familyCount: requests.reduce((sum, r) => sum + Number(r.numberOfFamilies), 0) });
        await Notifications.sendTransactionalEmail({ ToAddresses: [updated.GSI3PK], ...template });
      } catch (error) {
        console.error("Pledge saved but notification failed", error.code || error.message);
        notificationWarning = "Pledge saved, but the confirmation email result could not be confirmed. Check before sending another copy.";
      }
    }
    return Responses._200({ success: "Pledge successfully updated", donor: updated, ...(notificationWarning ? { notificationWarning } : {}) });
  } catch (error) {
    console.error("Pledge update failed", error.code || error.message);
    return Responses._400({ messages: { error: error.code ? "Could not save the pledge. Refresh and try again." : error.message } });
  }
};
