const Responses = require("../common/API_Responses");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

var AWS = require("aws-sdk");
AWS.config.region = "eu-west-2";
var lambda = new AWS.Lambda();
var https = require("https");
const s3 = new AWS.S3();

async function get_page(url) {
  return new Promise((resolve) => {
    let data = "";

    https.get(url, (res) => {
      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        resolve(data);
      });
    });
  });
}

exports.handler = async (event, context, cb) => {
  try {
    if (event?.Records) {
      for (const r of event?.Records) {
        console.log(`Running message: ${r.body}`);

        if (r?.messageAttributes?.donorDetails) {
          const donorDetails = JSON.parse(
            r.messageAttributes.donorDetails.stringValue
          );
          const donorFamiliesData = JSON.parse(
            r.messageAttributes.donorFamiliesData.stringValue
          );
          console.log(donorFamiliesData);

          let standardTemplate = await Notifications.getEmailTemplate();

          const familyData = [];
          for (const family of donorFamiliesData) {
            familyData.push({
              reference: family.GSI2SK.replace("SK#", ""),
              totalUnit: family.members.length,
              members: family.members,
              familyDetail: "",
            });
          }

          const emailTemplate = {
            familyData: familyData,
          };
          const emailTemplateParams = await Functions.getEmailTemplate(
            "donorFamilyAllocationConfirmed",
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
            ToAddress: donorDetails.GSI3PK,
            htmlContent: standardTemplate,
            subject: emailTemplateParams.subject,
          };

          let hamperCount = 0;
          let csvContent = "";
          const pdfPages = [];

          for (const family of donorFamiliesData) {
            hamperCount++;
            const hamperReference = family.GSI2SK.replace("SK#", "");

            csvContent += '"Hamper ' + hamperCount + '"' + "\r\n";
            csvContent +=
              '"Hamper ID","Family Member","Age","Additional Information"' +
              "\r\n";
            const currentFamilyMembers = [...family.members];

            currentFamilyMembers.sort((a, b) =>
              b.age > a.age ? 1 : a.age > b.age ? -1 : 0
            );

            let familyDynamics = [];
            for (const familyMember of currentFamilyMembers) {
              const familyWho = familyMember.who;

              csvContent +=
                `"${hamperReference}","${familyWho}","${familyMember.age}${
                  familyMember.age ? " " + familyMember.ageType : ""
                }","${
                  familyMember.additionalInfo ? familyMember.additionalInfo : ""
                }"` + "\r\n";
              familyDynamics.push(
                ` ${familyWho} ${
                  familyMember.age
                    ? familyMember.age + " " + familyMember.ageType
                    : ""
                }`
              );
            }

            // Seperate Familes with a blank line
            csvContent += "\r\n";

            pdfPages.push({
              template: "labels",
              qrCode: hamperReference,
              replaceStrings: {
                "###DONOR_NAME###": `${donorDetails.donorDetails.firstName} ${donorDetails.donorDetails.lastName}`,
                "###HAMPER_ID###": `${hamperReference}`,
                "###FAMILY_DYNAMICS###": `${familyDynamics.join(",")}`,
              },
            });
          }

          if (donorFamiliesData.length >= 5) {
            rawEmailJsonParameters.csvAttachment = csvContent;
            rawEmailJsonParameters.csvAttachmentFilename =
              "your-allocation-families.csv";
          }

          const FunctionName =
            "PdfGeneratorV2Stack-HtmlToPdfLambdaB7443488-LJXTgl6nvBE2";

          var params = {
            FunctionName, // the lambda function we are going to invoke
            InvocationType: "RequestResponse",
            LogType: "Tail",
            Payload: `{ "body": ${JSON.stringify({
              pdfPages: pdfPages,
            })} }`,
          };

          const lambdaResult = await lambda.invoke(params).promise();
          const resultObject = JSON.parse(lambdaResult.Payload);

          rawEmailJsonParameters.pdfAttachmentFilename =
            "family-hamper-labels.pdf";
          if (resultObject?.body) {
            const resultBody = JSON.parse(resultObject?.body);

            if (resultBody?.filename && resultBody?.location) {
              console.log("S3 Direct...");
              const s3Params = {
                Bucket: resultBody?.location,
                Key: resultBody?.filename,
              };

              const pdfFile = await s3.getObject(s3Params).promise();
              console.log(pdfFile.Body);
              const base64Pdf = Buffer.from(pdfFile.Body).toString("base64");

              rawEmailJsonParameters.pdfAttachment = base64Pdf;
            } else if (resultBody?.pdfUrl) {
              console.log("Secure URL...");
              const pdfRespone = await get_page(resultBody.pdfUrl);

              const binaryPdf = Buffer.from(pdfRespone);

              rawEmailJsonParameters.pdfAttachment = binaryPdf;
            }

            if (rawEmailJsonParameters.pdfAttachment) {
              await Notifications.sendRawEmail(rawEmailJsonParameters);
              console.log("rawEmailJsonParameters", rawEmailJsonParameters);
            } else {
              console.log("Error with the response", rawEmailJsonParameters);
            }
          }
        }
      }
      return Responses._200({
        messages: { success: "Email Sending Complete" },
      });
    } else {
      console.log(`No records found`, event);
      return Responses._400({
        messages: { unexpected: "An unexpected error occurred" },
      });
    }
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: {
        unexpected: "An unexpected error occurred. Please try again later",
      },
    });
  }
};
