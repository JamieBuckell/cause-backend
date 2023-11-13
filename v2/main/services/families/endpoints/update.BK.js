const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");

var uuid = require("uuid");

const moment = require("moment-timezone");

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
    const familiesTableName = process.env.FAMILIES_TABLE;
    const familyMembersTableName = process.env.FAMILY_MEMBERS_TABLE;
    const nomTableName = process.env.NOMINATORS_TABLE;
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;

    const parsed = event.nominatorId ? event : JSON.parse(event.body);

    const campaignId = parsed.campaign;
    const organisationId = parsed.organisationId;

    const escapeRegEx = new RegExp(/(<([^>]+)>)/gi);

    const campaignParams = {
      TableName: mainTableName,
      FilterExpression: "#pk = :pk AND #sk = :sk AND #type = :type",
      ExpressionAttributeNames: {
        "#pk": "PK",
        "#sk": "SK",
        "#type": "type",
      },
      ExpressionAttributeValues: {
        ":pk": campaignId,
        ":sk": "A",
        ":type": "campaign",
      },
    };
    let campaignData = await Dynamo.scan(campaignParams).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });
    campaignData = campaignData[0] ?? {};

    const organisationParams = {
      TableName: mainTableName,
      FilterExpression: "#pk = :pk AND #type = :type",
      ExpressionAttributeNames: {
        "#pk": "PK",
        "#type": "type",
      },
      ExpressionAttributeValues: {
        ":pk": campaignId,
        ":type": "organisation",
      },
    };
    let organisationData = await Dynamo.scan(organisationParams).catch(
      (err) => {
        console.log("error in dynamo query", err);
        return Responses._400({ messages: err });
      }
    );
    organisationData = organisationData[0] ?? {};

    const closingDate = moment(
      campaignData?.campaignDetails?.nominationsClosed
    );

    if (
      !Functions.hasPermission(event, "Admin") &&
      !organisationData?.organisation?.ignoreNominationEndDate &&
      moment().isAfter(closingDate)
    ) {
      console.log("Nominations are closed", organisationId);
      return Responses._400({
        messages: { error: "The nominations process is now closed." },
      });
    }

    const params = {
      TableName: mainTableName,
      FilterExpression: "#pk = :pk AND begins_with(#sk, :sk) AND #type = :type",
      ExpressionAttributeNames: {
        "#pk": "PK",
        "#sk": "SK",
        "#type": "type",
      },
      ExpressionAttributeValues: {
        ":pk": campaignId,
        ":sk": "REF#",
        ":type": "family",
      },
    };
    let allFamilyData = await Dynamo.scan(params).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    var createdFamilies = [];

    if (parsed.nominations.length) {
      for (const [i, n] of parsed.nominations.entries()) {
        if (!n.hamperId) {
          console.log("Nominator not found... ", n, parsed.nominations);
          return Responses._400({
            messages: { unexpected: "Nominator not found" },
          });
        }

        if (!n.familyId) {
          continue;
        }

        const familyData = allFamilyData.find((f) => f.GSI2PK === n.familyId);
        if (!familyData) {
          return Responses._400({ message: "Failed to retrieve by ID" });
        }

        const familyMembersData = familyData.members;

        const familyId = familyData.requestId;

        // use replace for extra layer of security
        const validReference = n.hamperId.toString().replace(escapeRegEx, "");

        var totalUnit = 0;

        const timezone = process.env.TIMEZONE;
        const dateFormat = process.env.DATE_FORMAT;
        const timeStamp = moment(new Date().getTime())
          .tz(timezone)
          .format(dateFormat);

        familyData.reference = validReference;
        familyData.totalUnit = totalUnit;
        familyData.status = familyData.status
          ? familyData.status
          : "unallocated";

        const updatedRequest = await Dynamo.write(
          familyData,
          familiesTableName
        ).catch((err) => {
          console.log("error in dynamo write", err);
          return Responses._400({ messages: err });
        });

        if (!updatedRequest) {
          return Responses._400({ message: "Failed to write db by ID" });
        }

        // Add the members...
        if (n.members.length) {
          const familyMembers = n.members.filter((m) => m.who);

          const updatedMembers = [];
          for (const [j, m] of familyMembers.entries()) {
            totalUnit++;
            let memberData = {
              requestId: uuid.v4(),
              familyId: familyId,
              nominatorId: validNominatorId,
              organisationId: organisationId,
              dateSubmitted: timeStamp,
              status: "unallocated",
            };
            if (m?.memberId) {
              updatedMembers.push(m.memberId);
              findMember = familyMembersData.find(
                (fm) => fm.requestId === m.memberId
              );
              if (findMember) {
                memberData = { ...findMember };
              }
            }
            memberData.age = m.age ?? "";
            memberData.ageType = m.ageType ?? "";
            memberData.who = m.who ?? "";
            memberData.whoOther = m.whoOther ?? "";
            memberData.additionalInfo = m.additionalInfo ?? "";

            const newMember = await Dynamo.write(
              memberData,
              familyMembersTableName
            ).catch((err) => {
              console.log("error in dynamo write", err);
              return Responses._400({ messages: err });
            });

            if (!newMember) {
              return Responses._400({ message: "Failed to write db by ID" });
            }
          }

          familyData.nominatorDetail = Functions.createDetailPreview(
            "workerDetail",
            nominatorData
          );
          familyData.familyDetail = Functions.createDetailPreview(
            "familyDetail",
            { members: familyMembers }
          );
          familyData.totalUnit = totalUnit;
          familyData.status = familyData.status
            ? familyData.status
            : "unallocated";
          await Dynamo.write(familyData, familiesTableName).catch((err) => {
            console.log("error in dynamo write", err);
            return Responses._400({ messages: err });
          });

          if (updatedMembers.length) {
            const deletedMembers = familyMembersData.filter(
              (fm) => !updatedMembers.includes(fm.requestId)
            );
            if (deletedMembers) {
              console.log(deletedMembers);

              const batchData = [];
              for (const [k, member] of deletedMembers.entries()) {
                batchData.push({
                  DeleteRequest: {
                    Key: { requestId: member.requestId },
                  },
                });
              }

              const chunkSize = 25;
              for (let i = 0; i < batchData.length; i += chunkSize) {
                const chunk = batchData.slice(i, i + chunkSize);

                await Dynamo.batchWrite(chunk, familyMembersTableName).catch(
                  (err) => {
                    console.log("error in dynamo write", err);
                    return Responses._400({ messages: err });
                  }
                );
              }
            }
          }
        }

        createdFamilies.push(familyData);
      }
    }

    return Responses._200({
      messages: {
        success: `Famil${
          parsed.nominations.length > 1 ? "ies" : "y"
        } created successful`,
      },
      families: createdFamilies,
    });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
