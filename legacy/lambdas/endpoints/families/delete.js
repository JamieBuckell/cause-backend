const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');

const moment = require("moment-timezone");

exports.handler = async (event, context, cb) => {
    try {
        if (
            !Functions.hasPermission(event, 'Admin') &&
            !Functions.hasPermission(event, 'TeamLead') &&
            !Functions.hasPermission(event, 'Nominator')
        ) {
            return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
        }
        const { familyId } = event.pathParameters;

        const familiesTableName = process.env.FAMILIES_TABLE;
        const familyMembersTableName = process.env.FAMILY_MEMBERS_TABLE;
        
        const familyData = await Dynamo.get(
            {
                "requestId": familyId,
            }, 
            familiesTableName
        ).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        if (!familyData.requestId) {
            return Responses._400({ messages: { 'unexpected': 'Nominator not found' } });
        }

        if (familyData?.status == 'Allocated') {
            return Responses._400({ messages: { 'error': 'This family has been assigned to a donor, please contact us to delete it.' } });
        }

        const queryData = {
            'IndexName': 'familyRequest',
            'KeyConditionExpression': 'familyId = :familyId',
            'ExpressionAttributeValues': {
                ':familyId': familyId
            }
        };
        let familyMemberData = await Dynamo.query(queryData, familyMembersTableName).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        for (const member of familyMemberData) {
            await Dynamo.delete(
                { "requestId": member.requestId }, 
                familyMembersTableName
            ).catch(err => {
                console.log('error in dynamo query', err);
                return Responses._400({ messages: err });
            });
        }
         await Dynamo.delete(
            { "requestId": familyData.requestId }, 
            familiesTableName
        ).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        return Responses._200({ messages: { 'success': 'Family deleted successfully' }});
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};