const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

var uuid = require("uuid");
const moment = require("moment-timezone");
const validations = [
  {
    key: "firstname",
    required: true,
    pattern: new RegExp(/[a-zA-ZÀ-ÖØ-öø-ÿ.\-\s']{1,50}/i),
    errorMsg: "Please enter a valid first name",
  },
  {
    key: "lastname",
    required: true,
    pattern: new RegExp(/[a-zA-ZÀ-ÖØ-öø-ÿ.\-\s']{1,50}/i),
    errorMsg: "Please enter a valid last name",
  },
  {
    key: "email",
    required: true,
  },
  {
    key: "company",
    required: false,
    pattern: new RegExp(/[a-zA-ZÀ-ÖØ-öø-ÿ.\-\s']{1,50}/i),
    errorMsg: "Please enter a valid company name",
  },
];

exports.handler = async (event, context, cb) => {
  try {
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;

    const parsed = event.emailAddress ? event : JSON.parse(event.body);

    const campaignId = parsed.campaign ?? Functions.defaultCampaign(); // 2022 Campaign

    const currentCampaign = await Dynamo.get(
      {
        PK: campaignId,
        SK: "A",
      },
      mainTableName
    ).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    if (!currentCampaign.PK) {
      return Responses._400({
        messages: { notfound: `Campaign "${campaignId}" not found` },
      });
    }

    const valid = await Functions.validateSubmission(parsed, validations);
    if (Object.keys(valid).length > 0) {
      return Responses._400({ messages: valid });
    }

    const escapeRegEx = new RegExp(/(<([^>]+)>)/i);

    // use replace for extra layer of security
    const validFirstName = parsed.firstname.toString().replace(escapeRegEx, "");
    const validLastName = parsed.lastname.toString().replace(escapeRegEx, "");
    const donorSK = `LASTNAME#${validLastName}#FIRSTNAME#${validFirstName}`;
    const validEmail = parsed.email
      .toString()
      .replace(escapeRegEx, "")
      .toLowerCase();
    const validCompany = parsed.company
      ? parsed.company.toString().replace(escapeRegEx, "")
      : "";
    const validTelephone = parsed.telephone
      ? parsed.telephone.toString().replace(escapeRegEx, "")
      : "";
    const validFamilies = parsed.families
      ? parseInt(parsed.families.toString().replace(escapeRegEx, ""))
      : "";
    const validAdditionalInformation = parsed.additionalInformation
      ? parsed.additionalInformation.toString().replace(escapeRegEx, "")
      : "";
    const validHowHeard = parsed.howHeard
      ? parsed.howHeard.toString().replace(escapeRegEx, "")
      : "Not Specified";
    const validHowHeardOther = parsed.howHeardOther
      ? parsed.howHeardOther.toString().replace(escapeRegEx, "")
      : "";

    const timezone = process.env.TIMEZONE;
    const dateFormat = process.env.DATE_FORMAT;
    const timeStamp = moment(new Date().getTime())
      .tz(timezone)
      .format(dateFormat);

    const donorIdentifier = nanoid(12);
    const donorData = {
      PK: validEmail,
      SK: currentCampaign.PK,
      GSI1PK: donorIdentifier,
      GSI1SK: `C#${currentCampaign.PK}`,
      GSI2PK: donorIdentifier,
      GSI3PK: validEmail,
      GSI3SK: donorSK,
      donorDetails: {
        firstName: validFirstName,
        lastName: validLastName,
        company: validCompany,
        telephone: validTelephone,
      },
      familyDetails: {
        request: {
          numberOfFamilies: validFamilies,
          additionalInfo: validAdditionalInformation,
          familyDetail: JSON.stringify(parsed.familyDetail),
        },
        allocation: {},
      },
      dateAdded: timeStamp,
    };

    console.log(`Donor Registration: ${validEmail}`);

    const queryData = {
      KeyConditionExpression: "#pk= :pk And begins_with(#sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": validEmail,
        ":sk": currentCampaign.PK,
      },
      ExpressionAttributeNames: {
        "#pk": "PK",
        "#sk": "SK",
      },
    };
    const existingDonor = await Dynamo.query(queryData, mainTableName).catch(
      (err) => {
        console.log("error in dynamo query", err);
        return Responses._400({ messages: err });
      }
    );

    if (existingDonor.length && existingDonor[0].PK) {
      const previousData = existingDonor[0];
      const historicData = {
        donorDetails: previousData?.donorDetails ?? {},
        familyDetails: previousData?.familyDetails ?? {},
        dateAdded: previousData.dateAdded,
      };
      const existingHistory = previousData.history ?? [];
      donorData.history = [historicData, ...existingHistory];
      donorData.totalChanges = previousData?.totalChanges ?? 1;

      // Make sure we don't wipe out any allocation data!
      donorData.familyDetails.allocation =
        previousData.familyDetails.allocation;
    }
    //Subscriber stuff tbc
    /* *
    const existingSubscriber = await Dynamo.query(
        { PK: validEmail },
        subscriberTableName
      ).catch((err) => {
        console.log("error in dynamo query", err);
        return Responses._400({ messages: err });
      });

    let isSubscribed = parsed.marketing ?? false;

    let registerTemplateEmail = "donorRegister";
    let donorData = {};
    let subscriptionData = {};
    if (existingSubscriber.length) {
      registerTemplateEmail = "donorRegisterSubsequent";
      subscriptionData = existingSubscriber[0];
      if (subscriptionData.subscribed && !isSubscribed) {
        subscriptionData.subscribed = subscriptionData.subscribed;
      }
      if (!subscriptionData.dateSubscribed && isSubscribed) {
        subscriptionData.dateSubscribed = timeStamp;
      }
      if (!subscriptionData.dateAdded) {
        subscriptionData.dateAdded = timeStamp;
      }
    } else {
    /* */

    //Subscriber stuff tbc
    /* *
    
      subscriptionData = {
        subscribed: isSubscribed,
        dateSubscribed: isSubscribed ? timeStamp : "",
        howHeard:
          validHowHeard === "other" ? validHowHeardOther : validHowHeard,
        dateUnsubcribed: "",
        verified: false,
        dateVerified: "",
      };
    }
    /* */
    const donorRequest = await Dynamo.write(donorData, mainTableName).catch(
      (err) => {
        console.log("error in dynamo write", err);
        return Responses._400({ messages: err });
      }
    );

    if (!donorRequest) {
      return Responses._400({ message: "Failed to write db by ID" });
    }

    //Subscriber stuff tbc
    /* *

    const donorHash = Hashing.hash(requestId, envSalt).hashedpassword;
    const emailTemplate = {
      websiteURL,
      appURL,
      emailAddress: validEmail,
      donorHash,
      donorData: donorData,
      familyCount: validFamilies,
      familyData: campaignData,
    };
    const emailTemplateParams = await Functions.getEmailTemplate(
      registerTemplateEmail,
      emailTemplate
    );
    const jsonParameters = {
      ToAddresses: [validEmail],
      ...emailTemplateParams,
    };
    await Notifications.sendTransactionalEmail(jsonParameters);
    /* */

    return Responses._200({
      messages: { success: "Registration successful" },
      registrationId: donorRequest.PK,
    });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
