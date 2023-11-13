const Responses = require('../common/API_Responses');
const Dynamo = require('../common/Dynamo');
const Hashing = require('../common/Hashing');
const Functions = require('../common/Functions');

exports.handler = async (event, context, cb) => {
    try {
        if (
            !Functions.hasPermission(event, 'Admin')
        ) {
            return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
        }
        
        const feedbackTableName = process.env.FEEDBACK_TABLE;

        const { campaignId } = event.pathParameters;

        const params = {
            TableName: feedbackTableName,
            FilterExpression: "#campaignId = :campaignId",
            ExpressionAttributeNames: {
              "#campaignId": "campaignId",
            },
            ExpressionAttributeValues: {
              ":campaignId": campaignId,
            },
        };
        let allFeedback = await Dynamo.scan(params).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        if (!allFeedback) {
            return Responses._400({ message: 'Failed to find feedback data' });
        }
        allFeedback = allFeedback.filter(f => f.type && f.type === 'family');

        return Responses._200([ ...allFeedback ]);
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};