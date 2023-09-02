const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');

exports.handler = async (event, context, cb) => {
    try {

        const familiesTableName = process.env.FAMILIES_TABLE;
        const orgTableName = process.env.ORGANISATIONS_TABLE;
        
        const params = {"TableName": familiesTableName};
        let allFamilies = await Dynamo.scan(params).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });
        if (allFamilies.LastEvaluatedKey) {
            console.log('YEP!');
        }
        console.log(allFamilies);

        const orgCounts = {};
        for (const familyKey in allFamilies) {
            const family = allFamilies[familyKey];
            if (!orgCounts[family.organisationId]) {
                orgCounts[family.organisationId] = 0;
            }
            orgCounts[family.organisationId] ++;
        }
        
        const orgParams = {"TableName": orgTableName};
        let allOrgs = await Dynamo.scan(orgParams).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        let batchData = [];
        for (const orgKey in allOrgs) {
            const org = allOrgs[orgKey];
            org.totalFamilies = orgCounts[org.requestId] ? orgCounts[org.requestId] : 0;
            batchData.push({
                PutRequest: {
                    Item: org
                }
            });
        }
                
        /* */
        const chunkSize = 25;
        for (let i = 0; i < batchData.length; i += chunkSize) {
            const chunk = batchData.slice(i, i + chunkSize);

            await Dynamo.batchWrite(chunk, orgTableName).catch(err => {
                console.log('error in dynamo write', err);
                return Responses._400({ messages: err });
            });
        }
        /* */
        

        return Responses._200({ messages: { 'success': 'Import successful' }});
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};