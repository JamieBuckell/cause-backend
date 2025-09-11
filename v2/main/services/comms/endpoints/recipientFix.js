const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");

const { nanoid } = require("nanoid");

exports.handler = async (event, context, cb) => {
  try {
    const commsTableName = process.env.COMMS_DYNAMO_TABLE;

    const findRecipientParams = {
      KeyConditionExpression: "#pk= :pk",
      ExpressionAttributeValues: {
        ":pk": "RECIPIENT",
      },
      ExpressionAttributeNames: {
        "#pk": "PK",
      },
    };
    let recipientsToFix = await Dynamo.query(
      findRecipientParams,
      commsTableName
    ).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    for (const [i, entry] of recipientsToFix.entries()) {
      /* *
      const re = /[\-\s\:]/g;
    
      const newDate = `SORT#${entry.dateSent.replace(re, "")}#${
        entry.ref ?? nanoid(12)
      }`;
      (entry.SK = newDate),
        (entry.PK = "RECIPIENT"),
        (entry.GSI1SK = `EMAIL#${entry.emailAddress}`);
      /* */
      const dupe = recipientsToFix.filter((r) => {
        const parts = entry.SK.split("#");
        return (
          r.SK.includes(parts[0] + "#" + parts[1]) &&
          r.emailAddress == entry.emailAddress &&
          r.GSI1PK == entry.GSI1PK
        );
      });

      if (dupe.length > 1) {
        console.log(`${entry.SK} is duplicated ${dupe.length} times`);
      }
    }

    console.log("Item Import Fin.");
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
