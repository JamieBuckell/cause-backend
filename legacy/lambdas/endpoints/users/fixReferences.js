const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');

const AWS = require('aws-sdk');
const cognito = new AWS.CognitoIdentityServiceProvider({
    apiVersion: "2016-04-18",
});
const validations = [
    {
        key: 'nominatorId',
        required: true,
        errorMsg: 'Nominator ID is required',
    },
];

exports.handler = async (event, context, cb) => {
    try {
        // Check permissions
        if (!Functions.hasPermission(event, 'Admin')) {
            return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
        }

        // Validate submission
        const parsed = event.nominatorId ? event : JSON.parse(event.body);
        const valid = await Functions.validateSubmission(parsed, validations);
        if (Object.keys(valid).length > 0) {
            return Responses._400({ messages: valid });
        }

        // Set Env Variables
        const nomTableName = process.env.NOMINATORS_TABLE;
        const familiesTableName = process.env.FAMILIES_TABLE;
        const orgTableName = process.env.ORGANISATIONS_TABLE;

        const nominatorData = await Dynamo.get(
            {
                "requestId": parsed.nominatorId,
            }, 
            nomTableName
        ).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        if (!nominatorData) {
            console.log(parsed.nominatorId);
            return Responses._400({ message: 'Failed to retrieve nom by ID' });
        }

        const organisationData = await Dynamo.get(
            {
                "requestId": nominatorData.organisationId,
            }, 
            orgTableName
        ).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        if (!organisationData) {
            console.log(nominatorData.organisationId);
            return Responses._400({ message: 'Failed to retrieve org by ID' });
        }

        const nomFamilyQueryData = {
            'IndexName': 'nominatorRequest',
            'KeyConditionExpression': 'nominatorId = :nominatorId',
            'ExpressionAttributeValues': {
                ':nominatorId': parsed.nominatorId
            }
        };
        const nominatorsFamilies = await Dynamo.query(nomFamilyQueryData, familiesTableName).catch(err => {
            console.log('error in dynamo query 3', err);
            console.log(nomFamilyQueryData, familiesTableName);
            return Responses._400({ messages: err });
        });
        
        if (nominatorsFamilies.length) {
            nominatorsFamilies.sort((a, b) =>
                b.dateSubmitted < a.dateSubmitted ? 1 : a.dateSubmitted < b.dateSubmitted ? -1 : 0
            );

            let count = 1;
            for (const [i, family] of nominatorsFamilies.entries()) {
                const newRef = `${organisationData.reference}${nominatorData.userReference}-${count.toString().padStart(3, "0")}`;
                if (newRef != family.reference) {
                    console.log(`NominatorId: ${family.nominatorId}`);
                    console.log(`Previous Ref: ${family.reference}`);
                    console.log(`New Ref: ${newRef}`);
                    family.reference = newRef;
                    family.status = family.status ? family.status : 'unallocated';
                    const newRequest = await Dynamo.write(family, familiesTableName).catch(err => {
                        console.log('error in dynamo write', err);
                        return Responses._400({ messages: err });
                    });

                    if (!newRequest) {
                        return Responses._400({ message: 'Failed to write family to db by ID' });
                    }
                } else {
                    console.log(`Sticking with reference: ${newRef}`);
                }

                count ++;
            }
        }

        return Responses._200({ messages: { 'success': 'References updated successfully' }});
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};