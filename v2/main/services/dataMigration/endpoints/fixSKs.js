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
    };
    let allData = await Dynamo.scan(params).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    const batchData = [];

    if (allData.length) {
      console.log("Data to migrate", allData.length);
      for (const [i, entry] of allData.entries()) {
        if (entry?.GSI2SK && entry.GSI2SK.startsWith("SK#")) {
          console.log(`Skipping ${entry?.GSI2SK ?? entry.GSI2PK}`);
          continue;
        }
        if (!entry?.GSI2SK) {
          entry.GSI2SK = `SK#${entry.SK.replace("EMAIL#", "")}`;
        } else {
          entry.GSI2SK = `SK#${entry.GSI2SK.replace("EMAIL#", "")}`;
        }

        batchData.push({
          PutRequest: {
            Item: entry,
          },
        });
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
