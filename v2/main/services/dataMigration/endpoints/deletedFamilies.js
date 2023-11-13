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
    const params = {
      TableName: mainTableName,
      FilterExpression: "#pk = :pk",
      ExpressionAttributeNames: {
        "#pk": "PK",
      },
      ExpressionAttributeValues: {
        ":pk": "CH2",
      },
    };
    let allCampaignData = await Dynamo.scan(params).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    params.TableName = "cause-portal-v2-live-restored-17Oct";
    let backup17CampaignData = await Dynamo.scan(params).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    params.TableName = "cause-portal-v2-live-restored-18Oct";
    let backup18CampaignData = await Dynamo.scan(params).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    params.TableName = "cause-portal-v2-live-restored-19Oct";
    let backup19CampaignData = await Dynamo.scan(params).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    const batchData = [];

    const familyData = allCampaignData.filter(
      (d) => d?.type === "family" && d?.status !== "deleted"
    );

    const familyData17 = backup17CampaignData.filter(
      (d) => d?.type === "family" && d?.status !== "deleted"
    );

    const familyData18 = backup18CampaignData.filter(
      (d) => d?.type === "family" && d?.status !== "deleted"
    );

    const familyData19 = backup19CampaignData.filter(
      (d) => d?.type === "family" && d?.status !== "deleted"
    );

    if (familyData17.length) {
      console.log("Families to check", familyData17.length);
      for (const [i, entry] of familyData17.entries()) {
        if (!entry?.SK || !entry?.GSI2PK) {
          console.log("Invalid Entry", entry);
          continue;
        }

        const familyExists = familyData.find((f) => f.GSI2PK === entry.GSI2PK);

        if (!familyExists) {
          console.log("LOST FAMILY!", entry.GSI2PK, entry);
          /* *
          const newSK = `REF#${entry.GSI2PK}`;
          entry.SK = newSK;
          batchData.push({
            PutRequest: {
              Item: entry,
            },
          });
          /* */
        }

        /* */
      }
    } else {
      console.log("NOPE");
    }

    if (batchData && batchData.length) {
      const chunkSize = 25;
      console.log(
        "Item batches to import, total:",
        batchData.length,
        "Batches:",
        batchData.length / chunkSize
      );
      for (let i = 0; i < batchData.length; i += chunkSize) {
        const chunk = batchData.slice(i, i + chunkSize);

        await Dynamo.batchWrite(chunk, mainTableName).catch((err) => {
          console.log("error in dynamo write", err);
          return Responses._400({ messages: err });
        });
      }
      console.log("Item Import Fin.");
    }
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
