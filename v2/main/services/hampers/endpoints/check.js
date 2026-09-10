const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");

const validations = [
  {
    key: "campaignId",
    required: true,
    errorMsg: "Campaign ID is required",
  },
  {
    key: "hamperId",
    required: true,
    errorMsg: "Hamper ID is required",
  },
];

exports.handler = async (event, context, cb) => {
  try {
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;

    const parsed = event.hamperId ? event : JSON.parse(event.body);

    const valid = await Functions.validateSubmission(parsed, validations);
    if (Object.keys(valid).length > 0) {
      return Responses._400({ messages: valid });
    }

    const campaignQueryData = {
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
    var campaignData = await Dynamo.scan(campaignQueryData).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    let hamperId = parsed.hamperId;
    if (hamperId.indexOf("-") === -1) {
      const insertPos = hamperId.length - 3;
      hamperId =
        hamperId.substring(0, insertPos) + "-" + hamperId.substring(insertPos);
    }

    const donorQueryData = {
      KeyConditionExpression: "#pk= :pk And begins_with(#sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": parsed.campaignId,
        ":sk": `EMAIL#D#`,
      },
      ExpressionAttributeNames: {
        "#pk": "PK",
        "#sk": "SK",
      },
    };
    var campaignDonors = await Dynamo.query(
      donorQueryData,
      mainTableName
    ).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    const campaignDonorsMapped = campaignDonors.map((d) => ({
      donorId: d.GSI2PK,
      name: `${d.donorDetails.firstName} ${d.donorDetails.lastName}`,
      company: d.donorDetails.company,
    }));

    const allDonorPledges = Object.fromEntries(
      campaignDonorsMapped.map((d) => [d.donorId, d])
    );

    const hamper = campaignData.find(
      (h) => h.GSI2SK === `SK#${hamperId}` && h.status != "deleted"
    );
    if (hamper && hamper?.PK) {
      const returnRes = {
        success: true,
        hamperId,
        bagsReceived: hamper?.bagsReceived ? hamper.bagsReceived : 0,
        donor: hamper?.allocatedTo ? allDonorPledges[hamper.allocatedTo] : {},
        familyUnitTotal: hamper?.totalUnit ?? 0,
        familyDynamic: await Functions.generateFamilyDynamics(
          { reference: hamperId },
          hamper?.members ?? []
        ),
      };
      if (returnRes.bagsReceived > 0) {
        returnRes.success = false;
        returnRes.messages = {
          error: "This hamper has already been received!",
        };
      }
      return Responses._200(returnRes);
    } else {
      console.log("hamperId", hamperId);
      console.log("campaignId", parsed.campaignId);
      return Responses._200({ messages: { error: "Hamper ID not found" } });
    }
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
