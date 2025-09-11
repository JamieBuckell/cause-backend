const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");

const { nanoid } = require("nanoid");

exports.handler = async (event, context, cb) => {
  try {
    const commsTableName = process.env.COMMS_DYNAMO_TABLE;

    /*
    const deleteRecipientParams = {
      KeyConditionExpression: "#pk= :pk",
      ExpressionAttributeValues: {
        ":pk": "RECIPIENT",
      },
      ExpressionAttributeNames: {
        "#pk": "PK",
      },
    };
    let recipientsToDelete = await Dynamo.query(
      deleteRecipientParams,
      commsTableName
    ).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });
    console.log(`deleting ${recipientsToDelete.length} recipients`);
    for (const [i, entry] of recipientsToDelete.entries()) {
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

    const emailRecipients = allComms.filter(
      (d) => d?.type === "recipient" && d?.PK != "RECIPIENT"
    );
    const re = /[\-\s\:]/g;
    for (const [i, entry] of emailRecipients.entries()) {
      const newDate = `SORT#${entry.dateSent.replace(re, "")}#${
        entry.ref ?? nanoid(12)
      }`;

      const existing = emailRecipients.find(
        (e) => e.PK == "RECIPIENT" && e.SK == newDate
      );

      await Dynamo.delete({ PK: entry.PK, SK: entry.SK }, commsTableName).catch(
        (err) => {
          console.log("error in donors dynamo delete", err);
          return Responses._400({ messages: err });
        }
      );

      /*
      if (!existing?.PK) {
        (entry.SK = newDate),
          (entry.PK = "RECIPIENT"),
          (entry.GSI1SK = `EMAIL#${entry.emailAddress}`);

        batchData.push({
          PutRequest: {
            Item: entry,
          },
        });
      } else {
        console.log(
          `${entry.emailAddress} at ${entry.dateSent}: ${entry.GSI1PK} Exists`
        );
      }
      */
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
