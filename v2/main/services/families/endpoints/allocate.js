const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");

const validations = [
  {
    key: "campaignId",
    required: true,
    errorMsg: "Campaign is required",
  },
  {
    key: "hamperId",
    required: true,
    errorMsg: "Hamper is required",
  },
  {
    key: "donorId",
    required: true,
    errorMsg: "Nominator is required",
  },
  {
    key: "requestId",
    required: true,
    errorMsg: "Family Request is required",
  },
];

exports.handler = async (event, context, cb) => {
  try {
    if (!Functions.hasPermission(event, "Admin")) {
      return Responses._401({
        messages: {
          unauthorized: "You are not authorized to view this section",
        },
      });
    }

    const mainTableName = process.env.MAIN_DYNAMO_TABLE;

    const remove =
      event["path"] && event["path"].includes("families/allocate/remove");

    const parsed = event.campaignId ? event : JSON.parse(event.body);
    console.log("Submitted Data", parsed);

    const valid = await Functions.validateSubmission(parsed, validations);
    if (Object.keys(valid).length > 0) {
      return Responses._400({ messages: valid });
    }

    console.log(
      `Allocating ${parsed.hamperId} to ${parsed.donorId} for campaign ${parsed.campaignId}`
    );

    const hamperQueryData = {
      TableName: mainTableName,
      FilterExpression: "#pk= :pk AND begins_with(#sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": parsed.campaignId,
        ":sk": "REF#",
      },
      ExpressionAttributeNames: {
        "#pk": "PK",
        "#sk": "SK",
      },
    };
    var hamperData = await Dynamo.scan(hamperQueryData).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    if (hamperData.length) {
      hamperData = hamperData.find(
        (h) => h.type === "family" && h.GSI2SK === `SK#${parsed.hamperId}`
      );
    }
    if (hamperData?.SK) {
      console.log("hamperData", hamperData);

      if (
        !remove &&
        hamperData?.allocatedTo &&
        hamperData.allocatedTo != "" &&
        hamperData.allocatedTo != "unallocated"
      ) {
        return Responses._400({
          messages: {
            unexpected:
              "This family has already been allocated to another donor.",
          },
        });
      }

      const donorQueryData = {
        IndexName: "GSI2",
        KeyConditionExpression: "#pk= :pk AND begins_with(#sk, :sk)",
        ExpressionAttributeValues: {
          ":pk": parsed.donorId,
          ":sk": `EMAIL#`,
        },
        ExpressionAttributeNames: {
          "#pk": "GSI2PK",
          "#sk": "GSI2SK",
        },
      };
      var donorData = await Dynamo.query(donorQueryData, mainTableName).catch(
        (err) => {
          console.log("error in dynamo query", err);
          return Responses._400({ messages: err });
        }
      );

      if (donorData && donorData[0]) {
        hamperData.allocatedTo = remove ? "unallocated" : parsed.donorId;
        hamperData.status = remove ? "unallocated" : "allocated-unconfirmed";

        console.log("hamperData", hamperData);
        await Dynamo.write(hamperData, mainTableName).catch((err) => {
          console.log("error in dynamo write", err);
          return Responses._400({ messages: err });
        });

        donorData = donorData[0];
        console.log("donorData", donorData);

        /* *
        const previousData = { ...donorData };
        const historicData = {
          familyDetails: previousData?.familyDetails ?? {},
        };
        const existingHistory = previousData.history ?? [];
        donorData.history = [historicData, ...existingHistory];
        /* */
        donorData.history = "REMOVED"; //[historicData, ...existingHistory];

        if (donorData?.familyDetails?.allocation) {
          delete donorData.familyDetails.allocation;
        }

        const requestIndex = donorData.familyDetails.request.findIndex(
          (r) => r.requestId === parsed.requestId
        );

        if (!donorData.familyDetails.request[requestIndex]?.allocation) {
          donorData.familyDetails.request[requestIndex].allocation = [];
        }

        if (remove) {
          const indexToDelete = donorData.familyDetails.request[
            requestIndex
          ].allocation.findIndex((a) => a.hamperId === parsed.hamperId);
          donorData.familyDetails.request[requestIndex].allocation.splice(
            indexToDelete,
            1
          );
        } else {
          donorData.familyDetails.request[requestIndex].allocation.push({
            hamperId: parsed.hamperId,
            members: hamperData?.members ?? [],
          });
        }

        console.log("donorData", donorData);
        await Dynamo.write(donorData, mainTableName).catch((err) => {
          console.log("error in dynamo write", err);
          return Responses._400({ messages: err });
        });

        return Responses._200({
          messages: { success: `Family allocated successful` },
        });
      } else {
        return Responses._400({ messages: { unexpected: "Donor not found" } });
      }
    } else {
      return Responses._400({ messages: { unexpected: "Family not found" } });
    }
    /* */
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
