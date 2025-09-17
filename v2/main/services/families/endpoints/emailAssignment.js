const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

const moment = require("moment-timezone");

const ageListBase = [
  { label: "0-6 months", value: 0.25 },
  { label: "6-12 months", value: 0.75 },
  { label: "12-18 months", value: 1 },
  { label: "18-24 months", value: 1.5 },
];

const validations = [
  {
    key: "donorId",
    required: true,
    errorMsg: "Donor is required",
  },
];

exports.handler = async (event, context, cb) => {
  try {
    if (!Functions.hasPermission(event, "Admin")) {
      return Responses._401({
        messages: {
          unauthorized: "You are not authorized to view this section",
        },
      });
    }
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;
    const websiteURL = process.env.WEBSITE_URL;
    const appURL = process.env.APP_URL;
    const envSalt = process.env.HASHING_SALT;

    const parsed = event.donorId ? event : JSON.parse(event.body);

    const valid = await Functions.validateSubmission(parsed, validations);
    if (Object.keys(valid).length > 0) {
      return Responses._400({ messages: valid });
    }

    const donorQueryData = {
      IndexName: "GSI2",
      KeyConditionExpression: "#pk= :pk AND begins_with(#sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": parsed.donorId,
        ":sk": `EMAIL#`,
      },
      ExpressionAttributeNames: {
        "#pk": "GSI2PK",
        "#sk": "GSI2SK",
      },
    };
    var donorData = await Dynamo.query(donorQueryData, mainTableName).catch(
      (err) => {
        console.log("error in dynamo query", err);
        return Responses._400({ messages: err });
      }
    );

    if (donorData && donorData[0]) {
      donorData = donorData[0];

      if (!donorData?.familyDetails?.request) {
        return Responses._400({
          messages: { unexpected: "Donor requests not found" },
        });
      }

      let hamperCount = 0;
      let csvContent = "";

      const timezone = process.env.TIMEZONE;
      const dateFormat = process.env.DATE_FORMAT;
      const timeStamp = moment(new Date().getTime())
        .tz(timezone)
        .format(dateFormat);
      let batchData = [];
      const familyData = [];
      for (const request of donorData.familyDetails.request) {
        for (const allocation of request.allocation) {
          hamperCount++;
          csvContent += '"Hamper ' + hamperCount + '"' + "\r\n";
          csvContent +=
            '"Family Member","Age","Additional Information"' + "\r\n";

          allocation.members.sort((a, b) =>
            b.age > a.age ? 1 : a.age > b.age ? -1 : 0
          );

          let familyDynamics = [];
          familyData.push({
            reference: allocation.hamperId,
            totalUnit: allocation.members.length,
            members: allocation.members,
            familyDetail: "",
          });
          for (const familyMember of allocation.members) {
            const familyWho = familyMember.who;

            const ageListIndex = ageListBase.findIndex(
              (al) => al.value == familyMember.age
            );

            csvContent +=
              `"${familyWho}","${
                ageListIndex >= 0
                  ? ageListBase[ageListIndex].label
                  : familyMember.age +
                    " " +
                    (familyMember.age ? familyMember.ageType : "")
              }","${
                familyMember.additionalInfo ? familyMember.additionalInfo : ""
              }"` + "\r\n";
            familyDynamics.push(
              ` ${familyWho} ${
                ageListIndex >= 0
                  ? ageListBase[ageListIndex].label
                  : familyMember.age +
                    " " +
                    (familyMember.age ? familyMember.ageType : "")
              }`
            );
          }

          // Seperate Familes with a blank line
          csvContent += "\r\n";
        }
      }
      donorData.familyDetails.allocationEmailSentDate = timeStamp;
      batchData.push({
        PutRequest: {
          Item: donorData,
        },
      });

      if (batchData.length) {
        console.log(`${batchData.length} donors to update`);
        const chunkSize = 25;
        for (let i = 0; i < batchData.length; i += chunkSize) {
          const chunk = batchData.slice(i, i + chunkSize);

          await Dynamo.batchWrite(chunk, mainTableName).catch((err) => {
            console.log("error in dynamo write", err);
            return Responses._400({ messages: err });
          });
        }
      }

      /* */
      const donorHash = Hashing.hash(
        donorData.emailVerification.hash,
        envSalt
      ).hashedpassword;
      console.log("Get standard template");
      let standardTemplate = await Notifications.getEmailTemplate();

      const emailTemplate = {
        appURL,
        websiteURL,
        emailAddress: donorData.GSI3PK,
        familyData: familyData,
        donorHash,
      };
      emailTemplate.campaignRequestId = donorData.PK;
      console.log("Get donorFamilyAllocation template");
      const emailTemplateParams = await Functions.getEmailTemplate(
        "donorFamilyAllocation",
        emailTemplate
      );

      standardTemplate = standardTemplate.replace(
        "{{pageTitle}}",
        emailTemplateParams.pageTitle
      );
      standardTemplate = standardTemplate.replace(
        "{{pageContent}}",
        emailTemplateParams.pageContent
      );

      const rawEmailJsonParameters = {
        ToAddress: donorData.GSI3PK,
        htmlContent: standardTemplate,
        subject: emailTemplateParams.subject,
      };

      if (familyData.length >= 5) {
        rawEmailJsonParameters.csvAttachment = csvContent;
        rawEmailJsonParameters.csvAttachmentFilename =
          "your-allocation-families.csv";
      }

      console.log("Send email");
      await Notifications.sendRawEmail(rawEmailJsonParameters);
      /* */

      console.log("Fin.");
      return Responses._200({
        messages: { success: `Family allocated successful` },
      });
    } else {
      return Responses._400({ messages: { unexpected: "Donor not found" } });
    }
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
