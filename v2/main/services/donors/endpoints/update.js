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
      throw err;
    });

    console.log(hamperData.length);
    if (hamperData && hamperData[0]) {
      hamperData = hamperData.find(
        (h) => h.type === "family" && h.status !== "deleted" && h.GSI2SK === `SK#${parsed.hamperId}`
      );
    }
    if (hamperData?.SK) {
      console.log("hamperData", hamperData);

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
          throw err;
        }
      );

      donorData = donorData.filter(d => d.PK === parsed.campaignId && d.type === "donor" && d.status !== "deleted");
      if (donorData && donorData[0]) {
        const targetRequest = donorData[0].familyDetails?.request?.find(r => r.requestId === parsed.requestId);
        if (!targetRequest) return Responses._400({ messages: { error: "Donor request not found" } });
        donorData = donorData[0];
        console.log("donorData", donorData);

        donorData.history = "REMOVED";

        if (donorData?.familyDetails?.allocation) {
          delete donorData.familyDetails.allocation;
        }

        const requestIndex = donorData.familyDetails.request.findIndex(
          (r) => r.requestId === parsed.requestId
        );

        if (!donorData.familyDetails.request[requestIndex]?.allocation) {
          donorData.familyDetails.request[requestIndex].allocation = [];
        }

        if (!donorData.familyDetails.request[requestIndex].allocation.some(a => a.hamperId === parsed.hamperId)) donorData.familyDetails.request[requestIndex].allocation.push({
          hamperId: parsed.hamperId,
          members: hamperData?.members ?? [],
        });

        console.log("donorData", donorData);
        await Dynamo.write(donorData, mainTableName).catch((err) => {
          console.log("error in dynamo write", err);
          throw err;
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
