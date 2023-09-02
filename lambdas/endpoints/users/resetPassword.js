const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');
const Notifications = require('../../common/Notifications');

exports.handler = async (event, context, cb) => {
    try {
        const { emailAddress } = event.pathParameters;
        const nomTableName = process.env.NOMINATORS_TABLE;
        const appURL = process.env.APP_URL;
        const envSalt = process.env.HASHING_SALT;

        console.log(`${emailAddress} is attempting to reset their password.`);

        const nomQueryData = {
            'IndexName': 'nominatorRequest',
            'KeyConditionExpression': 'emailAddress = :emailAddress',
            'ExpressionAttributeValues': {
                ':emailAddress': emailAddress
            }
        };
        const nominatorData = await Dynamo.query(nomQueryData, nomTableName).catch(err => {
            console.log('error in dynamo query 1', err);
            return Responses._400({ messages: err });
        });

        // Delete the nominator if they exist...
        // Todo: also delete any data they have created!
        if (nominatorData[0]?.requestId) {
            const nominator = nominatorData[0];
            nominator.resetPasswordHash = Hashing.generateSalt(14) + '-' + Hashing.generateSalt(14);
            await Dynamo.write(nominator, nomTableName).catch(err => {
                console.log('error in dynamo write', err);
                return Responses._400({ messages: err });
            });

            const urlHash = Hashing.hash(nominator.requestId, envSalt+nominator.resetPasswordHash).hashedpassword;
            const resetPasswordLink = `${appURL}/reset-password/${nominator.emailAddress}/${urlHash}`;

            const emailTemplate = {
                resetPasswordLink,
                nominator
            };
            const emailAccountTemplateParams = await Functions.getEmailTemplate('userPasswordResetInit', emailTemplate);
            const jsonAccountParameters = {
                ToAddresses: [nominator.emailAddress],
                ...emailAccountTemplateParams,
            };
            await Notifications.sendTransactionalEmail(jsonAccountParameters);            
        } else {
            console.log(`Nominator not found: ${JSON.stringify(nominator)}`);
        }

        return Responses._200({ success: true });
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};