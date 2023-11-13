const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

const { nanoid } = require("nanoid");
const moment = require("moment-timezone");

exports.handler = async (event, context, cb) => {
  try {
    const websiteURL = process.env.WEBSITE_URL;
    const appURL = process.env.APP_URL;
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;
    const subscriberTableName = process.env.SUBSCRIBERS_TABLE;

    const legacyDonorsTable = "cause-donors-live";
    const legacyCampaignDonorsTable = "cause-campaign-donors-new-live";

    const envSalt = process.env.HASHING_SALT;
    const envHashPrefix = process.env.HASHING_PREFIX;

    const campaignId = "CH1"; // 2022 Campaign

    const params = {
      TableName: mainTableName,
      FilterExpression: "#pk = :pk and #type = :type",
      ExpressionAttributeNames: {
        "#pk": "PK",
        "#type": "type",
      },
      ExpressionAttributeValues: {
        ":pk": campaignId,
        ":type": "donor",
      },
    };
    let allCurrentDonorsData = await Dynamo.scan(params).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    console.log("Get Donors");
    const donorsData = await Dynamo.scan({
      TableName: legacyDonorsTable,
    }).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    console.log("Get Donor campaign data");
    const campaignDonorsData = await Dynamo.scan({
      TableName: legacyCampaignDonorsTable,
    }).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    console.log("Get Subscribers data");
    const existingSubscribers = await Dynamo.scan({
      TableName: subscriberTableName,
    }).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    const batchData = [];
    const batchSubscriberData = [];

    if (donorsData.length) {
      console.log("Donors to migrate", donorsData.length);
      for (const [i, donor] of donorsData.entries()) {
        const donorSK = `EMAIL#D#${donor.email}`;
        const donorGSI2SK = `SK#${donor.email}`;
        const donorSK3 = `LASTNAME#${donor.lastName}#FIRSTNAME#${donor.firstName}`;
        const timezone = process.env.TIMEZONE;
        const dateFormat = process.env.DATE_FORMAT;
        const timeStamp = moment(new Date().getTime())
          .tz(timezone)
          .format(dateFormat);

        const existingDonor = allCurrentDonorsData.find(
          (d) =>
            d.PK === campaignId && d.SK === donorSK && d.GSI3PK === donor.email
        );
        if (existingDonor?.familyDetails?.request) {
          let dataCorrect = true;
          for (const cd of existingDonor?.familyDetails?.request) {
            if (typeof cd.familyDetail !== "string") {
              dataCorrect = false;
            }
          }
          if (dataCorrect) {
            console.log("data is correct... continue");
            continue;
          }
        }

        var campaignData = campaignDonorsData.filter(
          (cd) => cd.donorId === donor.requestId
        );

        // Check if they are an actual donor and not just a subscriber!
        if (campaignData.length) {
          console.log("Campaign Data found...");
          const existingDonor = batchData.find(
            (bd) => bd.PutRequest.Item.SK === donorSK
          );

          if (existingDonor) {
            console.log("This dood already exists!", existingDonor);

            let sumAllocatedFamilies = 0;
            if (!existingDonor?.familyDetails) {
              existingDonor.familyDetails = {
                allocation: {
                  numberOfFamilies: 0,
                },
                request: [],
              };
            }
            if (!existingDonor?.familyDetails?.request) {
              existingDonor.familyDetails.request = [];
            }

            for (const cd of campaignData) {
              sumAllocatedFamilies += cd?.allocatedFamilies ?? 0;
            }
            /* *
            existingDonor.familyDetails.request = [
              ...existingDonor.familyDetails.request,
              {
                numberOfFamilies: campaignData?.numberOfFamilies ?? "",
                additionalInfo: campaignData?.additionalInfo ?? "",
                familyDetail: campaignData?.familyDetail ?? [],
              },
            ];
            /* */
            existingDonor.familyDetails.allocation.numberOfFamilies =
              (existingDonor?.familyDetails?.allocation?.numberOfFamilies ??
                0) + sumAllocatedFamilies;
            console.log("But look at dem now!", existingDonor);
          } else {
            const donorIdentifier = nanoid(12);
            const donorData = {
              PK: campaignId,
              SK: donorSK,
              GSI1PK: donorIdentifier,
              GSI1SK: `C#${campaignId}`,
              GSI2PK: donorIdentifier,
              GSI2SK: donorGSI2SK,
              GSI3PK: donor.email,
              GSI3SK: donorSK3,
              donorDetails: {
                firstName: donor?.firstName ?? "",
                lastName: donor?.lastName ?? "",
                company: donor?.company ?? "",
                telephone: donor?.telephone ?? "",
                howHeard: donor?.howHeard ?? "",
              },
              familyDetails: {
                request: [],
                allocation: {
                  numberOfFamilies: campaignData?.allocatedFamilies ?? "",
                },
              },
              emailVerification: {
                dateVerified: donor.dateVerified ?? "",
                verified: donor?.verified ?? false,
                bounced: donor?.bounced ?? false,
                bouncedDetail: donor?.bouncedDetail ?? "",
              },
              type: "donor",
              legacyId: donor.requestId,
              dateAdded: donor?.dateAdded ?? donor?.dateSubscribed ?? timeStamp,
            };
            console.log("New donor...", donorData);

            let sumAllocatedFamilies = 0;
            for (const cd of campaignData) {
              donorData.familyDetails.request.push({
                requestId: nanoid(12),
                numberOfFamilies: cd?.numberOfFamilies ?? "",
                additionalInfo: cd?.additionalInfo ?? "",
                familyDetail: cd?.familyDetail ?? "",
              });
              sumAllocatedFamilies += cd?.allocatedFamilies ?? 0;
            }

            donorData.familyDetails.allocation.numberOfFamilies =
              (donorData?.familyDetails?.allocation?.numberOfFamilies ?? 0) +
              sumAllocatedFamilies;

            batchData.push({
              PutRequest: {
                Item: donorData,
              },
            });
          }
        }

        //Subscription stuff
        const subscriberHash = donor.requestId;

        /* */
        const subscriberQueryData = {
          KeyConditionExpression: "#pk= :pk And begins_with(#sk, :sk)",
          ExpressionAttributeValues: {
            ":pk": donor.email,
            ":sk": envHashPrefix,
          },
          ExpressionAttributeNames: {
            "#pk": "PK",
            "#sk": "SK",
          },
        };

        const existingSubscriber = existingSubscribers.filter(
          (s) => s.PK === donor.email
        );

        if (!existingSubscriber.length) {
          let subscriptionData = {
            PK: donor.email,
            SK: `${envHashPrefix}${subscriberHash}`,
            firstName: donor.firstName,
            lastName: donor.lastName,
            company: donor?.company ?? "",
            telephone: donor?.telephone ?? "",
            subscribed: donor.subscribed ?? false,
            dateAdded: donor.dateSubscribed ?? timeStamp,
            dateSubscribed: donor.dateSubscribed ?? timeStamp,
            dateVerified: donor.dateVerified ?? "",
            verified: donor?.verified ?? false,
            bounced: donor?.bounced ?? "",
            bouncedDetail: donor?.bouncedDetail ?? "",
            howHeard: donor?.howHeard ?? "",
          };

          batchSubscriberData.push({
            PutRequest: {
              Item: subscriptionData,
            },
          });
        } else {
          console.log("This is a duplicate... ", donor.email);
        }
      }
    } else {
      console.log("NOPE");
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

        await Dynamo.batchWrite(chunk, mainTableName).catch((err) => {
          console.log("error in dynamo write", err);
          return Responses._400({ messages: err });
        });
        await Functions.timer(3000);
      }
      console.log("Donors Import Fin.");
    }

    if (batchSubscriberData && batchSubscriberData.length) {
      const chunkSize = 25;
      console.log(
        "Subscriber batches to import, total:",
        batchSubscriberData.length,
        "Batches:",
        batchSubscriberData.length / chunkSize
      );
      for (let i = 0; i < batchSubscriberData.length; i += chunkSize) {
        const chunk = batchSubscriberData.slice(i, i + chunkSize);

        await Dynamo.batchWrite(chunk, subscriberTableName).catch((err) => {
          console.log("error in dynamo write", err);
          return Responses._400({ messages: err });
        });
        await Functions.timer(1000);
      }
      console.log("Subscribers Import Fin.");
    }
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
