const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");

exports.handler = async (event, context, cb) => {
  try {
    const { organisationId, hash } = event.pathParameters;
    const envSalt = process.env.HASHING_SALT;
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;

    console.log(organisationId, hash);

    const orgsQueryData = {
      IndexName: "GSI2",
      KeyConditionExpression:
        "#gsi2pk = :gsi2pk AND begins_with(#gsi2sk, :gsi2sk)",
      ExpressionAttributeValues: {
        ":gsi2pk": organisationId,
        ":gsi2sk": "SK#",
      },
      ExpressionAttributeNames: {
        "#gsi2pk": "GSI2PK",
        "#gsi2sk": "GSI2SK",
      },
    };
    const matchedOrgs = await Dynamo.query(orgsQueryData, mainTableName).catch(
      (err) => {
        console.log("error in dynamo query", err);
        return Responses._400({ messages: err });
      }
    );

    if (matchedOrgs.length) {
      const organisationData = matchedOrgs[0];

      const hashCompare = Hashing.compare(organisationData.hash.data, {
        salt: envSalt + organisationData.hash.salt,
        hashedpassword: hash,
      });

      if (hashCompare) {
        return Responses._200({
          organisationId: organisationData.GSI2PK,
          campaignId: organisationData.PK,
        });
      }
    }
    return Responses._400({ messages: { notfound: "Organisation not found" } });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
