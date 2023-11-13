const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');

var uuid = require('uuid');

const moment = require("moment-timezone");
const validations = [
    {
        key: 'requestId',
        required: true,
        errorMsg: 'Family ID is required',
    },
    {
        key: 'nominatorId',
        required: true,
        errorMsg: 'Nominator ID is required',
    },
    {
        key: 'organisationId',
        required: true,
        errorMsg: 'Organisation ID is required',
    },
];

exports.handler = async (event, context, cb) => {
    try {
        if (!Functions.hasPermission(event, 'Admin')) {
            return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
        }

        const familiesTableName = process.env.FAMILIES_TABLE;
        const familyMembersTableName = process.env.FAMILY_MEMBERS_TABLE;

        const parsed = event.nominatorId ? event : JSON.parse(event.body);
        
        const valid = await Functions.validateSubmission(parsed, validations);
        if (Object.keys(valid).length > 0) {
            return Responses._400({ messages: valid });
        }
        
        const escapeRegEx = new RegExp(/(<([^>]+)>)/ig);

        var createdFamiliesReturn = [];
        var createdFamilies = [];
        let existingFamilyData = {};
        if (parsed.members && parsed.members.length) {
            let familyId;
            for (const [i, m] of parsed.members.entries()) {
                console.log(m);
                const familyNumber = m.familyNumber ?? 1;
                familyId = '';
                const createdFamilyData = createdFamilies.filter(f => f.familyNumber === familyNumber);
                if (
                    createdFamilyData &&
                    createdFamilyData.length && 
                    createdFamilyData[0]?.data?.familyId
                ) {
                    existingFamilyData = createdFamilyData[0];
                    familyId = existingFamilyData.data.familyId;
                }

                if (familyNumber > 1) {
                    if (familyId) {
                        existingFamilyData.data.totalUnit ++;
                    } else {
                        familyId = uuid.v4();
                        console.log(`NEW FAMILY ID: ${familyId}`);

                        // use replace for extra layer of security
                        const validReference = m.hamperId.toString().replace(escapeRegEx, '');

                        const timezone = process.env.TIMEZONE;
                        const dateFormat = process.env.DATE_FORMAT;
                        const timeStamp = moment((new Date()).getTime()).tz(timezone).format(dateFormat);
                        const familyMembers = parsed.members.filter(fm => fm.familyNumber === familyNumber);
                        const familyData = {
                            "requestId": familyId,
                            "nominatorId": parsed.nominatorId,
                            "organisationId": parsed.organisationId,
                            "nominatorDetail": parsed.nominatorDetail,
                            "familyDetail": Functions.createDetailPreview ('familyDetail', { members: familyMembers }),
                            "reference": validReference,
                            "totalUnit": familyMembers.length,
                            "dateSubmitted": timeStamp,
                            "allocatedTo": "unallocated",
                            "status": "unallocated",
                        }
                    
                        console.log('CREATE FAMILY', familyData, familiesTableName);
                        /* */
                        const newRequest = await Dynamo.write(familyData, familiesTableName).catch(err => {
                            console.log('error in dynamo write', err);
                            return Responses._400({ messages: err });
                        });

                        if (!newRequest) {
                            return Responses._400({ message: 'Failed to write db by ID' });
                        }
                        /* */
                        createdFamiliesReturn.push(familyData);

                        existingFamilyData = {
                            familyNumber: familyNumber,
                            data: {
                                familyId,
                                validReference,
                                totalUnit: 1,
                            },
                        }
                        createdFamilies.push(existingFamilyData);
                    }

                    const familyMember = await Dynamo.get(
                        {
                            "requestId": m.requestId,
                        }, 
                        familyMembersTableName
                    ).catch(err => {
                        console.log('error in dynamo query', err);
                        return Responses._400({ messages: err });
                    });


                    if (!familyMember.familyId) {
                        console.log('Family Member not found', m.requestId, familyMember);
                        return Responses._400({ message: 'Unable to find existing family' });
                    }
                    
                    familyMember.familyId = familyId;
                    
                    console.log('UPDATE MEMBER!', familyMember, familyMembersTableName);
                    /* */
                    await Dynamo.write(familyMember, familyMembersTableName).catch(err => {
                        console.log('error in dynamo write', err);
                        return Responses._400({ messages: err });
                    });
                    /* */
                } else {
                    // This one is staying where it is!
                    const familyData = await Dynamo.get(
                        {
                            "requestId": m.familyId,
                        }, 
                        familiesTableName
                    ).catch(err => {
                        console.log('error in dynamo query', err, m.familyId);
                        return Responses._400({ messages: err });
                    });

                    if (!familyData.requestId) {
                        console.log('Family ID not found', m.familyId);
                        return Responses._400({ message: 'Unable to find existing family' });
                    }

                    const familyMembers = parsed.members.filter(fm => !fm.familyNumber || fm.familyNumber === 1);
                    if (familyMembers && familyMembers.length) {
                        familyData.totalUnit = familyMembers.length
                        familyData.familyDetail = Functions.createDetailPreview ('familyDetail', { members: familyMembers });
                        familyData.status = familyData.status ? familyData.status : 'unallocated';
                            
                        console.log('UPDATE FAMILY!', familyData, familiesTableName);
                        /* */
                        await Dynamo.write(familyData, familiesTableName).catch(err => {
                            console.log('error in dynamo write', err);
                            return Responses._400({ messages: err });
                        });
                        /* */
                    } else {
                        console.log('family update failed!', familyMembers, parsed.members, familyNumber);
                    }
                }
            }
        }

        console.log(createdFamiliesReturn);

        return Responses._200({ messages: { 'success': `Family split successfully` }, families: createdFamiliesReturn});
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};