const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

const { nanoid } = require("nanoid");
const moment = require("moment-timezone");

exports.handler = async (event, context, cb) => {
  try {
    const websiteURL = process.env.WEBSITE_URL;
    const appURL = process.env.APP_URL;
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;
    const subscriberTableName = process.env.SUBSCRIBERS_TABLE;

    const legacyOrganisationsTable = "cause-organisations-live-restored";

    const envSalt = process.env.HASHING_SALT;
    const envHashPrefix = process.env.HASHING_PREFIX;

    const campaignId = "CH1"; // 2022 Campaign

    console.log("Get Organisations");
    const organisationsData = await Dynamo.scan({
      TableName: legacyOrganisationsTable,
    }).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    const batchData = [];

    if (organisationsData.length) {
      console.log("Organisations to migrate", organisationsData.length);
      for (const [i, organisation] of organisationsData.entries()) {
        const timezone = process.env.TIMEZONE;
        const dateFormat = process.env.DATE_FORMAT;
        const timeStamp = moment(new Date().getTime())
          .tz(timezone)
          .format(dateFormat);

        const orgSK = organisation.reference;
        const orgGSI2SK = `SK#${organisation.reference}`;

        const existingOrg = batchData.find(
          (bd) => bd.PutRequest.Item.SK === orgSK
        );

        if (existingOrg) {
          console.log("This org already exists!", existingOrg);
        } else {

          const organisationIdentifier = nanoid(12);
          const organisationData = {
            PK: campaignId,
            SK: orgSK,
            dateAdded: organisation?.dateSubmitted ?? timeStamp,
            GSI1PK: organisationIdentifier,
            GSI1SK: `C#${campaignId}`,
            GSI2PK: organisationIdentifier,
            GSI2SK: orgGSI2SK,
            hash: {
              data: organisation?.hashedData ?? "",
              salt: organisation?.hashSalt ?? "",
            },
            legacyId: organisation.requestId,
            organisation: {
              name: organisation?.name ?? "",
              totalFamilies: organisation?.totalFamilies ?? "",
              type: organisation?.type ?? "",
            },
            type: "organisation",
          };

          batchData.push({
            PutRequest: {
              Item: organisationData,
            },
          });
        }
      }
    } else {
      console.log("NOPE");
    }

    if (batchData && batchData.length) {
      const chunkSize = 25;
      console.log(
        "Organisation batches to import, total:",
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
      console.log("Organisations Import Fin.");
    }
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
