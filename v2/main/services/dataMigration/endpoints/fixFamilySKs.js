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

    const familyData = allData.filter(
      (d) => d?.type === "family" && d?.status !== "deleted"
    );

    if (familyData.length) {
      console.log("Data to migrate", familyData.length);
      let count = 0;
      for (const [i, entry] of familyData.entries()) {
        count++;
        if (!entry?.SK || !entry?.GSI2PK) {
          console.log("Invalid Entry", entry);
          continue;
        }
        const newSK = `REF#${entry.GSI2PK}`;
        if (entry.SK === newSK) {
          console.log(`Skipping ${entry?.SK ?? "UNKNOWN"}`);
          continue;
        }

        console.log("Updating");

        const ogEntry = { ...entry };
        ogEntry.status = "deleted";

        // Create the new version!
        /* */
        entry.SK = newSK;

        batchData.push({
          PutRequest: {
            Item: entry,
          },
        });
        batchData.push({
          PutRequest: {
            Item: ogEntry,
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
