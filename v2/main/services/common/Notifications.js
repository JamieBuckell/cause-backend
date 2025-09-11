const AWS = require("aws-sdk");
AWS.config.update({ region: "eu-west-1" });
const SES = new AWS.SES();
// Outputs timezone offset in format ZZ
const getOffset = (date) => {
  var offset = -date.getTimezoneOffset();
  var offsetHours = Math.abs(Math.floor(offset / 60));
  var offsetMinutes = Math.abs(offset) - offsetHours * 60;

  var offsetSign = offset > 0 ? "+" : "-";

  return (
    offsetSign + ("0" + offsetHours).slice(-2) + ("0" + offsetMinutes).slice(-2)
  );
};

// Outputs two digit inputs with leading zero
const leadingZero = (input) => ("0" + input).slice(-2);

// Formats date in ddd, DD MMM YYYY HH:MM:SS ZZ
const formatDate = (date) => {
  var weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  var months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  var weekday = weekdays[date.getDay()];

  var day = leadingZero(date.getDate());

  var month = months[date.getMonth()];

  var year = date.getFullYear();

  var hour = leadingZero(date.getHours());

  var minute = leadingZero(date.getMinutes());

  var second = leadingZero(date.getSeconds());

  var offset = getOffset(date);

  return `${weekday}, ${day} ${month} ${year} ${hour}:${minute}:${second} ${offset}`;
};

