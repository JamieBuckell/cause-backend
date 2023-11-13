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

        const { organisationId } = event.pathParameters;
        const orgTableName = process.env.ORGANISATIONS_TABLE;
        const familiesTableName = process.env.FAMILIES_TABLE;

        const envSalt = process.env.HASHING_SALT;

        const organisationData = await Dynamo.get(
            {
                "requestId": organisationId,
            }, 
            orgTableName
        ).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        if (!organisationData) {
            return Responses._400({ message: 'Failed to retrieve by ID' });
        }

        const queryData = {
            'IndexName': 'organisationFamilyRequest',
            'KeyConditionExpression': 'organisationId = :organisationId',
            'ExpressionAttributeValues': {
                ':organisationId': organisationId
            }
        };
        let familyData = await Dynamo.query(queryData, familiesTableName).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });
        organisationData.familiesLimit = organisationData.familiesLimit ? organisationData.familiesLimit : (organisationData.type === 'charity' ? 20 : 0),
        organisationData.familiesTotal = familyData.length;

        organisationData.urlHash = Hashing.hash(organisationData.hashedData, envSalt+organisationData.hashSalt).hashedpassword;
        delete organisationData.hashedData;
        delete organisationData.hashSalt;

        return Responses._200({ ...organisationData });
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};