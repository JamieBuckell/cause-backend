const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

const moment = require("moment-timezone");
exports.handler = async (event, context, cb) => {
  try {
    const { emailAddress } = event.pathParameters;
    let { v, campaignId } = event.queryStringParameters;

    const isAdmin = Functions.hasPermission(event, 'Admin');

    console.log("Verification attempt for", emailAddress);
    if (isAdmin) {
      console.log("User is Admin...", event);
    }

    if (!campaignId || campaignId === "undefined") {
      campaignId = "CH2"; // Default it to CH2 for now
    }

    const envSalt = process.env.HASHING_SALT;
    const envHashPrefix = process.env.HASHING_PREFIX;
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;
    const subscriberTableName = process.env.SUBSCRIBERS_TABLE;

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

    if (currentCampaign?.PK) {
      const registrationClosed = new Date(
        currentCampaign.campaignDetails.registrationClosed
      );
      const now = new Date();
      const campaignActive = now <= registrationClosed;

      var hashVerified = false;

      // Specifically Verify any subscriptions
      const subscriberQueryData = {
        KeyConditionExpression: "#pk= :pk And begins_with(#sk, :sk)",
        ExpressionAttributeValues: {
          ":pk": emailAddress,
          ":sk": envHashPrefix,
        },
        ExpressionAttributeNames: {
          "#pk": "PK",
          "#sk": "SK",
        },
      };
      const subscribers = await Dynamo.query(
        subscriberQueryData,
        subscriberTableName
      ).catch((err) => {
        console.log("error in dynamo query", err);
        return Responses._400({ messages: err });
      });

      if (subscribers.length) {
        const existingSubscriber = subscribers[0];

        let verificationSuccess = false;

        if (!existingSubscriber?.verified) {
          const subscriberHash = existingSubscriber.SK.replace(
            envHashPrefix,
            ""
          );
          const hashCompare = Hashing.compare(subscriberHash, {
            salt: envSalt,
            hashedpassword: v,
          });

          if (hashCompare || isAdmin) {
            hashVerified = true;
            const timezone = process.env.TIMEZONE;
            const dateFormat = process.env.DATE_FORMAT;
            const timeStamp = moment(new Date().getTime())
              .tz(timezone)
              .format(dateFormat);

            existingSubscriber.verified = true;
            existingSubscriber.dateVerified = timeStamp;

            await Dynamo.write(existingSubscriber, subscriberTableName).catch(
              (err) => {
                console.log("error in dynamo write", err);
                return Responses._400({
                  messages: {
                    error:
                      "An unexpected error occurred. Please try again later",
                  },
                });
              }
            );

            verificationSuccess = true;
          } else {
            console.log("Hash not matched...", hashCompare, subscriberHash, {
              salt: envSalt,
              hashedpassword: v,
            });
          }
        } else {
          console.log("Already verified...");
          verificationSuccess = true;
        }

        if (verificationSuccess) {
          if (campaignActive) {
            // Verification process completed, send the hamper confirmation email...
            const queryData = {
              KeyConditionExpression: "#pk= :pk And begins_with(#sk, :sk)",
              ExpressionAttributeValues: {
                ":pk": currentCampaign.PK,
                ":sk": `EMAIL#D#${existingSubscriber.PK}`,
              },
              ExpressionAttributeNames: {
                "#pk": "PK",
                "#sk": "SK",
              },
            };
            const donors = await Dynamo.query(queryData, mainTableName).catch(
              (err) => {
                console.log("error in dynamo query", err);
                return Responses._400({ messages: err });
              }
            );

            if (donors.length) {
              for (const [i, existingDonor] of donors.entries()) {
                console.log("verifying", existingDonor.GSI3PK);
                if (!existingDonor?.emailVerification) {
                  existingDonor.emailVerification = {
                    bounced: false,
                    bouncedDetail: "",
                    dateVerified: "",
                    verified: false,
                  };
                }

                const timezone = process.env.TIMEZONE;
                const dateFormat = process.env.DATE_FORMAT;
                const timeStamp = moment(new Date().getTime())
                  .tz(timezone)
                  .format(dateFormat);

                existingDonor.emailVerification.verified = true;
                existingDonor.emailVerification.dateVerified = timeStamp;

                await Dynamo.write(existingDonor, mainTableName).catch(
                  (err) => {
                    console.log("error in dynamo write", err);
                    return Responses._400({
                      messages: {
                        error:
                          "An unexpected error occurred. Please try again later",
                      },
                    });
                  }
                );

                const emailTemplate = {
                  familyData: existingDonor.familyDetails.request,
                  donorData: {
                    ...existingDonor.donorDetails,
                    email: emailAddress,
                  },
                };
                const emailTemplateParams = await Functions.getEmailTemplate(
                  "donorVerified",
                  emailTemplate
                );
                const jsonParameters = {
                  ToAddresses: [emailAddress],
                  ...emailTemplateParams,
                };
                await Notifications.sendTransactionalEmail(jsonParameters);
              }
            } else {
              console.log(
                "Donor not found...",
                currentCampaign?.PK,
                existingSubscriber?.PK
              );
            }
          } else {
            console.log(
              "We finished because the campaign is no longer active...",
              now,
              registrationClosed
            );
          }
          return Responses._200({
            messages: {
              success:
                'Your email address has successfully been verified.<br /><br /><a href="https://www.cause-foundation.org.uk/">Click here to go to the website.</a>',
            },
          });
        } else {
          console.log("Verification not successfull...");
        }
      } else {
        console.log("Subscriber not found?", emailAddress, envHashPrefix);
      }
    } else {
      console.log("Campaign not found.", campaignId);
    }
    return Responses._400({
      messages: {
        error:
          'There was an error verifying your email address, please try the link again or <a href="https://www.cause-foundation.org.uk/contact-us-i3">Contact Us</a> if the problem persists.',
      },
    });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: {
        unexpected: "An unexpected error occurred. Please try again later",
      },
    });
  }
};
