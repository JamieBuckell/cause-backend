const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");

const validations = [
  {
    key: "hamperId",
    required: true,
    errorMsg: "Hamper ID is required",
  },
  {
    key: "hamperHash",
    required: true,
    errorMsg: "Hamper Hash is required",
  },
];

exports.handler = async (event, context, cb) => {
  try {
    const familiesTableName = process.env.FAMILIES_TABLE;

    const parsed = event.hamperId ? event : JSON.parse(event.body);

    const valid = await Functions.validateSubmission(parsed, validations);
    if (Object.keys(valid).length > 0) {
      return Responses._400({ messages: valid });
    }

    const hamperId = parsed.hamperId;
    const hamperHash = parsed.hamperHash;

    const queryData = {
      IndexName: "familyRequest",
      KeyConditionExpression: "#hamper_reference = :reference",
      ExpressionAttributeValues: {
        ":reference": hamperId,
      },
      ExpressionAttributeNames: {
        "#hamper_reference": "reference",
      },
    };
    let familyData = await Dynamo.query(queryData, familiesTableName).catch(
      (err) => {
        console.log("error in dynamo query", err);
        return Responses._400({ messages: err });
      }
    );

    if (familyData && familyData[0]) {
      familyData = familyData[0];

      const familyId = familyData.requestId;
      const envSalt = process.env.HASHING_SALT;

      const hashCompare = Hashing.compare(hamperId, {
        salt: envSalt + familyId,
        hashedpassword: hamperHash,
      });

      if (hashCompare) {
        return Responses._200({
          hasFeedback: familyData?.feedback && familyData?.feedback !== "",
        });
      } else {
        console.log("Has not matched");
      }
    } else {
      console.log("Hamper not found");
    }

    return Responses._200({ messages: { error: "Hamper not found" } });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
