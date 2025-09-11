const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");

const { nanoid } = require("nanoid");

exports.handler = async (event, context, cb) => {
  try {
    const commsTableName = process.env.COMMS_DYNAMO_TABLE;

    /*
    const deleteEmailParams = {
      KeyConditionExpression: "#pk= :pk",
      ExpressionAttributeValues: {
        ":pk": "EMAIL",
      },
      ExpressionAttributeNames: {
        "#pk": "PK",
      },
    };
    let emailsToDelete = await Dynamo.query(
      deleteEmailParams,
      commsTableName
    ).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });
    console.log(`deleting ${emailsToDelete.length} emails`);
    for (const [i, entry] of emailsToDelete.entries()) {
      await Dynamo.delete({ PK: entry.PK, SK: entry.SK }, commsTableName).catch(
        (err) => {
          console.log("error in donors dynamo delete", err);
          return Responses._400({ messages: err });
        }
      );
    }
    */

    const params = {
      TableName: commsTableName,
    };
    let allComms = await Dynamo.scan(params).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });
    const batchData = [];

    const emailAddresses = allComms.filter((d) => d?.type === "email");
    for (const [i, entry] of emailAddresses.entries()) {
      await Dynamo.delete({ PK: entry.PK, SK: entry.SK }, commsTableName).catch(
        (err) => {
          console.log("error in donors dynamo delete", err);
          return Responses._400({ messages: err });
        }
      );

      (entry.GSI1PK = `${entry.PK}`), (entry.PK = "EMAIL");

      batchData.push({
        PutRequest: {
          Item: entry,
        },
      });
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

        await Dynamo.batchWrite(chunk, commsTableName).catch((err) => {
          console.log("error in dynamo write", err);
          return Responses._400({ messages: err });
        });
        console.log("Completed Batch ", i);
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
