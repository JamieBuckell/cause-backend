const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

var uuid = require("uuid");
const moment = require("moment-timezone");

exports.handler = async (event, context, cb) => {
  try {
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;
    const subscriberTableName = process.env.SUBSCRIBERS_TABLE;
    const legacyDonorsTable = "cause-donors-live";
    const legacyCampaignDonorsTable = "cause-campaign-donors-new-live";

    const timezone = process.env.TIMEZONE;
    const dateFormat = process.env.DATE_FORMAT;
    const timeStamp = moment(new Date().getTime())
      .tz(timezone)
      .format(dateFormat);

    const batchData = [];
    const batchSubscriberData = [];

    const campaignId = Functions.defaultCampaign();

    const legacyDonorData = await Dynamo.scan({
      TableName: legacyDonorsTable,
    }).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    /* */
    console.log("Get Donors data");

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
    let allDonorData = await Dynamo.scan(params).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    console.log("Get Campaign data");
    const campaignDonorsData = await Dynamo.scan({
      TableName: legacyCampaignDonorsTable,
    }).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });
    /* *
    if (legacyDonorData.length) {
      console.log("Donors to fix", legacyDonorData.length);

      for (const [i, donor] of legacyDonorData.entries()) {
        var campaignData = campaignDonorsData.filter(
          (cd) => cd.donorId === donor.requestId
        );
        if (campaignData.length > 1) {
          console.log(
            "More than one campaign...",
            donor.requestId,
            campaignData.length
          );
          const existingDonor = allDonorData.find(
            (d) => d.legacyId === donor.requestId
          );

          if (existingDonor?.SK) {
            console.log("Here be the donor...", existingDonor?.GSI3PK);
            const familyRequests = [];
            let sumAllocatedFamilies = 0;
            for (const [i, cd] of campaignData.entries()) {
              familyRequests.push({
                numberOfFamilies: cd?.numberOfFamilies ?? "",
                additionalInfo: cd?.additionalInfo ?? "",
                familyDetail: cd?.familyDetail ?? [],
              });
              sumAllocatedFamilies += cd?.allocatedFamilies ?? 0;
            }
            existingDonor.familyDetails.request = [...familyRequests];
            existingDonor.familyDetails.allocation.numberOfFamilies =
              sumAllocatedFamilies;

            batchData.push({
              PutRequest: {
                Item: existingDonor,
              },
            });
          }
        }
      }
    }
    /* */

    if (legacyDonorData.length) {
      console.log("Donors to fix", legacyDonorData.length);

      for (const [i, donor] of legacyDonorData.entries()) {
        const donorToCheck = allDonorData.find(
          (d) => d.legacyId === donor.requestId
        );
        if (donorToCheck?.PK !== undefined) {
          if (donor?.howHeard) {
            donorToCheck.donorDetails.howHeard = donor.howHeard;
            batchData.push({
              PutRequest: {
                Item: donorToCheck,
              },
            });
          }
          /* *
          if (!donorToCheck?.emailVerification) {
            donorToCheck.emailVerification = {
              dateVerified: donor.dateVerified ?? "",
              verified: donor?.verified ?? false,
              bounced: donor?.bounced ?? false,
              bouncedDetail: donor?.bouncedDetail ?? "",
            };
          }
          donorToCheck.dateAdded =
            donor?.dateAdded ?? donor?.dateSubscribed ?? timezone;
          batchData.push({
            PutRequest: {
              Item: donorToCheck,
            },
          });

          /* */
        }
      }
    }
    /* */

    // Update bounced data for subscribers
    /* *

    console.log("Get Subscribers data");

    const existingSubscribers = await Dynamo.scan({
      TableName: subscriberTableName,
    }).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    if (existingSubscribers.length) {
      console.log("Subscribers to fix", existingSubscribers.length);
      for (const [i, subscriber] of existingSubscribers.entries()) {
        const donorToCheck = legacyDonorData.find(
          (d) => d.requestId === subscriber.SK.replace("H#", "")
        );
        if (donorToCheck.bounced || donorToCheck.bouncedDetail) {
          subscriber.bounced = donorToCheck.bounced;
          subscriber.bouncedDetail = donorToCheck.bouncedDetail;
          batchSubscriberData.push({
            PutRequest: {
              Item: subscriber,
            },
          });
        }
      }
    } else {
      console.log("NOPE");
    }
    /* */

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
