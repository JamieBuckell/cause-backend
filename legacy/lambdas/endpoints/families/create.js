const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');

var uuid = require('uuid');

const moment = require("moment-timezone");
const validations = [
    {
        key: 'nominatorId',
        required: true,
        errorMsg: 'Nominator is required',
    },
];

exports.handler = async (event, context, cb) => {
    try {
        if (
            !Functions.hasPermission(event, 'Admin') &&
            !Functions.hasPermission(event, 'TeamLead') &&
            !Functions.hasPermission(event, 'Nominator')
        ) {
            return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
        }
        const familiesTableName = process.env.FAMILIES_TABLE;
        const familyMembersTableName = process.env.FAMILY_MEMBERS_TABLE;
        const nomTableName = process.env.NOMINATORS_TABLE;

        const parsed = event.nominatorId ? event : JSON.parse(event.body);
        
        const valid = await Functions.validateSubmission(parsed, validations);
        if (Object.keys(valid).length > 0) {
            return Responses._400({ messages: valid });
        }
        const nominatorData = await Dynamo.get(
            {
                "requestId": parsed.nominatorId,
            }, 
            nomTableName
        ).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        if (!nominatorData.requestId) {
            console.log('Nominator not found... ', parsed.nominatorId, nominatorData);
            return Responses._400({ messages: { 'unexpected': 'Nominator not found' } });
        }
        const validNominatorId = nominatorData.requestId;
        const validOrganisationId = nominatorData.organisationId;
        
        const escapeRegEx = new RegExp(/(<([^>]+)>)/ig);

        var createdFamilies = [];

        if (parsed.nominations.length) {
            for (const [i, n] of parsed.nominations.entries()) {
                const familyId = uuid.v4();

                // use replace for extra layer of security
                const validReference = n.hamperId.toString().replace(escapeRegEx, '');

                if (
                    !Functions.hasPermission(event, 'Admin') && 
                    validOrganisationId !== '1c0ab939-458f-4bf7-9d46-4b52094d8a60'
                ) {
                    const closingDate = new Date('2022-10-05');
                    closingDate.setHours(18, 0, 0, 0);
                    const now = new Date();

                    if (closingDate < now) {
                        console.log('Nominations are closed', validOrganisationId);
                        return Responses._400({ messages: { 'error': 'The nominations process is now closed.' } });
                    }
                }

                var totalUnit = 0;

                const timezone = process.env.TIMEZONE;
                const dateFormat = process.env.DATE_FORMAT;
                const timeStamp = moment((new Date()).getTime()).tz(timezone).format(dateFormat);
                const familyData = {
                    "requestId": familyId,
                    "nominatorId": validNominatorId,
                    "organisationId": validOrganisationId,
                    "reference": validReference,
                    "totalUnit": totalUnit,
                    "dateSubmitted": timeStamp,
                    "allocatedTo": "unallocated",
                    "status": "unallocated",
                }
                
                const newRequest = await Dynamo.write(familyData, familiesTableName).catch(err => {
                    console.log('error in dynamo write', err);
                    return Responses._400({ messages: err });
                });

                if (!newRequest) {
                    return Responses._400({ message: 'Failed to write db by ID' });
                }

                // Add the members...
                if (n.members.length) {

                    const familyMembers = n.members.filter(
                        (m) => m.who
                    );

                    for (const [j, m] of familyMembers.entries()) {
                        totalUnit++;
                        const memberData = {
                            "requestId": uuid.v4(),
                            "familyId": familyId,
                            "nominatorId": validNominatorId,
                            "organisationId": validOrganisationId,
                            "age": m.age ?? '',
                            "ageType": m.ageType ?? '',
                            "who": m.who ?? '',
                            "whoOther": m.whoOther ?? '',
                            "additionalInfo": m.additionalInfo ?? '',
                            "dateSubmitted": timeStamp,
                            "status": "unallocated",
                        }
                        
                        const newMember = await Dynamo.write(memberData, familyMembersTableName).catch(err => {
                            console.log('error in dynamo write', err);
                            return Responses._400({ messages: err });
                        });
                        
                        if (!newMember) {
                            return Responses._400({ message: 'Failed to write db by ID' });
                        }
                    };

                    familyData.nominatorDetail = Functions.createDetailPreview ('workerDetail', nominatorData);
                    familyData.familyDetail = Functions.createDetailPreview ('familyDetail', { members: familyMembers });
                    familyData.totalUnit = totalUnit;
                    await Dynamo.write(familyData, familiesTableName).catch(err => {
                        console.log('error in dynamo write', err);
                        return Responses._400({ messages: err });
                    });
                }

                createdFamilies.push(familyData);
            };
        }

        return Responses._200({ messages: { 'success': `Famil${parsed.nominations.length > 1 ? 'ies' : 'y'} created successful` }, families: createdFamilies});
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};