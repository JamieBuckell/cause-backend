const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");

exports.handler = async (event, context, cb) => {
  try {
    if (event?.Records) {
      const mainTableName = process.env.MAIN_DYNAMO_TABLE;
      console.log("Checking Table", mainTableName);
      for (const r of event?.Records) {
        console.log(`Running message: ${r.body}`);

        if (
          r?.messageAttributes?.campaign &&
          r?.messageAttributes?.nominatorId
        ) {
          const campaignId = r.messageAttributes.campaign.stringValue;
          const nominatorId = r.messageAttributes.nominatorId.stringValue;

          console.log("Get Campaign data", campaignId);
          const campaignParams = {
            TableName: mainTableName,
            FilterExpression: "#pk = :pk",
            ExpressionAttributeNames: {
              "#pk": "PK",
            },
            ExpressionAttributeValues: {
              ":pk": campaignId,
            },
          };

          let allCampaignData = await Dynamo.scan(campaignParams).catch(
            (err) => {
              console.log("error in dynamo query", err);
              return Responses._400({ messages: err });
            }
          );
          console.log(
            "campaign data recieved...",
            allCampaignData.length,
            allCampaignData
          );
          console.log("Get Nominator", nominatorId);
          const nominatorData = allCampaignData.find(
            (cd) =>
              cd.GSI2PK === nominatorId &&
              (cd.type === "nominator" || cd.type === "team-lead")
          );
          if (!nominatorData) {
            console.log(nominatorId, nominatorData);
            return Responses._400({ message: "Failed to retrieve nom by ID" });
          }

          console.log("Get Organisation", nominatorData?.GSI3PK);
          const organisationData = allCampaignData.find(
            (cd) =>
              cd.GSI2PK === nominatorData?.GSI3PK && cd.type === "organisation"
          );
          if (!organisationData) {
            return Responses._400({ message: "Failed to retrieve org by ID" });
          }

          const nominatorsFamilies = allCampaignData.filter(
            (cd) => cd?.GSI3SK === nominatorData?.GSI2PK && cd.type === "family"
          );
          if (nominatorsFamilies.length) {
            nominatorsFamilies.sort((a, b) =>
              b.dateAdded < a.dateAdded ? 1 : a.dateAdded < b.dateAdded ? -1 : 0
            );

            let count = 1;
            const newData = [];
            for (const [i, family] of nominatorsFamilies.entries()) {
              const newRef = `${organisationData.SK}${
                nominatorData.nominatorDetails.reference
              }-${count.toString().padStart(3, "0")}`;
              if (`SK#${newRef}` != family.GSI2SK) {
                console.log(`NominatorId: ${family.GSI3SK}`);
                console.log(
                  `Previous Ref: ${family.GSI2SK.replace("SK#", "")}`
                );
                console.log(`New Ref: ${newRef}`);
                family.GSI2SK = `SK#${newRef}`;
                family.status = family.status ?? "unallocated";
                if (family?.reference) {
                  delete family.reference;
                }

                // Update family
                const newRequest = await Dynamo.write(
                  family,
                  mainTableName
                ).catch((err) => {
                  console.log("error in dynamo write", err);
                  return Responses._400({ messages: err });
                });

                if (!newRequest) {
                  return Responses._400({
                    message: "Failed to write family to db by ID",
                  });
                }
              } else {
                console.log(`Sticking with reference: ${newRef}`);
              }
              newData.push({ ...family });

              count++;
            }
          }
        }
      }
    }

    return Responses._200({
      messages: { success: "References updated successfully" },
    });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
