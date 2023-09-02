const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');

exports.handler = async (event, context, cb) => {
    try {
        const orgMapping = {};
        const nominatorMapping = {};
        const familyMapping = {};
        const batchData = [];
        
        //Add Campaigns
        /* */
        batchData.push({
            PutRequest: {
                Item: {
                    "PK": "C1",
                    "SK": "2022-04-01T00:00:00#campaign",
                    "dateSubmitted": "2022-04-01 00:00:00",
                    "GSI1CAMPAIGN": "C1",
                    "GSI1PK": "C1",
                    "GSI1SK": "22022-04-01T00:00:00#campaign",
                    "name": "CAUSE Christmas Hampers 2022",
                    "status": "active",
                    "type": "campaign"
                }
            }
        });
        batchData.push({
            PutRequest: {
                Item: {
                    "PK": "C2",
                    "SK": "2023-07-02T00:00:00#campaign",
                    "dateSubmitted": "2023-07-02 00:00:00",
                    "GSI1CAMPAIGN": "C1",
                    "GSI1PK": "C1",
                    "GSI1SK": "2023-07-02T00:00:00#campaign",
                    "name": "CAUSE Christmas Hampers 2023",
                    "status": "active",
                    "type": "campaign"
                }
            }
        });
        /* */

        //Add Organisations
        let restoreFrom = 'cause-organisations-live';
        const restoreTo = process.env.MASTER_TABLE;
        
        let dynamoParams = {"TableName": restoreFrom};
        const allOrgs = await Dynamo.scan(dynamoParams).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });
        const escapeRegEx = new RegExp(/[^a-zA-Z]/g);
        if (allOrgs && allOrgs.length) {
            console.log('Orgs to migrate', allOrgs.length)
            for (const [i, tableData] of allOrgs.entries()) {
                if (!orgMapping[tableData.requestId]) {
                    orgMapping[tableData.requestId] = {"PK":tableData.reference, "SK": "SK#"+tableData.reference.replace(escapeRegEx, '')};
                }
                /* */
                const newOrg = {
                    "PK": tableData.reference,
                    "SK": "SK#"+tableData.reference.replace(escapeRegEx, ''),
                    "dateSubmitted": tableData.dateSubmitted,
                    "GSI1CAMPAIGN": "C1",
                    "GSI1PK": "C1",
                    "GSI1SK": "A",
                    "hashedData": tableData.hashedData,
                    "hashSalt": tableData.hashSalt,
                    "name": tableData.name,
                    "status": tableData.status,
                    "type": "organisation"
                }
                batchData.push({
                    PutRequest: {
                        Item: newOrg
                    }
                });
                /* */
            }
        }

        //Add Nominators
        restoreFrom = 'cause-nominators-live';
        
        dynamoParams = {"TableName": restoreFrom};
        const allNominators = await Dynamo.scan(dynamoParams).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });
        if (allNominators && allNominators.length) {
            console.log('Noms to migrate', allNominators.length)
            for (const [i, tableData] of allNominators.entries()) {
                
                if (!nominatorMapping[tableData.requestId]) {
                    nominatorMapping[tableData.requestId] = {"PK":tableData.userReference, "SK": `LASTNAME#${tableData.lastName}#FIRSTNAME#${tableData.firstName}`};
                }
                /* */
                const newNominator = {
                    "PK": (orgMapping[tableData.organisationId] ? orgMapping[tableData.organisationId].PK : "MISSING")+tableData.userReference,
                    "SK": `LASTNAME#${tableData.lastName}#FIRSTNAME#${tableData.firstName}`,
                    "cognitoId": tableData.cognitoId,
                    "cognitoIdv1": tableData.cognitoIdv1 ?? "",
                    "dateSubmitted": tableData.dateSubmitted,
                    "emailAddress": tableData.emailAddress,
                    "emailSent": tableData.emailSent,
                    "firstName": tableData.firstName,
                    "GSI1CAMPAIGN": "C1",
                    "GSI1PK": orgMapping[tableData.organisationId] ? orgMapping[tableData.organisationId].PK : "MISSING",
                    "GSI1SK": orgMapping[tableData.organisationId] ? orgMapping[tableData.organisationId].SK : "MISSING",
                    "lastName": tableData.lastName,
                    "status": tableData.status,
                    "telephoneNumber": tableData.telephoneNumber,
                    "type": "nominator",
                }
                batchData.push({
                    PutRequest: {
                        Item: newNominator
                    }
                });
                /* */
            }
        }

        //Add Families
        /* *
        restoreFrom = 'cause-families-live';
        
        dynamoParams = {"TableName": restoreFrom};
        let alldata = await Dynamo.scan(dynamoParams).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });
        if (alldata && alldata.length) {
            console.log('Fams to migrate', alldata.length)
            for (const [i, tableData] of alldata.entries()) {
                
                if (!familyMapping[tableData.requestId]) {
                    familyMapping[tableData.requestId] = {"PK":tableData.reference, "SK": `SIZE#${tableData.totalUnit}`};
                }

                const newItem = {
                    "PK": tableData.reference,
                    "SK": `SIZE#${tableData.totalUnit}`,
                    "dateSubmitted": tableData.dateSubmitted,
                    "GSI1CAMPAIGN": "C1",
                    "GSI1PK": nominatorMapping[tableData.nominatorId] ? nominatorMapping[tableData.nominatorId].PK : "MISSING",
                    "GSI1SK": nominatorMapping[tableData.nominatorId] ? nominatorMapping[tableData.nominatorId].SK : "MISSING",
                    "receivedDate": tableData.receivedDate,
                    "receiveStatus": tableData.receiveStatus,
                    "status": tableData.status,
                    "totalUnit": tableData.totalUnit,
                    "type": "family"
                }
                batchData.push({
                    PutRequest: {
                        Item: newItem
                    }
                });
            }
        }
        /* */

        //Add Family Members
        /* *
        restoreFrom = 'cause-family-members-live';
        
        dynamoParams = {"TableName": restoreFrom};
        alldata = await Dynamo.scan(dynamoParams).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });
        if (alldata && alldata.length) {
            console.log('Fam membss to migrate', alldata.length)
            for (const [i, tableData] of alldata.entries()) {
                const newItem = {
                    "PK": familyMapping[tableData.familyId] ? familyMapping[tableData.familyId].PK : "MISSING",
                    "SK": `${tableData.dateSubmitted}#member`,
                    "dateSubmitted": tableData.dateSubmitted,
                    "GSI1CAMPAIGN": "C1",
                    "GSI1PK": nominatorMapping[tableData.nominatorId] ? nominatorMapping[tableData.nominatorId].PK : "MISSING",
                    "GSI1SK": nominatorMapping[tableData.nominatorId] ? nominatorMapping[tableData.nominatorId].SK : "MISSING",
                    "age": tableData.age,
                    "ageType": tableData.ageType,
                    "additionalInfo": tableData.additionalInfo,
                    "status": tableData.status,
                    "who": tableData.who,
                    "whoOther": tableData.whoOther,
                    "type": "familymember"
                }
                batchData.push({
                    PutRequest: {
                        Item: newItem
                    }
                });
            }
        }
        /* */
        

        //Do the batch adds
        if (batchData && batchData.length) {
            const chunkSize = 25;
            for (let i = 0; i < batchData.length; i += chunkSize) {
                const chunk = batchData.slice(i, i + chunkSize);

                await Dynamo.batchWrite(chunk, restoreTo).catch(err => {
                    console.log('error in dynamo write', err);
                    return Responses._400({ messages: err });
                });
            }
        }

        return Responses._200({ messages: { 'success': 'Organisations migrated successfully' }});
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};
/* *
"about": {
    "M": {
      "blocks": {
        "L": [
          {
            "M": {
              "data": {
                "M": {
                  "text": {
                    "S": "We’re the original coastal specialist"
                  }
                }
              },
              "id": {
                "S": "l98dyx3yjb"
              },
              "type": {
                "S": "header"
              }
            }
          },
          {
            "M": {
              "data": {
                "M": {
                  "text": {
                    "S": "We are hugely passionate about the coast and decided long ago to focus our business on providing the very best service to the people of the area."
                  }
                }
              },
              "id": {
                "S": "mhTl6ghSkV"
              },
              "type": {
                "S": "paragraph"
              }
            }
          },
          {
            "M": {
              "data": {
                "M": {
                  "text": {
                    "S": "Our passion for the area is only surpassed by our passion for the exceptional service. We know that by achieving the best possible results for our clients, they will return to us and recommend us to their families and friends. Given the majority of our business comes by these routes, it's clear that the philosophy works."
                  }
                }
              },
              "id": {
                "S": "mhTl6SkV"
              },
              "type": {
                "S": "paragraph"
              }
            }
          }
        ]
      },
      "time": {
        "N": "1687434499871"
      }
    }
  }
/* */