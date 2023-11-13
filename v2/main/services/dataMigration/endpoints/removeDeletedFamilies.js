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

    const familyData = allData.filter(
      (d) => d?.type === "family" && d?.status === "deleted"
    );

    if (familyData.length) {
      console.log("Data to delete", familyData.length);
      for (const [i, entry] of familyData.entries()) {
        if (!entry?.SK || !entry?.SK) {
          console.log("Invalid Entry", entry);
          continue;
        }
        console.log("Deleting", entry?.PK, entry?.SK, entry?.status);

        await Dynamo.delete(
          { PK: entry?.PK, SK: entry?.SK },
          mainTableName
        ).catch((err) => {
          console.log("error in dynamo query", err);
          return Responses._400({ messages: err });
        });

        /* */
      }
    } else {
      console.log("NOPE");
    }
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
