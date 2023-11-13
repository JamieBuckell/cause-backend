const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');
const Notifications = require('../../common/Notifications');

const moment = require("moment-timezone");
const uuid = require('uuid');

const AWS = require('aws-sdk');
AWS.config.update({region: 'eu-west-2'});
var sqs = new AWS.SQS({apiVersion: '2012-11-05'});

const validations = [
    {
        key: 'email.subject',
        required: true,
        pattern: new RegExp(/[a-zA-ZÀ-ÖØ-öø-ÿ.\-\s']{1,50}/),
        errorMsg: 'Please enter a valid email subject',
    },
    {
        key: 'email.title',
        required: true,
        pattern: new RegExp(/[a-zA-ZÀ-ÖØ-öø-ÿ.\-\s']{1,50}/),
        errorMsg: 'Please enter a valid email title',
    },
    {
        key: 'email.content',
        required: true,
        errorMsg: 'Please enter valid email content',
    }
];

exports.handler = async (event, context, cb) => {
    try {
        if (!Functions.hasPermission(event, 'Admin')) {
            return Responses._401({ messages: { 'unauthorized': 'You are not authorized to view this section' } });
        }

        const parsed = event.email ? event : JSON.parse(event.body);
        if (!parsed) {
            return Responses._400({ message: 'Failed to read submitted data: '+JSON.stringify(parsed) });
        }

        const valid = await Functions.validateSubmission(parsed, validations);
        if (Object.keys(valid).length > 0) {
            return Responses._400({ messages: valid });
        }

        const donorsTableName = process.env.DONORS_TABLE;
        const campaignDonorsTableName = process.env.CAMPAIGN_DONORS_TABLE;
        const nomTableName = process.env.NOMINATORS_TABLE;
        const emailsTableName = process.env.EMAILS_TABLE;
        const emailsSubscribersTableName = process.env.EMAILS_SUBSCRIBERS_TABLE;
        const timezone = process.env.TIMEZONE;
        const dateFormat = process.env.DATE_FORMAT;

        const escapeRegEx = new RegExp(/(<([^>]+)>)/ig);

        const verifiedSubject = parsed.email.subject.toString().replace(escapeRegEx, '');
        const verifiedTitle = parsed.email.title.toString().replace(escapeRegEx, '');
        const verifiedContent = parsed.email.content;

        const existingEmailId = parsed?.existingEmailId ?? '';

        var emailRecipients = [];

        const recipientType = parsed.options?.type ?? 'specific';
        console.log(`Getting Subscribers For Email Type: ${recipientType}`)
        switch (recipientType) {
            case 'specific':
                emailRecipients = parsed.options.toAddresses.map((email) => ({
                    requestId: "unknown",
                    email,
                }));
                break;
            case 'subscribers':
                const donorParams = {"TableName": donorsTableName};
                emailRecipients = await Dynamo.scan(donorParams).catch(err => {
                    console.log('error in dynamo query', err);
                    return Responses._400({ messages: err });
                });
                emailRecipients = emailRecipients.filter(d => d.subscribed === true && d.verified === true);

                if (parsed.options.excludePledged) {
                    const pledgedParams = {"TableName": campaignDonorsTableName};
                    const allPledged = await Dynamo.scan(pledgedParams).catch(err => {
                        console.log('error in dynamo query', err);
                        return Responses._400({ messages: err });
                    });
                    const pledgedDonorIds = allPledged.flatMap(d => d.donorId)

                    emailRecipients = emailRecipients.filter(d => !pledgedDonorIds.includes(d.requestId));
                }
                break;

            case 'nominators':
                const nomParams = {"TableName": nomTableName};
                emailRecipients = await Dynamo.scan(nomParams).catch(err => {
                    console.log('error in dynamo query', err);
                    return Responses._400({ messages: err });
                });

                if (parsed.options.excludeTeamLeads) {
                    emailRecipients = emailRecipients.filter(n => !n.isAdmin);
                }

                // Format for SQS
                emailRecipients = emailRecipients.map((nom) => ({
                    requestId: nom.requestId,
                    email: nom.emailAddress,
                }));
                break;
            case 'teamleads':
                const teamLeadParams = {"TableName": nomTableName};
                emailRecipients = await Dynamo.scan(teamLeadParams).catch(err => {
                    console.log('error in dynamo query', err);
                    return Responses._400({ messages: err });
                });

                emailRecipients = emailRecipients.filter(n => n.isAdmin);

                // Format for SQS
                emailRecipients = emailRecipients.map((nom) => ({
                    requestId: nom.requestId,
                    email: nom.emailAddress,
                }));
                break;
            case 'donors':
                const donorParams2 = {"TableName": nomTableName};
                const allDonors = await Dynamo.scan(donorParams2).catch(err => {
                    console.log('error in dynamo query', err);
                    return Responses._400({ messages: err });
                });
                const pledgedParams = {"TableName": campaignDonorsTableName};
                const allPledged = await Dynamo.scan(pledgedParams).catch(err => {
                    console.log('error in dynamo query', err);
                    return Responses._400({ messages: err });
                });
                const pledgedDonorIds = allPledged.flatMap(d => d.donorId);

                allSubscribers = allDonors.filter(d => pledgedDonorIds.includes(d.requestId));
                break;
        }
        console.log(`Total subscribers: ${emailRecipients.length}`);

        const emailId = existingEmailId ? existingEmailId : uuid.v4();
        const emailData = {
            "requestId": emailId,
            "subject": verifiedSubject,
            "title": verifiedTitle,
            "content": verifiedContent,
            "dateCreated": moment((new Date()).getTime()).tz(timezone).format(dateFormat),
            "recipientCount": emailRecipients.length,
            "options": JSON.stringify(parsed.options),
        }

        var receivedSubscriberIds = [];
        if (!existingEmailId) {
            await Dynamo.write(emailData, emailsTableName).catch(err => {
                console.log('error in dynamo write', err);
                return Responses._400({ messages: err });
            });
        } else {
            const searchQueryData = {
                'IndexName': 'emailRequest',
                'KeyConditionExpression': 'emailId = :emailId',
                'ExpressionAttributeValues': {
                    ':emailId': existingEmailId
                }
            };
            const receivedSubscribers = await Dynamo.query(searchQueryData, emailsSubscribersTableName).catch(err => {
                console.log('error in dynamo query', err);
                return Responses._400({ messages: err });
            });

            receivedSubscriberIds = receivedSubscribers.flatMap(d => d.subscriberId);
            emailRecipients = emailRecipients.filter(d => !receivedSubscriberIds.includes(d.requestId));

            console.log(`Total subscribers (excluding previously sent): ${emailRecipients.length}`);
        }

        for (const subscriber of emailRecipients) {
            /* */
            const emailedSubscriberId = uuid.v4();
            const emailedSubscriberData = {
                "requestId": emailedSubscriberId,
                "emailId": emailId,
                "subscriberId": subscriber.requestId,
                "dateSent": "",
            }
            await Dynamo.write(emailedSubscriberData, emailsSubscribersTableName).catch(err => {
                console.log('error in dynamo write', err);
                return Responses._400({ messages: err });
            });
            /* */

            // Add to SQS!

            const jsonParameters = {
                ToAddresses: [subscriber.email],
                subject: verifiedSubject,
                pageTitle: verifiedTitle,
                pageContent: verifiedContent,
            };
            var params = {
                // Remove DelaySeconds parameter and value for FIFO queues
                DelaySeconds: 10,
                MessageAttributes: {
                    "jsonParameters": {
                        DataType: "String",
                        StringValue: JSON.stringify(jsonParameters)
                    },
                    "emailedSubscriberId": {
                        DataType: "String",
                        StringValue: emailedSubscriberId
                    },
                },
                MessageBody: `Email message to subscriber id ${emailedSubscriberId} for email ${emailId}`,
                // MessageDeduplicationId: "TheWhistler",  // Required for FIFO queues
                // MessageGroupId: "Group1",  // Required for FIFO queues
                QueueUrl: `https://sqs.${process.env.AWS_ACCOUNT_REGION}.amazonaws.com/${process.env.AWS_ACCOUNT_ID}/${process.env.MAILER_QUEUE}`
            };

            // console.log(`Email message to subscriber id ${emailedSubscriberId} for email ${emailId}: ${subscriber.email}`);
            
            await sqs.sendMessage(params).promise();
        }

        return Responses._200({ messages: { 'success': 'Email Sending Complete' }});

    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};