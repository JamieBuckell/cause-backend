const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');

exports.handler = async (event, context, cb) => {
    try {
        const { organisationId, hash } = event.pathParameters;
        const tableName = process.env.ORGANISATIONS_TABLE;
        const envSalt = process.env.HASHING_SALT;

        console.log(organisationId, hash);

        const organisationData = await Dynamo.get(
            {
                "requestId": organisationId,
            }, 
            tableName
        ).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        const hashCompare = Hashing.compare(organisationData.hashedData, {salt: envSalt+organisationData.hashSalt, hashedpassword: hash})
        
        if (hashCompare) {
            return Responses._200({ organisationId: organisationData.requestId });
        } else {
            return Responses._400({ messages: { 'notfound': 'Organisation not found' } });
        }
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};