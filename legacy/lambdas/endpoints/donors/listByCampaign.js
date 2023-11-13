const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');
const Notifications = require('../../common/Notifications')

exports.handler = async (event, context, cb) => {
    try {
        if (!Functions.hasPermission(event, 'Admin')) {
            return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
        }

        let dodgyCSV = `"Donor ID","Requested Families","Chosen Options","Total Allocated"\n`;
        
        const requestId = context.awsRequestId; // Change this so that we are generating our own ID
        const { campaignId } = event.pathParameters;
        if (!campaignId) {
            return Responses._400({ messages: { 'error': 'Invalid request' } });
        }

        const donorsTableName = process.env.DONORS_TABLE;

        const campaignDonorsTableName = process.env.CAMPAIGN_DONORS_TABLE;
        const queryData = {
            'IndexName': 'campaignRequest',
            'KeyConditionExpression': 'campaignId = :campaignId',
            'ExpressionAttributeValues': {
                ':campaignId': campaignId
            }
        };
        const campaignDonors = await Dynamo.query(queryData, campaignDonorsTableName).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        if (!campaignDonors.length) {
            return Responses._200({});
        }

        const donorIds = campaignDonors.map( d => { 
            const familyDetail = JSON.parse(d.familyDetail);
            if (d.numberOfFamilies > 4) {
                if (familyDetail.length >= 1) {
                    dodgyCSV += `"${d.donorId}","${d.numberOfFamilies}","${familyDetail.length}","${d.allocatedFamilies}","https://portal.cause-foundation.org.uk/donors/view/${d.donorId}"\n`;
                    console.log('More than 4 but detail chosen..', d.donorId, d.numberOfFamilies, familyDetail.length);
                    console.log(d)
                }
            } else { 
                if (d.numberOfFamilies != familyDetail.length) {
                    dodgyCSV += `"${d.donorId}","${d.numberOfFamilies}","${familyDetail.length}","${d.allocatedFamilies}","https://portal.cause-foundation.org.uk/donors/view/${d.donorId}"\n`;
                    console.log('Details dont match...', d.donorId, d.numberOfFamilies, familyDetail.length);
                    console.log(d)
                }
            }
            return d.donorId 
        } );
        /* */

        const params = {"TableName": donorsTableName};
        const allDonorsData = await Dynamo.scan(params).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });

        const donorsData = campaignDonors.map((cd) => {
            cd.pledgeId = cd.requestId
            return Object.assign(cd, allDonorsData.find(d => cd.donorId === d.requestId));
        });

        /*
        const donorsData = allDonorsData.filter(d => donorIds.includes(d.requestId));
        */
        console.log(donorsData);
        console.log(dodgyCSV);

        return Responses._200({ ...donorsData });
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};