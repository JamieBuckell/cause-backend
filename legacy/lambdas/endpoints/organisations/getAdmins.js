const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Functions = require('../../common/Functions');

exports.handler = async (event, context, cb) => {
    try {
        if (!Functions.hasPermission(event, 'Admin') && !Functions.hasPermission(event, 'TeamLead')) {
            return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
        }

        const { organisationId } = event.pathParameters;
        const nomTableName = process.env.NOMINATORS_TABLE;

        const queryData = {
            'IndexName': 'adminsRequest',
            'KeyConditionExpression': 'organisationId = :organisationId AND isAdmin = :isAdmin',
            'ExpressionAttributeValues': {
                ':organisationId': organisationId,
                ':isAdmin': 'true',
            }
        };
        const orgAdmins = await Dynamo.query(queryData, nomTableName).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        if (!orgAdmins) {
            return Responses._400({ message: 'Failed to retrieve db by ID' });
        }

        return Responses._200({ ...orgAdmins });
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};