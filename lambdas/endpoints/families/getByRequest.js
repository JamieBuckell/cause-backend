const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');

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
        const familiesMembersTableName = process.env.FAMILY_MEMBERS_TABLE;

        const familyData = await Dynamo.get(
            {
                "requestId": familyId,
            }, 
            familiesTableName
        ).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        if (!familyData) {
            return Responses._400({ message: 'Failed to retrieve by ID' });
        }

        const queryData = {
            'IndexName': 'familyRequest',
            'KeyConditionExpression': 'familyId = :familyId',
            'ExpressionAttributeValues': {
                ':familyId': familyId
            }
        };
        let familyMembersData = await Dynamo.query(queryData, familiesMembersTableName).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        return Responses._200({ family: {...familyData}, members: [...familyMembersData ]});
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};