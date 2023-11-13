const Responses = require('../common/API_Responses');
const Dynamo = require('../common/Dynamo');
const Hashing = require('../common/Hashing');
const Functions = require('../common/Functions');

const moment = require("moment-timezone");

const validations = [
    {
        key: 'hamperId',
        required: true,
        errorMsg: 'Hamper ID is required',
    },
];

exports.handler = async (event, context, cb) => {
    try {
        const familiesTableName = process.env.FAMILIES_TABLE;
        const timezone = process.env.TIMEZONE;
        const dateFormat = process.env.DATE_FORMAT;

        const parsed = event.nominatorId ? event : JSON.parse(event.body);
        
        const valid = await Functions.validateSubmission(parsed, validations);
        if (Object.keys(valid).length > 0) {
            return Responses._400({ messages: valid });
        }

        const queryData = {
            'IndexName': 'familyRequest',
            'KeyConditionExpression': '#reference = :reference',
            ExpressionAttributeNames: {
                "#reference": "reference"
            },
            'ExpressionAttributeValues': {
                ':reference': parsed.hamperId
            }
        };
        let familyData = await Dynamo.query(queryData, familiesTableName).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        if (familyData && familyData[0]) {
            familyData = familyData[0];
            familyData.receiveStatus = 'direct-hamper'

            const timeStamp = moment((new Date()).getTime()).tz(timezone).format(dateFormat);
            familyData.receivedDate = timeStamp
            
            await Dynamo.write(familyData, familiesTableName).catch(err => {
                console.log('error in dynamo write', err);
                return Responses._400({ messages: err });
            });

            return Responses._200({ success: true });
        }
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });

    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};