const AWS = require("aws-sdk");
AWS.config.update({ region: "eu-west-1" });
const SES = new AWS.SES();
// Outputs timezone offset in format ZZ
const getOffset = (date) => {
  var offset = -date.getTimezoneOffset();
  var offsetHours = Math.floor(Math.abs(offset) / 60);
  var offsetMinutes = Math.abs(offset) - offsetHours * 60;

  var offsetSign = offset >= 0 ? "+" : "-";

  return (
    offsetSign + ("0" + offsetHours).slice(-2) + ("0" + offsetMinutes).slice(-2)
  );
};

// Outputs two digit inputs with leading zero
const leadingZero = (input) => ("0" + input).slice(-2);

// Formats date in ddd, DD MMM YYYY HH:MM:SS ZZ
const formatDate = (date) => {
  var weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
    await new Promise(resolve => setTimeout(resolve, ms));
    return Notifications.sendTransactionalEmail(data);
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
    const header = value => {
      const text = String(value ?? "");
      if (/[\r\n]/.test(text)) throw new Error("Invalid email header");
      return text;
    };
    const filename = value => header(value).replace(/["\\]/g, "_");
    const wrapBase64 = value => (value.match(/.{1,76}/g) ?? []).join("\r\n");
    const encodeText = value => wrapBase64(Buffer.from(value, "utf8").toString("base64"));
    const html = data.htmlContent ?? "";
    const plain = data.plainContent ?? html.replace(/<br\s*\/?\s*>/gi, "\r\n").replace(/<[^>]*>/g, "");
    const to = header(data.ToAddress);
    if (!to) throw new Error("Email recipient is required");
    const subject = header(data.subject ?? "CAUSE Foundation");
    const boundary = `cause_mixed_${require("crypto").randomBytes(12).toString("hex")}`;
    const alternative = `${boundary}_alternative`;
    const raw = [
      `From: <${header(process.env.FROM_ADDRESS)}>`,
      `To: ${to}`,
      `Bcc: email@jamiebuckell.co.uk, ${header(process.env.INTERNAL_ADDRESS)}`,
      `Subject: ${/[^\x20-\x7e]/.test(subject) ? "=?UTF-8?B?" + Buffer.from(subject).toString("base64") + "?=" : subject}`,
      "MIME-Version: 1.0",
      `Date: ${formatDate(new Date())}`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      `Content-Type: multipart/alternative; boundary="${alternative}"`,
      "",
    ];
    for (const [type, content] of [["text/plain", plain], ["text/html", html]]) {
      raw.push(`--${alternative}`, `Content-Type: ${type}; charset=UTF-8`,
        "Content-Transfer-Encoding: base64", "", encodeText(content));
    }
    raw.push(`--${alternative}--`);
    if (data.pdfAttachment) {
      // PDF callers supply base64 text; accept binary buffers without double encoding.
      const payload = Buffer.isBuffer(data.pdfAttachment)
        ? data.pdfAttachment.toString("base64") : String(data.pdfAttachment).replace(/\s/g, "");
      const name = filename(data.pdfAttachmentFilename ?? "attachment.pdf");
      raw.push(`--${boundary}`, `Content-Type: application/pdf; name="${name}"`,
        "Content-Transfer-Encoding: base64", `Content-Disposition: attachment; filename="${name}"`, "", wrapBase64(payload));
    }
    if (data.csvAttachment) {
      const name = filename(data.csvAttachmentFilename ?? "attachment.csv");
      raw.push(`--${boundary}`, `Content-Type: text/csv; charset=UTF-8; name="${name}"`,
        "Content-Transfer-Encoding: base64", `Content-Disposition: attachment; filename="${name}"`, "", encodeText(data.csvAttachment));
    }
    raw.push(`--${boundary}--`, "");
    return SES.sendRawEmail({ Source: process.env.FROM_ADDRESS, RawMessage: { Data: raw.join("\r\n") } }).promise();
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
    return SES.sendTemplatedEmail(emailParams).promise();
  },
};

module.exports = Notifications;
