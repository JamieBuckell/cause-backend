const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

const moment = require("moment-timezone");

const AWS = require("aws-sdk");
AWS.config.update({ region: "eu-west-2" });
var sqs = new AWS.SQS({ apiVersion: "2012-11-05" });

exports.handler = async (event, context, cb) => {
  try {
    if (event?.Records) {
      const appURL = process.env.APP_URL;
      const timezone = process.env.TIMEZONE;
      const dateFormat = process.env.DATE_FORMAT;
      for (const r of event?.Records) {
        console.log(`Running generate message: ${r.body}`);
        if (r?.messageAttributes) {
          console.log(r.messageAttributes);
        }

        if (
          r?.messageAttributes?.emailData &&
          r?.messageAttributes?.emailId &&
          r?.messageAttributes?.recipient
        ) {
          const emailData = JSON.parse(
            r.messageAttributes.emailData.stringValue
          );
          const recipient = r.messageAttributes.recipient.stringValue ?? null;

          if (!recipient) {
            console.log("recipient not found ", r.messageAttributes);
            continue;
          }

          let unsubscribeLink = "";
          if (
            emailData?.email?.type === "subscriber" &&
            r?.messageAttributes?.subscriberHash
          ) {
            unsubscribeLink = `${appURL}/subscription/unsubscribe/${encodeURIComponent(
              recipient
            )}/${encodeURIComponent(
              r?.messageAttributes?.subscriberHash?.stringValue ?? ""
            )}`;
          }

          const jsonParameters = {
            TemplateName: unsubscribeLink
              ? "CauseFSubscriber"
              : "CauseFStandard",
            fromAddress: emailData?.email?.sendFrom
              ? emailData?.email?.sendFrom
              : "hampers",
            ToAddresses: [recipient],
            subject: emailData?.email?.subject,
            pageTitle: emailData?.email?.title,
            pageContent: emailData?.email?.content,
            unsubscribeLink: unsubscribeLink,
            type: emailData?.email?.type ?? "",
          };

          console.log("jsonParameters:", jsonParameters);

          /* *
          console.log("SAFETY MESSAGE - RECIPIENT CHANGED TO JAMIE");
          jsonParameters.pageContent = `${
            jsonParameters.pageContent
          }${jsonParameters.ToAddresses.join(",")}`;
          jsonParameters.ToAddresses = [
            "email+causetesting@jamiebuckell.co.uk",
          ];
          /* */
          await Notifications.sendTransactionalEmail({ ...jsonParameters });
          console.log("Notification Sent!", { ...jsonParameters });

          emailData.dateSent = moment(new Date().getTime())
            .tz(timezone)
            .format(dateFormat);

          console.log("Do the complete queue", emailData.dateSent);
          const emailRecipients = jsonParameters.ToAddresses.map((e) => ({
            email: e,
          }));

          // Now we've added the emails to the queues, let's add them to the DB
          var params = {
            DelaySeconds: 0,
            MessageAttributes: {
              emailId: {
                DataType: "String",
                StringValue:
                  r?.messageAttributes?.emailId?.stringValue ?? "UNKNOWN",
              },
              emailRecipients: {
                DataType: "String",
                StringValue: JSON.stringify(emailRecipients),
              },
              emailData: {
                DataType: "String",
                StringValue: JSON.stringify(emailData),
              },
            },
            MessageBody: `Complete email process for: ${emailRecipients
              .map((r) => r.email)
              .join(",")}`,
            QueueUrl: `https://sqs.${process.env.AWS_ACCOUNT_REGION}.amazonaws.com/${process.env.AWS_ACCOUNT_ID}/${process.env.MAIL_COMPLETE_QUEUE}`,
          };
          await sqs.sendMessage(params).promise();
          console.log(
            `Added ${emailRecipients.length} emails to complete queue...`
          );
        } else {
          throw Error(
            `Invalid Message: ${JSON.stringify(r?.messageAttributes)}`
          );
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
    throw Error("An unexpected error occurred");
  }
};
