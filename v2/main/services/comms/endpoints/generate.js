const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

const AWS = require("aws-sdk");
AWS.config.update({ region: "eu-west-2" });
var sqs = new AWS.SQS({ apiVersion: "2012-11-05" });

exports.handler = async (event, context, cb) => {
  try {
    const envSalt = process.env.HASHING_SALT;

    let emailRecipients = [];
    if (event?.Records) {
      for (const r of event?.Records) {
        console.log(`Running generate message: ${r.body}`);
        if (r?.messageAttributes) {
          console.log(r.messageAttributes);
        }

        if (
          r?.messageAttributes?.emailId &&
          r?.messageAttributes?.emailRecipients &&
          r?.messageAttributes?.emailData
        ) {
          const batchData = [];

          const emailId = r.messageAttributes.emailId.stringValue;
          emailRecipients = JSON.parse(
            r.messageAttributes.emailRecipients.stringValue
          );
          const emailData = JSON.parse(
            r.messageAttributes.emailData.stringValue
          );

          // Add each email send to the queue 1 by 1...
          if (emailRecipients.length) {
            console.log("Do the actual mailer queue");
            let emailsProcessedCount = 0;
            for (const subscriber of emailRecipients) {
              // Add to SQS!
              var params = {
                DelaySeconds: 0,
                MessageAttributes: {
                  recipient: {
                    DataType: "String",
                    StringValue: subscriber.email,
                  },
                  emailData: {
                    DataType: "String",
                    StringValue: JSON.stringify(emailData),
                  },
                  emailId: {
                    DataType: "String",
                    StringValue: emailId,
                  },
                },
                MessageBody: `Email message to subscriber id ${subscriber?.email} for email ${emailId}`,
                MessageGroupId: emailId,
                QueueUrl: `https://sqs.${process.env.AWS_ACCOUNT_REGION}.amazonaws.com/${process.env.AWS_ACCOUNT_ID}/${process.env.MAILER_QUEUE}`,
              };

              const subscriberHash = subscriber?.SK
                ? Hashing.hash(subscriber.SK, envSalt).hashedpassword
                : "";
              if (subscriberHash) {
                params.MessageAttributes["subscriberHash"] = {
                  DataType: "String",
                  StringValue: subscriberHash,
                };
              }
              await sqs.sendMessage(params).promise();
              emailsProcessedCount++;
              console.log(`Added email ${subscriber.email} send queue...`);
            }
            console.log(
              `processed ${emailsProcessedCount} out of ${emailRecipients.length} emails`
            );
          }
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
