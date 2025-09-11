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

    const legacyNominatorsTable = "cause-nominators-live";

    const envSalt = process.env.HASHING_SALT;
    const envHashPrefix = process.env.HASHING_PREFIX;

    const campaignId = Functions.defaultCampaign();

    console.log("Get Nominators");
    const nominatorsnsData = await Dynamo.scan({
      TableName: legacyNominatorsTable,
    }).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    console.log("Get Curent Orgs");
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
    let allOrganisationsData = await Dynamo.scan(params).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    const batchData = [];

    if (nominatorsnsData.length) {
      console.log("Nominators to migrate", nominatorsnsData.length);
      for (const [i, nominator] of nominatorsnsData.entries()) {
        const nominatorSK = `EMAIL#${nominator.emailAddress}`;
        const nominatorSK3 = `LASTNAME#${nominator.lastName}#FIRSTNAME#${nominator.firstName}`;
        const timezone = process.env.TIMEZONE;
        const dateFormat = process.env.DATE_FORMAT;
        const timeStamp = moment(new Date().getTime())
          .tz(timezone)
          .format(dateFormat);

        const donorGSI2SK = `SK#${nominator.reference}`;

        const nomsOrg = allOrganisationsData.find(
          (o) => o?.legacyId === nominator?.organisationId
        );

        const nominatorIdentifier = nanoid(12);

        const nominatorData = {
          PK: campaignId,
          SK: nominatorSK,
          dateAdded: nominator?.dateSubmitted ?? timeStamp,
          emailVerification: {
            bouncedDetail: "",
            sent: nominator?.emailSent ?? false,
            verified: nominator?.emailSent ?? false,
          },
          GSI1PK: nominatorIdentifier,
          GSI1SK: `C#${campaignId}`,
          GSI2PK: nominatorIdentifier,
          GSI2SK: donorGSI2SK,
          GSI3PK: nomsOrg?.GSI2PK,
          GSI3SK: nominatorSK3,
          legacyId: nominator.requestId,
          nominatorDetails: {
            cognitoId: nominator?.cognitoId ?? "",
            cognitoIdv1: nominator?.cognitoIdv1 ?? "",
            email: nominator?.emailAddress ?? "",
            firstName: nominator?.firstName ?? "",
            lastName: nominator?.lastName ?? "",
            initials: nominator?.userInitials ?? "",
            reference: nominator?.userReference ?? "",
            telephone: nominator?.telephoneNumber ?? "",
          },
          status: nominator?.status ?? "",
          type: nominator?.isAdmin ? "team-lead" : "nominator",
        };

        batchData.push({
          PutRequest: {
            Item: nominatorData,
          },
        });
      }
    } else {
      console.log("NOPE");
    }

    if (batchData && batchData.length) {
      const chunkSize = 25;
      console.log(
        "Nominator batches to import, total:",
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
      console.log("Nominators Import Fin.");
    }
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
