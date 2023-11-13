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

    const donorData = allData.filter((d) => d?.type === "donor");

    if (donorData.length) {
      console.log("Data to migrate", donorData.length);
      for (const [i, entry] of donorData.entries()) {
        if (entry?.SK && entry.SK.startsWith("EMAIL#D#")) {
          console.log(`Skipping ${entry?.SK ?? entry.SK}`);
          continue;
        }

        // Delete the original!
        /* */
        await Dynamo.delete(
          { PK: entry.PK, SK: entry.SK },
          mainTableName
        ).catch((err) => {
          console.log("error in donors dynamo delete", err);
          return Responses._400({ messages: err });
        });
        /* */

        // Create the new version!
        /* *
        if (!entry?.SK) {
          entry.SK = `${entry.SK.replace("EMAIL#", "EMAIL#D#")}`;
        } else {
          entry.SK = `${entry.SK.replace("EMAIL#", "EMAIL#D#")}`;
        }

        batchData.push({
          PutRequest: {
            Item: entry,
          },
        });
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
