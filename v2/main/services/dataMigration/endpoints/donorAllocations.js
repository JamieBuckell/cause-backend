const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

const { nanoid } = require("nanoid");
const moment = require("moment-timezone");

exports.handler = async (event, context, cb) => {
  try {
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;

    const legacyDonorsTable = "cause-donors-live";
    const legacyFamiliesTable = "cause-families-live";
    const legacyFamilyMembersTable = "cause-family-members-live";
    const legacyNominatorsTable = "cause-nominators-live";
    const legacyOrganisationsTable = "cause-organisations-live-restored";

    const campaignId = "CH1"; // 2022 Campaign

    const params = {
      TableName: mainTableName,
      FilterExpression: "#pk = :pk",
      ExpressionAttributeNames: {
        "#pk": "PK",
      },
      ExpressionAttributeValues: {
        ":pk": campaignId,
      },
    };
    let allCurrentCampaignData = await Dynamo.scan(params).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });
    const currentDonors = allCurrentCampaignData.filter(
      (n) => n.type === "donor"
    );
    const campaignFamilies = allCurrentCampaignData.filter(
      (n) => n.type === "family"
    );

    const batchData = [];

    if (currentDonors.length) {
      console.log("Donors to update", currentDonors.length);
      for (const [i, donor] of currentDonors.entries()) {
        var addToBatch = false;
        if (donor?.familyDetails?.allocation) {
          delete donor.familyDetails.allocation;
        }
        if (
          donor?.familyDetails?.request &&
          donor.familyDetails.request.length
        ) {
          if (donor.familyDetails.request.length > 1) {
            console.log(
              "Donor has multiple requests",
              donor?.GSI3PK,
              donor.familyDetails.request
            );
          } else {
            if (!donor.familyDetails.request[0]?.allocation) {
              donor.familyDetails.request[0].allocation = [];
            }

            const donorsFamilies = campaignFamilies.filter(
              (f) => f.allocatedTo === donor?.GSI2PK
            );

            if (!donorsFamilies || !donorsFamilies.length) {
              console.log("No families for donor", donor?.GSI3PK);
            } else {
              for (const family of donorsFamilies) {
                const hamperId = family?.GSI2SK
                  ? family.GSI2SK.replace("SK#", "")
                  : "";
                if (hamperId) {
                  const isFamilyAllocated =
                    donor.familyDetails.request[0].allocation.find(
                      (a) => a.hamperId === hamperId
                    );
                  if (isFamilyAllocated && isFamilyAllocated.length) {
                    console.log(hamperId, "already allocated");
                  } else {
                    if (!addToBatch) {
                      addToBatch = true;
                    }
                    donor.familyDetails.request[0].allocation.push({
                      hamperId: hamperId,
                      members: family?.members ?? [],
                    });
                  }
                }
              }
            }
          }
        }

        if (addToBatch) {
          batchData.push({
            PutRequest: {
              Item: donor,
            },
          });
        }
      }
    } else {
      console.log("NOPE", currentDonors);
    }

    await Functions.doBatchImport(batchData, mainTableName);
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