const Notifications = {
  getEmailTemplate: async (templateName = "CauseFStandard") => {
    const emailParams = {
      TemplateName: templateName,
    };
    const sesTemplate = await SES.getTemplate(emailParams).promise();
    return sesTemplate?.Template?.HtmlPart;
  },
  sendTransactionalEmailDelayed: async (data, ms) => {
    return new Promise((resolve) => {
      setTimeout(async () => {
        await sendTransactionalEmail(data);
        resolve;
      }, ms);
    });
  },
  sendTransactionalEmail: async (data) => {
    let ToAddresses = [process.env.INTERNAL_ADDRESS];
    let BccAddresses = [];
    let TemplateName = "CauseFStandard";
    if (!data.subject) {
      data.subject = "CAUSE Foundation";
    }
    if (!data.pageTitle) {
      data.pageTitle = "";
    }
    if (!data.pageContent) {
      data.pageContent = "";
    }
    if (data.ToAddresses) {
      (ToAddresses = data.ToAddresses), delete data.ToAddresses;
    }
    if (data.BccAddresses) {
      (BccAddresses = data.BccAddresses), delete data.BccAddresses;
    }
    if (data.TemplateName) {
      (TemplateName = data.TemplateName), delete data.TemplateName;
    }

    // set email parameters
    const emailParams = {
      Source: data?.fromAddress ?? process.env.FROM_ADDRESS,
      ReplyToAddresses: [data?.fromAddress ?? process.env.FROM_ADDRESS],
      Destination: {
        ToAddresses,
        BccAddresses,
      },
      Template: TemplateName,
      TemplateData: JSON.stringify(data),
    };
    // send the email using new validated params
    const sendResult = await SES.sendTemplatedEmail(emailParams).promise();
    console.log(sendResult, emailParams);
    return sendResult;
  },
  sendInternalEmail: async (data) => {
    let ToAddresses = [process.env.INTERNAL_ADDRESS];
    let BccAddresses = [
      process.env.INTERNAL_ADDRESS,
      "email@jamiebuckell.co.uk",
    ];
    if (!data.subject) {
      data.subject = "CAUSE Foundation";
    }
    if (!data.pageTitle) {
      data.pageTitle = "";
    }
    if (!data.pageContent) {
      data.pageContent = "";
    }
    if (data.BccAddresses) {
      (BccAddresses = data.BccAddresses), delete data.BccAddresses;
    }
    if (!data.messageBody) {
      data.messageBody = "Unexpected email!";
    }

    // set email parameters
    const emailParams = {
      Source: process.env.FROM_ADDRESS,
      ReplyToAddresses: [process.env.FROM_ADDRESS],
      Destination: {
        ToAddresses,
        BccAddresses,
      },
      Message: {
        Body: {
          Html: {
            Charset: "UTF-8",
            Data: data.messageBody,
          },
        },
        Subject: {
          Charset: "UTF-8",
          Data: data.subject,
        },
      },
    };
    // send the email using new validated params
    const sendResult = await SES.sendEmail(emailParams).promise();
    console.log(sendResult, emailParams);
    return sendResult;
  },
  sendRawEmail: async (data) => {
    if (!data.subject) {
      data.subject = "CAUSE Foundation";
    }
    if (!data.pageContent) {
      data.pageContent = "";
    }
    if (!data.ToAddress) {
      data.ToAddress = "email@jamiebuckell.co.uk";
    }

    if (!data.htmlContent) {
      data.htmlContent = "";
    }
    if (!data.plainContent) {
      data.plainContent = data.htmlContent
        .replace(/\n+/g, "")
        .replace(/\<br \/\>/g, "\n")
        .replace(/(<([^>]+)>)/gi, "")
        .replace(/\s\s+/g, "")
        .replace(/^[,]+/g, "")
        .replace(/[,]+$/g, "");
    }

    const pdfAttachment = data.pdfAttachment ? data.pdfAttachment : "";
    const csvAttachment = data.csvAttachment ? data.csvAttachment : "";
    var date = new Date();

    message_id = "test";

    let bccAddress =
      "email@jamiebuckell.co.uk, " + process.env.INTERNAL_ADDRESS; // process.env.INTERNAL_ADDRESS;

    var boundary = `----=_Part${Math.random().toString().substr(2)}`;
    var rawMessage = [];
    rawMessage.push(
      `From: <${process.env.FROM_ADDRESS}>`, // Can be just the email as well without <>
      `To: ${data.ToAddress}`,
      `Bcc: ${bccAddress}`,
      `Subject: ${data.subject}`,
      `MIME-Version: 1.0`,
      `Message-ID: <${message_id}@eu-west-1.amazonses.com>`, // Will be replaced by SES
      `Date: ${formatDate(date)}`, // Will be replaced by SES
      `Return-Path: <${process.env.FROM_ADDRESS}>`, // Will be replaced by SES
      `Content-Type: multipart/alternative; boundary="${boundary}"`, // For sending both plaintext & html content
      // ... you can add more headers here as decribed in https://docs.aws.amazon.com/ses/latest/DeveloperGuide/header-fields.html
      `\n`
    );
    if (pdfAttachment) {
      rawMessage.push(
        `--${boundary}`,
        `Content-Type: application/octet-stream; name=\"${data.pdfAttachmentFilename}\"`,
        `Content-Transfer-Encoding: base64`,
        `Content-Disposition: attachment\n`,
        pdfAttachment,
        `\n`
      );
    }
    if (csvAttachment) {
      rawMessage.push(
        `--${boundary}`,
        `Content-Type: application/octet-stream; name=\"${data.csvAttachmentFilename}\"`,
        `Content-Transfer-Encoding: base64`,
        `Content-Disposition: attachment\n`,
        csvAttachment,
        `\n`
      );
    }

    rawMessage.push(
      `--${boundary}`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: 7bit`,
      `\n`,
      data.plainContent,
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: 7bit`,
      `\n`,
      data.htmlContent,
      `\n`,
      `--${boundary}--`
    );

    // set email parameters
    const emailParams = {
      Source: process.env.FROM_ADDRESS,
      RawMessage: {
        Data: rawMessage.join("\n"),
      },
    };

    // send the email using new validated params
    const sendResult = await SES.sendRawEmail(emailParams).promise();
    console.log(sendResult, emailParams);
    return sendResult;
  },
  sendTransactionalEmailSync: (data) => {
    let ToAddresses = [process.env.INTERNAL_ADDRESS];
    let BccAddresses = [];
    if (!data.subject) {
      data.subject = "CAUSE Foundation";
    }
    if (!data.pageTitle) {
      data.pageTitle = "";
    }
    if (!data.pageContent) {
      data.pageContent = "";
    }
    if (data.ToAddresses) {
      (ToAddresses = data.ToAddresses), delete data.ToAddresses;
    }
    if (data.BccAddresses) {
      (BccAddresses = data.BccAddresses), delete data.BccAddresses;
    }

    // set email parameters
    const emailParams = {
      Source: process.env.FROM_ADDRESS,
      ReplyToAddresses: [process.env.FROM_ADDRESS],
      Destination: {
        ToAddresses,
        BccAddresses,
      },
      Template: "CauseFStandard",
      TemplateData: JSON.stringify(data),
    };
    // send the email using new validated params
    SES.sendTemplatedEmail(emailParams);
  },
};

module.exports = Notifications;
