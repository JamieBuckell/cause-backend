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

    const campaignId = Functions.defaultCampaign();

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

    console.log("Get Donors");
    const donorsData = await Dynamo.scan({
      TableName: legacyDonorsTable,
    }).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    console.log("Get Nominators");
    const nominatorsData = await Dynamo.scan({
      TableName: legacyNominatorsTable,
    }).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    console.log("Get Organisations");
    const organisationsData = await Dynamo.scan({
      TableName: legacyOrganisationsTable,
    }).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    console.log("Get Families");
    const familiesData = await Dynamo.scan({
      TableName: legacyFamiliesTable,
    }).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    console.log("Get Family Members");
    const familyMembersData = await Dynamo.scan({
      TableName: legacyFamilyMembersTable,
    }).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    const batchData = [];

    if (familiesData.length) {
      console.log("Families to migrate", familiesData.length);
      for (const [i, family] of familiesData.entries()) {
        const existingFamily = allCurrentCampaignData.find(
          (n) => n.type === "family" && n.GSI2SK === `SK#${family.reference}`
        );
        if (existingFamily?.GSI2PK) {
          // console.log("Skipping", existingFamily?.GSI2PK);
          continue;
        }
        const members = familyMembersData
          .filter((m) => m.familyId === family.requestId)
          .map((m) => ({
            additionalInfo: m?.additionalInfo ?? "",
            age: m?.age ?? "",
            ageType: m?.ageType ?? "",
            who: m?.who ?? "",
            whoOther: m?.whoOther ?? "",
          }));

        const legacyOrganisation = organisationsData.find(
          (n) => n.requestId === family.organisationId
        );
        const orgId = legacyOrganisation?.requestId
          ? allCurrentCampaignData.find(
              (n) =>
                n.type === "organisation" &&
                n.legacyId === family.organisationId
            )?.GSI2PK
          : false;
        const legacyNominator = nominatorsData.find(
          (n) => n.requestId === family.nominatorId
        );
        const nominatorId = legacyNominator?.requestId
          ? allCurrentCampaignData.find(
              (n) =>
                (n.type === "nominator" || n.type === "team-lead") &&
                n.legacyId === family.nominatorId
            )?.GSI2PK
          : false;

        if (!orgId || !nominatorId) {
          console.log(
            `Skipping because i cant find an org or nominator`,
            "Org",
            family?.organisationId,
            orgId,
            "Nom",
            family?.nominatorId,
            nominatorId,
            legacyNominator
          );
          continue;
        }

        let donorId = "unallocated";
        if (family?.allocatedTo && family?.allocatedTo !== "unallocated") {
          let legacyDonor = donorsData.find(
            (d) => d.requestId === family.allocatedTo
          );
          let currentDonor = legacyDonor?.requestId
            ? allCurrentCampaignData.find(
                (n) => n.type === "donor" && n.legacyId === family.allocatedTo
              )
            : false;

          if (!currentDonor?.GSI2PK) {
            console.log("ID not found... could be a duplicate...");

            currentDonor = allCurrentCampaignData.find(
              (n) => n.type === "donor" && n.GSI3PK === legacyDonor.email
            );
            if (!currentDonor?.GSI2PK) {
              console.log(
                `Skipping because i cant find a donor`,
                "Donor",
                legacyDonor?.email,
                `"${family?.allocatedTo}"`,
                `"${donorId}"`,
                `"${family?.requestId}"`
              );
              continue;
            }
          }
          donorId = currentDonor?.GSI2PK;
        }

        const familyIdentifier = nanoid(12);

        const familyData = {
          PK: campaignId,
          SK: `REF#${familyIdentifier}`,
          allocatedTo: donorId,
          dateAdded: family.dateSubmitted,
          familyDetail: family.familyDetail,
          GSI1PK: family.reference,
          GSI1SK: `C#${campaignId}`,
          GSI2PK: familyIdentifier,
          GSI2SK: `SK#${family.reference}`,
          GSI3PK: orgId, // Org ID
          GSI3SK: nominatorId, // Nominator Id
          members: members,
          nominatorDetail: family.nominatorDetail,
          status: family.status,
          totalUnit: family.totalUnit,
          type: "family",
        };

        /* */
        batchData.push({
          PutRequest: {
            Item: familyData,
          },
        });
        /* */
      }
    } else {
      console.log("NOPE");
    }

    await Functions.doBatchImport(batchData, mainTableName);
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
