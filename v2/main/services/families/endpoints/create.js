const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

const { nanoid } = require("nanoid");
const moment = require("moment-timezone");

const checkValidReference = async (reference, existingFamiliesData) => {
  const existingRef = existingFamiliesData.find(
    (f) => f?.GSI2SK === `SK#${reference}`
  );

  const referenceMatch = reference.match(/(.*)-/);
  const usersReference = referenceMatch[1];
  let validHamperId = reference.replace(referenceMatch[0], "");
  if (existingRef) {
    console.log(reference, "already exists!");
    let isUnique = false;

    let hamperIncrement = 0;
    while (!isUnique) {
      hamperIncrement++;
      let checkIncrement = hamperIncrement.toString().padStart(3, "0");
      const existingRefCheck = existingFamiliesData.find(
        (f) => f?.GSI2SK === `SK#${usersReference}-${checkIncrement}`
      );
      isUnique = existingRefCheck === undefined;

      if (hamperIncrement >= 100) {
        isUnique = true;
      }
    }
    validHamperId = hamperIncrement.toString().padStart(3, "0");
  }
  console.log(`Rolling with: ${usersReference}-${validHamperId}`);
  return `${usersReference}-${validHamperId}`;
};

exports.handler = async (event, context, cb) => {
  try {
    if (
      !Functions.hasPermission(event, "Admin") &&
      !Functions.hasPermission(event, "TeamLead") &&
      !Functions.hasPermission(event, "Nominator")
    ) {
      return Responses._401({
        messages: {
          unauthorized: "You are not authorized to view this section",
        },
      });
    }

    const escapeRegEx = new RegExp(/(<([^>]+)>)/gi);
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;

    const parsed = event.nominators ? event : JSON.parse(event.body);
    const userEmail = event.requestContext.authorizer.claims.email;

    console.log("We are authorised as: ", userEmail);

    if (!parsed) {
      return Responses._400({
        message: "Failed to read submitted data: " + JSON.stringify(parsed),
      });
    }
    console.log("data is parsed", parsed);

    const campaignId = parsed.campaign.toString().replace(escapeRegEx, "");
    let nominatorRequest = parsed.nominator;

    const campaignParams = {
      TableName: mainTableName,
      FilterExpression: "#pk = :pk",
      ExpressionAttributeNames: {
        "#pk": "PK",
      },
      ExpressionAttributeValues: {
        ":pk": campaignId ?? "UNKNOWN",
      },
    };
    let allCampaignData = await Dynamo.scan(campaignParams).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });
    console.log("campaign data recieved...", allCampaignData.length);

    let nominatorData;
    if (
      !nominatorRequest ||
      (!Functions.hasPermission(event, "Admin") &&
        !Functions.hasPermission(event, "TeamLead"))
    ) {
      nominatorData = allCampaignData.find(
        (o) =>
          (o?.type === "nominator" || o?.type === "team-lead") &&
          o.SK === `EMAIL#${userEmail}`
      );
    } else {
      nominatorData = allCampaignData.find(
        (o) =>
          (o?.type === "nominator" || o?.type === "team-lead") &&
          o.GSI2PK === nominatorRequest
      );
    }

    if (!nominatorData?.PK) {
      console.log("Unauthorised nomination", campaignId, nominatorData);
      return Responses._400({ message: "Unauthorised nomination" });
    }
    console.log("Nominator found", nominatorData);

    const nominatorId = nominatorData.GSI2PK;
    const organisationId = nominatorData.GSI3PK;

    const organisationData = allCampaignData.find(
      (o) => o?.type === "organisation" && o.GSI2PK === organisationId
    );

    if (!organisationData?.PK) {
      console.log("Organisation not found", campaignId, nominatorData);
      return Responses._400({ message: "Unauthorised nomination" });
    }
    console.log("Organisation found", organisationData);

    const campaignData = allCampaignData.find((o) => o?.type === "campaign");

    if (!campaignData?.PK) {
      console.log("Unauthorised nomination", campaignId, nominatorData);
      return Responses._400({ message: "Unauthorised nomination" });
    }
    console.log("Campaign found", campaignData);

    let existingFamiliesData = allCampaignData.filter(
      (o) => o?.type === "family" && o.GSI3PK === organisationId
    );
    console.log(existingFamiliesData.length, "Existing families");

    if (
      !Functions.hasPermission(event, "Admin") &&
      !organisationData?.organisation?.ignoreClose
    ) {
      console.log("Don't ignore the close");
      let closingDate =
        campaignData?.campaignDetails?.nominationsClosed ??
        campaignData?.campaignDetails?.campaignEnd;

      if (moment().isAfter(moment(closingDate))) {
        console.log("Nominations are closed", organisationId);
        return Responses._400({
          messages: { error: "The nominations process is now closed." },
        });
      }
      console.log("we're good, don't panic");
    }

    if (parsed.nominations.length) {
      console.log("Loop the nomindations", parsed.nominations.length);
      for (const [i, n] of parsed.nominations.entries()) {
        console.log("i, n", i, n);
        const familyId = nanoid(12);

        // Double check the reference so we don't accidentally overwrite something we shouldn't
        const validReference = await checkValidReference(
          n.hamperId.toString().replace(escapeRegEx, ""),
          existingFamiliesData
        );

        var totalUnit = 0;

        const timezone = process.env.TIMEZONE;
        const dateFormat = process.env.DATE_FORMAT;
        const timeStamp = moment(new Date().getTime())
          .tz(timezone)
          .format(dateFormat);

        const familyMembersData = [];

        // Add the members...
        if (n.members.length) {
          console.log("Add the memebrs...");
          const familyMembers = n.members.filter((m) => m.who);

          for (const [j, m] of familyMembers.entries()) {
            console.log("j, m", j, m);
            const memberData = {
              age: m.age ?? "",
              ageType: m.ageType ?? "",
              who: m.who ?? "",
              whoOther: m.whoOther ?? "",
              additionalInfo: m.additionalInfo ?? "",
            };
            console.log("memberData", memberData);
            familyMembersData.push(memberData);
            totalUnit++;
          }
        }

        const familyData = {
          PK: campaignId,
          SK: `REF#${familyId}`,
          dateAdded: timeStamp,
          GSI1PK: familyId,
          GSI1SK: `C#${campaignId}`,
          GSI2PK: familyId,
          GSI2SK: `SK#${validReference}`,
          GSI3PK: organisationId,
          GSI3SK: `${nominatorId}`,
          members: familyMembersData,
          nominatorDetail: Functions.createDetailPreview(
            "workerDetail",
            nominatorData?.nominatorDetails ?? {}
          ),
          familyDetail: Functions.createDetailPreview("familyDetail", {
            members: familyMembersData,
          }),
          totalUnit: totalUnit,
          allocatedTo: "unallocated",
          status: "unallocated",
          type: "family",
        };

        console.log("Create the family!");
        const newRequest = await Dynamo.write(familyData, mainTableName).catch(
          (err) => {
            console.log("error in dynamo write", err);
            return Responses._400({ messages: err });
          }
        );

        if (!newRequest) {
          return Responses._400({ message: "Failed to write db by ID" });
        }

        existingFamiliesData.push(familyData);
      }

      if (
        !Functions.hasPermission(event, "Admin") &&
        !Functions.hasPermission(event, "TeamLead")
      ) {
        existingFamiliesData = existingFamiliesData.filter(
          (f) => f?.GSI3SK === nominatorId
        );
      }

      return Responses._200({
        messages: {
          success: `Famil${
            parsed.nominations.length > 1 ? "ies" : "y"
          } created successful`,
        },
        families: existingFamiliesData,
      });
    }

    return Responses._400({
      messages: { notfound: "Invalid Family" },
    });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
