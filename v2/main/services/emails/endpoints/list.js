const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

exports.handler = async (event, context, cb) => {
  try {
    if (!Functions.hasPermission(event, "Admin")) {
      return Responses._401({
        messages: {
          unauthorized: "You are not authorized to view this section",
        },
      });
    }

    const emailTemplatesTableName = process.env.EMAIL_TEMPLATES_TABLE;

    const params = {
      TableName: emailTemplatesTableName,
    };
    let allEmailTemplates = await Dynamo.scan(params).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    console.log("All templates", allEmailTemplates.length);

    const standardTemplate = await Notifications.getEmailTemplate();
    allEmailTemplates = allEmailTemplates
      .filter((et) => et?.status === "active")
      .map((et) => ({ ...et, template: standardTemplate }));

    console.log("Filtered templates", allEmailTemplates.length);

    return Responses._200([...allEmailTemplates]);
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
