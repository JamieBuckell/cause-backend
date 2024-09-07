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

const moment = require("moment-timezone");

exports.handler = async (event, context, cb) => {
  try {
    if (!Functions.hasPermission(event, "Admin")) {
      return Responses._401({
        messages: {
          unauthorized: "You are not authorized to view this section",
        },
      });
    }

    const mainTableName = process.env.MAIN_DYNAMO_TABLE;
    const appURL = process.env.APP_URL;
    const userPoolId = process.env.USER_POOL;
    const envSalt = process.env.HASHING_SALT;
    const { userId } = event.pathParameters;

    const timezone = process.env.TIMEZONE;
    const dateFormat = process.env.DATE_FORMAT;
    const timeStamp = moment(new Date().getTime())
      .tz(timezone)
      .format(dateFormat);

    const nomParams = {
      TableName: mainTableName,
      FilterExpression: "#gsi2pk = :gsi2pk AND begins_with(#gsi2sk, :gsi2sk)",
      IndexName: "GSI2",
      ExpressionAttributeNames: {
        "#gsi2pk": "GSI2PK",
        "#gsi2sk": "GSI2SK",
      },
      ExpressionAttributeValues: {
        ":gsi2pk": userId ?? "UNKNOWN",
        ":gsi2sk": "SK#",
      },
    };
    const nomSearchData = await Dynamo.scan(nomParams).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });
    const nominatorData = nomSearchData.find((o) => o.GSI2PK === userId);

    const userEmail = nominatorData?.nominatorDetails?.email;
    if (!userEmail) {
      return Responses._200({ message: "Nominator not found", result: false });
    }
    const userFullName = `${nominatorData?.nominatorDetails?.firstName ?? ""} ${
      nominatorData?.nominatorDetails?.lastName ?? ""
    }`;
    const userFirstName = nominatorData?.nominatorDetails?.firstName ?? "";
    const nominatorType = nominatorData?.type ?? "nominator";

    if (nominatorData?.emailVerification?.sent) {
      return Responses._400({
        message: "Email has already been sent",
        result: false,
      });
    }

    const orgParams = {
      TableName: mainTableName,
      FilterExpression: "#gsi2pk = :gsi2pk AND begins_with(#gsi2sk, :gsi2sk)",
      IndexName: "GSI2",
      ExpressionAttributeNames: {
        "#gsi2pk": "GSI2PK",
        "#gsi2sk": "GSI2SK",
      },
      ExpressionAttributeValues: {
        ":gsi2pk": nominatorData?.GSI3PK ?? "UNKNOWN",
        ":gsi2sk": "SK#",
      },
    };
    const orgSearchData = await Dynamo.scan(orgParams).catch((err) => {
      console.log("error in dynamo query", err);
      return Responses._400({ messages: err });
    });
    const organisationData = orgSearchData.find(
      (o) => o.GSI2PK === nominatorData?.GSI3PK
    );

    if (!organisationData?.PK) {
      console.log("Organisation not found", organisationData);
      return Responses._200({
        message: "Organisation not found",
        result: false,
      });
    }

    const userPassword = Functions.generateP({ length: 8 });
    let cognitoId = "";
    try {
      const existingCognitoUser = await cognito
        .adminGetUser({
          UserPoolId: userPoolId,
          Username: userEmail,
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
          userEmail
        );
        /* *
        console.log("Email address in use - cognito");
        return Responses._200({
          messages: { error: "Welcome email already sent" },
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

    if (!cognitoId) {
      const cognitoParams = {
        MessageAction: "SUPPRESS",
        UserPoolId: userPoolId,
        Username: userEmail,
        UserAttributes: [
          {
            Name: "email",
            Value: userEmail,
          },
          {
            Name: "name",
            Value: `${userFullName}`,
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
      Username: userEmail,
    };
    await cognito.adminAddUserToGroup(cognitoGroupParams).promise();
    console.log("Cognito user added to group", cognitoGroupParams);

    // Update user with cognitoId
    nominatorData.nominatorDetails.cognitoId = cognitoId;
    nominatorData.emailVerification = {
      dateVerified: "",
      dateSent: timeStamp,
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

    const urlHash = Hashing.hash(
      organisationData.hash.data,
      envSalt + organisationData.hash.salt
    ).hashedpassword;
    const nominatorRegisterLink = `${appURL}/register/${organisationData.GSI2PK}/${urlHash}`;
    const emailTemplate = {
      appURL,
      nominator: {
        firstName: userFirstName,
        email: userEmail,
        password: userPassword,
      },
      nominatorRegisterLink,
    };
    const emailAccountTemplateParams = await Functions.getEmailTemplate(
      nominatorType === "team-lead"
        ? "organisationAdminAccount"
        : "newNominatorConfirmation",
      emailTemplate
    );
    const jsonNominatorParameters = {
      ToAddresses: [userEmail],
      ...emailAccountTemplateParams,
    };
    await Notifications.sendTransactionalEmail(jsonNominatorParameters);
    console.log("Nominator notification sent");

    /*
    Moved to after first login
    if (nominatorType === "team-lead") {
      const emailWelcomeTemplateParams = await Functions.getEmailTemplate(
        "organisationAdminWelcome",
        emailTemplate
      );
      const jsonWelcomeParameters = {
        ToAddresses: [userEmail],
        ...emailWelcomeTemplateParams,
      };
      await Notifications.sendTransactionalEmail(jsonWelcomeParameters);
      console.log("Admin welcome sent");
    }
    */
    return Responses._200({
      success: true,
    });
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`);
    return Responses._400({
      messages: { unexpected: "An unexpected error occurred" },
    });
  }
};
