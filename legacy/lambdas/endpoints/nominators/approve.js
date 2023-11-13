const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Functions = require('../../common/Functions');

exports.handler = async (event, context, cb) => {
    try {
        if (!Functions.hasPermission(event, 'Admin') && !Functions.hasPermission(event, 'TeamLead')) {
            return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
        }
        
        const { nominatorId, organisationId } = event.pathParameters;

        const userEmail = event.requestContext.authorizer.claims.email;
        const nomTableName = process.env.NOMINATORS_TABLE;

        let lead = {};

        if (Functions.hasPermission(event, 'TeamLead')) {
            const leadQueryData = {
                'IndexName': 'nominatorOrganisationRequest',
                'KeyConditionExpression': 'emailAddress = :emailAddress AND organisationId = :organisationId',
                'ExpressionAttributeValues': {
                    ':emailAddress': userEmail,
                    ':organisationId': organisationId
                }
            };
            const leadData = await Dynamo.query(leadQueryData, nomTableName).catch(err => {
                console.log('error in dynamo query', err);
                return Responses._400({ messages: err });
            });

            if (!leadData.length) {
                return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
            }
            lead = leadData[0];

            if (!lead.isAdmin) {
                return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
            }
        }

        const nominatorData = await Dynamo.get(
            {
                "requestId": nominatorId,
            }, 
            nomTableName
        ).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });
        if (!nominatorData.requestId) {
          return Responses._400({ messages: { 'error': 'Nominator not found' } });
        }

        if (Functions.hasPermission(event, 'TeamLead')) {
            if (lead.organisationId != nominatorData.organisationId) {
                return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
            }
        }

        nominatorData.status = 'Approved';
        await Dynamo.write(nominatorData, nomTableName).catch(err => {
            console.log('error in dynamo write', err);
            return Responses._400({ messages: err });
        });

        return Responses._200({ messages: { 'success': 'Nominator successfully approved' } });
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};