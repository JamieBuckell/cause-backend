const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

const AWS = require("aws-sdk");
AWS.config.update({ region: "eu-west-2" });

exports.handler = async (event, context, cb) => {
  try {
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;
    const envSalt = process.env.HASHING_SALT;
    const appURL = process.env.APP_URL;

    const userEmail =
      event.requestContext.authorizer.claims.email.toLowerCase();
    console.log(`Email ${userEmail} has been authorized`);

    const meResponse = {
      email: userEmail,
    };

    const params = {
      TableName: mainTableName,
      FilterExpression: "#sk = :sk",
      ExpressionAttributeNames: {
        "#sk": "SK",
      },
      ExpressionAttributeValues: {
        ":sk": `EMAIL#${userEmail}`,
      },
    };
    nominatorData = await Dynamo.scan(params).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });
    if (nominatorData.length) {
      const nominator = nominatorData[0];
      if (
        nominator?.type == "team-lead" &&
        !nominator?.nominatorDetails?.welcomeSent
      ) {
        const campaignParams = {
          TableName: mainTableName,
          FilterExpression: "#pk = :pk",
          ExpressionAttributeNames: {
            "#pk": "PK",
          },
          ExpressionAttributeValues: {
            ":pk": nominator.PK ?? "UNKNOWN",
          },
        };
        let allCampaignData = await Dynamo.scan(campaignParams).catch((err) => {
          console.log("error in dynamo query", err);
          return Responses._400({ messages: err });
        });

        const organisationData = allCampaignData.find(
          (o) => o?.type === "organisation" && o.GSI2PK === nominator.GSI3PK
        );

        const urlHash = Hashing.hash(
          organisationData.hash.data,
          envSalt + organisationData.hash.salt
        ).hashedpassword;
        const nominatorRegisterLink = `${appURL}/register/${organisationData.GSI2PK}/${urlHash}`;
        const emailTemplateNominator = {
          appURL,
          nominatorRegisterLink,
        };

        const emailWelcomeTemplateParams = await Functions.getEmailTemplate(
          "organisationAdminWelcome",
          emailTemplateNominator
        );
        const jsonWelcomeParameters = {
          ToAddresses: [userEmail],
          ...emailWelcomeTemplateParams,
        };
        await Notifications.sendTransactionalEmail(jsonWelcomeParameters);
        console.log("Admin welcome sent");

        nominator.nominatorDetails["welcomeSent"] = true;
        await Dynamo.write(nominator, mainTableName).catch((err) => {
          console.log("error in dynamo write", err);
          return Responses._400({ messages: err });
        });
      }
    }

    return Responses._200(meResponse);
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
