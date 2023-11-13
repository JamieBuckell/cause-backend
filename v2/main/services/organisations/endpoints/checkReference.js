const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");

exports.handler = async (event, context, cb) => {
  try {
    if (!Functions.hasPermission(event, "Admin")) {
      return Responses._401({
        messages: {
          unauthorized: "You are not authorized to view this section",
        },
      });
    }
    const { reference } = event.pathParameters;
    const parsed = event.emailAddress ? event : JSON.parse(event.body);
    const campaignId = parsed.campaignId ?? null; // 2022 Campaign
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;

    let referenceValid = false;
    let newReference = reference;
    let iterator = 1;
    while (referenceValid === false) {
      const params = {
        TableName: mainTableName,
        FilterExpression: "#pk = :pk AND #type = :type",
        ExpressionAttributeNames: {
          "#pk": "PK",
          "#type": "type",
        },
        ExpressionAttributeValues: {
          ":pk": campaignId,
          ":type": "organisation",
        },
      };
      let existingOrganisations = await Dynamo.scan(params).catch((err) => {
        console.log("error in dynamo query", err);
        return Responses._400({ messages: err });
      });
      const referenceCheck = existingOrganisations.filter(
        (o) => o.SK === newReference
      );
      if (!referenceCheck.length) {
        referenceValid = true;
      } else {
        newReference = `${reference}${iterator}`;
        iterator++;
      }
    }

    return Responses._200({ reference: newReference });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
