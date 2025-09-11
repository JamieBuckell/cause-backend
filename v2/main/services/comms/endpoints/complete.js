const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

const moment = require("moment-timezone");
const { nanoid } = require("nanoid");

const AWS = require("aws-sdk");
AWS.config.update({ region: "eu-west-2" });
var sqs = new AWS.SQS({ apiVersion: "2012-11-05" });

exports.handler = async (event, context, cb) => {
  try {
    const commsTableName = process.env.COMMS_DYNAMO_TABLE;
    const timezone = process.env.TIMEZONE;
    const dateFormat = process.env.DATE_FORMAT;
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

          console.log(`${emailRecipients.length} emails to send`);

          for (const subscriber of emailRecipients) {
            if (!subscriber.email) {
              console.log("SKIPPING", subscriber);
              continue;
            }

            const dateSent =
              emailData?.dateSent ??
              moment(new Date().getTime()).tz(timezone).format(dateFormat);
            const dateAdded = emailData?.dateAdded ?? dateSent;

            const recipientData = {
              PK: "RECIPIENT",
              SK: `SORT#${moment(new Date().getTime())
                .tz(timezone)
                .format("YYYYMMDDHHmmss")}#${nanoid(12)}`,
              dateSent: dateSent,
              emailAddress: subscriber.email,
              emailData,
              ref: nanoid(12),
              GSI1PK: emailId,
              GSI1SK: `SORT#${moment(dateAdded).format("YYYYMMDDHHmmss.SSS")}`,
              type: "recipient",
            };

            batchData.push({
              PutRequest: {
                Item: recipientData,
              },
            });
          }

          if (batchData && batchData.length) {
            const chunkSize = 25;
            console.log(
              "Donor batches to import, total:",
              batchData.length,
              "Batches:",
              batchData.length / chunkSize
            );
            for (let i = 0; i < batchData.length; i += chunkSize) {
              const chunk = batchData.slice(i, i + chunkSize);

              await Dynamo.batchWrite(chunk, commsTableName).catch((err) => {
                console.log("error in dynamo write", err);
                throw Error(err);
              });
            }
            console.log("Sent Emails Saved.");
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
