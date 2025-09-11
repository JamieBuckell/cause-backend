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

const validations = [
  {
    key: "email.subject",
    required: true,
    pattern: new RegExp(/[a-zA-ZÀ-ÖØ-öø-ÿ.\-\s']{1,50}/),
    errorMsg: "Please enter a valid email subject",
  },
  {
    key: "email.title",
    required: true,
    pattern: new RegExp(/[a-zA-ZÀ-ÖØ-öø-ÿ.\-\s']{1,50}/),
    errorMsg: "Please enter a valid email title",
  },
  {
    key: "email.content",
    required: true,
    errorMsg: "Please enter valid email content",
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

    const parsed = event.email ? event : JSON.parse(event.body);
    if (!parsed) {
      return Responses._400({
        message: "Failed to read submitted data: " + JSON.stringify(parsed),
      });
    }

    const valid = await Functions.validateSubmission(parsed, validations);
    if (Object.keys(valid).length > 0) {
      return Responses._400({ messages: valid });
    }
    console.log(parsed);

    const mainTableName = process.env.MAIN_DYNAMO_TABLE;
    const subscriberTableName = process.env.SUBSCRIBERS_TABLE;
    const commsTableName = process.env.COMMS_DYNAMO_TABLE;

    const timezone = process.env.TIMEZONE;
    const dateFormat = process.env.DATE_FORMAT;

    const escapeRegEx = new RegExp(/(<([^>]+)>)/gi);

    const verifiedSendFrom = parsed.email?.fromAddress
      ? parsed.email.fromAddress.toString().replace(escapeRegEx, "")
      : "hampers";
    const verifiedSubject = parsed.email.subject
      .toString()
      .replace(escapeRegEx, "");
    const verifiedTitle = parsed.email.title
      .toString()
      .replace(escapeRegEx, "");
    const verifiedContent = parsed.email.content;

    const existingEmailId = parsed?.existingEmailId ?? "";

    var emailRecipients = [];

    const recipientType = parsed.options?.type ?? "specific";
    const campaignId = parsed.options?.campaignId ?? false;
    console.log(`Getting Subscribers For Email Type: ${recipientType}`);
    let emailType = "transactional";
    let emailSubscribers = [];
    switch (recipientType) {
      case "specific":
        emailRecipients = parsed.options.toAddresses.map((email) => ({
          email,
        }));
        break;
      case "subscribers":
        emailType = "subscriber";
        emailSubscribers = await Dynamo.scan({
          TableName: subscriberTableName,
        }).catch((err) => {
          console.log("error in dynamo query", err);
          return Responses._400({ messages: err });
        });
        // Make sure they are still subscribed and verified
        emailRecipients = emailSubscribers
          .filter((s) => s.subscribed === true && s.verified === true)
          .map((sub) => ({
            email: sub.PK,
            SK: sub.SK,
          }));

        if (parsed.options.excludePledged) {
          const queryData = {
            KeyConditionExpression: "#pk= :pk AND #type = :type",
            ExpressionAttributeValues: {
              ":pk": campaignId,
              ":type": "donor",
            },
            ExpressionAttributeNames: {
              "#pk": "PK",
              "#type": "type",
            },
          };
          const campaignDonors = await Dynamo.query(
            queryData,
            mainTableName
          ).catch((err) => {
            console.log("error in dynamo query", err);
            return Responses._400({ messages: err });
          });

          const pledgedEmails = campaignDonors.flatMap((d) => d.GSI3PK);

          emailRecipients = emailRecipients.filter(
            (r) => !pledgedEmails.includes(r.email)
          );
        }
        break;
      case "donors":
      case "nominators":
      case "teamleads":
        const itemType = recipientType.replace(/s+$/, "");
        const queryData = {
          KeyConditionExpression: "#pk= :pk AND begins_with(#sk, :sk)",
          ExpressionAttributeValues: {
            ":pk": campaignId,
            ":sk": "EMAIL#",
          },
          ExpressionAttributeNames: {
            "#pk": "PK",
            "#sk": "SK",
          },
        };
        console.log("Get", itemType, "...", queryData);
        let campaignDonors = await Dynamo.query(queryData, mainTableName).catch(
          (err) => {
            console.log("error in dynamo query", err);
            return Responses._400({ messages: err });
          }
        );

        if (campaignDonors.length) {
          campaignDonors = campaignDonors;
        }
        campaignDonors.filter((d) => d?.type === itemType);

        if (parsed?.options?.excludeSubscribers && recipientType === "donors") {
          console.log(
            "Excluding subscribers from list:",
            campaignDonors.length
          );
          emailSubscribers = await Dynamo.scan({
            TableName: subscriberTableName,
          }).catch((err) => {
            console.log("error in dynamo query", err);
            return Responses._400({ messages: err });
          });

          campaignDonors = campaignDonors.filter(
            (d) =>
              !emailSubscribers.find(
                (s) => s?.PK === d?.GSI3PK && s?.subscribed
              )?.PK
          );
        }

        emailRecipients = campaignDonors.map((d) => ({
          email: d.GSI3PK,
        }));
        break;
    }
    console.log(`Total subscribers: ${emailRecipients.length}`);

    /* */
    const emailId = existingEmailId ? existingEmailId : nanoid(12);
    const emailData = {
      PK: "EMAIL",
      SK: `SORT#${moment(new Date().getTime())
        .tz(timezone)
        .format("YYYYMMDDHHmmss")}`,
      GSI1PK: emailId,
      dateAdded: moment(new Date().getTime()).tz(timezone).format(dateFormat),
      email: {
        content: verifiedContent,
        options: JSON.stringify(parsed.options),
        recipientCount: emailRecipients.length,
        sendFrom: verifiedSendFrom,
        subject: verifiedSubject,
        title: verifiedTitle,
        type: emailType,
      },
      type: "email",
    };

    if (!existingEmailId) {
      await Dynamo.write(emailData, commsTableName).catch((err) => {
        console.log("error in dynamo write", err);
        return Responses._400({ messages: err });
      });
    } else {
      if (!parsed.options?.ignorePreviouslySent) {
        const queryData = {
          KeyConditionExpression: "#pk= :pk AND #type = :type",
          ExpressionAttributeValues: {
            ":pk": campaignId,
            ":type": "recipient",
          },
          ExpressionAttributeNames: {
            "#pk": "PK",
            "#type": "type",
          },
        };
        const receivedSubscribers = await Dynamo.query(
          queryData,
          commsTableName
        ).catch((err) => {
          console.log("error in dynamo query", err);
          return Responses._400({ messages: err });
        });

        receivedSubscriberEmails = receivedSubscribers.flatMap(
          (d) => d.emailAddress
        );
        emailRecipients = emailRecipients.filter(
          (d) => !receivedSubscriberEmails.includes(d.email)
        );

        console.log(
          `Total subscribers (excluding previously sent): ${emailRecipients.length}`
        );
      }
    }

    const chunkSize = 100;
    for (let i = 0; i < emailRecipients.length; i += chunkSize) {
      const chunk = emailRecipients.slice(i, i + chunkSize);

      var params = {
        DelaySeconds: 0,
        MessageAttributes: {
          emailId: {
            DataType: "String",
            StringValue: emailId,
          },
          emailRecipients: {
            DataType: "String",
            StringValue: JSON.stringify(chunk),
          },
          emailData: {
            DataType: "String",
            StringValue: JSON.stringify(emailData),
          },
        },
        MessageBody: `Email process data for emailId: ${emailId}`,
        QueueUrl: `https://sqs.${process.env.AWS_ACCOUNT_REGION}.amazonaws.com/${process.env.AWS_ACCOUNT_ID}/${process.env.MAIL_PROCESSOR_QUEUE}`,
      };

      await sqs.sendMessage(params).promise();
      console.log("batched " + chunk.length);
    }
    /* */

    return Responses._200({ messages: { success: "Email Sending Complete" } });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
