const Responses = require('../../common/API_Responses');
const Dynamo = require('../../common/Dynamo');
const Hashing = require('../../common/Hashing');
const Functions = require('../../common/Functions');

const moment = require("moment-timezone");
const validations = [
    {
        key: 'name',
        required: true,
        errorMsg: 'Please enter a valid organisation name',
    },
    {
        key: 'reference',
        required: true,
        errorMsg: 'Please enter a valid organisation name',
    },
    {
        key: 'contacts.lead.name',
        required: false,
        pattern: new RegExp(/[a-zA-ZÀ-ÖØ-öø-ÿ.\-\s']{1,50}/),
        errorMsg: 'Please enter a valid lead contact name',
    },
    {
        key: 'contacts.secondary.name',
        required: false,
        pattern: new RegExp(/[a-zA-ZÀ-ÖØ-öø-ÿ.\-\s']{1,50}/),
        errorMsg: 'Please enter a valid secondary contact name',
    },
    {
        key: 'contacts.lead.email',
        required: false,
        pattern: new RegExp(/^([a-z\d\-\.+]{1,50})@([a-z\d\-]{1,50})\.([a-z]{2,8})(\.[a-z]{2,8})?$/),
        errorMsg: 'Please enter a valid lead contact email address',
    },
    {
        key: 'contacts.secondary.email',
        required: false,
        pattern: new RegExp(/^([a-z\d\-\.+]{1,50})@([a-z\d\-]{1,50})\.([a-z]{2,8})(\.[a-z]{2,8})?$/),
        errorMsg: 'Please enter a valid secondary contact email address',
    },
    {
        key: 'contacts.lead.number',
        required: false,
        pattern: new RegExp(/[0-9+()\-\s]{8,30}/),
        errorMsg: 'Please enter a valid lead contact telephone number',
    },
    {
        key: 'contacts.secondary.number',
        required: false,
        pattern: new RegExp(/[0-9+()\-\s]{8,30}/),
        errorMsg: 'Please enter a valid secondary contact telephone number',
    }
];

exports.handler = async (event, context, cb) => {
    try {
        const parsed = event.reference ? event : JSON.parse(event.body);
        
        if (!parsed) {
            return Responses._400({ message: 'Failed to read submitted data: '+JSON.stringify(parsed) });
        }
        const requestId = context.awsRequestId; // Change this so that we are generating our own ID

        const valid = await Functions.validateSubmission(parsed, validations);
        if (Object.keys(valid).length > 0) {
            return Responses._400({ messages: valid });
        }

        const escapeRegEx = new RegExp(/(<([^>]+)>)/ig);

        // use replace for extra layer of security
        const validOrganisationName = parsed.name.toString().replace(escapeRegEx, '');
        const validOrganisationReference = parsed.reference.toString().replace(escapeRegEx, '');
        const validLeadContactName = parsed.contacts.lead.name.toString().replace(escapeRegEx, '');
        const validLeadContactNumber = parsed.contacts.lead.number.toString().replace(escapeRegEx, '').replace(' ', '');
        const validLeadContactEmail = parsed.contacts.lead.email.toString().replace(escapeRegEx, '');
        const validSecondaryContactName = parsed.contacts.secondary.name.toString().replace(escapeRegEx, '');
        const validSecondaryContactNumber = parsed.contacts.secondary.number.toString().replace(escapeRegEx, '').replace(' ', '');
        const validSecondaryContactEmail = parsed.contacts.secondary.email.toString().replace(escapeRegEx, '');

    

        const timezone = process.env.TIMEZONE;
        const dateFormat = process.env.DATE_FORMAT;
        const timeStamp = moment((new Date()).getTime()).tz(timezone).format(dateFormat);
        const tableName = process.env.ORGANISATIONS_TABLE;
        const requestData = {
            "requestId": requestId,
            "hashSalt": Hashing.generateSalt(6),
            "hashedData": Hashing.generateSalt(14) + '-' + Hashing.generateSalt(14),
            "name": validOrganisationName,
            "reference": validOrganisationReference,
            "leadContactName": validLeadContactName,
            "leadContactNumber": validLeadContactNumber,
            "leadContactEmail": validLeadContactEmail,
            "secondaryContactName": validSecondaryContactName,
            "secondaryContactNumber": validSecondaryContactNumber,
            "secondaryContactEmail": validSecondaryContactEmail,
            "dateSubmitted": timeStamp,
            "status": "",
        }

        const newRequest = await Dynamo.write(requestData, tableName).catch(err => {
            console.log('error in dynamo write', err);
            return Responses._400({ messages: err });
        });

        if (!newRequest) {
            return Responses._400({ message: 'Failed to write db by ID' });
        }

        return Responses._200({ messages: { 'success': 'Creation successful' }, registrationId: requestId, tableName, requestData});
    } catch (e) {
        console.log(`An unexpected error occurred ${e}`);
        return Responses._400({ messages: { 'unexpected': 'An unexpected error occurred' } });
    }
};