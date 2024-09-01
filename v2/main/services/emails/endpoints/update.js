const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");

const validations = [
  {
    key: "key",
    required: true,
    errorMsg: "Email key is required",
  },
  {
    key: "subject",
    required: true,
    errorMsg: "Please enter a valid email subject",
  },
  {
    key: "pageTitle",
    required: false,
    errorMsg: "Please enter a valid email title",
  },
  {
    key: "description",
    required: false,
    errorMsg: "Please enter a valid email description",
  },
  {
    key: "pageContent",
    required: true,
    errorMsg: "Page content is required",
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
    const parsed = event?.key ? event : JSON.parse(event.body);
    console.log("parsed data", parsed);

    if (!parsed) {
      console.log("Failed to read submitted data: " + JSON.stringify(parsed));
      return Responses._400({
        message: "Failed to read submitted data",
      });
    }

    const valid = await Functions.validateSubmission(parsed, validations);
    if (Object.keys(valid).length > 0) {
      return Responses._400({ messages: valid });
    }

    const escapeRegEx = new RegExp(/(<([^>]+)>)/gi);
    const emailTemplatesTableName = process.env.EMAIL_TEMPLATES_TABLE;

    const emailTemplateKey = parsed.key;

    const emailTemplatesQueryData = {
      TableName: emailTemplatesTableName,
      FilterExpression: "#pk = :pk",
      ExpressionAttributeNames: {
        "#pk": "PK",
      },
      ExpressionAttributeValues: {
        ":pk": emailTemplateKey,
      },
    };
    let matchedEmailTemplates = await Dynamo.scan(
      emailTemplatesQueryData
    ).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });
    if (matchedEmailTemplates.length) {
      const emailTemplateData = matchedEmailTemplates.find(
        (o) => o?.PK === emailTemplateKey
      );
      if (emailTemplateData?.subject) {
        emailTemplateData.subject = parsed.subject
          .toString()
          .replace(escapeRegEx, "");
        emailTemplateData.description = parsed.description
          .toString()
          .replace(escapeRegEx, "");
        emailTemplateData.pageTitle = parsed.pageTitle
          .toString()
          .replace(escapeRegEx, "");
        emailTemplateData.pageContent = parsed.pageContent;

        await Dynamo.write(emailTemplateData, emailTemplatesTableName).catch(
          (err) => {
            console.log("error in dynamo query", err);
            return Responses._400({ messages: err });
          }
        );

        return Responses._200({
          messages: { success: "Update successful" },
          emailTemplate: emailTemplateData,
        });
      } else {
        console.log("Dodgy emailTemplate data", emailTemplatesQueryData);
      }
    } else {
      console.log(
        "Email Template not found",
        emailTemplateData,
        matchedEmailTemplates,
        emailTemplateKey
      );
    }

    return Responses._400({ message: "An unexpected error occurred" });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
