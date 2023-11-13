const Responses = require('../../common/API_Responses')
const Dynamo = require('../../common/Dynamo')
const Hashing = require('../../common/Hashing')
const Functions = require('../../common/Functions')
const Notifications = require('../../common/Notifications')

const moment = require('moment-timezone')

exports.handler = async (event, context, cb) => {
  try {
    // Hourly Cron Job
    const donorsTableName = process.env.DONORS_TABLE
    const familiesTableName = process.env.FAMILIES_TABLE;
    const familyMembersTableName = process.env.FAMILY_MEMBERS_TABLE;
    const envSalt = process.env.HASHING_SALT;
    const timezone = process.env.TIMEZONE
    const dateFormat = process.env.DATE_FORMAT

    const getAllocationReminders = async (status = 'allocated-unconfirmed') => {
        const queryData = {
            IndexName: 'statusRequest',
            KeyConditionExpression: '#status = :status',
            ExpressionAttributeNames: {
                "#status": "status"
            },
            ExpressionAttributeValues: {
                ':status': status,
            },
        }
        let familyData = await Dynamo.query(queryData, familiesTableName).catch(
            (err) => {
                console.log('error in dynamo query', err)
                return Responses._400({ messages: err })
            }
        )
        
        let notifyList = [];
        if (familyData && familyData.length) {
            const uniqueNominators = familyData.filter(
            (f, i) =>
                familyData.findIndex((obj) => (obj.allocatedTo === f.allocatedTo) && (obj.campaignRequestId === f.campaignRequestId)) === i
            )
            if (uniqueNominators && uniqueNominators.length) {
                notifyList = uniqueNominators.map(f => ({
                    allocatedTo: f.allocatedTo, 
                    notifiedDate: f.allocationEmailSentDate,
                    reminders: f.reminders ? f.reminders : 0
                }));
            }
        }
        return { reminderUsers:notifyList, familyData };
    }

    const timeStamp = moment(new Date().getTime())
      .tz(timezone)
      .format(dateFormat)
    const currentHour = moment().hour()

    switch (currentHour) {
        default:
            let {reminderUsers, familyData} = await getAllocationReminders();
            if (reminderUsers && reminderUsers.length) {
                const batchData = [];
                
                console.log('Reminders to check', reminderUsers.length);
                let reminderCount = 0;
                for (const [i, reminder] of reminderUsers.entries()) {
                    if (reminder.reminders >= 2) {
                        continue;
                    }

                    let emailTemplate = '';
                    let daysCheck = 2;

                    switch (reminder.reminders) {
                        case 0:
                            emailTemplate = 'donorFamilyAllocationReminder1';
                            daysCheck = 2;
                            break;
                        case 1:
                            emailTemplate = 'donorFamilyAllocationReminder1';
                            daysCheck = 4;
                            break;
                        case 1:
                            emailTemplate = 'donorFamilyAllocationReminder2';
                            daysCheck = 6;
                            break;
                    }

                    if (!emailTemplate) {
                        continue;
                    }

                    const dateCheck = moment(reminder.notifiedDate)
                        .add(daysCheck, 'd')
                        .tz(timezone)
                        .format(dateFormat);

                    if (timeStamp >= dateCheck) {
                        console.log('reminder due!', reminder);

                        // Just do 1 for now
                        if (reminder.reminders >= 1) {
                            continue;
                        }
                        reminderCount++;

                        const updateFamilies = familyData.filter(f => f.allocatedTo === reminder.allocatedTo);
                        let campaignRequestId = '';
                        if (updateFamilies) {
                            console.log(updateFamilies);
                            const reminderCount = reminder.reminders + 1;
                            for (const [j, f] of updateFamilies.entries()) {
                                if (!campaignRequestId && f.campaignRequestId) {
                                    campaignRequestId = f.campaignRequestId
                                }
                                f.reminders = reminderCount;
                                batchData.push({
                                    PutRequest: {
                                        Item: f
                                    }
                                });
                            }
                        }

                        const donorData = await Dynamo.get(
                            {
                                "requestId": reminder.allocatedTo,
                            }, 
                            donorsTableName
                        ).catch(err => {
                            console.log('error in dynamo query', err);
                            return Responses._400({ messages: err });
                        });

                        if (!donorData) {
                            console.log("Donor doesn't exist", donorData);
                            continue;
                        }

                        console.log('We have the donor data', donorData);
                        donorData.donorHash = Hashing.hash(donorData.requestId, envSalt).hashedpassword;

                        const queryFamilyData = {
                            'IndexName': 'allocatedToRequest',
                            'KeyConditionExpression': 'allocatedTo = :donorId',
                            'ExpressionAttributeValues': {
                                ':donorId': reminder.allocatedTo
                            }
                        };
                        const familiesData = await Dynamo.query(queryFamilyData, familiesTableName).catch(err => {
                            console.log('error in dynamo query', err);
                            return Responses._400({ messages: { 'error': 'An unexpected error occurred. Please try again later' }});
                        });

                        const familyMemberQueryData = {
                            'IndexName': 'donorFamilyRequest',
                            'KeyConditionExpression': 'allocatedTo = :allocatedTo',
                            'ExpressionAttributeValues': {
                                ':allocatedTo': reminder.allocatedTo
                            }
                        };
                        let familiesMembersData = await Dynamo.query(familyMemberQueryData, familyMembersTableName).catch(err => {
                            console.log('error in dynamo query', err);
                            return Responses._400({ messages: err });
                        });

                        let standardTemplate = await Notifications.getEmailTemplate();
                        const rawEmailJsonParameters = await Functions.generateAllocationEmails(donorData, familiesData, familiesMembersData, standardTemplate, emailTemplate, false, campaignRequestId);
                        console.log(rawEmailJsonParameters);
                        await Notifications.sendRawEmail(rawEmailJsonParameters);
                    }

                    if (reminderCount >= 10) {
                        break;
                    }
                }

                if (batchData && batchData.length) {
                    const chunkSize = 25;
                    for (let i = 0; i < batchData.length; i += chunkSize) {
                        const chunk = batchData.slice(i, i + chunkSize);
                        
                        /* *
                        for (const [k, i] of chunk.entries()) {
                            console.log(k, i.PutRequest.Item)
                        }
                        /* */
                        await Dynamo.batchWrite(chunk, familiesTableName).catch(err => {
                            console.log('error in dynamo write', err);
                            return Responses._400({ messages: err });
                        });
                        /* */
                    }
                }
            }
            break
    }

    return Responses._200({ messages: { success: 'Email Sending Complete' } })
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`)
    return Responses._400({
      messages: { unexpected: 'An unexpected error occurred' },
    })
  }
}