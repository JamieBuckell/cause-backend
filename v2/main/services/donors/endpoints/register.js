const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

const moment = require("moment-timezone");
const { nanoid } = require("nanoid");

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
    console.log("Register!");
    const websiteURL = process.env.WEBSITE_URL;
    const appURL = process.env.APP_URL;
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;
    const subscriberTableName = process.env.SUBSCRIBERS_TABLE;

    const envSalt = process.env.HASHING_SALT;
    const envHashPrefix = process.env.HASHING_PREFIX;
    const parsed = event.emailAddress ? event : JSON.parse(event.body);

    const emailVerificationHash = `${envHashPrefix}${context.awsRequestId}`;

    const campaignId = parsed.campaign ?? Functions.defaultCampaign();

    console.log("Get the campaign!", {
      PK: campaignId,
      SK: "A",
    });
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
        messages: { notfound: `Campaign "${currentCampaign.PK}" not found` },
      });
    }

    const valid = await Functions.validateSubmission(parsed, validations);
    if (Object.keys(valid).length > 0) {
      return Responses._400({ messages: valid });
    }
    console.log("valid, crack on");

    const escapeRegEx = new RegExp(/(<([^>]+)>)/i);

    // use replace for extra layer of security
    const validEmail = parsed.email
      .toString()
      .replace(escapeRegEx, "")
      .toLowerCase();
    const validFirstName = parsed.firstname.toString().replace(escapeRegEx, "");
    const validLastName = parsed.lastname.toString().replace(escapeRegEx, "");
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

    const donorSK = `EMAIL#D#${validEmail}`;
    const donorSK3 = `LASTNAME#${validLastName}#FIRSTNAME#${validFirstName}`;
    const timezone = process.env.TIMEZONE;
    const dateFormat = process.env.DATE_FORMAT;
    const timeStamp = moment(new Date().getTime())
      .tz(timezone)
      .format(dateFormat);

    console.log("Create donor data");
    const donorIdentifier = nanoid(12);
    const donorData = {
      PK: currentCampaign.PK,
      SK: donorSK,
      GSI1PK: donorIdentifier,
      GSI1SK: `C#${currentCampaign.PK}`,
      GSI2PK: donorIdentifier,
      GSI2SK: donorSK,
      GSI3PK: validEmail,
      GSI3SK: donorSK3,
      donorDetails: {
        firstName: validFirstName,
        lastName: validLastName,
        company: validCompany,
        telephone: validTelephone,
      },
      emailVerification: {
        bounced: false,
        bouncedDetail: "",
        dateVerified: "",
        verified: false,
        hash: emailVerificationHash,
      },
      familyDetails: {
        request: [
          {
            requestId: nanoid(12),
            numberOfFamilies: validFamilies,
            additionalInfo: validAdditionalInformation,
            familyDetail: JSON.stringify(parsed.familyDetail),
          },
        ],
        allocation: {},
      },
      type: "donor",
      dateAdded: timeStamp,
    };

    console.log(`Donor Registration: ${validEmail}`);

    const queryData = {
      KeyConditionExpression: "#pk= :pk And begins_with(#sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": currentCampaign.PK,
        ":sk": donorSK,
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

    if (existingDonor.length && existingDonor[0]?.PK) {
      const previousData = existingDonor[0];
      console.log("Donor Exists", previousData);

      donorData.GSI1PK = previousData.GSI1PK;
      donorData.GSI2PK = previousData.GSI2PK;

      // History was too big?
      /* *
      const historicData = {
        donorDetails: previousData?.donorDetails ?? {},
        familyDetails: previousData?.familyDetails ?? {},
        dateAdded: previousData.dateAdded,
      };
      const existingHistory = previousData.history ?? [];
      donorData.history = [historicData, ...existingHistory];
      /* */
      donorData.totalChanges = previousData?.totalChanges
        ? previousData?.totalChanges + 1
        : 1;

      if (!donorData?.familyDetails) {
        console.log("Setting a blank familyDetails");
        donorData.familyDetails = {
          request: [],
        };
      }

      // Add new request in alongside the old one
      console.log("Set the request");
      donorData.familyDetails.request = [
        ...donorData.familyDetails.request,
        ...(previousData?.familyDetails?.request ?? []),
      ];

      if (
        previousData?.emailVerification &&
        previousData?.emailVerification?.verified
      ) {
        donorData.emailVerification["dateVerified"] =
          previousData?.emailVerification?.dateVerified;
        donorData.emailVerification["verified"] =
          previousData?.emailVerification?.verified;
        donorData.emailVerification["hash"] =
          previousData?.emailVerification?.hash ?? emailVerificationHash;
      }
    }
    console.log("Do the write request");
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
    /* */
    let isSubscribed = parsed.marketing ?? false;

    const subscriberQueryData = {
      KeyConditionExpression: "#pk= :pk And begins_with(#sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": validEmail,
        ":sk": envHashPrefix,
      },
      ExpressionAttributeNames: {
        "#pk": "PK",
        "#sk": "SK",
      },
    };
    const existingSubscriber = await Dynamo.query(
      subscriberQueryData,
      subscriberTableName
    ).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    let subscriptionData = {
      PK: validEmail,
      SK: emailVerificationHash,
      firstName: validFirstName,
      lastName: validLastName,
      company: validCompany,
      telephone: validTelephone,
      subscribed: isSubscribed,
      dateAdded: timeStamp,
      dateSubscribed: timeStamp,
      howHeard: validHowHeard === "other" ? validHowHeardOther : validHowHeard,
    };
    if (existingSubscriber.length) {
      const subscriberData = existingSubscriber[0];
      //Merge the two objects overwriting the old stuff with the new stuff
      subscriptionData = { ...subscriberData, ...subscriptionData };

      // Reset these fields to be what they were before
      subscriptionData.SK = subscriberData.SK;
      subscriptionData.dateAdded = subscriberData.dateAdded;

      // Dont update subscription date if they were already subscribed.
      if (subscriberData.subscribed) {
        subscriptionData.dateSubscribed = subscriberData.dateSubscribed;
      }
    }

    const subscriberRequest = await Dynamo.write(
      subscriptionData,
      subscriberTableName
    ).catch((err) => {
      console.log("error in dynamo write", err);
      return Responses._400({ messages: err });
    });

    if (!subscriberRequest) {
      return Responses._400({
        message: "Failed to write to subscriber db by ID",
      });
    }

    // Send the email
    const donorHash = Hashing.hash(
      subscriptionData.SK.replace(envHashPrefix, ""),
      envSalt
    ).hashedpassword;
    const emailTemplate = {
      websiteURL,
      appURL,
      campaignId: currentCampaign.PK,
      emailAddress: validEmail,
      donorHash,
      donorData: donorData.donorDetails,
      familyCount: validFamilies,
      familyData: donorData.familyDetails.request,
    };
    const emailTemplateParams = await Functions.getEmailTemplate(
      "donorRegister",
      emailTemplate
    );
    const jsonParameters = {
      ToAddresses: [validEmail],
      ...emailTemplateParams,
    };
    await Notifications.sendTransactionalEmail(jsonParameters);

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
