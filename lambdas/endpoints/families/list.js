const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');

exports.handler = async (event, context, cb) => {
    try {
        if (
            !Functions.hasPermission(event, 'Admin')
        ) {
            return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
        }
        
        const parsed = event.emailAddress ? event : JSON.parse(event.body);

        const familiesTableName = process.env.FAMILIES_TABLE;

        const params = {"TableName": familiesTableName};
        let allFamilies = await Dynamo.scan(params).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        if (parsed?.organisationId) {
            allFamilies = allFamilies.filter(
                (f) => f.organisationId == parsed.organisationId
            );
        }

        if (!allFamilies) {
            return Responses._400({ message: 'Failed to find family data' });
        }

        return Responses._200([ ...allFamilies ]);
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};