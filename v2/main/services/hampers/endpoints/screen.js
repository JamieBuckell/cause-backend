const Responses = require('../common/API_Responses');
const Dynamo = require('../common/Dynamo');
const Hashing = require('../common/Hashing');
const Functions = require('../common/Functions');
const Notifications = require('../common/Notifications');

const AWS = require('aws-sdk');
AWS.config.update({region: 'eu-west-2'});
const cognito = new AWS.CognitoIdentityServiceProvider({
    apiVersion: "2016-04-18",
});

exports.handler = async (event, context, cb) => {
    try {
        const mainTableName = process.env.MAIN_DYNAMO_TABLE;

        const { campaignId } = event.pathParameters;
        
        const counts = {
            allocatedConfirmed: 0,
            hampersDropped: 0,
            bagsDropped: 0,
        };
        
        const campaignQueryData = {
            TableName: mainTableName,
            FilterExpression: "#pk= :pk AND begins_with(#sk, :sk)",
            ExpressionAttributeValues: {
                ":pk": campaignId,
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

        const allFamilies = campaignData.filter((cd) => cd?.type === 'family');

        counts.allocatedConfirmed = allFamilies.filter(f => f.status.indexOf('allocated-confirmed') >= 0).length;
        counts.hampersDropped = allFamilies.filter(f => f?.receiveStatus && (f.receiveStatus.indexOf('hamper-received') >= 0 || f.receiveStatus.indexOf('direct-hamper') >= 0)).length;

        const sum = allFamilies.reduce((accumulator, object) => {
            console.log(object);
            return accumulator + (object?.bagsReceived && object.bagsReceived != "" ? parseInt(object.bagsReceived) : 0);
        }, 0);
        counts.bagsDropped += sum;

        return Responses._200(counts);
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};