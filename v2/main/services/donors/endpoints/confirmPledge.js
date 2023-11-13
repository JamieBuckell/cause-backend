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
    const { emailAddress } = event.pathParameters;
    const { v, c } = event.queryStringParameters;
    const envSalt = process.env.HASHING_SALT;

    const isAdmin = Functions.hasPermission(event, "Admin");

    const mainTableName = process.env.MAIN_DYNAMO_TABLE;

    const donorQueryData = {
      KeyConditionExpression: "#pk= :pk AND #sk= :sk",
      ExpressionAttributeValues: {
        ":pk": c,
        ":sk": `EMAIL#D#${emailAddress}`,
      },
      ExpressionAttributeNames: {
        "#pk": "PK",
        "#sk": "SK",
      },
    };
    var donorData = await Dynamo.query(donorQueryData, mainTableName).catch(
      (err) => {
        console.log("error in dynamo query", err);
        return Responses._400({ messages: err });
      }
    );

    if (donorData && donorData[0]) {
      const existingDonor = donorData[0];

      const hashCompare = isAdmin
        ? false
        : Hashing.compare(existingDonor.emailVerification.hash, {
            salt: envSalt,
            hashedpassword: v,
          });

      if (isAdmin || hashCompare) {
        const familiesQueryData = {
          TableName: mainTableName,
          FilterExpression: "#pk= :pk AND begins_with(#sk, :sk)",
          ExpressionAttributeValues: {
            ":pk": c,
            ":sk": `REF#`,
          },
          ExpressionAttributeNames: {
            "#pk": "PK",
            "#sk": "SK",
          },
        };
        const allFamiliesData = await Dynamo.scan(familiesQueryData).catch(
          (err) => {
            console.log("error in dynamo query", err);
            return Responses._400({ messages: err });
          }
        );

        const unconfirmedFamilies = allFamiliesData.filter(
          (f) =>
            f.allocatedTo === existingDonor.GSI2PK &&
            f.status !== "allocated-confirmed"
        );

        if (unconfirmedFamilies.length) {
          let batchData = [];
          for (const family of unconfirmedFamilies) {
            family.status = "allocated-confirmed";
            batchData.push({
              PutRequest: {
                Item: family,
              },
            });
          }
          if (batchData.length) {
            console.log(`${batchData.length} families to update`);
            const chunkSize = 25;
            for (let i = 0; i < batchData.length; i += chunkSize) {
              const chunk = batchData.slice(i, i + chunkSize);

              await Dynamo.batchWrite(chunk, mainTableName).catch((err) => {
                console.log("error in dynamo write", err);
                return Responses._400({ messages: err });
              });
            }
          }

          if (!isAdmin) {
            var params = {
              DelaySeconds: 10,
              MessageAttributes: {
                donorDetails: {
                  DataType: "String",
                  StringValue: JSON.stringify(existingDonor),
                },
                donorFamiliesData: {
                  DataType: "String",
                  StringValue: JSON.stringify(unconfirmedFamilies),
                },
              },
              MessageBody: `Sending pledge detail email to: ${emailAddress}`,
              QueueUrl: `https://sqs.${process.env.AWS_ACCOUNT_REGION}.amazonaws.com/${process.env.AWS_ACCOUNT_ID}/${process.env.PLEDGE_DETAIL_QUEUE}`,
            };

            await sqs.sendMessage(params).promise();
          }

          return Responses._200({
            messages: {
              success:
                "Thank you, your pledge has been confirmed.<br /><br />You will shortly recieve an email with confirmation of your families along with your labels.",
            },
          });
        } else {
          return Responses._400({
            messages: { error: "You have already confirmed your allocation." },
          });
        }
      } else {
        console.log("isAdmin", isAdmin);
        console.log("hashCompare", hashCompare);
        return Responses._400({
          messages: {
            error:
              'There was an error confirming your allocation, please try the link again or <a href="https://www.cause-foundation.org.uk/contact-us-i3">Contact Us</a> if the problem persists.',
          },
        });
      }
    } else {
      console.log(`Cannot find donor!`, emailAddress);
    }
    return Responses._400({
      messages: {
        error:
          'There was an error confirming your allocation, please try the link again or <a href="https://www.cause-foundation.org.uk/contact-us-i3">Contact Us</a> if the problem persists.',
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
