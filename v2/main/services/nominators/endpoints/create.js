const Responses = require("../common/API_Responses");
const Dynamo = require("../common/Dynamo");
const Hashing = require("../common/Hashing");
const Functions = require("../common/Functions");
const Notifications = require("../common/Notifications");

const AWS = require("aws-sdk");
AWS.config.update({ region: "eu-west-2" });
const cognito = new AWS.CognitoIdentityServiceProvider({
  apiVersion: "2016-04-18",
});

const { nanoid } = require("nanoid");
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
    key: "organisationId",
    required: true,
    errorMsg: "This user must be attached to a valid organisation",
  },
  {
    key: "campaign",
    required: true,
    errorMsg: "This nominator must be attached to a valid campaign",
  },
];

exports.handler = async (event, context, cb) => {
  try {
    const escapeRegEx = new RegExp(/(<([^>]+)>)/gi);
    const mainTableName = process.env.MAIN_DYNAMO_TABLE;
    const appURL = process.env.APP_URL;
    const userPoolId = process.env.USER_POOL;
    const envSalt = process.env.HASHING_SALT;

    const parsed = event?.campaign ? event : JSON.parse(event.body);

    if (!parsed) {
      return Responses._400({
        message: "Failed to read submitted data: " + JSON.stringify(parsed),
      });
    }

    const nominatorType =
      parsed?.type === "team-lead" ? parsed.type : "nominator";

    // Only admins can create team leads...
    if (
      nominatorType === "team-lead" &&
      !Functions.hasPermission(event, "Admin")
    ) {
      return Responses._401({
        messages: {
          unauthorized: "You are not authorized to view this section",
        },
      });
    }

    //Nominators must provide a telephone number
    if (nominatorType === "nominator") {
      validations.push({
        key: "telephone",
        required: true,
        pattern: new RegExp(/[0-9+()\-\s]{8,30}/),
        errorMsg: "Please enter a valid telephone number",
      });
    }

    const valid = await Functions.validateSubmission(parsed, validations);
    if (Object.keys(valid).length > 0) {
      return Responses._400({ messages: valid });
    }
    const campaignId = parsed.campaign.toString().replace(escapeRegEx, "");
    const sendEmail = parsed?.sendEmail ?? false;

    const requestId = nanoid(12);
    if (parsed.email) {
      console.log(
        `Attempt to create ${parsed.email} on ${parsed.organisationId}`,
        parsed
      );
    }

    const campaignParams = {
      TableName: mainTableName,
      FilterExpression: "#pk = :pk",
      ExpressionAttributeNames: {
        "#pk": "PK",
      },
      ExpressionAttributeValues: {
        ":pk": campaignId ?? "UNKNOWN",
      },
    };
    let allCampaignData = await Dynamo.scan(campaignParams).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });

    const organisationData = allCampaignData.find(
      (o) => o?.type === "organisation" && o.GSI2PK === parsed.organisationId
    );

    if (organisationData?.PK) {
      console.log("Org Found", organisationData);

      if (!campaignId) {
        console.log("No campaign ID", campaignId, organisationData);
        return Responses._400({ message: "Org not found" });
      }

      let hashCompare = false;
      if (nominatorType === "team-lead") {
        hashCompare = true;
      } else {
        hashCompare = Hashing.compare(organisationData.hash.data, {
          salt: envSalt + organisationData.hash.salt,
          hashedpassword: parsed.hashPassword,
        });
      }

      if (hashCompare) {
        console.log("HASH Match");

        // use replace for extra layer of security
        const validFirstname = parsed.firstname
          .toString()
          .replace(escapeRegEx, "");
        const validLastname = parsed.lastname
          .toString()
          .replace(escapeRegEx, "");
        const validName = `${validFirstname} ${validLastname}`;
        const validEmail = parsed.email
          .toString()
          .replace(escapeRegEx, "")
          .toLowerCase();
        const validPhone = parsed.telephone.toString().replace(escapeRegEx, "");

        const validOrganisationId = parsed.organisationId;
        const validCompany = organisationData?.organisation?.name;

        const existingUser = allCampaignData.find(
          (o) =>
            o?.nominatorDetails?.email === validEmail &&
            o?.GSI3PK === validOrganisationId
        );

        if (existingUser?.PK) {
          console.log("Email address in use - dynamo");
          return Responses._400({
            messages: {
              duplicate: `Email address already in use. <a class="text-primary" href="/reset-password"><strong>Click here</strong></a> to reset your password`,
            },
          });
        }
        console.log("New user, great!");

        const userPassword = Functions.generateP({ length: 8 });
        let cognitoId = "";
        try {
          const existingCognitoUser = await cognito
            .adminGetUser({
              UserPoolId: userPoolId,
              Username: validEmail,
            })
            .promise();

          // Todo: If this is the case, force reset their password
          if (existingCognitoUser) {
            /* */
            cognitoId = existingCognitoUser.Username;
            const passwordSetParams = {
              Password: userPassword,
              Permanent: false,
              Username: cognitoId,
              UserPoolId: userPoolId,
            };
            await cognito.adminSetUserPassword(passwordSetParams).promise();

            console.log(
              "We have reset the password for the email address",
              validEmail
            );
            /* *
            console.log("Email address in use - cognito", existingCognitoUser);
            return Responses._400({
              messages: { duplicate: "Email address already in use" },
            });
            /* */
          }
          console.log("Cognito user retrieved.");
        } catch (e) {
          switch (e.code) {
            case "UserNotFoundException":
              break;
            default:
              console.log(`Cognito User Check Error! - ${e}`);
              break;
          }
        }

        const userInitials = Functions.getUsersUniqueReference(validName);
        let userReference = userInitials;

        const existingReference = allCampaignData.filter(
          (o) =>
            o?.GSI3PK === validOrganisationId &&
            o?.nominatorDetails?.reference === userReference
        );
        if (existingReference.length > 0) {
          console.log(validOrganisationId, userReference);
          console.log(existingReference);
          console.log(existingReference.length);
          const userCount = existingReference.length + 1;
          userReference = `${userReference}${Functions.numToSSColumn(
            userCount
          )}`;
        }

        const timezone = process.env.TIMEZONE;
        const dateFormat = process.env.DATE_FORMAT;
        const timeStamp = moment(new Date().getTime())
          .tz(timezone)
          .format(dateFormat);

        const nominatorData = {
          PK: campaignId,
          SK: `EMAIL#${validEmail}`,
          dateAdded: timeStamp,
          GSI1PK: requestId,
          GSI1SK: `C#${campaignId}`,
          GSI2PK: requestId,
          GSI2SK: `SK#${validEmail}`,
          GSI3PK: validOrganisationId,
          GSI3SK: `LASTNAME#${validFirstname}#FIRSTNAME#${validLastname}`,
          nominatorDetails: {
            cognitoId: cognitoId,
            firstName: validFirstname,
            lastName: validLastname,
            email: validEmail,
            reference: userReference,
            telephone: validPhone,
          },
          type: nominatorType,
        };
        if (nominatorType === "team-lead") {
          nominatorData.status = "Approved";
        }
        console.log("Create nominator in DB...", nominatorData);

        const newRequest = await Dynamo.write(
          nominatorData,
          mainTableName
        ).catch((err) => {
          console.log("error in dynamo write", err);
          return Responses._400({ messages: err });
        });

        if (!newRequest) {
          console.log("Failed to write db by ID");
          return Responses._400({
            messages: { error: "Failed to write db by ID" },
          });
        }

        if (sendEmail) {
          if (!cognitoId) {
            const cognitoParams = {
              MessageAction: "SUPPRESS",
              UserPoolId: userPoolId,
              Username: validEmail,
              UserAttributes: [
                {
                  Name: "email",
                  Value: validEmail,
                },
                {
                  Name: "name",
                  Value: `${validName}`,
                },
              ],
              TemporaryPassword: userPassword,
            };

            console.log("Create cognito user...", cognitoParams);
            const congitoUser = await cognito
              .adminCreateUser(cognitoParams)
              .promise();
            cognitoId = congitoUser.User.Attributes.find(
              (a) => a.Name === "sub"
            ).Value;
            console.log("Cognito user created!?", congitoUser);
          }

          const cognitoGroupParams = {
            GroupName: nominatorType === "team-lead" ? "TeamLead" : "Nominator",
            UserPoolId: userPoolId,
            Username: validEmail,
          };
          await cognito.adminAddUserToGroup(cognitoGroupParams).promise();
          console.log("Cognito user added to group", cognitoGroupParams);

          // Update user with cognitoId
          nominatorData.nominatorDetails.cognitoId = cognitoId;
          nominatorData.emailVerification = {
            dateVerified: "",
            sent: true,
            verified: false,
            bounced: false,
            bouncedDetail: "",
          };
          await Dynamo.write(nominatorData, mainTableName).catch((err) => {
            console.log("error in dynamo write", err);
            return Responses._400({ messages: err });
          });
          console.log("Updated cognito id against user in dynamo");

          const emailTemplateNominator = {
            appURL,
            nominator: {
              firstName: validFirstname,
              email: validEmail,
              password: userPassword,
            },
          };
          const emailAccountTemplateParams = await Functions.getEmailTemplate(
            nominatorType === "team-lead"
              ? "organisationAdminAccount"
              : "newNominatorConfirmation",
            emailTemplateNominator
          );
          const jsonNominatorParameters = {
            ToAddresses: [validEmail],
            ...emailAccountTemplateParams,
          };
          await Notifications.sendTransactionalEmail(jsonNominatorParameters);
          console.log("Nominator notification sent");

          if (nominatorType === "team-lead") {
            const emailWelcomeTemplateParams = await Functions.getEmailTemplate(
              "organisationAdminWelcome",
              emailTemplateNominator
            );
            const jsonWelcomeParameters = {
              ToAddresses: [validEmail],
              ...emailWelcomeTemplateParams,
            };
            await Notifications.sendTransactionalEmail(jsonWelcomeParameters);
            console.log("Admin welcome sent");
          }
        }

        // Notify Org Admins...
        const orgAdmins = allCampaignData.filter(
          (o) =>
            o?.GSI3PK === validOrganisationId &&
            o?.type === "team-lead" &&
            o?.nominatorDetails?.email != validEmail
        );

        if (nominatorType !== "team-lead" && orgAdmins.length) {
          console.log("We've got admins to notify");
          for (const admin of orgAdmins) {
            const emailTemplateAdmin = {
              appURL,
              nominator: { name: validName, email: validEmail },
              companyName: validCompany,
            };
            const AdminTemplateParams = await Functions.getEmailTemplate(
              "adminNewNominator",
              emailTemplateAdmin
            );
            const jsonAdminParameters = {
              ToAddresses: [admin.nominatorDetails.email],
              ...AdminTemplateParams,
            };
            await Notifications.sendTransactionalEmail(jsonAdminParameters);
          }
        }

        return Responses._200({
          messages: { success: "Creation successful" },
          registrationId: requestId,
          nominator: nominatorData,
        });
      }
    }
    return Responses._400({
      messages: { notfound: "Invalid organisation" },
    });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
