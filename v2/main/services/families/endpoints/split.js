const Responses = require('../common/API_Responses');
const Dynamo = require('../common/Dynamo');
const Hashing = require('../common/Hashing');
const Functions = require('../common/Functions');

const { nanoid } = require("nanoid");

const moment = require("moment-timezone");
const validations = [
    {
        key: 'campaign',
        required: true,
        errorMsg: 'Campaign is required',
    },
    {
        key: 'familyId',
        required: true,
        errorMsg: 'Family ID is required',
    },
    {
        key: 'members',
        required: true,
        errorMsg: 'Family members are required',
    },
];

const checkValidReference = async (reference, existingFamiliesData) => {
    const existingRef = existingFamiliesData.find(
        (f) => f?.GSI2SK === `SK#${reference}`
    );

    const referenceMatch = reference.match(/(.*)-/);
    const usersReference = referenceMatch[1];
    let validHamperId = reference.replace(referenceMatch[0], "");
    if (existingRef) {
        console.log(reference, "already exists!");
        let isUnique = false;

        let hamperIncrement = 0;
        while (!isUnique) {
            hamperIncrement++;
            let checkIncrement = hamperIncrement.toString().padStart(3, "0");
            const existingRefCheck = existingFamiliesData.find(
                (f) => f?.GSI2SK === `SK#${usersReference}-${checkIncrement}`
            );
            isUnique = existingRefCheck === undefined;

            if (hamperIncrement >= 100) {
                isUnique = true;
            }
        }
        validHamperId = hamperIncrement.toString().padStart(3, "0");
        console.log(`Rolling with: ${usersReference}-${validHamperId}`);
    }
    return `${usersReference}-${validHamperId}`;
};

exports.handler = async (event, context, cb) => {
    try {
        if (!Functions.hasPermission(event, 'Admin')) {
            return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
        }

        console.log("We are authorised...");

        const escapeRegEx = new RegExp(/(<([^>]+)>)/gi);
        const mainTableName = process.env.MAIN_DYNAMO_TABLE;

        const parsed = event.nominatorId ? event : JSON.parse(event.body);
        const userEmail = event.requestContext.authorizer.claims.email;

        const valid = await Functions.validateSubmission(parsed, validations);
        if (Object.keys(valid).length > 0) {
            return Responses._400({ messages: valid });
        }
        console.log(userEmail, 'is attempting to split family ', parsed.familyId);
        console.log("data is parsed", parsed);

        const campaignParams = {
            TableName: mainTableName,
            FilterExpression: "#pk = :pk",
            ExpressionAttributeNames: {
                "#pk": "PK",
            },
            ExpressionAttributeValues: {
                ":pk": parsed.campaign ?? "UNKNOWN",
            },
        };
        let allCampaignData = await Dynamo.scan(campaignParams).catch((err) => {
            console.log("error in dynamo query", err);
            return Responses._400({ messages: err });
        });
        console.log("campaign data recieved...", allCampaignData.length);

        const familyData = allCampaignData.find((cd) => cd?.GSI2PK === parsed.familyId && cd?.type === 'family');
        if (!familyData?.GSI3SK) {
            console.log("Family not found", parsed.familyId, familyData);
            return Responses._400({ message: "Family not found" });
        }

        console.log("family data recieved...", familyData);

        const nominatorData = allCampaignData.find((cd) => cd?.GSI2PK === familyData?.GSI3SK && (cd?.type === 'nominator' || cd?.type === 'team-lead'));
        if (!nominatorData?.PK) {
            console.log("Nominator not found", familyData?.GSI3SK, nominatorData);
            return Responses._400({ message: "Nominator not found" });
        }
        console.log("Nominator found", nominatorData);

        const organisationData = allCampaignData.find((cd) => cd?.GSI2PK === nominatorData?.GSI3PK && cd?.type === 'organisation');

        if (!organisationData?.PK) {
            console.log("Organisation not found", nominatorData?.GSI3PK, organisationData);
            return Responses._400({ message: "Unauthorised nomination" });
        }
        console.log("Organisation found", organisationData);

        let existingFamiliesData = allCampaignData.filter(
            (o) => o?.type === "family" && o.GSI3PK === organisationData.GSI2PK
        );
        console.log(existingFamiliesData.length, "Existing families");

        let updateHamperData = [];

        const timezone = process.env.TIMEZONE;
        const dateFormat = process.env.DATE_FORMAT;
        const timeStamp = moment(new Date().getTime())
            .tz(timezone)
            .format(dateFormat);

        familyData.members = [];
        familyData.familyDetail = '';

        if (parsed.members && parsed.members.length) {
            for (const [i, m] of parsed.members.entries()) {
                if (m.familyNumber === 1) {
                    familyData.members.push(m);
                } else {
                    const validReference = await checkValidReference(
                        m.hamperId.toString().replace(escapeRegEx, ""),
                        existingFamiliesData
                    );

                    let existingFamilyIndex = updateHamperData.findIndex((h) => h.GSI2SK === `SK#${validReference}`);
                    
                    if (existingFamilyIndex >= 0 && updateHamperData[existingFamilyIndex]) {
                        updateHamperData[existingFamilyIndex].members.push(m);
                    } else {
                        existingFamily = { ...familyData };

                        const familyId = nanoid(12);
                        existingFamily.SK = `REF#${familyId}`;
                        existingFamily.GSI1PK = familyId;
                        existingFamily.GSI2PK = familyId;
                        existingFamily.GSI2SK = `SK#${validReference}`;
                        existingFamily.familyDetail = '';
                        existingFamily.members = [];
                        existingFamily.totalUnit = 0;
                        existingFamily.allocatedTo = 'unallocated';
                        existingFamily.status = 'unallocated';
                        existingFamily.dateAdded = timeStamp;

                        existingFamily.members.push(m);

                        updateHamperData.push(existingFamily);
                    }
                }
            }
        }
        updateHamperData.push(familyData);

        const batchData = [];
        for (const [i, h] of updateHamperData.entries()) {
            h.totalUnit = h.members.length;
            batchData.push({
                PutRequest: {
                    Item: h,
                },
            });
        }

        if (batchData.length) {
            console.log(`${batchData.length} familys to update/create`);
            console.log(updateHamperData);
            const chunkSize = 25;
            /* */
            for (let i = 0; i < batchData.length; i += chunkSize) {
                const chunk = batchData.slice(i, i + chunkSize);

                await Dynamo.batchWrite(chunk, mainTableName).catch((err) => {
                    console.log("error in dynamo write", err);
                    return Responses._400({ messages: err });
                });
            }
            /* */
        }

        return Responses._200({ messages: { 'success': `Family split successfully` }, families: batchData });
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};