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
        key: 'positives',
        required: true,
        errorMsg: 'Positives is required',
    },
    {
        key: 'negatives',
        required: true,
        errorMsg: 'Negatives is required',
    },
    {
        key: 'improvements',
        required: true,
        errorMsg: 'Improvements is required',
    },
    {
        key: 'skills',
        required: true,
        errorMsg: 'Skills is required',
    },
    {
        key: 'otherComments',
        required: true,
        errorMsg: 'Other Comments is required',
    },
];

exports.handler = async (event, context, cb) => {
    try {
        const requestId = context.awsRequestId; // Change this so that we are generating our own ID

        const feedbackTableName = process.env.FEEDBACK_TABLE;

        const parsed = event.hamperId ? event : JSON.parse(event.body);
        
        const valid = await Functions.validateSubmission(parsed, validations);
        if (Object.keys(valid).length > 0) {
            return Responses._400({ messages: valid });
        }

        const timezone = process.env.TIMEZONE;
        const dateFormat = process.env.DATE_FORMAT;
        const timeStamp = moment((new Date()).getTime()).tz(timezone).format(dateFormat);

        const fullName = parsed.fullName ?? '';
        const campaignId = parsed.campaignId;
        const positives = parsed.positives;
        const negatives = parsed.negatives;
        const improvements = parsed.improvements;
        const skills = parsed.skills;
        const otherComments = parsed.otherComments;

        const feedbackObj = {
            "requestId" : requestId,
            "campaignId" : campaignId,
            "type" : "volunteer",
            "fullName" : fullName,
            "positives" : positives,
            "negatives" : negatives,
            "improvements" : improvements,
            "skills" : skills,
            "otherComments" : otherComments,
            "feedbackRecieved" : timeStamp,
        };

        await Dynamo.write(feedbackObj, feedbackTableName).catch(err => {
            console.log('error in dynamo write', err);
            return Responses._400({ messages: err });
        });

        return Responses._200({ success: true });

    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};