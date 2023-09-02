const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Functions = require('../../common/Functions');

exports.handler = async (event, context, cb) => {
    try {
        if (!Functions.hasPermission(event, 'Admin') && !Functions.hasPermission(event, 'TeamLead')) {
            return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
        }

        const { organisationId } = event.pathParameters ?? {};
        const tableName = process.env.NOMINATORS_TABLE;

        const params = {"TableName": tableName};
        let nominatorsData = await Dynamo.scan(params).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });
        
        //Todo: This should be in the dynamo query above, not foltered out after the fact...
        if (organisationId) {
            nominatorsData = nominatorsData.filter(nom => nom.organisationId == organisationId);
        }
        // nominatorsData = nominatorsData.filter(nom => !nom.isAdmin);

        if (!nominatorsData) {
            return Responses._400({ message: 'Failed to retrieve all via scan' });
        }

        return Responses._200([ ...nominatorsData ]);
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};