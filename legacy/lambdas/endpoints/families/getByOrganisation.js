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

        const userEmail = event.requestContext.authorizer.claims.email;
        
        const { organisationId } = event.pathParameters;

        const familiesTableName = process.env.FAMILIES_TABLE;
        const familiesMembersTableName = process.env.FAMILY_MEMBERS_TABLE;
        const nomTableName = process.env.NOMINATORS_TABLE;

        let nominator = {};

        if (!Functions.hasPermission(event, 'Admin')) {

            const nomQueryData = {
                'IndexName': 'nominatorOrganisationRequest',
                'KeyConditionExpression': 'emailAddress = :emailAddress AND organisationId = :organisationId',
                'ExpressionAttributeValues': {
                    ':emailAddress': userEmail,
                    ':organisationId': organisationId
                }
            };
            const nominatorData = await Dynamo.query(nomQueryData, nomTableName).catch(err => {
                console.log('error in dynamo query', err);
                return Responses._400({ messages: err });
            });

            if (!nominatorData.length) {
                return Responses._400({ message: 'Failed to find nominator' });
            }
            nominator = nominatorData[0];

            if (nominator.organisationId != organisationId) {
                return Responses._400({ message: 'You do no have access to this organisation' });
            }
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

        const queryDataMembers = {
            'IndexName': 'organisationFamilyRequest',
            'KeyConditionExpression': 'organisationId = :organisationId',
            'ExpressionAttributeValues': {
                ':organisationId': organisationId
            }
        };
        let familyMembersData = await Dynamo.query(queryDataMembers, familiesMembersTableName).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        if (
            Functions.hasPermission(event, 'Nominator') && 
            !Functions.hasPermission(event, 'TeamLead') && 
            !Functions.hasPermission(event, 'Admin')
        ) {
            familyData = familyData.filter(f => f.nominatorId === nominator.requestId);
            familyMembersData = familyMembersData.filter(f => f.nominatorId === nominator.requestId);
        }

        return Responses._200({ families: [...familyData], members: [...familyMembersData ]});
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};