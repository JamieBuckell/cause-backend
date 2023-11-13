const Responses = require('../common/API_Responses');
const Dynamo = require('../common/Dynamo');
const Hashing = require('../common/Hashing');
const Functions = require('../common/Functions');

const moment = require("moment-timezone");

const validations = [
    {
        key: 'campaignId',
        required: true,
        errorMsg: 'Campaign ID is required',
    },
    {
        key: 'hamperId',
        required: true,
        errorMsg: 'Hamper ID is required',
    },
    {
        key: 'noBags',
        required: true,
        errorMsg: 'Number of bags is required',
    },
];

exports.handler = async (event, context, cb) => {
    try {
        const mainTableName = process.env.MAIN_DYNAMO_TABLE;
        const timezone = process.env.TIMEZONE;
        const dateFormat = process.env.DATE_FORMAT;

        const parsed = event.nominatorId ? event : JSON.parse(event.body);
        
        const valid = await Functions.validateSubmission(parsed, validations);
        if (Object.keys(valid).length > 0) {
            return Responses._400({ messages: valid });
        }

        const campaignQueryData = {
          TableName: mainTableName,
          FilterExpression: "#pk= :pk AND begins_with(#sk, :sk)",
          ExpressionAttributeValues: {
            ":pk": parsed.campaignId,
            ":sk": "REF#",
          },
          ExpressionAttributeNames: {
            "#pk": "PK",
            "#sk": "SK",
          },
        };
        var campaignData = await Dynamo.scan(campaignQueryData).catch((err) => {
          console.log("error in dynamo query", err);
          return Responses._400({ messages: err });
        });

        const hamper = campaignData.find((h) => h.GSI2SK === `SK#${parsed.hamperId}`);
        if (hamper && hamper?.PK) {
            // if (!hamper.bagsReceived) {
            if (!hamper.bagsReceived || hamper.bagsReceived !== parsed.noBags) {
                hamper.bagsReceived = parsed.noBags
                hamper.receiveStatus = 'hamper-received'

                const timeStamp = moment((new Date()).getTime()).tz(timezone).format(dateFormat);
                hamper.receivedDate = timeStamp
                
                await Dynamo.write(hamper, mainTableName).catch(err => {
                    console.log('error in dynamo write', err);
                    return Responses._400({ messages: err });
                });

                return Responses._200({ success: true });
            // } else {
                // return Responses._400({ messages: { 'error': 'This hamper has already been received!' } });
            } else {
                return Responses._200({ success: true });
            }
        }
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });

    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};